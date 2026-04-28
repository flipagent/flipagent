variable "environment" {
  description = "Environment slug — lands in resource names. Use prod/staging/dev."
  type        = string
  default     = "prod"
  validation {
    condition     = can(regex("^[a-z0-9]{1,12}$", var.environment))
    error_message = "environment must be lowercase alphanumeric, ≤12 chars (folded into globally-unique resource names)."
  }
}

variable "location" {
  description = "Azure region. eastus2 keeps the api close to eBay US data centers and most Oxylabs US exits."
  type        = string
  default     = "eastus2"
}

variable "postgres_sku" {
  description = "Postgres Flexible Server SKU. B1ms is cheapest; B2s for production breathing room."
  type        = string
  default     = "B_Standard_B1ms"
}

variable "postgres_storage_mb" {
  description = "Postgres storage in MB. Min 32768."
  type        = number
  default     = 32768
}

variable "api_image" {
  description = "Container image for the api. First apply uses the placeholder; CI replaces it with flipagentprod.azurecr.io/api:<sha>."
  type        = string
  default     = "mcr.microsoft.com/azuredocs/containerapps-helloworld:latest"
}

variable "api_cpu" {
  type    = number
  default = 0.5
}

variable "api_memory" {
  description = "Container memory. Use Azure's canonical form (e.g. 1Gi, 0.5Gi) — '1.0Gi' is normalized to '1Gi' on the server and shows up as perpetual drift in plan."
  type        = string
  default     = "1Gi"
}

variable "api_min_replicas" {
  description = "Keep ≥1 to avoid cold-starting the first request. With >1, move db migrations into a separate Container App Job."
  type        = number
  default     = 1
}

variable "api_max_replicas" {
  type    = number
  default = 5
}

variable "custom_domain" {
  description = "Custom hostname for the api ingress. e.g. api.flipagent.dev. Empty disables custom domain wiring."
  type        = string
  default     = ""
}

# --- Application secrets, threaded into the Container App ----------------------

variable "scraper_api_vendor" {
  description = "Managed scraper vendor for eBay HTML fetches. Today only `oxylabs` is wired."
  type        = string
  default     = "oxylabs"
  validation {
    condition     = contains(["oxylabs"], var.scraper_api_vendor)
    error_message = "scraper_api_vendor must be one of: oxylabs."
  }
}

variable "scraper_api_username" {
  description = "Username for the managed scraper vendor (e.g. Oxylabs Web Scraper API)."
  type        = string
  default     = ""
  sensitive   = true
}

variable "scraper_api_password" {
  description = "Password for the managed scraper vendor."
  type        = string
  default     = ""
  sensitive   = true
}

variable "stripe_secret_key" {
  description = "Stripe sk_live_... or sk_test_..., or empty to disable /v1/billing/*."
  type        = string
  default     = ""
  sensitive   = true
}

variable "stripe_webhook_secret" {
  type      = string
  default   = ""
  sensitive = true
}

variable "stripe_price_hobby" {
  type    = string
  default = ""
}

variable "stripe_price_pro" {
  type    = string
  default = ""
}

# --- eBay OAuth — leave empty to ship with /sell/*, /commerce/*, /v1/connect/ebay --
# returning 503 not_configured.

variable "ebay_client_id" {
  description = "eBay App keyset client_id. Empty disables every OAuth-passthrough route."
  type        = string
  default     = ""
}

variable "ebay_client_secret" {
  type      = string
  default   = ""
  sensitive = true
}

variable "ebay_ru_name" {
  description = "eBay RuName (redirect identifier). NOT a URL — looks like 'MyApp-RuName'."
  type        = string
  default     = ""
}

variable "ebay_base_url" {
  description = "eBay REST host. Swap to api.sandbox.ebay.com for the sandbox environment."
  type        = string
  default     = "https://api.ebay.com"
}

variable "ebay_auth_url" {
  description = "eBay OAuth host. Pair with ebay_base_url's environment."
  type        = string
  default     = "https://auth.ebay.com"
}

variable "ebay_scopes" {
  description = "Space-separated OAuth scopes the connect handshake requests."
  type        = string
  default     = "https://api.ebay.com/oauth/api_scope https://api.ebay.com/oauth/api_scope/sell.inventory https://api.ebay.com/oauth/api_scope/sell.fulfillment https://api.ebay.com/oauth/api_scope/sell.finances https://api.ebay.com/oauth/api_scope/sell.account https://api.ebay.com/oauth/api_scope/commerce.identity.readonly"
}

variable "ebay_order_api_approved" {
  description = "Set true ONLY after eBay approves flipagent's tenant for the Buy Order API. Until then /buy/order/v1/* and /v1/* return 501."
  type        = bool
  default     = false
}

# --- Better-Auth + GitHub/Google OAuth — leave empty to ship with the dashboard --
# (sign-in, /v1/me/*, /api/auth/*) returning 503 not_configured.

variable "better_auth_secret" {
  description = "Secret for signing Better-Auth session cookies (openssl rand -base64 32)."
  type        = string
  default     = ""
  sensitive   = true
}

variable "app_url" {
  description = "Dashboard origin (the docs/marketing site). Used for trusted-origin + post-checkout success URL. e.g. https://flipagent.dev"
  type        = string
  default     = ""
}

variable "better_auth_url" {
  description = "External URL of this api — what GitHub/Google redirect to. Callback configured on the OAuth app(s) must be {better_auth_url}/api/auth/callback/{provider}."
  type        = string
  default     = ""
}

variable "github_client_id" {
  type    = string
  default = ""
}

variable "github_client_secret" {
  type      = string
  default   = ""
  sensitive = true
}

variable "google_client_id" {
  type    = string
  default = ""
}

variable "google_client_secret" {
  type      = string
  default   = ""
  sensitive = true
}

# --- Email (Resend) — required for password reset / future verification. --

variable "resend_api_key" {
  type      = string
  default   = ""
  sensitive = true
}

variable "email_from" {
  description = "From line on transactional email. Must match a verified Resend sender."
  type        = string
  default     = "flipagent <noreply@flipagent.dev>"
}
