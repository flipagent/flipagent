locals {
  prefix = "flipagent-${var.environment}"
  # ACR + Postgres need globally-unique, no-hyphen names.
  flat_prefix = "flipagent${var.environment}"
  tags = {
    project     = "flipagent"
    environment = var.environment
    managed_by  = "terraform"
  }
}

# --- Resource group ------------------------------------------------------------

resource "azurerm_resource_group" "rg" {
  name     = local.prefix
  location = var.location
  tags     = local.tags
}

# --- Container Registry --------------------------------------------------------

resource "azurerm_container_registry" "acr" {
  name                = local.flat_prefix
  resource_group_name = azurerm_resource_group.rg.name
  location            = azurerm_resource_group.rg.location
  sku                 = "Basic"
  admin_enabled       = false
  tags                = local.tags
}

# --- Postgres Flexible Server -------------------------------------------------

resource "random_password" "pg_admin" {
  length           = 32
  special          = true
  override_special = "!#$%&*()-_=+:?"
}

resource "azurerm_postgresql_flexible_server" "pg" {
  name                          = "${local.prefix}-pg"
  resource_group_name           = azurerm_resource_group.rg.name
  location                      = azurerm_resource_group.rg.location
  version                       = "16"
  administrator_login           = "flipagent"
  administrator_password        = random_password.pg_admin.result
  sku_name                      = var.postgres_sku
  storage_mb                    = var.postgres_storage_mb
  backup_retention_days         = 7
  public_network_access_enabled = true
  zone                          = "1"
  tags                          = local.tags
}

resource "azurerm_postgresql_flexible_server_database" "appdb" {
  name      = "flipagent"
  server_id = azurerm_postgresql_flexible_server.pg.id
  charset   = "UTF8"
  collation = "en_US.utf8"
}

# Allow other Azure services (including our Container App) to reach Postgres.
# 0.0.0.0–0.0.0.0 is the special "Allow Azure services" sentinel rule.
resource "azurerm_postgresql_flexible_server_firewall_rule" "allow_azure" {
  name             = "allow-azure-services"
  server_id        = azurerm_postgresql_flexible_server.pg.id
  start_ip_address = "0.0.0.0"
  end_ip_address   = "0.0.0.0"
}

locals {
  # urlencode the password — random_password emits chars like :?+ that
  # collide with URL grammar, so the postgres-js client throws "URI
  # malformed" without encoding.
  database_url = format(
    "postgres://%s:%s@%s:5432/%s?sslmode=require",
    azurerm_postgresql_flexible_server.pg.administrator_login,
    urlencode(random_password.pg_admin.result),
    azurerm_postgresql_flexible_server.pg.fqdn,
    azurerm_postgresql_flexible_server_database.appdb.name,
  )
}

# --- Storage account for /v1/media image uploads -----------------------------
# Listings reference image URLs by fetch — eBay's image fetcher retrieves
# them at publish time. The container is set to anonymous-blob (read-only)
# public access so the URLs are reachable without per-request signing.
# Uploads themselves are SAS-signed and short-lived (30 min) — see
# `services/blob/azure.ts`.

resource "azurerm_storage_account" "media" {
  # Storage-account names must be 3-24 chars, lowercase letters/digits only.
  # `local.prefix` already meets that; strip non-alnum just in case.
  name                            = substr(replace("${local.prefix}media", "/[^a-z0-9]/", ""), 0, 24)
  resource_group_name             = azurerm_resource_group.rg.name
  location                        = azurerm_resource_group.rg.location
  account_tier                    = "Standard"
  account_replication_type        = "LRS"
  allow_nested_items_to_be_public = true
  min_tls_version                 = "TLS1_2"
  tags                            = local.tags
}

resource "azurerm_storage_container" "media" {
  name                  = "media"
  storage_account_id    = azurerm_storage_account.media.id
  container_access_type = "blob"
}

locals {
  blob_connection_string = azurerm_storage_account.media.primary_connection_string
}

# --- Log Analytics workspace (required by Container Apps) ---------------------

