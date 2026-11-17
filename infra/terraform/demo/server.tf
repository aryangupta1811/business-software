# One EC2 server that will run Docker Compose (web, api, worker, Caddy) in part 3.
# No SSH key and no port 22: shell access is through Session Manager.

# Canonical publishes the newest Ubuntu image ID in a public SSM parameter.
data "aws_ssm_parameter" "ubuntu_arm64" {
  name = "/aws/service/canonical/ubuntu/server/26.04/stable/current/arm64/hvm/ebs-gp3/ami-id"
}

data "aws_iam_policy_document" "server_assume" {
  statement {
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["ec2.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "server" {
  name               = "${local.name}-server"
  assume_role_policy = data.aws_iam_policy_document.server_assume.json
}

# Lets the SSM agent on the server register, so Session Manager can open a shell.
resource "aws_iam_role_policy_attachment" "server_ssm_core" {
  role       = aws_iam_role.server.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore"
}

# Read this environment's parameters, nothing else. SecureStrings use the aws/ssm key,
# whose key policy already allows decrypting through SSM within the account.
data "aws_iam_policy_document" "server_parameters" {
  statement {
    actions = [
      "ssm:GetParameter",
      "ssm:GetParameters",
      "ssm:GetParametersByPath",
    ]
    resources = [
      "arn:aws:ssm:${var.region}:${data.aws_caller_identity.current.account_id}:parameter/business-software/${var.environment}/*",
    ]
  }
}

resource "aws_iam_role_policy" "server_parameters" {
  name   = "read-own-parameters"
  role   = aws_iam_role.server.id
  policy = data.aws_iam_policy_document.server_parameters.json
}

resource "aws_iam_instance_profile" "server" {
  name = "${local.name}-server"
  role = aws_iam_role.server.name
}

resource "aws_instance" "server" {
  ami           = data.aws_ssm_parameter.ubuntu_arm64.insecure_value
  instance_type = var.server_instance_type

  subnet_id                   = aws_subnet.public[0].id
  vpc_security_group_ids      = [aws_security_group.web.id]
  associate_public_ip_address = true
  iam_instance_profile        = aws_iam_instance_profile.server.name

  # "standard": the CPU slows down when burst credits run out. The default for t4g,
  # "unlimited", keeps it fast and bills for the extra.
  credit_specification {
    cpu_credits = "standard"
  }

  # IMDSv2 only: a stolen request URL can't read the instance's credentials.
  # Hop limit 1: containers can't reach the metadata service at all; the host
  # reads SSM and hands containers only what they need.
  metadata_options {
    http_endpoint               = "enabled"
    http_tokens                 = "required"
    http_put_response_hop_limit = 1
    instance_metadata_tags      = "disabled"
  }

  root_block_device {
    volume_type           = "gp3"
    volume_size           = var.server_disk_gb
    encrypted             = true
    delete_on_termination = true
  }

  monitoring = false # detailed monitoring is billed per metric

  # Cloud-init runs only at first boot, so a changed file replaces the server.
  # Safe: the server keeps no data; the database is on RDS.
  user_data                   = file("${path.module}/cloud-init.yaml")
  user_data_replace_on_change = true

  # A newer Ubuntu image every few weeks shouldn't replace the server on every plan.
  lifecycle {
    ignore_changes = [ami]
  }

  tags = { Name = local.name }
}
