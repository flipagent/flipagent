output "resource_group" {
  value = azurerm_resource_group.rg.name
}

output "acr_login_server" {
  description = "Used as the docker push target. e.g. flipagentprod.azurecr.io"
  value       = azurerm_container_registry.acr.login_server
}

output "api_fqdn" {
  description = "Stable ingress hostname (does not change across revisions). Use this as the CNAME target for custom_domain."
  value       = azurerm_container_app.api.ingress[0].fqdn
}

output "api_url" {
  value = "https://${azurerm_container_app.api.ingress[0].fqdn}"
}

output "postgres_fqdn" {
  value = azurerm_postgresql_flexible_server.pg.fqdn
}

output "postgres_admin_password" {
  description = "Generated Postgres admin password. Copy to a secret store."
  value       = random_password.pg_admin.result
  sensitive   = true
}

output "database_url" {
  description = "Connection string the Container App uses. Pull it for ad-hoc psql."
  value       = local.database_url
  sensitive   = true
}

output "custom_domain_verification_id" {
  description = "Set this as the value of an `asuid.<custom_domain>` TXT record before binding the domain. Marked sensitive because azurerm flags it that way."
  value       = azurerm_container_app.api.custom_domain_verification_id
  sensitive   = true
}

# --- GitHub Actions OIDC values ----------------------------------------------
# Pipe these into GH secrets after `terraform apply`:
#   gh secret set AZURE_CLIENT_ID       --body "$(terraform output -raw github_oidc_client_id)"
#   gh secret set AZURE_TENANT_ID       --body "$(terraform output -raw azure_tenant_id)"
#   gh secret set AZURE_SUBSCRIPTION_ID --body "$(terraform output -raw azure_subscription_id)"

output "github_oidc_client_id" {
  description = "appId of the SP GH Actions assumes via OIDC. → AZURE_CLIENT_ID"
  value       = azuread_application.github_oidc.client_id
}

output "azure_tenant_id" {
  description = "→ AZURE_TENANT_ID"
  value       = data.azurerm_client_config.current.tenant_id
}

output "azure_subscription_id" {
  description = "→ AZURE_SUBSCRIPTION_ID"
  value       = data.azurerm_client_config.current.subscription_id
}
