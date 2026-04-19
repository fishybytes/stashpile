resource "aws_iam_openid_connect_provider" "github" {
  url             = "https://token.actions.githubusercontent.com"
  client_id_list  = ["sts.amazonaws.com"]
  thumbprint_list = [
    "6938fd4d98bab03faadb97b34396831e3780aea1",
    "1c58a3a8518e8759bf075b76b750d4f2df264fcd"
  ]
}

resource "aws_iam_role" "github_actions" {
  name = "stashpile-dev-github-actions"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Federated = aws_iam_openid_connect_provider.github.arn }
      Action    = "sts:AssumeRoleWithWebIdentity"
      Condition = {
        StringLike    = { "token.actions.githubusercontent.com:sub" = "repo:fishybytes/stashpile:*" }
        StringEquals  = { "token.actions.githubusercontent.com:aud" = "sts.amazonaws.com" }
      }
    }]
  })
}

resource "aws_iam_role_policy" "github_actions" {
  name = "stashpile-dev-github-actions"
  role = aws_iam_role.github_actions.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        # EC2 + EIP management
        Effect   = "Allow"
        Action   = ["ec2:*"]
        Resource = "*"
      },
      {
        # IAM — scoped to stashpile resources
        Effect   = "Allow"
        Action   = ["iam:*"]
        Resource = [
          "arn:aws:iam::*:role/stashpile-*",
          "arn:aws:iam::*:policy/stashpile-*",
          "arn:aws:iam::*:instance-profile/stashpile-*",
          "arn:aws:iam::*:oidc-provider/*"
        ]
      },
      {
        # S3 — state bucket + sync bucket
        Effect   = "Allow"
        Action   = ["s3:*"]
        Resource = [
          "arn:aws:s3:::stashpile-*",
          "arn:aws:s3:::stashpile-*/*"
        ]
      },
      {
        # SSM — run commands + session manager
        Effect   = "Allow"
        Action   = ["ssm:*"]
        Resource = "*"
      }
    ]
  })
}

output "github_actions_role_arn" {
  value = aws_iam_role.github_actions.arn
}
