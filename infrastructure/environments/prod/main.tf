terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.0"
    }
  }

  backend "s3" {
    bucket = "stashpile-tfstate-978850043818"
    key    = "prod/terraform.tfstate"
    region = "us-east-1"
  }
}

provider "aws" {
  region = "us-east-1"
}

variable "domain_name" {
  description = "Root domain (e.g. stashpile.xyz). Must match the global environment."
}

variable "admin_email" {
  description = "Email for Let's Encrypt certificate notifications"
}

data "aws_route53_zone" "main" {
  name         = var.domain_name
  private_zone = false
}

# ─── Expo server ──────────────────────────────────────────────────────────────

module "server" {
  source        = "../../modules/server"
  environment   = "prod"
  instance_type = "t3.medium"
}

output "instance_id" { value = module.server.instance_id }
output "public_ip"   { value = module.server.public_ip }
output "s3_bucket"   { value = module.server.s3_bucket }
output "ssm_connect" { value = module.server.ssm_connect }

# ─── Backend API server ───────────────────────────────────────────────────────

module "backend" {
  source        = "../../modules/backend"
  environment   = "prod"
  instance_type = "t3.medium"
  api_domain    = "api.${var.domain_name}"
  zone_id       = data.aws_route53_zone.main.zone_id
  admin_email   = var.admin_email
}

output "backend_instance_id"    { value = module.backend.instance_id }
output "backend_public_ip"      { value = module.backend.public_ip }
output "backend_api_url"        { value = module.backend.api_url }
output "backend_ssm_connect"    { value = module.backend.ssm_connect }
output "backend_db_password_ssm"{ value = module.backend.db_password_ssm_path }
