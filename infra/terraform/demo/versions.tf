terraform {
  # 1.15+ reads `aws login` credentials (ADR 0031); write-only arguments need 1.11+.
  required_version = ">= 1.15"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.73"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.9"
    }
  }
}

provider "aws" {
  region  = var.region
  profile = var.aws_profile

  # Refuses to run against any other account, e.g. an old profile left on the laptop.
  allowed_account_ids = var.allowed_account_ids

  default_tags {
    tags = {
      Project     = "business-software"
      Environment = var.environment
      ManagedBy   = "terraform"
    }
  }
}

data "aws_caller_identity" "current" {}
