# sonarqube-multi-project-comment

A GitHub Action that aggregates quality-gate results from multiple SonarQube
projects analyzed within the same pull request and posts (or updates) a
**single** comment summarising all of them.

If your monorepo runs the scanner once per project (matrix build, multiple
`sonar-project.properties`, …) you usually end up with one PR comment per
project. Disable per-project PR decoration in SonarQube and use this action
instead — one comment, easier to skim, history collapses cleanly on every
re-run.

## How it works

This is a composite action. It runs two steps:

1. A bundled Node sub-action (`./render`) gathers data from the SonarQube API
   and renders the markdown table.
2. [`marocchino/sticky-pull-request-comment`][sticky] posts the body and hides
   the previous aggregated comment as outdated.

[sticky]: https://github.com/marocchino/sticky-pull-request-comment

## Inputs

### Data sources (pick one or combine)

| Input | Description |
| --- | --- |
| `sonar-host-url` | Base URL of the SonarQube/SonarCloud instance. |
| `sonar-token` | Token used to authenticate against the SonarQube API. |
| `projects` | Newline- or comma-separated list of `LABEL\|KEY` (or just `KEY`). |
| `report-task-files` | Glob of `report-task.txt` files produced by the scanner. |
| `results-json` | Pre-built JSON array of `ProjectResult` (escape hatch). |

### Rendering

| Input | Default | Description |
| --- | --- | --- |
| `comment-header` | `SonarQube PR analysis` | Heading. |
| `icon-base-url` | `<host>/static/communityBranchPlugin` | Base URL for status icons. |
| `footer` | _(set)_ | Text rendered below the table inside `<sub>`. |
| `pr-number` | from context | PR number override. |
| `fail-on-quality-gate` | `false` | Fail the job when any gate is `ERROR`. |

### Sticky comment behaviour (passed through to `sticky-pull-request-comment`)

| Input | Default | Description |
| --- | --- | --- |
| `github-token` | `${{ github.token }}` | Token used to read/write PR comments. |
| `sticky-header` | `sonarqube-aggregate` | Identifier sticky uses to dedupe its comment. |
| `hide-and-recreate` | `true` | Hide previous aggregated comment, post fresh. |
| `hide-classify` | `OUTDATED` | Classifier for the `minimizeComment` mutation. |
| `skip-unchanged` | `true` | Skip when the rendered body matches the existing comment. |

## Outputs

| Output | Description |
| --- | --- |
| `quality-gate` | `OK` if every project passed, otherwise `ERROR` / `NONE`. |
| `results-json` | JSON array of per-project results. |
| `body-path` | Path to the rendered comment body file. |

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

The JSON array follows the `ProjectResult` shape exported from
`render/src/types.ts`.

## Permissions

```yaml
permissions:
  contents: read
  pull-requests: write
```

## Development

```sh
cd render
npm install
npm run build   # bundles src/ → render/dist/index.js with ncc
```

The bundled `render/dist/` is committed because GitHub Actions runs the
sub-action's `main` file directly.
