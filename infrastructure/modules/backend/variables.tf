variable "environment" {
  description = "Environment name (dev, prod)"
}

variable "instance_type" {
  default = "t3.small"
}

variable "api_domain" {
  description = "FQDN for this environment's API (e.g. api.dev.stashpile.xyz)"
}

variable "zone_id" {
  description = "Route53 hosted zone ID"
}

variable "admin_email" {
  description = "Email for Let's Encrypt certificate notifications"
}
