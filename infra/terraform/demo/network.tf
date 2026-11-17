# A private network (VPC) with two kinds of subnet:
# - public: has a route to the internet gateway; the server lives here.
# - private: no route out at all; RDS lives here. RDS needs a subnet in two
#   Availability Zones even for a single-AZ database.
# No NAT gateway: it bills while idle, and nothing in the private subnets needs the internet.

locals {
  name = "business-software-${var.environment}"
  azs  = ["${var.region}a", "${var.region}b"]
}

resource "aws_vpc" "main" {
  cidr_block = var.vpc_cidr

  # Needed to resolve RDS's endpoint name and to give the server a public DNS name.
  enable_dns_support   = true
  enable_dns_hostnames = true

  tags = { Name = local.name }
}

resource "aws_internet_gateway" "main" {
  vpc_id = aws_vpc.main.id
  tags   = { Name = local.name }
}

resource "aws_subnet" "public" {
  count = length(local.azs)

  vpc_id                  = aws_vpc.main.id
  availability_zone       = local.azs[count.index]
  cidr_block              = cidrsubnet(var.vpc_cidr, 8, count.index) # 10.20.0.0/24, 10.20.1.0/24
  map_public_ip_on_launch = true

  tags = { Name = "${local.name}-public-${local.azs[count.index]}" }
}

resource "aws_subnet" "private" {
  count = length(local.azs)

  vpc_id            = aws_vpc.main.id
  availability_zone = local.azs[count.index]
  cidr_block        = cidrsubnet(var.vpc_cidr, 8, 10 + count.index) # 10.20.10.0/24, 10.20.11.0/24

  tags = { Name = "${local.name}-private-${local.azs[count.index]}" }
}

resource "aws_route_table" "public" {
  vpc_id = aws_vpc.main.id

  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.main.id
  }

  tags = { Name = "${local.name}-public" }
}

resource "aws_route_table_association" "public" {
  count = length(aws_subnet.public)

  subnet_id      = aws_subnet.public[count.index].id
  route_table_id = aws_route_table.public.id
}

# The private subnets use the VPC's main route table: only the local route inside the VPC.
# Terraform takes it over so a route added by hand would show up as drift.
resource "aws_default_route_table" "main" {
  default_route_table_id = aws_vpc.main.default_route_table_id
  tags                   = { Name = "${local.name}-private" }
}

# Every VPC comes with a "default" security group. Taking it over with no rules empties
# it, so nothing can end up in it by accident.
resource "aws_default_security_group" "main" {
  vpc_id = aws_vpc.main.id
  tags   = { Name = "${local.name}-default-unused" }
}

# Server: HTTP and HTTPS from anywhere. No port 22: shell access goes through
# Session Manager, which needs no open inbound port and no SSH key.
resource "aws_security_group" "web" {
  name        = "${local.name}-web"
  description = "Server: HTTP and HTTPS in, everything out"
  vpc_id      = aws_vpc.main.id
  tags        = { Name = "${local.name}-web" }
}

resource "aws_vpc_security_group_ingress_rule" "web_http" {
  security_group_id = aws_security_group.web.id
  description       = "HTTP (Let's Encrypt challenge and redirect to HTTPS)"
  ip_protocol       = "tcp"
  from_port         = 80
  to_port           = 80
  cidr_ipv4         = "0.0.0.0/0"
}

resource "aws_vpc_security_group_ingress_rule" "web_https" {
  security_group_id = aws_security_group.web.id
  description       = "HTTPS"
  ip_protocol       = "tcp"
  from_port         = 443
  to_port           = 443
  cidr_ipv4         = "0.0.0.0/0"
}

# Package updates, image pulls, Let's Encrypt, Session Manager and SSM all go out on 443/80.
resource "aws_vpc_security_group_egress_rule" "web_all" {
  security_group_id = aws_security_group.web.id
  description       = "All outbound"
  ip_protocol       = "-1"
  cidr_ipv4         = "0.0.0.0/0"
}

# Database: PostgreSQL only from the server's security group. No egress rules:
# security groups are stateful, so replies to the server still get out.
resource "aws_security_group" "db" {
  name        = "${local.name}-db"
  description = "RDS: PostgreSQL from the server only"
  vpc_id      = aws_vpc.main.id
  tags        = { Name = "${local.name}-db" }
}

resource "aws_vpc_security_group_ingress_rule" "db_from_web" {
  security_group_id            = aws_security_group.db.id
  description                  = "PostgreSQL from the server"
  ip_protocol                  = "tcp"
  from_port                    = 5432
  to_port                      = 5432
  referenced_security_group_id = aws_security_group.web.id
}
