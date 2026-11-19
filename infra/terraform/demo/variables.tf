variable "allowed_account_ids" {
  description = "The only AWS account this root may touch (from the git-ignored terraform.tfvars)."
  type        = list(string)
}

variable "region" {
  description = "AWS Region (ADR 0033: Mumbai)."
  type        = string
  default     = "ap-south-1"
}

variable "aws_profile" {
  description = "Named profile from `aws login --profile business-software` (ADR 0031)."
  type        = string
  default     = "business-software"
}

variable "environment" {
  description = "demo, or staging for a rehearsal copy (ADR 0011)."
  type        = string
  default     = "demo"
}

variable "vpc_cidr" {
  description = "Address range of the VPC."
  type        = string
  default     = "10.20.0.0/16"
}

variable "server_instance_type" {
  description = "EC2 size (ADR 0032)."
  type        = string
  default     = "t4g.small"
}

variable "server_disk_gb" {
  description = "Server root disk, gp3."
  type        = number
  default     = 20
}

variable "db_instance_class" {
  description = "RDS size (ADR 0032)."
  type        = string
  default     = "db.t4g.micro"
}

variable "db_engine_version" {
  description = "PostgreSQL version on RDS (local Docker image is 18 too)."
  type        = string
  default     = "18.6"
}

variable "db_disk_gb" {
  description = "RDS storage, gp3."
  type        = number
  default     = 20
}

variable "db_password_version" {
  description = "Bump by one to make a new RDS master password (it's write-only, so Terraform can't see a change otherwise)."
  type        = number
  # 2 (2026-11-17): the first apply failed after writing SSM but before RDS existed, so the
  # retry gave RDS a different password than SSM held. Bumped to resend one to both.
  default = 2
}

variable "app_password_version" {
  description = "Bump by one to make new passwords for app_owner, app_runtime and app_backup in SSM (then ALTER ROLE on RDS, see terraform.md)."
  type        = number
  default     = 1
}

variable "nightly_stop_cron" {
  description = "EventBridge Scheduler cron for the nightly stop (ADR 0032)."
  type        = string
  default     = "cron(30 23 * * ? *)"
}

variable "nightly_stop_timezone" {
  description = "Time zone for nightly_stop_cron."
  type        = string
  default     = "Asia/Kolkata"
}

variable "github_repository" {
  description = "owner/name of the GitHub repository whose demo environment may deploy (stage 6)."
  type        = string
  default     = "aryangupta1811/business-software"
}

variable "backup_retention_days" {
  description = "Days a nightly database backup is kept in S3 before it expires (ADR 0037); 30 more as an older version."
  type        = number
  default     = 90
}
