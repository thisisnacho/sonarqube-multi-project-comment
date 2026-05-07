import type { ProjectResult, QualityGateStatus } from "./types.js";

type IconState = "passed" | "failed" | "no-data";

export type IconStyle = "cloud" | "community-plugin";

export interface RenderOptions {
  header: string;
  iconBaseUrl: string;
  iconStyle: IconStyle;
  footer?: string;
}

export function renderComment(results: ProjectResult[], opts: RenderOptions): string {
  const lines = [
    `## ${opts.header}`,
    "",
    "| Project | Gate | Issues | Security | Coverage | Duplications |",
    "| --- | --- | --- | --- | --- | --- |",
    ...results.map((r) => renderRow(r, opts)),
  ];
  if (opts.footer) {
    lines.push("", `<sub>${opts.footer}</sub>`);
  }
  return lines.join("\n") + "\n";
}

function renderRow(r: ProjectResult, opts: RenderOptions): string {
  const { iconBaseUrl } = opts;
  const projectCell = link(r.label, r.dashboardUrl);

  if (!r.analyzed) {
    return `| ${projectCell} | Not&nbsp;analyzed | - | - | - | - |`;
  }

  const host = baseHost(r.dashboardUrl);
  const pr = prFrom(r.dashboardUrl);
  const key = encodeKey(r.projectKey);

  const gateState = qualityGateState(r.qualityGate);
  const gateText = qualityGateText(r.qualityGate);
  const gateIcon = gateBadgeUrl(iconBaseUrl, opts.iconStyle, gateState);
  const gateCell = linkedIcon("Gate", gateIcon, gateText, r.dashboardUrl);

  const newCodeFilter = `issueStatuses=OPEN,CONFIRMED&sinceLeakPeriod=true`;
  const newUrl = `${host}/project/issues?id=${key}&pullRequest=${pr}&${newCodeFilter}`;
  const acceptedUrl = `${host}/project/issues?id=${key}&pullRequest=${pr}&issueStatuses=ACCEPTED`;
  const securityUrl = `${host}/project/security_hotspots?id=${key}&pullRequest=${pr}&${newCodeFilter}`;
  const coverageUrl = `${host}/component_measures?id=${key}&pullRequest=${pr}&metric=new_coverage&view=list`;
  const duplicationsUrl = `${host}/component_measures?id=${key}&pullRequest=${pr}&metric=new_duplicated_lines_density&view=list`;

  const commonIcon = `${iconBaseUrl}/common`;

  const newLink = linkedIcon(
    "New",
    `${commonIcon}/${countState(r.issues.new)}-16px.png`,
    `${formatCount(r.issues.new)}&nbsp;New`,
    newUrl,
  );
  const acceptedLink = linkedIcon(
    "Accepted",
    `${commonIcon}/accepted-16px.png`,
    `${formatCount(r.issues.accepted)}&nbsp;Acc.`,
    acceptedUrl,
  );
  const issuesCell = `${newLink}<br>${acceptedLink}`;

  const securityCell = linkedIcon(
    "Security",
    `${commonIcon}/${countState(r.newSecurityHotspots)}-16px.png`,
    `${formatCount(r.newSecurityHotspots)}`,
    securityUrl,
  );

  const coverageCell = stackedPercent(
    r.newCoverage,
    r.coverage,
    "Coverage",
    commonIcon,
    coverageUrl,
  );
  const duplicationsCell = stackedPercent(
    r.newDuplications,
    r.duplications,
    "Duplications",
    commonIcon,
    duplicationsUrl,
  );

  return `| ${projectCell} | ${gateCell} | ${issuesCell} | ${securityCell} | ${coverageCell} | ${duplicationsCell} |`;
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
      return "Passed";
    case "ERROR":
      return "<strong>Failed</strong>";
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
  if (qualifier === "post-merge") {
    return value === null
      ? "No&nbsp;data&nbsp;if&nbsp;merged"
      : `~${value.toFixed(1)}%&nbsp;if&nbsp;merged`;
  }
  return value === null ? "No&nbsp;new&nbsp;data" : `${value.toFixed(1)}%&nbsp;new`;
}

function formatCount(count: number | null): string {
  return count === null ? "?" : String(count);
}

function linkedIcon(alt: string, iconUrl: string, text: string, href: string): string {
  // &nbsp; (non-breaking space) keeps the icon and label on the same line
  // when the cell is narrow; a regular space lets GitHub's table renderer
  // wrap them onto separate lines.
  return `<a href="${href}"><img src="${iconUrl}" alt="${alt}">&nbsp;${text}</a>`;
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
