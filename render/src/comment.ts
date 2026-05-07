import type { ProjectResult, QualityGateStatus } from "./types.js";

type IconState = "passed" | "failed" | "no-data";

export type IconStyle = "cloud" | "community-plugin";

// Literal U+00A0 (non-breaking space). Used inside table cells to keep
// icon+label and multi-word phrases on the same rendered line. The HTML
// entity `&nbsp;` is sometimes normalised to a regular space by GitHub's
// markdown sanitiser, so we ship the literal character instead.
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

export interface RenderOptions {
  header: string;
  iconBaseUrl: string;
  iconStyle: IconStyle;
  footer?: string;
}

export function renderComment(results: ProjectResult[], opts: RenderOptions): string {
  return fill(COMMENT_TEMPLATE, {
    header: opts.header,
    rows: results.map((r) => renderRow(r, opts)).join("\n"),
    footer: opts.footer ? fill(FOOTER_TEMPLATE, { text: opts.footer }) : "",
  });
}

function renderRow(r: ProjectResult, opts: RenderOptions): string {
  const projectCell = link(r.label, r.dashboardUrl);
  if (!r.analyzed) return fill(NOT_ANALYZED_ROW, { project: projectCell });
  return fill(ROW_TEMPLATE, buildCells(r, opts, projectCell));
}

function buildCells(
  r: ProjectResult,
  opts: RenderOptions,
  projectCell: string,
): Record<string, string> {
  const { iconBaseUrl } = opts;
  const host = baseHost(r.dashboardUrl);
  const pr = prFrom(r.dashboardUrl);
  const key = encodeKey(r.projectKey);
  const commonIcon = `${iconBaseUrl}/common`;

  const newCodeFilter = "issueStatuses=OPEN,CONFIRMED&sinceLeakPeriod=true";
  const issuesUrl = `${host}/project/issues?id=${key}&pullRequest=${pr}`;
  const measuresUrl = `${host}/component_measures?id=${key}&pullRequest=${pr}`;

  const gateState = qualityGateState(r.qualityGate);
  const gateIcon = gateBadgeUrl(iconBaseUrl, opts.iconStyle, gateState);

  const newLink = linkedIcon(
    "New",
    `${commonIcon}/${countState(r.issues.new)}-16px.png`,
    `${formatCount(r.issues.new)}${NB}New`,
    `${issuesUrl}&${newCodeFilter}`,
  );
  const acceptedLink = linkedIcon(
    "Accepted",
    `${commonIcon}/accepted-16px.png`,
    `${formatCount(r.issues.accepted)}${NB}Acc.`,
    `${issuesUrl}&issueStatuses=ACCEPTED`,
  );

  return {
    project: projectCell,
    gate: linkedIcon("Gate", gateIcon, qualityGateText(r.qualityGate), r.dashboardUrl),
    issues: `${newLink}<br>${acceptedLink}`,
    security: linkedIcon(
      "Security",
      `${commonIcon}/${countState(r.newSecurityHotspots)}-16px.png`,
      `${formatCount(r.newSecurityHotspots)}`,
      `${host}/project/security_hotspots?id=${key}&pullRequest=${pr}&${newCodeFilter}`,
    ),
    coverage: stackedPercent(
      r.newCoverage,
      r.coverage,
      "Coverage",
      commonIcon,
      `${measuresUrl}&metric=new_coverage&view=list`,
    ),
    duplications: stackedPercent(
      r.newDuplications,
      r.duplications,
      "Duplications",
      commonIcon,
      `${measuresUrl}&metric=new_duplicated_lines_density&view=list`,
    ),
  };
}

function fill(template: string, values: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (_, key) => values[key] ?? "");
}

function stackedPercent(
  newValue: number | null,
  postValue: number | null,
  alt: string,
  commonIcon: string,
  url: string,
): string {
  const newRow = linkedIcon(
    alt,
    `${commonIcon}/${pctState(newValue)}-16px.png`,
    pctLabel(newValue, "new"),
    url,
  );
  const postRow = linkedIcon(
    alt,
    `${commonIcon}/${pctState(postValue)}-16px.png`,
    pctLabel(postValue, "post-merge"),
    url,
  );
  return `${newRow}<br>${postRow}`;
}

function gateBadgeUrl(iconBaseUrl: string, style: IconStyle, state: IconState): string {
  return style === "cloud"
    ? `${iconBaseUrl}/checks/QualityGateBadge/qg-${state}-20px.png`
    : `${iconBaseUrl}/checks/QualityGateBadge/${state}-16px.png`;
}

function qualityGateState(status: QualityGateStatus): IconState {
  switch (status) {
    case "OK":
      return "passed";
    case "ERROR":
      return "failed";
    default:
      return "no-data";
  }
}

function qualityGateText(status: QualityGateStatus): string {
  switch (status) {
    case "OK":
      return "Pass";
    case "ERROR":
      return "<strong>Fail</strong>";
    default:
      return status;
  }
}

function countState(count: number | null): IconState {
  if (count === null) return "no-data";
  return count === 0 ? "passed" : "failed";
}

function pctState(value: number | null): IconState {
  return value === null ? "no-data" : "passed";
}

function pctLabel(value: number | null, qualifier: "new" | "post-merge"): string {
  if (value === null) return `No${NB}data`;
  if (qualifier === "post-merge") return `~${value.toFixed(1)}%${NB}merged`;
  return `${value.toFixed(1)}%${NB}new`;
}

function formatCount(count: number | null): string {
  return count === null ? "?" : String(count);
}

function linkedIcon(alt: string, iconUrl: string, text: string, href: string): string {
  return `<a href="${href}"><img src="${iconUrl}" alt="${alt}">${NB}${text}</a>`;
}

function link(text: string, href: string): string {
  return `<a href="${href}">${text}</a>`;
}

function baseHost(dashboardUrl: string): string {
  const u = new URL(dashboardUrl);
  return `${u.protocol}//${u.host}`;
}

function prFrom(dashboardUrl: string): string {
  return new URL(dashboardUrl).searchParams.get("pullRequest") ?? "";
}

function encodeKey(projectKey: string): string {
  return encodeURIComponent(projectKey);
}

export function overallQualityGate(results: ProjectResult[]): QualityGateStatus {
  if (results.length === 0) return "NONE";
  let saw: QualityGateStatus = "OK";
  for (const r of results) {
    if (r.qualityGate === "ERROR") return "ERROR";
    if (r.qualityGate !== "OK") saw = r.qualityGate;
  }
  return saw;
}
