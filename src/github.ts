import * as core from "@actions/core";
import * as github from "@actions/github";

type Octokit = ReturnType<typeof github.getOctokit>;

interface Repo {
  owner: string;
  repo: string;
}

export interface UpsertOptions {
  octokit: Octokit;
  repo: Repo;
  issueNumber: number;
  marker: string;
  body: string;
  hidePrevious: boolean;
}

export interface UpsertResult {
  commentId: number;
  created: boolean;
}

export async function upsertComment(opts: UpsertOptions): Promise<UpsertResult> {
  const existing = await findExistingComment(opts);

  if (!existing) {
    const created = await opts.octokit.rest.issues.createComment({
      ...opts.repo,
      issue_number: opts.issueNumber,
      body: opts.body,
    });
    return { commentId: created.data.id, created: true };
  }

  if (opts.hidePrevious) {
    await hideComment(opts.octokit, existing.nodeId).catch((err) => {
      core.warning(`Could not hide previous comment: ${(err as Error).message}`);
    });
    const created = await opts.octokit.rest.issues.createComment({
      ...opts.repo,
      issue_number: opts.issueNumber,
      body: opts.body,
    });
    return { commentId: created.data.id, created: true };
  }

  await opts.octokit.rest.issues.updateComment({
    ...opts.repo,
    comment_id: existing.id,
    body: opts.body,
  });
  return { commentId: existing.id, created: false };
}

async function findExistingComment(opts: UpsertOptions): Promise<{ id: number; nodeId: string } | null> {
  for await (const page of opts.octokit.paginate.iterator(opts.octokit.rest.issues.listComments, {
    ...opts.repo,
    issue_number: opts.issueNumber,
    per_page: 100,
  })) {
    for (const comment of page.data) {
      if (comment.body && comment.body.includes(opts.marker)) {
        return { id: comment.id, nodeId: comment.node_id };
      }
    }
  }
  return null;
}

async function hideComment(octokit: Octokit, subjectId: string): Promise<void> {
  await octokit.graphql(
    `mutation Hide($subjectId: ID!) {
      minimizeComment(input: { subjectId: $subjectId, classifier: OUTDATED }) {
        minimizedComment { isMinimized }
      }
    }`,
    { subjectId },
  );
}
