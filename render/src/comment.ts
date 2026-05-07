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
  const lines: string[] = [];
  lines.push(`## ${opts.header}`);
  lines.push("");
  lines.push("| Project | Gate | Issues | Security | Coverage | Duplications |");
  lines.push("| --- | --- | --- | --- | --- | --- |");
  for (const r of results) {
    lines.push(renderRow(r, opts));
  }
  if (opts.footer) {
    lines.push("");
    lines.push(`<sub>${opts.footer}</sub>`);
  }
  return lines.join("\n") + "\n";
}

function renderRow(r: ProjectResult, opts: RenderOptions): string {
  const { iconBaseUrl } = opts;
  const projectCell = link(r.label, r.dashboardUrl);

  if (!r.analyzed) {
    return `| ${projectCell} | Not analyzed | - | - | - | - |`;
  }

  const gateState = qualityGateState(r.qualityGate);
  const gateText = qualityGateText(r.qualityGate);
  const gateIcon = gateBadgeUrl(iconBaseUrl, opts.iconStyle, gateState);
  const gateCell = linkedIcon("Gate", gateIcon, gateText, r.dashboardUrl);

  const issuesUrl = (extra: string) => `${baseHost(r.dashboardUrl)}/project/issues?id=${encodeKey(r.projectKey)}&${extra}`;
  const newUrl = issuesUrl(`pullRequest=${prFrom(r.dashboardUrl)}&resolved=false`);
  const fixedUrl = issuesUrl(`fixedInPullRequest=${prFrom(r.dashboardUrl)}`);
  const acceptedUrl = issuesUrl(`pullRequest=${prFrom(r.dashboardUrl)}&issueStatus=ACCEPTED`);
  const securityUrl = `${baseHost(r.dashboardUrl)}/security_hotspots?id=${encodeKey(r.projectKey)}&pullRequest=${prFrom(r.dashboardUrl)}`;
  const coverageUrl = `${baseHost(r.dashboardUrl)}/component_measures?id=${encodeKey(r.projectKey)}&metric=new_coverage&pullRequest=${prFrom(r.dashboardUrl)}&view=list`;
  const duplicationsUrl = `${baseHost(r.dashboardUrl)}/component_measures?id=${encodeKey(r.projectKey)}&metric=new_duplicated_lines_density&pullRequest=${prFrom(r.dashboardUrl)}&view=list`;

  const commonIcon = `${iconBaseUrl}/common`;

  const newCount = r.issues.new;
  const fixedCount = r.issues.fixed;
  const acceptedCount = r.issues.accepted;
  const newLink = linkedIcon(
    "New",
    `${commonIcon}/${countState(newCount)}-16px.png`,
    `${formatCount(newCount)} New`,
    newUrl,
  );
  const fixedLink = linkedIcon(
    "Fixed",
    `${commonIcon}/fixed-16px.png`,
    `${formatCount(fixedCount)} Fixed`,
    fixedUrl,
  );
  const acceptedLink = linkedIcon(
    "Accepted",
    `${commonIcon}/accepted-16px.png`,
    `${formatCount(acceptedCount)} Acc.`,
    acceptedUrl,
  );
  const issuesCell = `${newLink}<br>${fixedLink}<br>${acceptedLink}`;

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

function pctLabel(value: number | null, qualifier: string): string {
  if (value === null) return `No ${qualifier} data`;
  return `${value.toFixed(1)}% ${qualifier}`;
}

function formatCount(count: number | null): string {
  return count === null ? "?" : String(count);
}

function linkedIcon(alt: string, iconUrl: string, text: string, href: string): string {
  return `<a href="${href}"><img src="${iconUrl}" alt="${alt}"> ${text}</a>`;
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
