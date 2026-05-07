import * as fs from "node:fs/promises";
import * as core from "@actions/core";
import * as glob from "@actions/glob";
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

export async function loadFromReportTaskFiles(
  client: SonarClient,
  patterns: string,
  pullRequest: string,
  waitForTask: boolean,
): Promise<ProjectResult[]> {
  if (!patterns.trim()) return [];
  const globber = await glob.create(patterns, { matchDirectories: false });
  const files = await globber.glob();
  if (files.length === 0) {
    core.warning(`No report-task.txt files matched: ${patterns}`);
    return [];
  }

  const tasks = await Promise.all(
    files.map(async (file) => {
      const content = await fs.readFile(file, "utf8");
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
          await client.waitForCeTask(task.ceTaskId);
        } catch (err) {
          core.warning(
            `Wait for SonarQube analysis failed for ${task.projectKey}: ${(err as Error).message}`,
          );
        }
      }
      return client.fetchProject(task.projectKey, task.projectKey, pullRequest);
    }),
  );
}