resource "azurerm_log_analytics_workspace" "logs" {
  name                = "${local.prefix}-logs"
  resource_group_name = azurerm_resource_group.rg.name
  location            = azurerm_resource_group.rg.location
  sku                 = "PerGB2018"
  retention_in_days   = 30
  tags                = local.tags
}

# --- User-assigned managed identity for the api ------------------------------
# We use a UAMI (not system-assigned) so the AcrPull role can be granted
# BEFORE the Container App tries to validate its registry config. With a
# system identity, the Container App's principal_id only exists after
# creation — but the registry binding is validated at create time, so the
# pull fails with a 401 chicken-and-egg loop.

resource "azurerm_user_assigned_identity" "api" {
  name                = "${local.prefix}-api-identity"
  resource_group_name = azurerm_resource_group.rg.name
  location            = azurerm_resource_group.rg.location
  tags                = local.tags
}

resource "azurerm_role_assignment" "api_acr_pull" {
  scope                = azurerm_container_registry.acr.id
  role_definition_name = "AcrPull"
  principal_id         = azurerm_user_assigned_identity.api.principal_id
}

# --- GitHub Actions OIDC ------------------------------------------------------
# App Registration + Service Principal that GH Actions assumes via federated
# identity. Three GH secrets (AZURE_CLIENT_ID / TENANT_ID / SUBSCRIPTION_ID)
# point the `azure/login@v2` action at this SP — no client secret stored.
# Subject must match the workflow's GITHUB_TOKEN claims; widen the federated
# credential list when you add more triggers (PRs, tags, environments).

data "azurerm_client_config" "current" {}

resource "azuread_application" "github_oidc" {
  display_name = "${local.prefix}-github-oidc"
}

resource "azuread_service_principal" "github_oidc" {
  client_id = azuread_application.github_oidc.client_id
}

resource "azuread_application_federated_identity_credential" "github_main" {
  application_id = azuread_application.github_oidc.id
  display_name   = "github-main"
  audiences      = ["api://AzureADTokenExchange"]
  issuer         = "https://token.actions.githubusercontent.com"
  subject        = "repo:flipagent/flipagent:ref:refs/heads/main"
}

resource "azurerm_role_assignment" "github_rg_contributor" {
  scope                = azurerm_resource_group.rg.id
  role_definition_name = "Contributor"
  principal_id         = azuread_service_principal.github_oidc.object_id
}

resource "azurerm_role_assignment" "github_acr_push" {
  scope                = azurerm_container_registry.acr.id
  role_definition_name = "AcrPush"
  principal_id         = azuread_service_principal.github_oidc.object_id
}

# --- Container Apps environment -----------------------------------------------

resource "azurerm_container_app_environment" "env" {
  name                       = "${local.prefix}-env"
  resource_group_name        = azurerm_resource_group.rg.name
  location                   = azurerm_resource_group.rg.location
  log_analytics_workspace_id = azurerm_log_analytics_workspace.logs.id
  tags                       = local.tags
}

# --- API Container App --------------------------------------------------------

