# DevOps & cloud plan

**Goal:** ship this project the way a real team would, and learn DevOps by doing it on a real app instead of a toy.

Tools below are **candidates**. The real choice for each stage is made with me and recorded as an ADR.

## How to teach me

- Before each stage: what it is, why real teams need it, and what we will build.
- Use the industry names (CI, CD, IaC, staging, runbook…) and explain them the first time.
- Ask which DevOps tools I've already covered in my course and prefer those where they fit. If a different tool is the better choice, say so and why.
- When I say "I'll do it", give me the steps and let me type the commands.
- After each stage: 3–5 interview questions about what we just did, with short answers, added to the phase journal.

## Cost rules

I'm a student. Keep cloud costs near zero.

- Use free tiers and student credits.
- Set a budget alarm before creating anything else in the cloud.
- Tell me before anything that costs money, with the expected monthly cost.
- Tear down what we don't use. Kubernetes in the cloud is expensive: keep it local or very short-lived.

## Stages

Each stage is woven into a project phase (see `docs/PROGRESS.md`).

| # | Stage | What we build | Candidate tools | When |
| --- | --- | --- | --- | --- |
| 1 | Git workflow | Branches, pull requests, protected `main`, commit conventions, no secrets in git | Git, GitHub | Phase 0 |
| 2 | Containers | A container per service; app + database start with one command locally | Docker, Docker Compose | Phase 0 (walking skeleton) |
| 3 | Continuous integration | Every push/PR runs lint, tests and a build; `main` stays green | GitHub Actions or Jenkins | Phase 0 |
| 4 | Cloud basics & guardrails | Secure account (MFA, no root use), IAM users/roles, budget alarm, region choice | AWS (Mumbai `ap-south-1` suggested: close to Indian users) | Start of Phase 1 |
| 5 | Infrastructure as code | Every cloud resource created from code; a staging environment | Terraform | Phase 1 |
| 6 | Continuous deployment | Auto-deploy to staging on merge; manual approval to production; one-step rollback; health checks | GitHub Actions / Jenkins | Phase 1 |
| 7 | Data safety | Managed database with automated backups and point-in-time restore; backups copied to separate storage; a restore drill run monthly; a written restore runbook | AWS managed database + object storage | Phase 1, before any real data |
| 8 | Configuration management | Only if we run plain servers: configure them from code | Ansible | If the architecture needs it |
| 9 | Observability | Structured logs, metrics, dashboards, uptime checks; alerts when the app is down or a backup fails | Prometheus + Grafana, or cloud-native | Phase 2 |
| 10 | Security | Secrets in a secrets manager, dependency and image scanning, HTTPS, least-privilege access | Secrets manager, Trivy, etc. | Throughout; review in Phase 2 |
| 11 | Stretch: Kubernetes | Run the app on a local cluster; optional GitOps | kind / minikube / k3s, Helm, Argo CD | Phase 3 |

Stage 7 is what makes "zero data loss" real. It is not optional.

## Portfolio outputs

By the end, the repo should show:

- An architecture diagram of how the app is deployed.
- A CI status badge on the README.
- Runbooks: how to deploy, how to roll back, how to restore from backup.
- A short "how it's deployed and what it costs" section in the README.
