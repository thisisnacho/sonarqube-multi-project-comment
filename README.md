# sonarqube-multi-project-comment

A GitHub Action that aggregates quality-gate results from multiple SonarQube
projects analyzed within the same pull request and posts (or updates) a
**single** comment summarising all of them.

If your monorepo runs the scanner once per project (matrix build, multiple
`sonar-project.properties`, …) you usually end up with one PR comment per
project. Disable per-project PR decoration in SonarQube and use this action
instead — one comment, easier to skim, history collapses cleanly on every
re-run.

## Inputs

You can feed the action three different ways. They can also be combined.

| Input | Description |
| --- | --- |
| `sonar-host-url` | Base URL of the SonarQube/SonarCloud instance. |
| `sonar-token` | Token used to authenticate against the SonarQube API. |
| `projects` | Newline- or comma-separated list of `LABEL|KEY` (or just `KEY`). |
| `report-task-files` | Glob of `report-task.txt` files produced by the scanner. |
| `results-json` | Pre-built JSON array of `ProjectResult` (escape hatch). |
| `pr-number` | PR number override. Defaults to `github.event.pull_request.number`. |
| `github-token` | Token for PR comment read/write. Defaults to `github.token`. |
| `comment-header` | Heading. Defaults to `SonarQube PR analysis`. |
| `comment-marker` | Hidden HTML marker used to locate the comment on re-runs. |
| `icon-base-url` | Base URL for status icons. Defaults to the community branch plugin path. |
| `footer` | Optional text rendered below the table. |
| `hide-previous` | Hide the prior comment as `OUTDATED` and post fresh (default `true`). When `false`, edits in place. |
| `fail-on-quality-gate` | Fail the action when any project's gate is `ERROR`. |

## Outputs

| Output | Description |
| --- | --- |
| `comment-id` | ID of the comment that was created or updated. |
| `quality-gate` | `OK` if every project passed, otherwise `ERROR` / `NONE`. |
| `results-json` | JSON array of per-project results. |

## Usage

### Hard-coded project list

```yaml
sonar-summary:
  needs: [scan-security, scan-web, scan-api]
  if: always()
  runs-on: ubuntu-latest
  permissions:
    pull-requests: write
  steps:
    - uses: thisisnacho/sonarqube-multi-project-comment@v1
      with:
        sonar-host-url: ${{ vars.SONAR_HOST_URL }}
        sonar-token: ${{ secrets.SONAR_TOKEN }}
        projects: |
          frontend|acme-frontend
          backend|acme-backend
          services/api|acme-services-api
          agents/rag|acme-rag
```

### Auto-discovery from `report-task.txt`

Have each scan job upload its `report-task.txt` artifact, then aggregate:

```yaml
- uses: actions/download-artifact@v4
  with:
    pattern: sonar-report-*
    path: sonar-reports
- uses: thisisnacho/sonarqube-multi-project-comment@v1
  with:
    sonar-host-url: ${{ vars.SONAR_HOST_URL }}
    sonar-token: ${{ secrets.SONAR_TOKEN }}
    report-task-files: sonar-reports/**/report-task.txt
```

### Inline JSON

```yaml
- uses: thisisnacho/sonarqube-multi-project-comment@v1
  with:
    results-json: ${{ steps.collect.outputs.results }}
```

The JSON array follows the `ProjectResult` shape exported from `src/types.ts`.

## Behaviour

- The comment is found via the hidden `comment-marker` HTML comment so
  successive runs update the same thread.
- With `hide-previous: true` (default) the previous aggregated comment is
  collapsed as `OUTDATED` via GitHub's `minimizeComment` GraphQL mutation and a
  fresh comment is posted; this matches the UX of `marocchino/sticky-pull-request-comment`
  with `hide_classify: OUTDATED`.
- Set `hide-previous: false` to edit the existing comment in place.

## Permissions

```yaml
permissions:
  contents: read
  pull-requests: write
```

## Development

```sh
npm install
npm run build   # bundles src/ → dist/index.js with ncc
```

The bundled `dist/` is committed because GitHub Actions runs the published
`main` file directly.
