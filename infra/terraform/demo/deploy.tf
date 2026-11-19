# Stage 6 (continuous deployment): GitHub Actions deploys to the demo server with no AWS keys
# stored anywhere (ADR 0012). Each deploy job asks GitHub for a signed token (OIDC), and AWS
# swaps it for credentials that last one hour, for this role only.
#
# Who may use the role: only a job in this repository that runs in the GitHub environment
# "demo". That environment requires the owner's approval and accepts only main, so the
# approval click is the manual go-ahead, and no pull request or other branch can deploy.
#
# What the role may call: start a shell script on this one server through Systems Manager,
# read that command's output, and see whether the server is running. No Terraform, no
# starting or stopping anything, and no S3 or SSM parameter calls of its own.
#
# What that really amounts to: AWS-RunShellScript runs any command as root on the server, and
# the server's own role can read the app's SSM SecureStrings and write backups to S3
# (server.tf, backup.tf). So whoever holds this role's credentials can reach those too,
# through the server. The real boundary is who can get the credentials: a job in the "demo"
# environment (owner's approval, main only), running workflow code that is on main. A custom
# SSM document that only runs install.sh <commit> would not narrow it much: install.sh runs
# code from main as root anyway, so anyone able to merge to main has root on the server
# (ADR 0012, 2026-11-20 note).

# GitHub's token issuer, registered once in the account. AWS checks GitHub's certificate
# against its own trusted authorities, so no thumbprint is needed.
resource "aws_iam_openid_connect_provider" "github" {
  url            = "https://token.actions.githubusercontent.com"
  client_id_list = ["sts.amazonaws.com"]
}

data "aws_iam_policy_document" "deploy_assume" {
  statement {
    actions = ["sts:AssumeRoleWithWebIdentity"]

    principals {
      type        = "Federated"
      identifiers = [aws_iam_openid_connect_provider.github.arn]
    }

    # The token was made for AWS STS.
    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:aud"
      values   = ["sts.amazonaws.com"]
    }

    # Exact match, no wildcard: this repository, a job in the "demo" environment. A
    # pull_request, a fork or any other workflow gets a different subject and is refused.
    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:sub"
      values   = ["repo:${var.github_repository}:environment:${var.environment}"]
    }
  }
}

resource "aws_iam_role" "deploy" {
  name                 = "${local.name}-deploy"
  description          = "GitHub Actions deploys to the demo server through Systems Manager"
  assume_role_policy   = data.aws_iam_policy_document.deploy_assume.json
  max_session_duration = 3600
}

data "aws_iam_policy_document" "deploy" {
  # Run AWS-RunShellScript (AWS's own document) on this server only. Both the document and
  # the instance are resources of SendCommand, so neither can be swapped.
  statement {
    actions = ["ssm:SendCommand"]
    resources = [
      "arn:aws:ssm:${var.region}::document/AWS-RunShellScript",
      aws_instance.server.arn,
    ]
  }

  # Read the command's status and output (scripts/deploy/lib.sh). It doesn't support
  # resource-level rules.
  statement {
    actions   = ["ssm:GetCommandInvocation"]
    resources = ["*"]
  }

  # Is the server running? Read-only; DescribeInstances doesn't support resource-level rules.
  statement {
    actions   = ["ec2:DescribeInstances"]
    resources = ["*"]
  }
}

resource "aws_iam_role_policy" "deploy" {
  name   = "deploy-through-run-command"
  role   = aws_iam_role.deploy.id
  policy = data.aws_iam_policy_document.deploy.json
}
