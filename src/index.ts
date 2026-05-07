import * as core from "@actions/core";
import * as github from "@actions/github";
import { overallQualityGate, renderComment } from "./comment";
import { upsertComment } from "./github";
import { SonarClient } from "./sonar";
import {
  loadFromProjects,
  loadFromReportTaskFiles,
  parseInlineResults,
  parseProjectsInput,
} from "./sources";
import type { ProjectResult, SonarConfig } from "./types";

const DEFAULT_MARKER = "<!-- sonarqube-multi-project-comment -->";

async function run(): Promise<void> {
  try {
    const sonarHostUrl = core.getInput("sonar-host-url");
    const sonarToken = core.getInput("sonar-token");
    const projectsRaw = core.getInput("projects");
    const reportTaskFiles = core.getInput("report-task-files");
    const resultsJson = core.getInput("results-json");
    const githubToken = core.getInput("github-token", { required: true });
    const commentHeader = core.getInput("comment-header") || "SonarQube PR analysis";
    const failOnGate = core.getBooleanInput("fail-on-quality-gate");
    const hidePrevious = core.getBooleanInput("hide-previous");
    const marker = core.getInput("comment-marker") || DEFAULT_MARKER;
    const iconBaseUrl =
      core.getInput("icon-base-url") || `${sonarHostUrl.replace(/\/+$/, "")}/static/communityBranchPlugin`;
    const footer =
      core.getInput("footer") ||
      "Aggregated from per-project SonarQube scans. Re-runs hide the previous comment as outdated.";

    const pullRequestInput = core.getInput("pr-number");
    const pullRequest = pullRequestInput || `${github.context.payload.pull_request?.number ?? ""}`;
    if (!pullRequest) {
      throw new Error("Could not determine pull request number — set the `pr-number` input.");
    }

    const sources = countSources({ projectsRaw, reportTaskFiles, resultsJson });
    if (sources === 0) {
      throw new Error("Provide at least one of `projects`, `report-task-files`, or `results-json`.");
    }

    const needsClient = projectsRaw || reportTaskFiles;
    let client: SonarClient | undefined;
    if (needsClient) {
      if (!sonarHostUrl || !sonarToken) {
        throw new Error("`sonar-host-url` and `sonar-token` are required when querying the SonarQube API.");
      }
      const config: SonarConfig = { hostUrl: sonarHostUrl, token: sonarToken, iconBaseUrl };
      client = new SonarClient(config);
    }

    const results: ProjectResult[] = [];

    if (resultsJson) {
      results.push(...parseInlineResults(resultsJson));
    }
    if (projectsRaw && client) {
      const projects = parseProjectsInput(projectsRaw);
      results.push(...(await loadFromProjects(client, projects, pullRequest)));
    }
    if (reportTaskFiles && client) {
      results.push(...(await loadFromReportTaskFiles(client, reportTaskFiles, pullRequest, true)));
    }

    if (results.length === 0) {
      core.warning("No SonarQube results to aggregate; skipping comment.");
      core.setOutput("quality-gate", "NONE");
      return;
    }

    const body = renderComment(results, {
      header: commentHeader,
      marker,
      iconBaseUrl,
      footer,
    });

    const overall = overallQualityGate(results);
    core.setOutput("quality-gate", overall);
    core.setOutput("results-json", JSON.stringify(results));

    const octokit = github.getOctokit(githubToken);
    const repo = github.context.repo;
    const issueNumber = Number.parseInt(pullRequest, 10);

    const { commentId } = await upsertComment({
      octokit,
      repo,
      issueNumber,
      marker,
      body,
      hidePrevious,
    });
    core.setOutput("comment-id", commentId);

    if (failOnGate && overall === "ERROR") {
      core.setFailed("One or more SonarQube quality gates failed.");
    }
  } catch (err) {
    core.setFailed((err as Error).message);
  }
}

function countSources(inputs: { projectsRaw: string; reportTaskFiles: string; resultsJson: string }): number {
  return [inputs.projectsRaw, inputs.reportTaskFiles, inputs.resultsJson].filter((v) => v.trim().length > 0).length;
}

void run();
