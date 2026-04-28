locals {
  api_subdomain   = "api"
  asuid_subdomain = "asuid.api"
}

# api.flipagent.dev → Container App. proxied=false because Container Apps
# terminates TLS itself with its own managed cert; routing through
# Cloudflare's proxy would require us to also add a CF cert + an Origin
# Rule, which is unnecessary for an API hit by SDKs (no need for caching
# or DDoS shielding on JSON-only traffic).
resource "cloudflare_record" "api_cname" {
  zone_id = var.zone_id
  name    = local.api_subdomain
  type    = "CNAME"
  content = var.api_target_fqdn
  proxied = false
  ttl     = 300
  comment = "Container App ingress"
}

# asuid.api.flipagent.dev TXT — Azure proves we own the domain via this.
resource "cloudflare_record" "api_asuid" {
  zone_id = var.zone_id
  name    = local.asuid_subdomain
  type    = "TXT"
  content = var.api_domain_verification_id
  ttl     = 300
  comment = "Azure Container Apps custom-domain verification"
}