resource "azurerm_container_app" "api" {
  name                         = "${local.prefix}-api"
  container_app_environment_id = azurerm_container_app_environment.env.id
  resource_group_name          = azurerm_resource_group.rg.name
  revision_mode                = "Single"
  tags                         = local.tags

  identity {
    type         = "UserAssigned"
    identity_ids = [azurerm_user_assigned_identity.api.id]
  }

  registry {
    server   = azurerm_container_registry.acr.login_server
    identity = azurerm_user_assigned_identity.api.id
  }

  # Wait for AcrPull on the UAMI before Azure validates the registry binding.
  depends_on = [azurerm_role_assignment.api_acr_pull]

  secret {
    name  = "database-url"
    value = local.database_url
  }
  secret {
    name  = "scraper-api-username"
    value = var.scraper_api_username
  }
  secret {
    name  = "scraper-api-password"
    value = var.scraper_api_password
  }
  secret {
    name  = "stripe-secret-key"
    value = var.stripe_secret_key
  }
  secret {
    name  = "stripe-webhook-secret"
    value = var.stripe_webhook_secret
  }
  secret {
    name  = "stripe-price-hobby"
    value = var.stripe_price_hobby
  }
  secret {
    name  = "stripe-price-standard"
    value = var.stripe_price_standard
  }
  secret {
    name  = "stripe-price-growth"
    value = var.stripe_price_growth
  }

  # eBay OAuth — empty values are fine; the api gracefully 503s downstream.
  secret {
    name  = "ebay-client-id"
    value = var.ebay_client_id
  }
  secret {
    name  = "ebay-client-secret"
    value = var.ebay_client_secret
  }
  secret {
    name  = "ebay-ru-name"
    value = var.ebay_ru_name
  }

  # AES-256-GCM symmetric key (base64) used to encrypt issued API key
  # plaintext at rest. Required in production for the dashboard's
  # "reveal key" feature; sha256 hash auth still works without it.
  # Generate with `openssl rand -base64 32`.
  secret {
    name  = "keys-encryption-key"
    value = var.keys_encryption_key
  }

  # AES-256-GCM symmetric key (base64) for the secrets envelope —
  # wraps eBay OAuth refresh tokens + webhook HMAC secrets at rest.
  # Required in production; the api throws on boot without it. Kept
  # separate from `keys-encryption-key` so the API-key blast radius
  # stays smaller. Generate with `openssl rand -base64 32`.
  secret {
    name  = "secrets-encryption-key"
    value = var.secrets_encryption_key
  }

  # Better-Auth + GitHub/Google OAuth + email.
  secret {
    name  = "better-auth-secret"
    value = var.better_auth_secret
  }
  secret {
    name  = "github-client-id"
    value = var.github_client_id
  }
  secret {
    name  = "github-client-secret"
    value = var.github_client_secret
  }
  secret {
    name  = "google-client-id"
    value = var.google_client_id
  }
  secret {
    name  = "google-client-secret"
    value = var.google_client_secret
  }
  secret {
    name  = "resend-api-key"
    value = var.resend_api_key
  }
  secret {
    name  = "blob-connection-string"
    value = local.blob_connection_string
  }

  # LLM provider keys + eBay DevID — declared dynamically so empty values are
  # silently skipped. Azure rejects secrets with empty `value`, and the
  # /v1/evaluate matcher + /v1/notifications already handle a missing env
  # (the provider self-disables).
  dynamic "secret" {
    for_each = var.anthropic_api_key == "" ? [] : [1]
    content {
      name  = "anthropic-api-key"
      value = var.anthropic_api_key
    }
  }
  dynamic "secret" {
    for_each = var.openai_api_key == "" ? [] : [1]
    content {
      name  = "openai-api-key"
      value = var.openai_api_key
    }
  }
  dynamic "secret" {
    for_each = var.google_api_key == "" ? [] : [1]
    content {
      name  = "google-api-key"
      value = var.google_api_key
    }
  }
  dynamic "secret" {
    for_each = var.ebay_dev_id == "" ? [] : [1]
    content {
      name  = "ebay-dev-id"
      value = var.ebay_dev_id
    }
  }

  template {
    min_replicas = var.api_min_replicas
    max_replicas = var.api_max_replicas

    container {
      name   = "api"
      image  = var.api_image
      cpu    = var.api_cpu
      memory = var.api_memory

      env {
        name  = "PORT"
        value = "4000"
      }
      env {
        name  = "NODE_ENV"
        value = "production"
      }
      env {
        name  = "MIGRATE_ON_BOOT"
        value = "1"
      }
      env {
        name        = "DATABASE_URL"
        secret_name = "database-url"
      }
      env {
        name        = "BLOB_CONNECTION_STRING"
        secret_name = "blob-connection-string"
      }
      env {
        name  = "BLOB_CONTAINER"
        value = azurerm_storage_container.media.name
      }
      env {
        name  = "SCRAPER_API_VENDOR"
        value = var.scraper_api_vendor
      }
      env {
        name        = "SCRAPER_API_USERNAME"
        secret_name = "scraper-api-username"
      }
      env {
        name        = "SCRAPER_API_PASSWORD"
        secret_name = "scraper-api-password"
      }
      env {
        name        = "STRIPE_SECRET_KEY"
        secret_name = "stripe-secret-key"
      }
      env {
        name        = "STRIPE_WEBHOOK_SECRET"
        secret_name = "stripe-webhook-secret"
      }
      env {
        name        = "STRIPE_PRICE_HOBBY"
        secret_name = "stripe-price-hobby"
      }
      env {
        name        = "STRIPE_PRICE_STANDARD"
        secret_name = "stripe-price-standard"
      }
      env {
        name        = "STRIPE_PRICE_GROWTH"
        secret_name = "stripe-price-growth"
      }

      # eBay OAuth.
      env {
        name        = "EBAY_CLIENT_ID"
        secret_name = "ebay-client-id"
      }
      env {
        name        = "EBAY_CLIENT_SECRET"
        secret_name = "ebay-client-secret"
      }
      env {
        name        = "EBAY_RU_NAME"
        secret_name = "ebay-ru-name"
      }
      env {
        name  = "EBAY_BASE_URL"
        value = var.ebay_base_url
      }
      env {
        name  = "EBAY_AUTH_URL"
        value = var.ebay_auth_url
      }
      env {
        name  = "EBAY_SCOPES"
        value = var.ebay_scopes
      }
      env {
        name  = "EBAY_ORDER_APPROVED"
        value = var.ebay_order_api_approved ? "1" : "0"
      }
      env {
        name  = "EBAY_INSIGHTS_APPROVED"
        value = var.ebay_insights_approved ? "1" : "0"
      }
      env {
        name  = "EBAY_CATALOG_APPROVED"
        value = var.ebay_catalog_approved ? "1" : "0"
      }
      env {
        name  = "OBSERVATION_ENABLED"
        value = var.observation_enabled ? "1" : "0"
      }
      env {
        name  = "ADMIN_EMAILS"
        value = var.admin_emails
      }

      # AES-256-GCM key for encrypting issued API key plaintext at rest.
      # Generated once with `openssl rand -base64 32` and stored in Key
      # Vault. Required in production — without it, the dashboard's
      # "reveal key" feature returns 503 (sha256 hash auth still works).
      env {
        name        = "KEYS_ENCRYPTION_KEY"
        secret_name = "keys-encryption-key"
      }
      # AES-256-GCM key for the secrets envelope — wraps eBay OAuth
      # refresh tokens + webhook HMAC secrets at rest. Required in
      # production; the api throws on boot without it.
      env {
        name        = "SECRETS_ENCRYPTION_KEY"
        secret_name = "secrets-encryption-key"
      }

      # Better-Auth + GitHub/Google OAuth.
      env {
        name        = "BETTER_AUTH_SECRET"
        secret_name = "better-auth-secret"
      }
      env {
        name  = "APP_URL"
        value = var.app_url
      }
      env {
        name  = "BETTER_AUTH_URL"
        value = var.better_auth_url
      }
      env {
        name        = "GITHUB_CLIENT_ID"
        secret_name = "github-client-id"
      }
      env {
        name        = "GITHUB_CLIENT_SECRET"
        secret_name = "github-client-secret"
      }
      env {
        name        = "GOOGLE_CLIENT_ID"
        secret_name = "google-client-id"
      }
      env {
        name        = "GOOGLE_CLIENT_SECRET"
        secret_name = "google-client-secret"
      }

      # Email (Resend).
      env {
        name        = "RESEND_API_KEY"
        secret_name = "resend-api-key"
      }
      env {
        name  = "EMAIL_FROM"
        value = var.email_from
      }

      # LLM provider for the /v1/evaluate matcher. Each secret-backed env
      # mirrors its `dynamic secret` above — only emitted when the
      # corresponding key is set.
      env {
        name  = "LLM_PROVIDER"
        value = var.llm_provider
      }
      dynamic "env" {
        for_each = var.anthropic_api_key == "" ? [] : [1]
        content {
          name        = "ANTHROPIC_API_KEY"
          secret_name = "anthropic-api-key"
        }
      }
      env {
        name  = "ANTHROPIC_MODEL"
        value = var.anthropic_model
      }
      dynamic "env" {
        for_each = var.openai_api_key == "" ? [] : [1]
        content {
          name        = "OPENAI_API_KEY"
          secret_name = "openai-api-key"
        }
      }
      env {
        name  = "OPENAI_MODEL"
        value = var.openai_model
      }
      dynamic "env" {
        for_each = var.google_api_key == "" ? [] : [1]
        content {
          name        = "GOOGLE_API_KEY"
          secret_name = "google-api-key"
        }
      }
      env {
        name  = "GOOGLE_MODEL"
        value = var.google_model
      }
      env {
        name  = "LLM_MAX_CONCURRENT"
        value = tostring(var.llm_max_concurrent)
      }

      # Agent surface (`/v1/agent/chat`) — runs OpenAI's Responses API
      # statefully. Reuses `OPENAI_API_KEY` (set above for the matcher);
      # only the model is split out so we can pick a smarter model for
      # the agent than the matcher uses. Defaults in code; threaded
      # through here so prod model swaps don't need a code change.
      env {
        name  = "AGENT_OPENAI_MODEL"
        value = var.agent_openai_model
      }
      # Public URL where this api's `/mcp` endpoint is reachable from
      # OpenAI's infrastructure (Responses API native MCP integration).
      # When unset the agent still chats but can't call tools — so set
      # this to `${better_auth_url}/mcp` (or the equivalent CDN-fronted
      # URL) in prod.
      env {
        name  = "MCP_PUBLIC_URL"
        value = var.mcp_public_url
      }

      # eBay Trading Platform Notifications + per-route source toggles.
      dynamic "env" {
        for_each = var.ebay_dev_id == "" ? [] : [1]
        content {
          name        = "EBAY_DEV_ID"
          secret_name = "ebay-dev-id"
        }
      }
      env {
        name  = "EBAY_NOTIFY_URL"
        value = var.ebay_notify_url
      }
      env {
        name  = "EBAY_LISTINGS_SOURCE"
        value = var.ebay_listings_source
      }
      env {
        name  = "EBAY_DETAIL_SOURCE"
        value = var.ebay_detail_source
      }
      env {
        name  = "EBAY_SOLD_SOURCE"
        value = var.ebay_sold_source
      }
    }

    http_scale_rule {
      name                = "http-scale"
      concurrent_requests = 50
    }
  }

  ingress {
    external_enabled = true
    target_port      = 4000
    transport        = "auto"

    traffic_weight {
      percentage      = 100
      latest_revision = true
    }
  }

  lifecycle {
    # CI updates the image on every push; don't fight it from TF after the
    # first apply. Re-apply with -replace if you need to reset the spec.
    ignore_changes = [
      template[0].container[0].image,
    ]
  }
}

