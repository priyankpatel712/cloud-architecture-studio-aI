variable "vercel_api_token" {
  type        = string
  description = "Vercel API Token (generate at https://vercel.com/account/tokens)"
  sensitive   = true
}

variable "vercel_team_id" {
  type        = string
  description = "Optional Vercel Team ID (leave blank for personal account)"
  default     = null
}

variable "project_name" {
  type        = string
  description = "Project name on Vercel and MongoDB Atlas"
  default     = "cloud-architecture-studio"
}

variable "github_repo" {
  type        = string
  description = "GitHub repository string (e.g. username/cloud-architecture-studio-aI)"
  default     = ""
}

# --- MongoDB Atlas Variables ---
variable "mongodbatlas_public_key" {
  type        = string
  description = "MongoDB Atlas Programmatic API Public Key"
  sensitive   = true
}

variable "mongodbatlas_private_key" {
  type        = string
  description = "MongoDB Atlas Programmatic API Private Key"
  sensitive   = true
}

variable "mongodbatlas_org_id" {
  type        = string
  description = "MongoDB Atlas Organization ID"
}

variable "mongodb_username" {
  type        = string
  description = "MongoDB Database user username"
  default     = "cas_app_user"
}

variable "mongodb_password" {
  type        = string
  description = "MongoDB Database user password"
  sensitive   = true
}

# --- Application Security & Config Variables ---
variable "auth_secret" {
  type        = string
  description = "Base64URL 32+ byte key for JWT auth secret. Leave empty to generate automatically."
  sensitive   = true
  default     = ""
}

variable "encryption_key" {
  type        = string
  description = "Base64 32-byte key for encryption at rest. Leave empty to generate automatically."
  sensitive   = true
  default     = ""
}

variable "llm_provider" {
  type        = string
  description = "Default LLM Provider (groq | nvidia | gemini | openrouter | anthropic)"
  default     = "nvidia"
}

variable "nvidia_api_key" {
  type        = string
  description = "NVIDIA NIM API Key"
  sensitive   = true
  default     = ""
}

variable "groq_api_key" {
  type        = string
  description = "Groq API Key"
  sensitive   = true
  default     = ""
}

variable "gemini_api_key" {
  type        = string
  description = "Google Gemini API Key"
  sensitive   = true
  default     = ""
}

variable "openrouter_api_key" {
  type        = string
  description = "OpenRouter API Key"
  sensitive   = true
  default     = ""
}

variable "resend_api_key" {
  type        = string
  description = "Resend Email API Key (optional for free tier email delivery)"
  sensitive   = true
  default     = ""
}

variable "smtp_host" {
  type        = string
  description = "SMTP Host for Mailtrap"
  default     = "sandbox.smtp.mailtrap.io"
}

variable "smtp_port" {
  type        = string
  description = "SMTP Port for Mailtrap"
  default     = "587"
}

variable "smtp_user" {
  type        = string
  description = "SMTP User for Mailtrap"
  default     = "158651ef857574"
}

variable "smtp_pass" {
  type        = string
  description = "SMTP Password for Mailtrap"
  sensitive   = true
  default     = "90a9a4499b856a"
}

variable "email_from" {
  type        = string
  description = "Default Email From address"
  default     = "Cloud Architecture Studio <from@example.com>"
}
