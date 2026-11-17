# The money guardrail (docs/devops/aws-account.md, "Keeping it free"). In the first
# account this budget was made by hand in the console, so the account switch meant
# making it again by hand. Here it is code: a new account gets it with one apply.
#
# AWS Budgets costs nothing for budgets that only send alerts (only budget actions
# beyond the first two are billed). It watches; it never stops anything.

variable "budget_alert_emails" {
  description = "Who gets the budget alerts (from the git-ignored terraform.tfvars; never commit an address)."
  type        = list(string)

  validation {
    condition     = length(var.budget_alert_emails) > 0
    error_message = "At least one email address is needed, or no alert reaches anyone."
  }
}

variable "monthly_budget_usd" {
  description = "Monthly spend that triggers the alerts, in USD (ADR 0030: $15)."
  type        = number
  default     = 15
}

resource "aws_budgets_budget" "monthly_credit_burn" {
  name         = "monthly-credit-burn"
  budget_type  = "COST"
  limit_amount = tostring(var.monthly_budget_usd)
  limit_unit   = "USD"
  time_unit    = "MONTHLY"

  # On the Free plan the credits pay the bill, so with credits included the cost
  # always shows about $0 and no alert would ever fire. Leaving out credits and
  # refunds makes the budget watch what is really being used up.
  cost_types {
    include_credit = false
    include_refund = false
  }

  # Early warnings at a third and two thirds, then the limit itself.
  dynamic "notification" {
    for_each = [33, 66, 100]

    content {
      comparison_operator        = "GREATER_THAN"
      threshold                  = notification.value
      threshold_type             = "PERCENTAGE"
      notification_type          = "ACTUAL"
      subscriber_email_addresses = var.budget_alert_emails
    }
  }

  # AWS's forecast says the month will end over the limit: the earliest warning.
  notification {
    comparison_operator        = "GREATER_THAN"
    threshold                  = 100
    threshold_type             = "PERCENTAGE"
    notification_type          = "FORECASTED"
    subscriber_email_addresses = var.budget_alert_emails
  }
}
