# The S3 bucket that holds Terraform's state for every root in infra/terraform.
#
# Chicken and egg: this root creates the bucket, so its first apply keeps state on the
# laptop. After that apply, uncomment the backend block below and run
#   terraform init -migrate-state -backend-config=../backend.hcl
# to move this root's own state into the bucket (docs/devops/terraform.md).

terraform {
  required_version = ">= 1.15"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.73"
    }
  }

  # backend "s3" {
  #   key          = "bootstrap/terraform.tfstate"
  #   region       = "ap-southeast-2"
  #   profile      = "business-software"
  #   encrypt      = true
  #   use_lockfile = true
  # }
}

variable "allowed_account_ids" {
  description = "The only AWS account this root may touch (from the git-ignored terraform.tfvars)."
  type        = list(string)
}

provider "aws" {
  region              = "ap-southeast-2"
  profile             = "business-software"
  allowed_account_ids = var.allowed_account_ids

  default_tags {
    tags = {
      Project     = "business-software"
      Environment = "shared"
      ManagedBy   = "terraform"
    }
  }
}

data "aws_caller_identity" "current" {}

# Bucket names are global across all of AWS, so the account ID makes it unique. That is
# why the name only lives in the git-ignored backend.hcl, never in the public repo.
resource "aws_s3_bucket" "state" {
  bucket = "business-software-tfstate-${data.aws_caller_identity.current.account_id}"

  lifecycle {
    prevent_destroy = true
  }
}

# Every write keeps the previous state file, so a bad apply can be rolled back.
resource "aws_s3_bucket_versioning" "state" {
  bucket = aws_s3_bucket.state.id

  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "state" {
  bucket = aws_s3_bucket.state.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_public_access_block" "state" {
  bucket = aws_s3_bucket.state.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_ownership_controls" "state" {
  bucket = aws_s3_bucket.state.id

  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}

# Old state versions cost storage forever unless something expires them.
resource "aws_s3_bucket_lifecycle_configuration" "state" {
  bucket = aws_s3_bucket.state.id

  rule {
    id     = "expire-old-state-versions"
    status = "Enabled"

    filter {}

    noncurrent_version_expiration {
      noncurrent_days = 90
    }

    abort_incomplete_multipart_upload {
      days_after_initiation = 7
    }
  }
}

# Refuse any request that isn't over HTTPS.
data "aws_iam_policy_document" "state" {
  statement {
    sid     = "DenyInsecureTransport"
    effect  = "Deny"
    actions = ["s3:*"]
    resources = [
      aws_s3_bucket.state.arn,
      "${aws_s3_bucket.state.arn}/*",
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

resource "aws_s3_bucket_policy" "state" {
  bucket = aws_s3_bucket.state.id
  policy = data.aws_iam_policy_document.state.json

  depends_on = [aws_s3_bucket_public_access_block.state]
}

output "state_bucket" {
  description = "Goes into infra/terraform/backend.hcl (git-ignored: it contains the account ID)."
  value       = aws_s3_bucket.state.bucket
}
