data "aws_caller_identity" "current" {}

locals {
  name = "stashpile-${var.environment}"
  tags = {
    Project     = "stashpile"
    Environment = var.environment
  }
}

resource "aws_s3_bucket" "sync" {
  bucket        = "${local.name}-sync-${data.aws_caller_identity.current.account_id}"
  force_destroy = true
  tags          = local.tags
}

resource "aws_s3_bucket_public_access_block" "sync" {
  bucket                  = aws_s3_bucket.sync.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_iam_role" "server" {
  name = "${local.name}-server"

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
  role       = aws_iam_role.server.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore"
}

resource "aws_iam_role_policy" "s3_sync" {
  name = "${local.name}-s3-sync"
  role = aws_iam_role.server.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["s3:GetObject", "s3:ListBucket"]
      Resource = [
        aws_s3_bucket.sync.arn,
        "${aws_s3_bucket.sync.arn}/*"
      ]
    }]
  })
}

resource "aws_iam_instance_profile" "server" {
  name = "${local.name}-server"
  role = aws_iam_role.server.name
  tags = local.tags
}

resource "aws_security_group" "server" {
  name        = "${local.name}-server"
  description = "Expo Metro bundler (${var.environment})"

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

  tags = local.tags
}

resource "aws_eip" "server" {
  instance = aws_instance.server.id
  domain   = "vpc"
  tags     = local.tags
}

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

resource "aws_instance" "server" {
  ami                    = data.aws_ami.al2023.id
  instance_type          = var.instance_type
  iam_instance_profile   = aws_iam_instance_profile.server.name
  vpc_security_group_ids = [aws_security_group.server.id]

  user_data = base64encode(templatefile("${path.module}/userdata.sh", {
    bucket_name = aws_s3_bucket.sync.bucket
  }))

  root_block_device {
    volume_size = 30
  }

  tags = merge(local.tags, { Name = "${local.name}-server" })
}
