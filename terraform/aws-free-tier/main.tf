terraform {
  required_version = ">= 1.5.0"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.5"
    }
  }
}

provider "aws" {
  region = var.aws_region
}

variable "aws_region" {
  type        = string
  description = "AWS region for free tier instance"
  default     = "us-east-1"
}

variable "instance_type" {
  type        = string
  description = "Free tier eligible EC2 instance type"
  default     = "t3.micro" # 750 free hours/month for 12 months
}

variable "key_name" {
  type        = string
  description = "AWS SSH Key pair name"
  default     = null
}

variable "app_name" {
  type        = string
  default     = "cloud-architecture-studio"
}

# --- VPC & Security Group ---
data "aws_vpc" "default" {
  default = true
}

resource "aws_security_group" "cas_sg" {
  name        = "${var.app_name}-free-sg"
  description = "Security Group for Free Tier Application Server"
  vpc_id      = data.aws_vpc.default.id

  ingress {
    description = "HTTP Traffic"
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  ingress {
    description = "HTTPS Traffic"
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  ingress {
    description = "SSH Access"
    from_port   = 22
    to_port     = 22
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"] # Restrict to your IP in production
  }

  egress {
    description = "Allow all outbound traffic"
    from_port   = 0
    to_port     = 0
    protocol    ="-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

# --- Ubuntu 24.04 LTS AMI ---
data "aws_ami" "ubuntu" {
  most_recent = true
  filter {
    name   = "name"
    values = ["ubuntu/images/hvm-ssd-gp3/ubuntu-noble-24.04-amd64-server-*"]
  }
  filter {
    name   = "virtualization-type"
    values = ["hvm"]
  }
  owners = ["099720109477"] # Canonical
}

# --- Free Tier EC2 Instance ---
resource "aws_instance" "cas_server" {
  ami                    = data.aws_ami.ubuntu.id
  instance_type          = var.instance_type
  key_name               = var.key_name
  vpc_security_group_ids = [aws_security_group.cas_sg.id]

  user_data = <<-EOF
              #!/bin/bash
              apt-get update -y
              apt-get install -y docker.io docker-compose git nodejs npm
              systemctl enable --now docker
              usermod -aG docker ubuntu
              EOF

  tags = {
    Name        = var.app_name
    Environment = "FreeTier"
    ManagedBy   = "Terraform"
  }
}

output "instance_public_ip" {
  value       = aws_instance.cas_server.public_ip
  description = "Public IP address of the AWS Free Tier instance"
}

output "instance_public_dns" {
  value       = aws_instance.cas_server.public_dns
  description = "Public DNS name of the AWS Free Tier instance"
}
