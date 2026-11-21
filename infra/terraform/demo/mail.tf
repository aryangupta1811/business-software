# Email from the demo server through Amazon SES (ADR 0040 and its 2026-11-20 note; plan
# docs/plans/2026-11-20-ses-mail-role.md).
#
# The api runs in a container, and the metadata hop limit of 1 (server.tf) keeps containers
# away from the server's own role on purpose. So the api gets a role of its own that can do
# one thing, send mail as one address: the host assumes it (deploy/demo/mail-credentials.sh)
# and hands the api 1-hour credentials through a file in memory.
#
# The account stays in the SES sandbox (D1): mail reaches only verified addresses, 200 a day.
# Price: $0.10 per 1,000 recipients; the identities, the role and the parameters are free.

# Creating an email identity makes AWS send a verification link to that address; it can send
# (or, in the sandbox, receive) only after the link is clicked.
resource "aws_sesv2_email_identity" "sender" {
  email_identity = var.mail_from
}

# Extra addresses that may receive demo mail while SES is in the sandbox. The sender's own
# address is verified above, so it doesn't belong in this list.
resource "aws_sesv2_email_identity" "recipient" {
  for_each       = toset(var.mail_recipients)
  email_identity = each.value
}

data "aws_iam_policy_document" "mail_assume" {
  statement {
    actions = ["sts:AssumeRole"]

    principals {
      type        = "AWS"
      identifiers = [aws_iam_role.server.arn]
    }
  }
}

resource "aws_iam_role" "mail" {
  name               = "${local.name}-mail"
  description        = "Sends the demo app's email through SES - assumed by the server and handed to the api container"
  assume_role_policy = data.aws_iam_policy_document.mail_assume.json

  # A role assumed with another role's credentials (role chaining) gets 1 hour at most anyway.
  max_session_duration = 3600
}

# Send, and only as var.mail_from. The resource is every identity in this account and Region,
# not the sender's alone: AWS documents that a send is authorized by the identity behind the
# From address, but not whether the sandbox also checks the recipient's identity against IAM.
# identity/* covers both cases; the ses:FromAddress condition still pins the sender.
data "aws_iam_policy_document" "mail_send" {
  statement {
    actions   = ["ses:SendEmail"]
    resources = ["arn:aws:ses:${var.region}:${data.aws_caller_identity.current.account_id}:identity/*"]

    condition {
      test     = "StringEquals"
      variable = "ses:FromAddress"
      values   = [var.mail_from]
    }
  }
}

resource "aws_iam_role_policy" "mail_send" {
  name   = "send-as-demo-sender"
  role   = aws_iam_role.mail.id
  policy = data.aws_iam_policy_document.mail_send.json
}

# The server may assume the mail role, and no other.
data "aws_iam_policy_document" "server_assume_mail" {
  statement {
    actions   = ["sts:AssumeRole"]
    resources = [aws_iam_role.mail.arn]
  }
}

resource "aws_iam_role_policy" "server_assume_mail" {
  name   = "assume-mail-role"
  role   = aws_iam_role.server.id
  policy = data.aws_iam_policy_document.server_assume_mail.json
}

# What start.sh and mail-credentials.sh read. Not secrets, but the address is personal, so it
# lives in SSM and the git-ignored terraform.tfvars, never in the public repo.
resource "aws_ssm_parameter" "mail_from" {
  name        = "${local.parameter_prefix}/mail/from"
  description = "Sender address of the demo's email (a verified SES identity)"
  type        = "String"
  value       = var.mail_from
}

resource "aws_ssm_parameter" "mail_role_arn" {
  name        = "${local.parameter_prefix}/mail/role-arn"
  description = "Role the server assumes to hand the api mail-only credentials"
  type        = "String"
  value       = aws_iam_role.mail.arn
}
