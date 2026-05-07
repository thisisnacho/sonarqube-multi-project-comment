# Demo dummy projects

These three projects exist solely to exercise the multi-project aggregator
end-to-end against a real SonarQube instance. They are scanned by the
`demo-projects-list` and `demo-report-tasks` workflows.

| Directory | Sonar projectKey |
| --- | --- |
| `frontend/` | `multi-comment-demo-frontend` |
| `backend/` | `multi-comment-demo-backend` |
| `api/` | `multi-comment-demo-api` |

You'll need to either pre-create these projects on your SonarQube/SonarCloud
instance or enable auto-creation. The token in `secrets.SONAR_TOKEN` must
have permissions to analyse them.
