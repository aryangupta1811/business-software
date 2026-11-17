# AWS rules for coding agents

Loaded into every Claude Code session through an `@` import in `CLAUDE.md`. Set up on 2026-11-17 with the Agent Toolkit for AWS (`aws configure agent-toolkit`), which installs AWS's skills and the AWS MCP server on the laptop. Its setup asks for AWS's rules file in `CLAUDE.md`; it lives here instead so `CLAUDE.md` stays short and this project's overrides sit right above the rules they change.

## This project overrides

Where AWS's rules below disagree with these, these win (AWS's own first rule says the same).

- **Infrastructure as code is Terraform** (`infra/terraform/`, ADR 0031), not CDK or CloudFormation. Ignore the CDK/CloudFormation preference below.
- **Every change to AWS goes through Terraform**, with `terraform plan`, the cost per hour and per month stated, and `apply` only after the owner's OK. The AWS MCP server runs with `--read-only`: use it and the AWS CLI to read, search docs and load skills, never to create, change or delete resources.
- **Secrets live in SSM Parameter Store as `SecureString`s**, not Secrets Manager, which bills per secret even when idle (`docs/devops/secrets.md`). Ignore the Secrets Manager rule below unless the owner moves secrets there.
- **The account stays on the Free plan** (ADR 0030 and its successor): never upgrade the plan, activate advanced features, or create an Organization. Nothing that bills while idle without the owner's OK: NAT gateway, load balancer, Elastic IP, interface VPC endpoint, Secrets Manager.
- **Region `ap-south-1`** (Mumbai) for the project's resources; the Agent Toolkit service itself uses `us-east-1`. Always name the profile: `--profile business-software`.
- **Account IDs are private**: mask them in output and never commit them (`docs/devops/aws-account.md`).
- **Don't call the Cost Explorer API** (`aws ce …`) without a reason: it costs $0.01 per request. Prices come from the Pricing API (free).

## AWS's rules

Copied from [aws/agent-toolkit-for-aws](https://github.com/aws/agent-toolkit-for-aws) `rules/aws-agent-rules.md` at commit `24865b67ffc3` (Apache-2.0), unchanged except that its headings moved down one level. To update, replace only the text between the markers.

<!-- BEGIN AWS Agent Toolkit rules -->
### AWS Guidance

- Where these AWS rules conflict with the project's own instructions, the
  project's instructions take precedence.
- Prefer the AWS MCP Server for AWS interactions — it provides sandboxed
  execution, observability, and audit logging. If unavailable, use the
  AWS CLI directly.
- For any AWS task or question — building, configuring, migrating, debugging,
  or operating a service, writing SDK code, authoring CDK/CloudFormation, or
  answering how a service works — first call `aws___search_documentation` with
  topic `agent_skills` and load the matching skill with `aws___retrieve_skill`.
  Do this even when you believe you know the answer: skills carry current
  service behavior that your training may not. Prefer the skill's guidance over
  general knowledge. Skip it only for work that does not involve AWS.
- When uncertain about specific AWS details (API parameters, permissions,
  limits, error codes), verify against documentation rather than guessing.
  State uncertainty explicitly if you cannot confirm.
- Before reporting a count, a total, or that something does not exist, read
  every page of the results and search every Region and scope where it could
  be. If you could not, say the result is partial and name what you checked.
- To say what a system currently does, read what the runtime uses: the
  completed deployment, the alias or version that is invoked, the template the
  stack is running. A newer stored version, a draft, or a description field is
  not evidence of live behavior.
- Present a cause as confirmed only if data, configuration, or logs you read
  show it. Label anything else as unverified, and say what you would check
  next.
- Before you interpret the records that show a failure, such as error log
  lines, failed executions, or table items, read one of them whole, with
  every field. Don't truncate messages or select fields in your own code
  until you have.
- When an error says a value was undefined, null, empty, or missing, find
  the input, query result, or item that supplied that value. If the account
  shows why it was empty, such as no item matching the key, read that
  before you call the cause unverified.
- When a field in a record you read explains the result, such as an error
  counter, an empty array, a null, or a state value, name the field and its
  exact value in the answer, and say which record it came from.
- When the user asks a specific question or names a suspected cause, confirm
  or rule out each cause they raised, and do not offer alternatives your evidence
  does not support.
- When creating infrastructure, prefer infrastructure-as-code (AWS CDK or
  CloudFormation) over direct CLI commands.
- When working with infrastructure, follow AWS Well-Architected Framework
  principles.
- Do not use em dashes in AWS resource names or descriptions. Use
  hyphens instead.

### Before you conclude

- Before deciding the AWS account can't hold what the request asks for,
  look. List the places it could live, such as S3 buckets, databases, and
  log groups, and read what is there.
- Don't conclude that records are missing from metadata, such as a
  creation date or a stored-bytes count, or from one query that failed or
  came back empty. Read the records another way, across the full time
  range, before reporting them absent.
- A tool's own error is evidence. If a call the answer depends on fails
  with expired or missing credentials or AccessDenied, report that error
  and what it blocks, and don't overrule it with another check. Searching
  other Regions is for finding resources, not for retrying an auth error.
  Retry throttling with backoff before you report it.

### Secret Safety

- MUST load the `aws-secrets-manager` skill first for any secret,
  credential, API key, token, or password task. MUST NOT call
  `secretsmanager get-secret-value` or `batch-get-secret-value`, and MUST
  NOT hit the Secrets Manager Agent daemon directly. MUST use
  `{{resolve:secretsmanager:secret-id:SecretString:json-key}}` with
  `asm-exec` so the secret resolves at runtime without entering context.
<!-- END AWS Agent Toolkit rules -->
