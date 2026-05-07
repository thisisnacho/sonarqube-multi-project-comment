# sonarqube-multi-project-comment

Aggregate SonarQube quality-gate results from multiple projects into a
**single** PR comment — one row per project, hidden as outdated on every
re-run.

If your monorepo runs the scanner once per project (matrix build, multiple
`sonar-project.properties`, …) you usually end up with one PR comment per
project. Disable per-project PR decoration in SonarQube and use this action
instead.

## Usage

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

## Data sources

The action needs to know which projects to summarise. Pick whichever fits
your pipeline — they can also be combined.

<details>
<summary><strong>1. <code>projects</code> — explicit list</strong> (simplest)</summary>

Each line is `LABEL|KEY`, or just `KEY` to use the key as the label. Requires
`sonar-host-url` and `sonar-token`.

```yaml
- uses: thisisnacho/sonarqube-multi-project-comment@v1
  with:
    sonar-host-url: ${{ vars.SONAR_HOST_URL }}
    sonar-token: ${{ secrets.SONAR_TOKEN }}
    projects: |
      frontend|acme-frontend
      backend|acme-backend
```
</details>

<details>
<summary><strong>2. <code>report-task-files</code> — auto-discover from scanner output</strong> (best for matrix builds)</summary>

Have each scan job upload its `report-task.txt` artifact, then aggregate.
The action waits for each Compute Engine task to finish before querying the
API.

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
</details>

<details>
<summary><strong>3. <code>results-json</code> — inline pre-built results</strong> (escape hatch)</summary>

For projects scanned outside the standard scanner, or when you want to
synthesise rows from another tool. The JSON array follows the
`ProjectResult` shape exported from `render/src/types.ts`.

```yaml
- uses: thisisnacho/sonarqube-multi-project-comment@v1
  with:
    results-json: ${{ steps.collect.outputs.results }}
```
</details>

## Inputs

| Input | Default | Description |
| --- | --- | --- |
| `sonar-host-url` | — | Base URL of the SonarQube/SonarCloud instance. |
| `sonar-token` | — | Token used to authenticate against the SonarQube API. |
| `projects` | — | Newline- or comma-separated list of `LABEL\|KEY` (or just `KEY`). |
| `report-task-files` | — | Glob of `report-task.txt` files produced by the scanner. |
| `results-json` | — | Pre-built JSON array of `ProjectResult` results. |
| `pr-number` | from context | Pull request number override. |
| `comment-header` | `SonarQube PR analysis` | Heading rendered above the table. |
| `icon-base-url` | `<host>/static/communityBranchPlugin` | Base URL for status icons. |
| `footer` | _(set)_ | Text rendered below the table inside `<sub>`. |
| `fail-on-quality-gate` | `false` | Fail the job when any gate is `ERROR`. |
| `github-token` | `${{ github.token }}` | Token used to read/write PR comments. |
| `sticky-header` | `sonarqube-aggregate` | Identifier `sticky-pull-request-comment` uses to dedupe. |
| `hide-and-recreate` | `true` | Hide the previous aggregated comment and post fresh. |
| `hide-classify` | `OUTDATED` | Classifier for GitHub's `minimizeComment` mutation. |
| `skip-unchanged` | `true` | Skip posting when the body matches the existing comment. |

## Outputs

| Output | Description |
| --- | --- |
| `quality-gate` | `OK` if every project passed, otherwise `ERROR` / `NONE`. |
| `results-json` | JSON array of per-project results. |
| `body-path` | Path to the rendered comment body file. |

## Permissions

```yaml
permissions:
  contents: read
  pull-requests: write
```

## How it works

This is a composite action. It runs two steps:

1. A bundled Node sub-action (`./render`) gathers data from the SonarQube API
   and renders the markdown table.
2. [`marocchino/sticky-pull-request-comment`][sticky] posts the body and hides
   the previous aggregated comment as outdated.

[sticky]: https://github.com/marocchino/sticky-pull-request-comment

## Development

```sh
cd render
npm install
npm run build   # bundles src/ → render/dist/index.js with ncc
```

The bundled `render/dist/` is committed because GitHub Actions runs the
sub-action's `main` file directly.
