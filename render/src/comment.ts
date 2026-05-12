import type { ProjectResult, QualityGateStatus } from "./types.js";

type IconState = "passed" | "failed" | "no-data";
export type IconStyle = "cloud" | "community-plugin";

export function inferIconStyle(hostUrl: string): IconStyle {
  try {
    const { hostname } = new URL(hostUrl);
    if (hostname === "sonarcloud.io" || hostname.endsWith(".sonarcloud.io")) {
      return "cloud";
    }
  } catch {
    // fall through to community-plugin default
  }
  return "community-plugin";
}

// Literal U+00A0 (non-breaking space). The HTML entity `&nbsp;` is sometimes
// normalised to a regular space by GitHub's markdown sanitiser; the literal
// character can't be stripped, so icon+label and multi-word phrases stay on
// one line.
const NB = " ";

const COMMENT_TEMPLATE = `## {header}

| Project | Gate | Issues | Sec. | Coverage | Duplications |
| --- | --- | --- | --- | --- | --- |
{rows}{footer}
`;
const ROW_TEMPLATE =
  "| {project} | {gate} | {issues} | {security} | {coverage} | {duplications} |";
const NOT_ANALYZED_ROW = "| {project} | Not analyzed | - | - | - | - |";
const FOOTER_TEMPLATE = "\n\n<sub>{text}</sub>";

const GATES: Record<QualityGateStatus, { state: IconState; text: string }> = {
  OK: { state: "passed", text: "Pass" },
  ERROR: { state: "failed", text: "<strong>Fail</strong>" },
  WARN: { state: "no-data", text: "WARN" },
  NONE: { state: "no-data", text: "NONE" },
  UNKNOWN: { state: "no-data", text: "UNKNOWN" },
};

export interface RenderOptions {
  header: string;
  iconBaseUrl: string;
  iconStyle: IconStyle;
  footer?: string;
}

export function renderComment(
  results: ProjectResult[],
  opts: RenderOptions,
): string {
  return fill(COMMENT_TEMPLATE, {
    header: opts.header,
    rows: results.map((r) => renderRow(r, opts)).join("\n"),
    footer: opts.footer ? fill(FOOTER_TEMPLATE, { text: opts.footer }) : "",
  });
}

export function overallQualityGate(
  results: ProjectResult[],
): QualityGateStatus {
  if (results.length === 0) return "NONE";
  if (results.some((r) => r.qualityGate === "ERROR")) return "ERROR";
  return results.find((r) => r.qualityGate !== "OK")?.qualityGate ?? "OK";
}

function renderRow(r: ProjectResult, opts: RenderOptions): string {
  const project = `<a href="${r.dashboardUrl}">${r.label}</a>`;
  if (!r.analyzed) return fill(NOT_ANALYZED_ROW, { project });

  const u = new URL(r.dashboardUrl);
  const host = `${u.protocol}//${u.host}`;
  const pr = u.searchParams.get("pullRequest") ?? "";
  const key = encodeURIComponent(r.projectKey);
  const common = `${opts.iconBaseUrl}/common`;
  const newCode = "issueStatuses=OPEN,CONFIRMED&sinceLeakPeriod=true";
  const issues = `${host}/project/issues?id=${key}&pullRequest=${pr}`;
  const measures = `${host}/component_measures?id=${key}&pullRequest=${pr}`;

  const gate = GATES[r.qualityGate];
  const gateIcon =
    opts.iconStyle === "cloud"
      ? `${opts.iconBaseUrl}/checks/QualityGateBadge/qg-${gate.state}-20px.png`
      : `${opts.iconBaseUrl}/checks/QualityGateBadge/${gate.state}-16px.png`;

  return fill(ROW_TEMPLATE, {
    project,
    gate: linkedIcon("Gate", gateIcon, gate.text, r.dashboardUrl),
    issues:
      linkedIcon(
        "New",
        `${common}/${countState(r.issues.new)}-16px.png`,
        `${r.issues.new ?? "?"}${NB}New`,
        `${issues}&${newCode}`,
      ) +
      "<br>" +
      linkedIcon(
        "Accepted",
        `${common}/accepted-16px.png`,
        `${r.issues.accepted ?? "?"}${NB}Acc.`,
        `${issues}&issueStatuses=ACCEPTED`,
      ),
    security: linkedIcon(
      "Security",
      `${common}/${countState(r.newSecurityHotspots)}-16px.png`,
      `${r.newSecurityHotspots ?? "?"}`,
      `${host}/project/security_hotspots?id=${key}&pullRequest=${pr}&${newCode}`,
    ),
    coverage: stackedPercent(
      r.newCoverage,
      r.coverage,
      "Coverage",
      common,
      `${measures}&metric=new_coverage&view=list`,
    ),
    duplications: stackedPercent(
      r.newDuplications,
      r.duplications,
      "Duplications",
      common,
      `${measures}&metric=new_duplicated_lines_density&view=list`,
    ),
  });
}

function fill(template: string, values: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (_, key) => values[key] ?? "");
}

function linkedIcon(
  alt: string,
  iconUrl: string,
  text: string,
  href: string,
): string {
  return `<a href="${href}"><img src="${iconUrl}" alt="${alt}">${NB}${text}</a>`;
}

function countState(count: number | null): IconState {
  if (count === null) return "no-data";
  return count === 0 ? "passed" : "failed";
}

function stackedPercent(
  newValue: number | null,
  postValue: number | null,
  alt: string,
  common: string,
  url: string,
): string {
  const row = (v: number | null, label: string): string => {
    const state: IconState = v === null ? "no-data" : "passed";
    return linkedIcon(alt, `${common}/${state}-16px.png`, label, url);
  };
  return (
    row(
      newValue,
      newValue === null ? `No${NB}data` : `${newValue.toFixed(1)}%${NB}new`,
    ) +
    "<br>" +
    row(
      postValue,
      postValue === null
        ? `No${NB}data`
        : `~${postValue.toFixed(1)}%${NB}merged`,
    )
  );
}
