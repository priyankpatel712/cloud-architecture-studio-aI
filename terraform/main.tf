provider "vercel" {
  api_token = var.vercel_api_token
  team_id   = var.vercel_team_id
}

provider "mongodbatlas" {
  public_key  = var.mongodbatlas_public_key
  private_key = var.mongodbatlas_private_key
}

# --- Random Security Key Generators ---
resource "random_password" "generated_auth_secret" {
  length  = 48
  special = false
}

resource "random_password" "generated_encryption_key" {
  length  = 32
  special = false
}

resource "random_password" "generated_db_password" {
  length  = 24
  special = false
}

locals {
  final_auth_secret    = var.auth_secret != "" ? var.auth_secret : random_password.generated_auth_secret.result
  final_encryption_key = var.encryption_key != "" ? var.encryption_key : random_password.generated_encryption_key.result
  final_db_password    = var.mongodb_password != "" ? var.mongodb_password : random_password.generated_db_password.result
}

# --- MongoDB Atlas M0 Free Tier Deployment ---
resource "mongodbatlas_project" "cas_project" {
  name   = var.project_name
  org_id = var.mongodbatlas_org_id
}

resource "mongodbatlas_cluster" "cas_free_cluster" {
  project_id   = mongodbatlas_project.cas_project.id
  name         = "${var.project_name}-cluster"
  cluster_type = "REPLICASET"

  # M0 Free Tier Tenant Configuration
  provider_name               = "TENANT"
  backing_provider_name       = "AWS"
  provider_region_name       = "US_EAST_1"
  provider_instance_size_name = "M0"
}

resource "mongodbatlas_database_user" "cas_db_user" {
  username           = var.mongodb_username
  password           = local.final_db_password
  project_id         = mongodbatlas_project.cas_project.id
  auth_database_name = "admin"

  roles {
    role_name     = "readWriteAnyDatabase"
    database_name = "admin"
  }
}

# Allow connections from Vercel Dynamic Edge/Serverless IPs
resource "mongodbatlas_project_ip_access_list" "allow_vercel" {
  project_id = mongodbatlas_project.cas_project.id
  cidr_block = "0.0.0.0/0"
  comment    = "Allow Vercel Serverless API Functions"
}

locals {
  # Construct secure TLS connection string for MongoDB Atlas
  raw_connection_string = mongodbatlas_cluster.cas_free_cluster.connection_strings[0].standard_srv
  mongodb_uri           = replace(local.raw_connection_string, "mongodb+srv://", "mongodb+srv://${var.mongodb_username}:${local.final_db_password}@")
}

# --- Vercel Project & Deployment Configuration ---
resource "vercel_project" "cas_vercel_project" {
  name      = var.project_name
  framework = "nextjs"

  root_directory = "app"

  git_repository = var.github_repo != "" ? {
    type = "github"
    repo = var.github_repo
  } : null
}

# --- Environment Variables Management on Vercel ---
resource "vercel_project_environment_variable" "env_mongodb_uri" {
  project_id = vercel_project.cas_vercel_project.id
  key        = "MONGODB_URI"
  value      = local.mongodb_uri
  target     = ["production", "preview", "development"]
}

resource "vercel_project_environment_variable" "env_auth_secret" {
  project_id = vercel_project.cas_vercel_project.id
  key        = "AUTH_SECRET"
  value      = local.final_auth_secret
  target     = ["production", "preview", "development"]
}

resource "vercel_project_environment_variable" "env_encryption_key" {
  project_id = vercel_project.cas_vercel_project.id
  key        = "ENCRYPTION_KEY"
  value      = local.final_encryption_key
  target     = ["production", "preview", "development"]
}

resource "vercel_project_environment_variable" "env_bcrypt_rounds" {
  project_id = vercel_project.cas_vercel_project.id
  key        = "BCRYPT_ROUNDS"
  value      = "12"
  target     = ["production", "preview", "development"]
}

resource "vercel_project_environment_variable" "env_llm_provider" {
  project_id = vercel_project.cas_vercel_project.id
  key        = "LLM_PROVIDER"
  value      = var.llm_provider
  target     = ["production", "preview", "development"]
}

resource "vercel_project_environment_variable" "env_nvidia_api_key" {
  count      = var.nvidia_api_key != "" ? 1 : 0
  project_id = vercel_project.cas_vercel_project.id
  key        = "NVIDIA_API_KEY"
  value      = var.nvidia_api_key
  target     = ["production", "preview", "development"]
}

resource "vercel_project_environment_variable" "env_groq_api_key" {
  count      = var.groq_api_key != "" ? 1 : 0
  project_id = vercel_project.cas_vercel_project.id
  key        = "GROQ_API_KEY"
  value      = var.groq_api_key
  target     = ["production", "preview", "development"]
}

resource "vercel_project_environment_variable" "env_gemini_api_key" {
  count      = var.gemini_api_key != "" ? 1 : 0
  project_id = vercel_project.cas_vercel_project.id
  key        = "GEMINI_API_KEY"
  value      = var.gemini_api_key
  target     = ["production", "preview", "development"]
}

resource "vercel_project_environment_variable" "env_openrouter_api_key" {
  count      = var.openrouter_api_key != "" ? 1 : 0
  project_id = vercel_project.cas_vercel_project.id
  key        = "OPENROUTER_API_KEY"
  value      = var.openrouter_api_key
  target     = ["production", "preview", "development"]
}

resource "vercel_project_environment_variable" "env_resend_api_key" {
  count      = var.resend_api_key != "" ? 1 : 0
  project_id = vercel_project.cas_vercel_project.id
  key        = "RESEND_API_KEY"
  value      = var.resend_api_key
  target     = ["production", "preview", "development"]
}

resource "vercel_project_environment_variable" "env_email_provider" {
  project_id = vercel_project.cas_vercel_project.id
  key        = "EMAIL_PROVIDER"
  value      = "smtp"
  target     = ["production", "preview", "development"]
}

resource "vercel_project_environment_variable" "env_smtp_host" {
  project_id = vercel_project.cas_vercel_project.id
  key        = "SMTP_HOST"
  value      = var.smtp_host
  target     = ["production", "preview", "development"]
}

resource "vercel_project_environment_variable" "env_smtp_port" {
  project_id = vercel_project.cas_vercel_project.id
  key        = "SMTP_PORT"
  value      = var.smtp_port
  target     = ["production", "preview", "development"]
}

resource "vercel_project_environment_variable" "env_smtp_user" {
  project_id = vercel_project.cas_vercel_project.id
  key        = "SMTP_USER"
  value      = var.smtp_user
  target     = ["production", "preview", "development"]
}

resource "vercel_project_environment_variable" "env_smtp_pass" {
  project_id = vercel_project.cas_vercel_project.id
  key        = "SMTP_PASS"
  value      = var.smtp_pass
  target     = ["production", "preview", "development"]
}

resource "vercel_project_environment_variable" "env_email_from" {
  project_id = vercel_project.cas_vercel_project.id
  key        = "EMAIL_FROM"
  value      = var.email_from
  target     = ["production", "preview", "development"]
}
