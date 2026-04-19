output "instance_id" {
  value = aws_instance.server.id
}

output "public_ip" {
  value = aws_eip.server.public_ip
}

output "s3_bucket" {
  value = aws_s3_bucket.sync.bucket
}

output "ssm_connect" {
  value = "aws ssm start-session --target ${aws_instance.server.id}"
}
