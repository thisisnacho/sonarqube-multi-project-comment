import * as core from "@actions/core";
import type { Globber, ReadFile } from "./deps.js";
import { parseReportTask, SonarClient } from "./sonar.js";
import type { ProjectInput, ProjectResult } from "./types.js";

export function parseProjectsInput(raw: string): ProjectInput[] {
  if (!raw.trim()) return [];
  const out: ProjectInput[] = [];
  for (const piece of raw.split(/[\n,]+/)) {
    const trimmed = piece.trim();
    if (!trimmed) continue;
    const sep = trimmed.indexOf("|");
    if (sep === -1) {
      out.push({ label: trimmed, key: trimmed });
    } else {
      out.push({
        label: trimmed.slice(0, sep).trim(),
        key: trimmed.slice(sep + 1).trim(),
      });
    }
  }
  return out;
}

export async function loadFromProjects(
  client: SonarClient,
  projects: ProjectInput[],
  pullRequest: string,
): Promise<ProjectResult[]> {
  return Promise.all(projects.map((p) => client.fetchProject(p.label, p.key, pullRequest)));
}

export interface ReportTaskLoaderDeps {
  readFile: ReadFile;
  glob: Globber;
}

export class ReportTaskLoader {
  constructor(
    private readonly client: SonarClient,
    private readonly deps: ReportTaskLoaderDeps,
  ) {}

  async load(patterns: string, pullRequest: string, waitForTask: boolean): Promise<ProjectResult[]> {
    if (!patterns.trim()) return [];
    const files = await this.deps.glob(patterns);
    if (files.length === 0) {
      core.warning(`No report-task.txt files matched: ${patterns}`);
      return [];
    }

    const tasks = await Promise.all(
      files.map(async (file) => {
        const content = await this.deps.readFile(file);
        try {
          return parseReportTask(content);
        } catch (err) {
          core.warning(`Skipping ${file}: ${(err as Error).message}`);
          return undefined;
        }
      }),
    );

    const valid = tasks.filter((t): t is NonNullable<typeof t> => Boolean(t));
    return Promise.all(
      valid.map(async (task) => {
        if (waitForTask) {
          try {
            await this.client.waitForCeTask(task.ceTaskId);
          } catch (err) {
            core.warning(
              `Wait for SonarQube analysis failed for ${task.projectKey}: ${(err as Error).message}`,
            );
          }
        }
        return this.client.fetchProject(task.projectKey, task.projectKey, pullRequest);
      }),
    );
  }
}
