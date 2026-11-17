variable "allowed_account_ids" {
  description = "The only AWS account this root may touch (from the git-ignored terraform.tfvars)."
  type        = list(string)
}

variable "region" {
  description = "AWS Region (ADR 0030: Sydney)."
  type        = string
  default     = "ap-southeast-2"
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
