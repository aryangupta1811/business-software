# Stage 7 (ADR 0037): the nightly database backups' bucket, separate from RDS.
#
# RDS keeps its own automated backups for 1 day only (the Free plan's cap, database.tf), and
# they live and die with the RDS instance. This bucket holds the nightly pg_dump copies for
# var.backup_retention_days, outside RDS.
#
# The server may only ADD files under postgres/ (server.tf below): it can't read, list,
# overwrite-and-lose (versioning) or delete a backup. So someone who takes over the server
# can't destroy the history, and can't read old copies either. Restore drills read through
# short-lived pre-signed links made on the laptop (scripts/deploy/backup.sh).

resource "aws_s3_bucket" "backups" {
  # Bucket names are global across AWS: the account ID makes it unique, so the name is only
  # in state and SSM, never in the public repo.
  bucket = "business-software-${var.environment}-backups-${data.aws_caller_identity.current.account_id}"

  # Zero data loss (CLAUDE.md rule 7): Terraform refuses to destroy it, and S3 refuses to
  # delete a bucket that isn't empty (force_destroy stays false).
  lifecycle {
    prevent_destroy = true
  }
}

# A file replaced or deleted by mistake stays recoverable as an older version.
resource "aws_s3_bucket_versioning" "backups" {
  bucket = aws_s3_bucket.backups.id

  versioning_configuration {
    status = "Enabled"
  }
}

# SSE-S3 (AES256): free, keys managed by S3. A customer-managed KMS key would cost $1 a month.
resource "aws_s3_bucket_server_side_encryption_configuration" "backups" {
  bucket = aws_s3_bucket.backups.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_public_access_block" "backups" {
  bucket = aws_s3_bucket.backups.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# ACLs off: only IAM and the bucket policy decide access.
resource "aws_s3_bucket_ownership_controls" "backups" {
  bucket = aws_s3_bucket.backups.id

  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}

# Storage costs money for ever unless something expires it. A backup is kept
# var.backup_retention_days, then becomes an older version for 30 more days, then is gone.
resource "aws_s3_bucket_lifecycle_configuration" "backups" {
  bucket = aws_s3_bucket.backups.id

  rule {
    id     = "expire-old-backups"
    status = "Enabled"

    filter {}

    expiration {
      days = var.backup_retention_days
    }

    noncurrent_version_expiration {
      noncurrent_days = 30
    }

    abort_incomplete_multipart_upload {
      days_after_initiation = 1
    }
  }

  # A lifecycle rule on a versioned bucket needs versioning switched on first.
  depends_on = [aws_s3_bucket_versioning.backups]
}

# Refuse any request that isn't over HTTPS.
data "aws_iam_policy_document" "backups_bucket" {
  statement {
    sid     = "DenyInsecureTransport"
    effect  = "Deny"
    actions = ["s3:*"]
    resources = [
      aws_s3_bucket.backups.arn,
      "${aws_s3_bucket.backups.arn}/*",
    ]

    principals {
      type        = "*"
      identifiers = ["*"]
    }

    condition {
      test     = "Bool"
      variable = "aws:SecureTransport"
      values   = ["false"]
    }
  }
}

resource "aws_s3_bucket_policy" "backups" {
  bucket = aws_s3_bucket.backups.id
  policy = data.aws_iam_policy_document.backups_bucket.json

  depends_on = [aws_s3_bucket_public_access_block.backups]
}

# The server's one right on the bucket: add a file under postgres/. backup.sh uploads with a
# single PutObject per file (no multipart, so no other action is needed).
data "aws_iam_policy_document" "server_backups" {
  statement {
    actions   = ["s3:PutObject"]
    resources = ["${aws_s3_bucket.backups.arn}/postgres/*"]
  }
}

resource "aws_iam_role_policy" "server_backups" {
  name   = "add-database-backups"
  role   = aws_iam_role.server.id
  policy = data.aws_iam_policy_document.server_backups.json
}

# Where backup.sh uploads. Not a secret, but it holds the account ID, so the server reads it
# here instead of from a file in the public repo.
resource "aws_ssm_parameter" "backup_bucket" {
  name        = "${local.parameter_prefix}/backup/bucket"
  description = "S3 bucket for the nightly database backups"
  type        = "String"
  value       = aws_s3_bucket.backups.bucket
}

# Password of app_backup, the read-only role pg_dump logs in as (ADR 0037). Made like the
# other app passwords (parameters.tf): never in state. bootstrap-db.sh creates the role on RDS
# with it at the next deploy; the server's existing read-own-parameters policy covers it.
ephemeral "random_password" "app_backup" {
  length  = 40
  special = false
}

resource "aws_ssm_parameter" "app_backup_password" {
  name             = "${local.parameter_prefix}/db/app-backup-password"
  description      = "Password of app_backup, used only by the nightly backup"
  type             = "SecureString"
  value_wo         = ephemeral.random_password.app_backup.result
  value_wo_version = var.app_password_version
}
