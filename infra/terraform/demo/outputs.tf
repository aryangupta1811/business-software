# No secrets here: outputs are stored in state in plain text.

output "server_instance_id" {
  description = "For aws ssm start-session and aws ec2 start/stop-instances."
  value       = aws_instance.server.id
}

output "server_public_dns" {
  description = "Changes at every start (no Elastic IP); DuckDNS follows it in part 3."
  value       = aws_instance.server.public_dns
}

output "db_identifier" {
  description = "For aws rds start/stop-db-instance."
  value       = aws_db_instance.main.identifier
}

output "db_address" {
  description = "RDS host name, reachable only from inside the VPC."
  value       = aws_db_instance.main.address
}

output "db_master_password_parameter" {
  description = "SSM parameter holding the master password."
  value       = aws_ssm_parameter.db_master_password.name
}

output "duckdns_token_parameter" {
  description = "SSM parameter the owner overwrites with the DuckDNS token."
  value       = aws_ssm_parameter.duckdns_token.name
}

output "deploy_role_arn" {
  description = "Goes into the GitHub environment secret AWS_DEPLOY_ROLE_ARN (holds the account ID, so not printed)."
  value       = aws_iam_role.deploy.arn
  sensitive   = true
}
