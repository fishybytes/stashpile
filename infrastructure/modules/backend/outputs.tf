output "instance_id" {
  value = aws_instance.backend.id
}

output "public_ip" {
  value = aws_eip.backend.public_ip
}

output "ssm_connect" {
  value = "aws ssm start-session --target ${aws_instance.backend.id}"
}

output "api_url" {
  value = "https://${var.api_domain}"
}

