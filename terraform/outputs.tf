output "vercel_project_name" {
  value       = vercel_project.cas_vercel_project.name
  description = "Name of the created Vercel project"
}

output "mongodb_cluster_name" {
  value       = mongodbatlas_cluster.cas_free_cluster.name
  description = "Name of the provisioned MongoDB Atlas M0 cluster"
}

output "mongodb_connection_string_masked" {
  value       = replace(local.mongodb_uri, local.final_db_password, "********")
  description = "Masked MongoDB Atlas URI for connection verification"
}

output "security_notice" {
  value       = "Deployment completed securely! Secrets (AUTH_SECRET and ENCRYPTION_KEY) are encrypted at rest in Vercel environment variables."
  description = "Post-deployment security reminder"
}
