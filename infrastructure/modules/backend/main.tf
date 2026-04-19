terraform {
  required_providers {
    random = {
      source  = "hashicorp/random"
      version = "~> 3.0"
    }
  }
}

data "aws_caller_identity" "current" {}

locals {
  name = "stashpile-${var.environment}-backend"
  tags = {
    Project     = "stashpile"
    Environment = var.environment
    Component   = "backend"
  }
}

# ─── Database password ────────────────────────────────────────────────────────

resource "random_password" "db" {
  length  = 32
  special = false
}

resource "aws_ssm_parameter" "db_password" {
  name  = "/stashpile/${var.environment}/db-password"
  type  = "SecureString"
  value = random_password.db.result
  tags  = local.tags
}

# ─── IAM ─────────────────────────────────────────────────────────────────────

resource "aws_iam_role" "backend" {
  name = local.name

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action    = "sts:AssumeRole"
      Effect    = "Allow"
      Principal = { Service = "ec2.amazonaws.com" }
    }]
  })

  tags = local.tags
}

resource "aws_iam_role_policy_attachment" "ssm" {
  role       = aws_iam_role.backend.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore"
}

resource "aws_iam_role_policy" "secrets" {
  name = "${local.name}-secrets"
  role = aws_iam_role.backend.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["ssm:GetParameter", "ssm:GetParameters"]
      Resource = "arn:aws:ssm:*:${data.aws_caller_identity.current.account_id}:parameter/stashpile/${var.environment}/*"
    }]
  })
}

resource "aws_iam_instance_profile" "backend" {
  name = local.name
  role = aws_iam_role.backend.name
  tags = local.tags
}

# ─── Security group ───────────────────────────────────────────────────────────

resource "aws_security_group" "backend" {
  name        = local.name
  description = "stashpile backend API"

  ingress {
    description = "HTTP (Let's Encrypt validation + redirect)"
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  ingress {
    description = "HTTPS"
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = local.tags

  lifecycle {
    create_before_destroy = true
  }
}

# ─── EC2 ─────────────────────────────────────────────────────────────────────

data "aws_ami" "al2023" {
  most_recent = true
  owners      = ["amazon"]

  filter {
    name   = "name"
    values = ["al2023-ami-*-x86_64"]
  }

  filter {
    name   = "state"
    values = ["available"]
  }
}

resource "aws_instance" "backend" {
  ami                    = data.aws_ami.al2023.id
  instance_type          = var.instance_type
  iam_instance_profile   = aws_iam_instance_profile.backend.name
  vpc_security_group_ids = [aws_security_group.backend.id]

  user_data = base64encode(templatefile("${path.module}/userdata.sh", {
    environment = var.environment
    api_domain  = var.api_domain
    admin_email = var.admin_email
  }))

  root_block_device {
    # Extra space for Postgres data and the sentence-transformers model (~500MB)
    volume_size = 20
  }

  tags = merge(local.tags, { Name = local.name })
}

resource "aws_eip" "backend" {
  instance = aws_instance.backend.id
  domain   = "vpc"
  tags     = local.tags
}

# ─── DNS ─────────────────────────────────────────────────────────────────────

resource "aws_route53_record" "api" {
  zone_id = var.zone_id
  name    = var.api_domain
  type    = "A"
  ttl     = 60
  records = [aws_eip.backend.public_ip]
}
