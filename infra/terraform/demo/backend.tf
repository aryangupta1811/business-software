# State lives in the bucket made by ../bootstrap. The bucket name comes from the
# git-ignored ../backend.hcl:  terraform init -backend-config=../backend.hcl
# use_lockfile: S3 keeps a .tflock file next to the state, so two applies can't run at once
# (no DynamoDB table needed since Terraform 1.10).
terraform {
  backend "s3" {
    key          = "demo/terraform.tfstate"
    region       = "ap-southeast-2"
    profile      = "business-software"
    encrypt      = true
    use_lockfile = true
  }
}
