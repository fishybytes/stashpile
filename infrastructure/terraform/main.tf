terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

provider "aws" {
  region = var.aws_region
}

data "aws_caller_identity" "current" {}

# S3 bucket for code syncing
resource "aws_s3_bucket" "dev_sync" {
  bucket        = "stashpile-dev-sync-${data.aws_caller_identity.current.account_id}"
  force_destroy = true

  tags = { Project = "stashpile" }
}

resource "aws_s3_bucket_public_access_block" "dev_sync" {
  bucket                  = aws_s3_bucket.dev_sync.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# IAM role for SSM access (no SSH needed)
resource "aws_iam_role" "dev_server" {
  name = "stashpile-dev-server"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action    = "sts:AssumeRole"
      Effect    = "Allow"
      Principal = { Service = "ec2.amazonaws.com" }
    }]
  })
}

resource "aws_iam_role_policy_attachment" "ssm" {
  role       = aws_iam_role.dev_server.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore"
}

resource "aws_iam_role_policy" "s3_sync" {
  name = "stashpile-s3-sync"
  role = aws_iam_role.dev_server.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["s3:GetObject", "s3:ListBucket"]
      Resource = [
        aws_s3_bucket.dev_sync.arn,
        "${aws_s3_bucket.dev_sync.arn}/*"
      ]
    }]
  })
}

resource "aws_iam_instance_profile" "dev_server" {
  name = "stashpile-dev-server"
  role = aws_iam_role.dev_server.name
}

# Security group — no 22, just Metro + Expo ports
resource "aws_security_group" "dev_server" {
  name        = "stashpile-dev-server"
  description = "Expo Metro bundler"

  ingress {
    description = "Metro bundler"
    from_port   = 8081
    to_port     = 8081
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  ingress {
    description = "Expo DevTools"
    from_port   = 19000
    to_port     = 19002
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

# Elastic IP so the address never changes
resource "aws_eip" "dev_server" {
  instance = aws_instance.dev_server.id
  domain   = "vpc"
}

# Latest Amazon Linux 2023 AMI (has SSM agent pre-installed)
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

resource "aws_instance" "dev_server" {
  ami                    = data.aws_ami.al2023.id
  instance_type          = var.instance_type
  iam_instance_profile   = aws_iam_instance_profile.dev_server.name
  vpc_security_group_ids = [aws_security_group.dev_server.id]

  # Instance starts stopped — use start-dev.sh to bring it up
  user_data = base64encode(templatefile("${path.module}/userdata.sh", {
    bucket_name = aws_s3_bucket.dev_sync.bucket
  }))

  root_block_device {
    volume_size = 20
  }

  tags = {
    Name    = "stashpile-dev-server"
    Project = "stashpile"
  }
}
