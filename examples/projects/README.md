# Demo dummy projects

These three projects exist solely to exercise the multi-project aggregator
end-to-end against a real SonarQube instance. They are scanned by the
`demo-projects-list` and `demo-report-tasks` workflows.

| Directory | Sonar projectKey |
| --- | --- |
| `alpha/` | `multi-comment-demo-alpha` |
| `beta/` | `multi-comment-demo-beta` |
| `gamma/` | `multi-comment-demo-gamma` |

You'll need to either pre-create these projects on your SonarQube/SonarCloud
instance or enable auto-creation. The token in `secrets.SONAR_TOKEN` must
have permissions to analyse them. SonarCloud users must also set
`vars.SONAR_ORGANIZATION` to their org slug; the workflows pass it via
`-Dsonar.organization=...`. Self-hosted SonarQube users can leave it unset.
