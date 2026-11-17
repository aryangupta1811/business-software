# RDS PostgreSQL in the private subnets, reachable only from the server.
#
# The master password never lands in Terraform state:
# - `ephemeral "random_password"` makes a password that exists only while Terraform runs.
# - `password_wo` (RDS) and `value_wo` (SSM) are write-only: sent to AWS, never stored.
# - Terraform can't compare a value it never stored, so `*_wo_version` tells it when to
#   send a new one. Bump var.db_password_version to rotate both at once.
# The application roles (app_owner, app_runtime) and the business_software database are
# made later by packages/db/bootstrap/create-roles.sql (stage 5 part 3).

ephemeral "random_password" "db_master" {
  length  = 40
  special = false # letters and digits only: it also goes inside connection URLs
}

resource "aws_db_subnet_group" "main" {
  name       = local.name
  subnet_ids = aws_subnet.private[*].id
  tags       = { Name = local.name }
}

resource "aws_db_instance" "main" {
  identifier     = local.name
  engine         = "postgres"
  engine_version = var.db_engine_version
  instance_class = var.db_instance_class

  allocated_storage = var.db_disk_gb
  storage_type      = "gp3"
  storage_encrypted = true

  username            = "postgres_admin"
  password_wo         = ephemeral.random_password.db_master.result
  password_wo_version = var.db_password_version

  db_subnet_group_name   = aws_db_subnet_group.main.name
  vpc_security_group_ids = [aws_security_group.db.id]
  publicly_accessible    = false
  multi_az               = false

  # Automated backups for point-in-time restore. They run only while the instance runs.
  # Times are UTC: 22:00–22:30 IST backups, Sunday 23:00–23:30 IST maintenance.
  # 1 day: the Free plan refused 7 (FreeTierRestrictionError, 2026-11-17; the cap isn't
  # documented, 1 is the API's own default). Time stopped doesn't count toward it.
  # Older history comes from stage 7's nightly pg_dump to S3.
  backup_retention_period = 1
  backup_window           = "16:30-17:00"
  maintenance_window      = "sun:17:30-sun:18:00"
  copy_tags_to_snapshot   = true

  # Zero data loss (CLAUDE.md rule 7): deleting needs two deliberate steps,
  # and a final snapshot is always taken.
  deletion_protection       = true
  skip_final_snapshot       = false
  final_snapshot_identifier = "${local.name}-final"

  auto_minor_version_upgrade = true
  apply_immediately          = false

  # Both add cost or noise for a demo: off.
  performance_insights_enabled = false
  monitoring_interval          = 0

  tags = { Name = local.name }
}

# A copy of the master password for whoever needs it later (Session Manager, part 3).
# SecureString with AWS's own aws/ssm key: free, unlike Secrets Manager.
resource "aws_ssm_parameter" "db_master_password" {
  name             = "/business-software/${var.environment}/db/master-password"
  description      = "RDS master password for postgres_admin"
  type             = "SecureString"
  value_wo         = ephemeral.random_password.db_master.result
  value_wo_version = var.db_password_version

  # Write the copy only after RDS has accepted the password. The ephemeral password is new
  # on every run, so if RDS failed after SSM was written, the retry would give RDS a
  # different password than SSM holds (it happened on 2026-11-17). This doesn't cover SSM
  # failing after RDS succeeded: after any failed apply touching either, follow the
  # recovery rule in docs/devops/terraform.md.
  depends_on = [aws_db_instance.main]
}
