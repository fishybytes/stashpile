variable "environment" {
  description = "Environment name (e.g. dev, prod)"
}

variable "aws_region" {
  default = "us-east-1"
}

variable "instance_type" {
  default = "t3.small"
}
