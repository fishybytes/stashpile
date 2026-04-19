terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

provider "aws" {
  region = "us-east-1"
}

module "server" {
  source        = "../../modules/server"
  environment   = "dev"
  instance_type = "t3.small"
}

output "instance_id" { value = module.server.instance_id }
output "public_ip"   { value = module.server.public_ip }
output "s3_bucket"   { value = module.server.s3_bucket }
output "ssm_connect" { value = module.server.ssm_connect }
