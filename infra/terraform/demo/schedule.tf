# Safety net for money: every night at 23:30 IST, stop the server and the database in case
# a session forgot to (ADR 0032). EventBridge Scheduler calls the EC2 and RDS APIs directly
# ("universal targets"), so there's no Lambda function to maintain.
# Stopping something already stopped just fails, so there are no retries.

data "aws_iam_policy_document" "scheduler_assume" {
  statement {
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["scheduler.amazonaws.com"]
    }

    # Only schedules in this account may use the role.
    condition {
      test     = "StringEquals"
      variable = "aws:SourceAccount"
      values   = [data.aws_caller_identity.current.account_id]
    }
  }
}

resource "aws_iam_role" "nightly_stop" {
  name               = "${local.name}-nightly-stop"
  assume_role_policy = data.aws_iam_policy_document.scheduler_assume.json
}

# It may stop this server and this database. It can't start, change or delete anything.
data "aws_iam_policy_document" "nightly_stop" {
  statement {
    actions   = ["ec2:StopInstances"]
    resources = [aws_instance.server.arn]
  }

  statement {
    actions   = ["rds:StopDBInstance"]
    resources = [aws_db_instance.main.arn]
  }
}

resource "aws_iam_role_policy" "nightly_stop" {
  name   = "stop-server-and-database"
  role   = aws_iam_role.nightly_stop.id
  policy = data.aws_iam_policy_document.nightly_stop.json
}

resource "aws_scheduler_schedule" "stop_server" {
  name                         = "${local.name}-stop-server"
  description                  = "Stop the demo server every night"
  schedule_expression          = var.nightly_stop_cron
  schedule_expression_timezone = var.nightly_stop_timezone

  flexible_time_window {
    mode = "OFF"
  }

  target {
    arn      = "arn:aws:scheduler:::aws-sdk:ec2:stopInstances"
    role_arn = aws_iam_role.nightly_stop.arn
    input    = jsonencode({ InstanceIds = [aws_instance.server.id] })

    retry_policy {
      maximum_retry_attempts = 0
    }
  }
}

resource "aws_scheduler_schedule" "stop_database" {
  name                         = "${local.name}-stop-database"
  description                  = "Stop the demo database every night"
  schedule_expression          = var.nightly_stop_cron
  schedule_expression_timezone = var.nightly_stop_timezone

  flexible_time_window {
    mode = "OFF"
  }

  target {
    arn      = "arn:aws:scheduler:::aws-sdk:rds:stopDBInstance"
    role_arn = aws_iam_role.nightly_stop.arn
    input    = jsonencode({ DbInstanceIdentifier = aws_db_instance.main.identifier })

    retry_policy {
      maximum_retry_attempts = 0
    }
  }
}
