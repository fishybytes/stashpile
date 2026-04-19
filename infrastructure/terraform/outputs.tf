output "instance_id" {
  value = aws_instance.dev_server.id
}

output "public_ip" {
  description = "Stable public IP for Expo Go — set this in EXPO_DEVSERVER_URL"
  value       = aws_eip.dev_server.public_ip
}

output "ssm_connect" {
  value = "aws ssm start-session --target ${aws_instance.dev_server.id}"
}

output "s3_bucket" {
  value = aws_s3_bucket.dev_sync.bucket
}
