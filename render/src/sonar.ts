import * as core from "@actions/core";
import type { IssueCounts, ProjectResult, QualityGateStatus, ReportTask, SonarConfig } from "./types.js";

const MEASURE_METRICS = [
  "new_coverage",
  "coverage",
  "new_duplicated_lines_density",
  "duplicated_lines_density",
  "new_security_hotspots",
];

export class SonarClient {
  private readonly authHeader: string;

  constructor(private readonly config: SonarConfig) {
    const encoded = Buffer.from(`${config.token}:`).toString("base64");
    this.authHeader = `Basic ${encoded}`;
  }

  get hostUrl(): string {
    return this.config.hostUrl.replace(/\/+$/, "");
  }

  get iconBaseUrl(): string {
    return this.config.iconBaseUrl.replace(/\/+$/, "");
  }

  private url(path: string, params: Record<string, string | undefined>): string {
    const search = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== "") search.set(k, v);
    }
    const qs = search.toString();
    return `${this.hostUrl}${path}${qs ? `?${qs}` : ""}`;
  }

  private async get<T>(path: string, params: Record<string, string | undefined>): Promise<T | undefined> {
    const url = this.url(path, params);
    try {
      const res = await fetch(url, { headers: { Authorization: this.authHeader } });
      if (!res.ok) {
        core.debug(`GET ${url} → ${res.status}`);
        return undefined;
      }
      return (await res.json()) as T;
    } catch (err) {
      core.debug(`GET ${url} threw: ${(err as Error).message}`);
      return undefined;
    }
  }

  async waitForCeTask(taskId: string, timeoutMs = 5 * 60_000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    let delay = 2_000;
    while (Date.now() < deadline) {
      const data = await this.get<{ task: { status: string } }>("/api/ce/task", { id: taskId });
      const status = data?.task?.status;
      if (status === "SUCCESS") return;
      if (status === "FAILED" || status === "CANCELED") {
        throw new Error(`Compute Engine task ${taskId} ended with status ${status}`);
      }
      await sleep(delay);
      delay = Math.min(delay * 1.5, 10_000);
    }
    throw new Error(`Compute Engine task ${taskId} did not finish within ${timeoutMs}ms`);
  }

  async fetchProject(label: string, projectKey: string, pullRequest: string): Promise<ProjectResult> {
    const dashboardUrl = `${this.hostUrl}/dashboard?id=${encodeURIComponent(projectKey)}&pullRequest=${encodeURIComponent(pullRequest)}`;

    const qg = await this.get<QualityGateResponse>("/api/qualitygates/project_status", {
      projectKey,
      pullRequest,
    });
    const status = (qg?.projectStatus.status as QualityGateStatus) ?? "NONE";

    if (status === "NONE") {
      return emptyResult(label, projectKey, dashboardUrl, status, false);
    }

    const [newIssues, acceptedIssues, measures] = await Promise.all([
      this.countIssues(projectKey, { pullRequest, inNewCodePeriod: "true", resolved: "false" }),
      this.countIssues(projectKey, { pullRequest, issueStatuses: "ACCEPTED" }),
      this.fetchMeasures(projectKey, pullRequest),
    ]);

    return {
      label,
      projectKey,
      qualityGate: status,
      analyzed: true,
      issues: {
        new: newIssues,
        accepted: acceptedIssues,
      } satisfies IssueCounts,
      newSecurityHotspots: parseIntOrNull(measures.new_security_hotspots) ?? 0,
      newCoverage: parseFloatOrNull(measures.new_coverage),
      coverage: parseFloatOrNull(measures.coverage),
      newDuplications: parseFloatOrNull(measures.new_duplicated_lines_density),
      duplications: parseFloatOrNull(measures.duplicated_lines_density),
      dashboardUrl,
    };
  }

  private async countIssues(
    projectKey: string,
    params: Record<string, string>,
  ): Promise<number | null> {
    const res = await this.get<{ total: number }>("/api/issues/search", {
      componentKeys: projectKey,
      ps: "1",
      ...params,
    });
    return typeof res?.total === "number" ? res.total : null;
  }

  private async fetchMeasures(
    projectKey: string,
    pullRequest: string,
  ): Promise<Record<string, string | undefined>> {
    const res = await this.get<MeasuresResponse>("/api/measures/component", {
      component: projectKey,
      pullRequest,
      metricKeys: MEASURE_METRICS.join(","),
    });
    const out: Record<string, string | undefined> = {};
    for (const m of res?.component.measures ?? []) {
      out[m.metric] = m.period?.value ?? m.value;
    }
    return out;
  }
}

function emptyResult(
  label: string,
  projectKey: string,
  dashboardUrl: string,
  qualityGate: QualityGateStatus,
  analyzed: boolean,
): ProjectResult {
  return {
    label,
    projectKey,
    qualityGate,
    analyzed,
    issues: { new: null, accepted: null },
    newSecurityHotspots: null,
    newCoverage: null,
    coverage: null,
    newDuplications: null,
    duplications: null,
    dashboardUrl,
  };
}

function parseIntOrNull(value: string | undefined): number | null {
  if (value === undefined || value === "") return null;
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) ? n : null;
}

function parseFloatOrNull(value: string | undefined): number | null {
  if (value === undefined || value === "") return null;
  const n = Number.parseFloat(value);
  return Number.isFinite(n) ? n : null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function parseReportTask(content: string): ReportTask {
  const map: Record<string, string> = {};
  for (const raw of content.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    map[line.slice(0, eq).trim()] = line.slice(eq + 1).trim();
  }
  if (!map.projectKey || !map.ceTaskId) {
    throw new Error("report-task.txt missing required keys (projectKey, ceTaskId)");
  }
  return {
    projectKey: map.projectKey,
    serverUrl: map.serverUrl,
    dashboardUrl: map.dashboardUrl,
    ceTaskId: map.ceTaskId,
    ceTaskUrl: map.ceTaskUrl,
  };
}

interface QualityGateResponse {
  projectStatus: {
    status: string;
  };
}

interface MeasuresResponse {
  component: {
    measures: Array<{
      metric: string;
      value?: string;
      period?: { value?: string };
    }>;
  };
}
