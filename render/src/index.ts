import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import * as core from "@actions/core";
import * as github from "@actions/github";
import * as glob from "@actions/glob";
import { overallQualityGate, renderComment } from "./comment.js";
import type { Globber } from "./deps.js";
import { SonarClient, type SonarClientDeps, stripTrailingSlash } from "./sonar.js";
import { loadFromProjects, parseProjectsInput, ReportTaskLoader } from "./sources.js";
import type { ProjectResult, SonarConfig } from "./types.js";

const realDeps: SonarClientDeps & { readFile: (p: string) => Promise<string>; glob: Globber } = {
  fetch: globalThis.fetch.bind(globalThis),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  readFile: (p) => fs.readFile(p, "utf8"),
  glob: async (patterns) => {
    const globber = await glob.create(patterns, { matchDirectories: false });
    return globber.glob();
  },
};

async function run(): Promise<void> {
  try {
    const sonarHostUrl = core.getInput("sonar-host-url");
    const sonarToken = core.getInput("sonar-token");
    const projectsRaw = core.getInput("projects");
    const reportTaskFiles = core.getInput("report-task-files");
    const commentHeader = core.getInput("comment-header") || "SonarQube PR analysis";
    const failOnGate = core.getBooleanInput("fail-on-quality-gate");
    const iconStyle = (core.getInput("icon-style") || "cloud") as "cloud" | "community-plugin";
    if (iconStyle !== "cloud" && iconStyle !== "community-plugin") {
      throw new Error(`icon-style must be "cloud" or "community-plugin", got: ${iconStyle}`);
    }
    const iconBaseUrl = core.getInput("icon-base-url") || defaultIconBase(iconStyle, sonarHostUrl);
    const footer = core.getInput("footer") || "Aggregated from per-project SonarQube scans.";

    const pullRequestInput = core.getInput("pr-number");
    const pullRequest = pullRequestInput || `${github.context.payload.pull_request?.number ?? ""}`;
    if (!pullRequest) {
      throw new Error("Could not determine pull request number — set the `pr-number` input.");
    }

    if (!projectsRaw && !reportTaskFiles) {
      throw new Error("Provide at least one of `projects` or `report-task-files`.");
    }
    if (!sonarHostUrl || !sonarToken) {
      throw new Error("`sonar-host-url` and `sonar-token` are required.");
    }

    const config: SonarConfig = { hostUrl: sonarHostUrl, token: sonarToken };
    const client = new SonarClient(config, realDeps);
    const reportTaskLoader = new ReportTaskLoader(client, realDeps);

    const results: ProjectResult[] = [];
    if (projectsRaw) {
      const projects = parseProjectsInput(projectsRaw);
      results.push(...(await loadFromProjects(client, projects, pullRequest)));
    }
    if (reportTaskFiles) {
      results.push(...(await reportTaskLoader.load(reportTaskFiles, pullRequest, true)));
    }

    const overall = overallQualityGate(results);
    core.setOutput("quality-gate", overall);
    core.setOutput("results-json", JSON.stringify(results));

    if (results.length === 0) {
      core.warning("No SonarQube results to aggregate; skipping comment body.");
      return;
    }

    const body = renderComment(results, {
      header: commentHeader,
      iconBaseUrl,
      iconStyle,
      footer,
    });

    const tmpDir = process.env.RUNNER_TEMP || os.tmpdir();
    const bodyPath = path.join(tmpDir, "sonarqube-multi-project-comment.md");
    await fs.writeFile(bodyPath, body, "utf8");
    core.setOutput("body-path", bodyPath);

    if (failOnGate && overall === "ERROR") {
      core.setFailed("One or more SonarQube quality gates failed.");
    }
  } catch (err) {
    core.setFailed((err as Error).message);
  }
}

function defaultIconBase(style: "cloud" | "community-plugin", sonarHostUrl: string): string {
  if (style === "cloud") {
    return "https://sonarsource.github.io/sonarcloud-github-static-resources/v2";
  }
  return `${stripTrailingSlash(sonarHostUrl)}/static/communityBranchPlugin`;
}

await run();
