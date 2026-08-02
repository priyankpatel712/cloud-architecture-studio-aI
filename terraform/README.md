# 🚀 Free & Secure Terraform Infrastructure Deployment

This directory contains production-ready Infrastructure as Code (IaC) scripts using **Terraform** to provision a 100% free yet secure deployment pipeline for **Cloud Architecture Studio AI**.

---

## 🏗️ Architecture Options Included

1. **Primary Recommended Option (`/terraform`): Vercel + MongoDB Atlas Free Tier**
   - **App Platform:** Vercel Hobby Tier (Serverless Next.js 16 runtime, SSL/TLS, DDoS defense)
   - **Database Platform:** MongoDB Atlas M0 Shared Free Tier (512 MB, SCRAM-SHA-256 auth, TLS in transit)
   - **Cost:** $0.00 / month forever

2. **Alternative Option (`/terraform/aws-free-tier`): AWS EC2 Free Tier**
   - **Compute:** AWS `t3.micro` / `t2.micro` (750 free hours/month for 12 months)
   - **Network:** VPC Default Security Group with strict HTTP/HTTPS/SSH ingress rules
   - **Cost:** $0.00 / month (first 12 months)

---

## 🔒 Security Best Practices Implemented
- **Secrets Management:** Automatically generates 48-byte `AUTH_SECRET` and 32-byte `ENCRYPTION_KEY` if not explicitly supplied.
- **State Protection:** Sensitive fields (`AUTH_SECRET`, `ENCRYPTION_KEY`, `MONGODB_URI`, API Keys) are marked `sensitive = true`.
- **Database Whitelisting:** MongoDB Atlas database cluster accepts traffic only with TLS and valid credentials.

---

## ⚡ Quickstart Guide: Deploying Vercel + MongoDB Atlas

### Prerequisites
1. Install [Terraform CLI](https://developer.hashicorp.com/terraform/downloads) (v1.5.0+).
2. Obtain API Tokens:
   - **Vercel API Token:** [https://vercel.com/account/tokens](https://vercel.com/account/tokens)
   - **MongoDB Atlas Programmatic API Key:** Project/Org Settings → Access Manager → API Keys (Public + Private Key).

### Step-by-Step Instructions

1. **Navigate to the terraform directory:**
   ```bash
   cd terraform
   ```

2. **Create your secrets file (`terraform.tfvars`):**
   ```bash
   cp terraform.tfvars.example terraform.tfvars
   ```
   Open `terraform.tfvars` and fill in your keys:
   ```hcl
   vercel_api_token        = "vca_..."
   mongodbatlas_public_key  = "..."
   mongodbatlas_private_key = "..."
   mongodbatlas_org_id      = "..."
   github_repo             = "your-username/cloud-architecture-studio-aI"
   nvidia_api_key          = "nvapi-..." # Or your preferred free LLM API key
   ```

3. **Initialize Terraform:**
   ```bash
   terraform init
   ```

4. **Preview Execution Plan:**
   ```bash
   terraform plan
   ```

5. **Apply & Deploy Infrastructure:**
   ```bash
   terraform apply
   ```

---

## ⚡ Alternative Quickstart: Deploying to AWS Free Tier

If you prefer to deploy directly on AWS Free Tier:

```bash
cd terraform/aws-free-tier
terraform init
terraform plan
terraform apply
```
This provisions an AWS EC2 instance pre-configured with Docker and Security Groups ready to run your application containers.
