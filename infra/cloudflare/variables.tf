variable "cloudflare_api_token" {
  description = "Token created at dash.cloudflare.com/profile/api-tokens — Edit Zone DNS template, scoped to flipagent.dev."
  type        = string
  sensitive   = true
}

variable "zone_id" {
  description = "Cloudflare zone id for flipagent.dev. Find under the zone's Overview page → API section."
  type        = string
}

variable "api_target_fqdn" {
  description = "Stable Container App ingress FQDN that api.flipagent.dev should CNAME to. Comes from `terraform output -raw api_fqdn` in infra/azure."
  type        = string
}

variable "api_domain_verification_id" {
  description = "Azure-issued domain verification token. Comes from `terraform output -raw custom_domain_verification_id` in infra/azure (mark output non-sensitive temporarily, or read state directly)."
  type        = string
}
