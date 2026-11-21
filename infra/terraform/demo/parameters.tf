# What the server reads from SSM Parameter Store at every boot (deploy/demo/start.sh).
# Standard-tier parameters are free; SecureStrings use AWS's own aws/ssm key (also free).
# The server's role may read /business-software/<environment>/* only (server.tf).
#
# No secret value is ever in Terraform state: the passwords are ephemeral and written with
# value_wo, and the DuckDNS token is typed in by the owner (docs/devops/terraform.md).

locals {
  parameter_prefix = "/business-software/${var.environment}"
}

# Not a secret, but it changes if the database is ever rebuilt, so the server looks it up
# instead of having it written into a file in the public repo.
resource "aws_ssm_parameter" "db_host" {
  name        = "${local.parameter_prefix}/db/host"
  description = "RDS host name for the app connection strings"
  type        = "String"
  value       = aws_db_instance.main.address
}

# Passwords for the two app roles (ADR 0019). The first deploy creates the roles on RDS with
# these values (deploy/demo/bootstrap-db.sh). Bumping the version makes new passwords in SSM
# only: the roles keep the old ones until ALTER ROLE runs (runbook: terraform.md).
ephemeral "random_password" "app_owner" {
  length  = 40
  special = false # letters and digits only: they go inside connection URLs
}

ephemeral "random_password" "app_runtime" {
  length  = 40
  special = false
}

resource "aws_ssm_parameter" "app_owner_password" {
  name             = "${local.parameter_prefix}/db/app-owner-password"
  description      = "Password of app_owner, used only by migrate"
  type             = "SecureString"
  value_wo         = ephemeral.random_password.app_owner.result
  value_wo_version = var.app_password_version
}

# Password of app_queue, the role the worker's job queue (pg-boss) logs in as (ADR 0022). Made
# like the others: never in state. bootstrap-db.sh creates the role on RDS with it at the next
# deploy; the server's read-own-parameters policy already covers it.
ephemeral "random_password" "app_queue" {
  length  = 40
  special = false
}

resource "aws_ssm_parameter" "app_queue_password" {
  name             = "${local.parameter_prefix}/db/app-queue-password"
  description      = "Password of app_queue, used only by the worker's job queue"
  type             = "SecureString"
  value_wo         = ephemeral.random_password.app_queue.result
  value_wo_version = var.app_password_version
}

resource "aws_ssm_parameter" "app_runtime_password" {
  name             = "${local.parameter_prefix}/db/app-runtime-password"
  description      = "Password of app_runtime, used by api and worker"
  type             = "SecureString"
  value_wo         = ephemeral.random_password.app_runtime.result
  value_wo_version = var.app_password_version
}

# The DuckDNS token updates the site's name to the server's new IP at every boot.
# Terraform creates the parameter with a placeholder; the owner then overwrites it from their
# own terminal, so the real token never passes through Terraform, its state or the chat.
# value_wo: Terraform never reads the value back, so the owner's value is never "drift".
resource "aws_ssm_parameter" "duckdns_token" {
  name             = "${local.parameter_prefix}/duckdns/token"
  description      = "DuckDNS token, set by the owner with put-parameter --overwrite"
  type             = "SecureString"
  value_wo         = "placeholder-set-by-owner"
  value_wo_version = 1
}
