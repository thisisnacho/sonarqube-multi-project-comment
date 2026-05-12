import * as core from "@actions/core";
import type {
  ProjectResult,
  QualityGateStatus,
  ReportTask,
  SonarConfig,
} from "./types.js";

export class SonarClient {
  private readonly authHeader: string;

  constructor(private readonly config: SonarConfig) {
    this.authHeader = `Basic ${Buffer.from(config.token + ":").toString("base64")}`;
  }

  get hostUrl(): string {
    return stripTrailingSlash(this.config.hostUrl);
  }

  private async get<T>(
    path: string,
    params: Record<string, string>,
  ): Promise<T | undefined> {
    const url = `${this.hostUrl}${path}?${new URLSearchParams(params).toString()}`;
    try {
      const res = await fetch(url, {
        headers: { Authorization: this.authHeader },
      });
      if (!res.ok) return undefined;
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
      const data = await this.get<{ task: { status: string } }>(
        "/api/ce/task",
        {
          id: taskId,
        },
      );
      const status = data?.task?.status;
      if (status === "SUCCESS") return;
      if (status === "FAILED" || status === "CANCELED") {
        throw new Error(
          `Compute Engine task ${taskId} ended with status ${status}`,
        );
      }
      await new Promise((r) => setTimeout(r, delay));
      delay = Math.min(delay * 1.5, 10_000);
    }
    throw new Error(
      `Compute Engine task ${taskId} did not finish within ${timeoutMs}ms`,
    );
  }

  async fetchProject(
    label: string,
    projectKey: string,
    pullRequest: string,
  ): Promise<ProjectResult> {
    const dashboardUrl = `${this.hostUrl}/dashboard?id=${encodeURIComponent(projectKey)}&pullRequest=${encodeURIComponent(pullRequest)}`;

    const qg = await this.get<{ projectStatus: { status: string } }>(
      "/api/qualitygates/project_status",
      { projectKey, pullRequest },
    );
    const status = (qg?.projectStatus.status as QualityGateStatus) ?? "NONE";

    if (status === "NONE") {
      return {
        label,
        projectKey,
        qualityGate: status,
        analyzed: false,
        issues: { new: null, accepted: null },
        newSecurityHotspots: null,
        newCoverage: null,
        coverage: null,
        newDuplications: null,
        duplications: null,
        dashboardUrl,
      };
    }

    const [newIssues, acceptedIssues, measures] = await Promise.all([
      this.countIssues(projectKey, {
        pullRequest,
        inNewCodePeriod: "true",
        resolved: "false",
      }),
      this.countIssues(projectKey, { pullRequest, issueStatuses: "ACCEPTED" }),
      this.fetchMeasures(projectKey, pullRequest),
    ]);

    return {
      label,
      projectKey,
      qualityGate: status,
      analyzed: true,
      issues: { new: newIssues, accepted: acceptedIssues },
      newSecurityHotspots: numOrNull(measures.new_security_hotspots) ?? 0,
      newCoverage: numOrNull(measures.new_coverage),
      coverage: numOrNull(measures.coverage),
      newDuplications: numOrNull(measures.new_duplicated_lines_density),
      duplications: numOrNull(measures.duplicated_lines_density),
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
    const res = await this.get<{
      component: {
        measures: {
          metric: string;
          value?: string;
          period?: { value?: string };
        }[];
      };
    }>("/api/measures/component", {
      component: projectKey,
      pullRequest,
      metricKeys:
        "new_coverage,coverage,new_duplicated_lines_density,duplicated_lines_density,new_security_hotspots",
    });
    const out: Record<string, string | undefined> = {};
    for (const m of res?.component.measures ?? []) {
      out[m.metric] = m.period?.value ?? m.value;
    }
    return out;
  }
}

function numOrNull(value: string | undefined): number | null {
  if (!value) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export function stripTrailingSlash(s: string): string {
  let r = s;
  while (r.endsWith("/")) r = r.slice(0, -1);
  return r;
}

export function parseReportTask(content: string): ReportTask {
  const map: Record<string, string> = {};
  for (const line of content.split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq === -1) continue;
    map[t.slice(0, eq).trim()] = t.slice(eq + 1).trim();
  }
  if (!map.projectKey || !map.ceTaskId) {
    throw new Error(
      "report-task.txt missing required keys (projectKey, ceTaskId)",
    );
  }
  return {
    projectKey: map.projectKey,
    serverUrl: map.serverUrl,
    dashboardUrl: map.dashboardUrl,
    ceTaskId: map.ceTaskId,
    ceTaskUrl: map.ceTaskUrl,
  };
}