# --- Worker container app -----------------------------------------------------
#
# Runs `compute_jobs` (evaluate, discover) so CPU-bound pipelines never starve
# the API event loop. Same image as the api; entrypoint is `node dist/worker.js`
# instead of `dist/server.js`. KEDA's Postgres scaler reads queue depth
# (`compute_jobs WHERE status='queued' OR expired-lease`) and scales the
# replica count 0..N. With min_replicas=0 an idle deploy costs nothing — the
# first enqueue triggers a cold start (~10s) which is invisible against
# multi-minute pipelines.
#
# Migrations are owned by the api (MIGRATE_ON_BOOT=1 there); the worker
# explicitly skips that to avoid two migrators racing on a shared DB.

resource "azurerm_container_app" "worker" {
  name                         = "${local.prefix}-worker"
  container_app_environment_id = azurerm_container_app_environment.env.id
  resource_group_name          = azurerm_resource_group.rg.name
  revision_mode                = "Single"
  tags                         = local.tags

  identity {
    type         = "UserAssigned"
    identity_ids = [azurerm_user_assigned_identity.api.id]
  }

  registry {
    server   = azurerm_container_registry.acr.login_server
    identity = azurerm_user_assigned_identity.api.id
  }

  depends_on = [azurerm_role_assignment.api_acr_pull]

  secret {
    name  = "database-url"
    value = local.database_url
  }
  secret {
    name  = "scraper-api-username"
    value = var.scraper_api_username
  }
  secret {
    name  = "scraper-api-password"
    value = var.scraper_api_password
  }
  # eBay OAuth — needed for token refresh during pipeline runs that hit
  # user-scoped REST endpoints. Empty values are fine for app-only flows.
  secret {
    name  = "ebay-client-id"
    value = var.ebay_client_id
  }
  secret {
    name  = "ebay-client-secret"
    value = var.ebay_client_secret
  }
  # Secrets envelope — same key as the api so any worker code path
  # that reads encrypted columns (eBay user-OAuth refresh during
  # pipeline runs, future cleanup jobs) can decrypt.
  secret {
    name  = "secrets-encryption-key"
    value = var.secrets_encryption_key
  }
  # Resend — the maintenance sweeper's takedown SLA enforcer emails
  # legal@ via sendOpsEmail. Without the key the sweeper still emits
  # warn-logs but doesn't escalate; for production we want the email.
  secret {
    name  = "resend-api-key"
    value = var.resend_api_key
  }

  dynamic "secret" {
    for_each = var.anthropic_api_key == "" ? [] : [1]
    content {
      name  = "anthropic-api-key"
      value = var.anthropic_api_key
    }
  }
  dynamic "secret" {
    for_each = var.openai_api_key == "" ? [] : [1]
    content {
      name  = "openai-api-key"
      value = var.openai_api_key
    }
  }
  dynamic "secret" {
    for_each = var.google_api_key == "" ? [] : [1]
    content {
      name  = "google-api-key"
      value = var.google_api_key
    }
  }

  template {
    min_replicas = var.worker_min_replicas
    max_replicas = var.worker_max_replicas

    container {
      name   = "worker"
      image  = var.api_image
      cpu    = var.worker_cpu
      memory = var.worker_memory
      # Dockerfile WORKDIR is /app; the api workspace builds to
      # packages/api/dist/. Match the api container's CMD path so the
      # worker entrypoint resolves correctly.
      command = ["node", "packages/api/dist/worker.js"]

      env {
        name  = "NODE_ENV"
        value = "production"
      }
      env {
        name        = "DATABASE_URL"
        secret_name = "database-url"
      }
      # Worker never migrates — api owns that step. Two migrators on one DB is
      # a footgun; declare the off state explicitly so a misread later doesn't
      # introduce one.
      env {
        name  = "MIGRATE_ON_BOOT"
        value = "0"
      }
      env {
        name  = "SCRAPER_API_VENDOR"
        value = var.scraper_api_vendor
      }
      env {
        name        = "SCRAPER_API_USERNAME"
        secret_name = "scraper-api-username"
      }
      env {
        name        = "SCRAPER_API_PASSWORD"
        secret_name = "scraper-api-password"
      }
      env {
        name        = "EBAY_CLIENT_ID"
        secret_name = "ebay-client-id"
      }
      env {
        name        = "EBAY_CLIENT_SECRET"
        secret_name = "ebay-client-secret"
      }
      env {
        name        = "SECRETS_ENCRYPTION_KEY"
        secret_name = "secrets-encryption-key"
      }
      # Maintenance sweeper email path: Resend creds + sender + the
      # APP_URL the SLA breach email links back to for triage.
      env {
        name        = "RESEND_API_KEY"
        secret_name = "resend-api-key"
      }
      env {
        name  = "EMAIL_FROM"
        value = var.email_from
      }
      env {
        name  = "APP_URL"
        value = var.app_url
      }
      env {
        name  = "EBAY_BASE_URL"
        value = var.ebay_base_url
      }
      env {
        name  = "EBAY_AUTH_URL"
        value = var.ebay_auth_url
      }
      env {
        name  = "EBAY_SCOPES"
        value = var.ebay_scopes
      }
      env {
        name  = "EBAY_LISTINGS_SOURCE"
        value = var.ebay_listings_source
      }
      env {
        name  = "EBAY_DETAIL_SOURCE"
        value = var.ebay_detail_source
      }
      env {
        name  = "EBAY_SOLD_SOURCE"
        value = var.ebay_sold_source
      }
      env {
        name  = "EBAY_INSIGHTS_APPROVED"
        value = var.ebay_insights_approved ? "1" : "0"
      }
      env {
        name  = "EBAY_CATALOG_APPROVED"
        value = var.ebay_catalog_approved ? "1" : "0"
      }
      env {
        name  = "OBSERVATION_ENABLED"
        value = var.observation_enabled ? "1" : "0"
      }
      # LLM provider — pipelines call the matcher, which requires one configured.
      env {
        name  = "LLM_PROVIDER"
        value = var.llm_provider
      }
      dynamic "env" {
        for_each = var.anthropic_api_key == "" ? [] : [1]
        content {
          name        = "ANTHROPIC_API_KEY"
          secret_name = "anthropic-api-key"
        }
      }
      env {
        name  = "ANTHROPIC_MODEL"
        value = var.anthropic_model
      }
      dynamic "env" {
        for_each = var.openai_api_key == "" ? [] : [1]
        content {
          name        = "OPENAI_API_KEY"
          secret_name = "openai-api-key"
        }
      }
      env {
        name  = "OPENAI_MODEL"
        value = var.openai_model
      }
      dynamic "env" {
        for_each = var.google_api_key == "" ? [] : [1]
        content {
          name        = "GOOGLE_API_KEY"
          secret_name = "google-api-key"
        }
      }
      env {
        name  = "GOOGLE_MODEL"
        value = var.google_model
      }
      env {
        name  = "LLM_MAX_CONCURRENT"
        value = tostring(var.llm_max_concurrent)
      }
    }

    # KEDA Postgres scaler — count rows the worker either has or could pick
    # up. Earlier this excluded `running` rows with a valid lease, on the
    # theory that a healthy in-flight job needed no extra replica. That
    # opened a fatal scale-down race: when the queue drained, KEDA started
    # its 5min cooldown timer, then sent SIGTERM mid-pipeline; the worker's
    # 30s shutdown grace was shorter than the filter step (~50s typical)
    # so the job got orphaned and the user waited 5+min for lease recovery
    # to spin a new replica. Counting active running jobs too keeps the
    # current replica alive while it's busy. With `min_replicas=0` we
    # still scale to 0 once everything is terminal.
    custom_scale_rule {
      name             = "compute-jobs-depth"
      custom_rule_type = "postgresql"
      metadata = {
        query                      = "SELECT count(*)::int FROM compute_jobs WHERE cancel_requested = false AND status IN ('queued', 'running')"
        targetQueryValue           = tostring(var.worker_keda_target)
        activationTargetQueryValue = "0"
      }
      authentication {
        secret_name       = "database-url"
        trigger_parameter = "connection"
      }
    }
  }

  # No ingress — worker is internal-only.

  lifecycle {
    ignore_changes = [
      template[0].container[0].image,
    ]
  }
}

# --- Custom domain (optional) -------------------------------------------------

resource "azurerm_container_app_custom_domain" "api_domain" {
  count                    = var.custom_domain == "" ? 0 : 1
  name                     = var.custom_domain
  container_app_id         = azurerm_container_app.api.id
  certificate_binding_type = "SniEnabled"

  # Container Apps will provision a free managed cert once the
  # asuid TXT + CNAME records exist on your DNS.
  lifecycle {
    ignore_changes = [
      container_app_environment_certificate_id,
      certificate_binding_type,
    ]
  }
}
