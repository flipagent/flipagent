import { Type } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import { config as loadEnv } from "dotenv";

loadEnv();

const Schema = Type.Object({
	DATABASE_URL: Type.String({ minLength: 1 }),
	PORT: Type.Number({ default: 4000 }),
	NODE_ENV: Type.Union([Type.Literal("development"), Type.Literal("production"), Type.Literal("test")], {
		default: "development",
	}),
	// eBay OAuth — all optional. When CLIENT_ID is unset, /v1/connect/ebay
	// and every OAuth-passthrough endpoint return 503 not_configured.
	EBAY_CLIENT_ID: Type.Optional(Type.String()),
	EBAY_CLIENT_SECRET: Type.Optional(Type.String()),
	EBAY_RU_NAME: Type.Optional(Type.String()),
	// Developer ID — used to verify Trading API Platform Notifications.
	// Found at developer.ebay.com → Application Keys (next to AppID/CertID).
	// When unset, /v1/notifications/ebay/* return 503 not_configured.
	EBAY_DEV_ID: Type.Optional(Type.String()),
	// Public URL eBay POSTs platform notifications to (Trading API). Must be
	// HTTPS-reachable from eBay servers. In dev: a tunnel
	// (https://dev.flipagent.dev/v1/notifications/ebay/inbound). In prod:
	// the api's own external URL with /v1/notifications/ebay/inbound.
	EBAY_NOTIFY_URL: Type.Optional(Type.String()),
	// Per-route data-source dispatch. Caller-explicit, no fallback chain —
	// the API picks exactly one primitive per request and surfaces it via
	// X-Flipagent-Source. Set per route to manage Browse REST quota
	// (5000/day default) vs Oxylabs scrape ($/req) vs bridge (free, uses
	// the user's extension). Required when the route is hit; unset → 503.
	EBAY_LISTINGS_SOURCE: Type.Optional(
		Type.Union([Type.Literal("rest"), Type.Literal("scrape"), Type.Literal("bridge")]),
	),
	EBAY_DETAIL_SOURCE: Type.Optional(
		Type.Union([Type.Literal("rest"), Type.Literal("scrape"), Type.Literal("bridge")]),
	),
	EBAY_SOLD_SOURCE: Type.Optional(Type.Union([Type.Literal("rest"), Type.Literal("scrape"), Type.Literal("bridge")])),
	EBAY_BASE_URL: Type.String({ default: "https://api.ebay.com" }),
	EBAY_AUTH_URL: Type.String({ default: "https://auth.ebay.com" }),
	EBAY_SCOPES: Type.String({
		default: [
			"https://api.ebay.com/oauth/api_scope",
			"https://api.ebay.com/oauth/api_scope/sell.inventory",
			"https://api.ebay.com/oauth/api_scope/sell.fulfillment",
			"https://api.ebay.com/oauth/api_scope/sell.finances",
			"https://api.ebay.com/oauth/api_scope/sell.account",
			"https://api.ebay.com/oauth/api_scope/commerce.identity.readonly",
			"https://api.ebay.com/oauth/api_scope/commerce.message",
			"https://api.ebay.com/oauth/api_scope/commerce.feedback",
			"https://api.ebay.com/oauth/api_scope/sell.marketing",
			"https://api.ebay.com/oauth/api_scope/sell.marketing.readonly",
			// `sell.stores.readonly` deliberately omitted — verified live
			// 2026-05-02 that eBay silently drops it from consent for
			// non-approved apps (every /sell/stores/v1/* path 403s
			// "Insufficient permissions" even though the seller has an
			// active eBay Store). Re-add only after our app gets
			// stores-API app-level approval through the developer portal.
		].join(" "),
	}),
	// Buy Order API is Limited Release. Set to `1` only after eBay approves
	// flipagent's tenant — `/v1/purchases` then uses REST transport
	// (synchronous BIN). Without it the orchestrator routes to the bridge
	// transport (Chrome extension), and multi-stage updates 412.
	EBAY_ORDER_API_APPROVED: Type.Boolean({ default: false }),
	// Marketplace Insights program approval (sold-listing history). With
	// this flag, `/v1/items/search?status=sold` hits Marketplace Insights
	// REST; without it the route falls back to scraping.
	EBAY_INSIGHTS_APPROVED: Type.Boolean({ default: false }),
	// Commerce Catalog API program approval (canonical product master by
	// EPID). With this flag, `/v1/products/{epid}` hits Catalog REST;
	// without it (the default — eBay denies most apps) it falls back to
	// scraping `/p/{epid}` + a representative listing and emits the same
	// `Product` shape.
	EBAY_CATALOG_APPROVED: Type.Boolean({ default: false }),
	// Better-Auth + GitHub OAuth. All three required to enable session auth
	// (the /api/auth/* handler + /v1/me/* routes return 503 if not set).
	//   APP_URL          dashboard origin (the docs site) — used for
	//                    trusted-origin/CORS + success_url after upgrade
	//   BETTER_AUTH_URL  this api's own external URL — what GitHub redirects
	//                    to after auth ({BETTER_AUTH_URL}/api/auth/callback/github)
	BETTER_AUTH_SECRET: Type.Optional(Type.String()),
	// 32-byte symmetric key (base64) used to encrypt issued API key plaintext
	// at rest. With this set, the dashboard's "reveal" button decrypts and
	// shows the full key on demand. Without it, the column stays null on
	// new keys and reveal returns 503 — sha256 hash auth still works fine.
	// Generate: `openssl rand -base64 32`. NODE_ENV=production → required;
	// dev/test → falls back to a key derived from BETTER_AUTH_SECRET so
	// local setups don't trip on startup.
	KEYS_ENCRYPTION_KEY: Type.Optional(Type.String()),
	// AES-256 envelope key for OAuth tokens (eBay, GitHub, Google) and
	// webhook HMAC secrets at rest. Base64; required in production. Same
	// dev/test fallback shape as KEYS_ENCRYPTION_KEY — derives from
	// BETTER_AUTH_SECRET so local boots don't trip. Kept separate from
	// KEYS_ENCRYPTION_KEY so the API-key blast radius stays smaller.
	SECRETS_ENCRYPTION_KEY: Type.Optional(Type.String()),
	APP_URL: Type.String({ default: "http://localhost:4321" }),
	BETTER_AUTH_URL: Type.String({ default: "http://localhost:4000" }),
	GITHUB_CLIENT_ID: Type.Optional(Type.String()),
	GITHUB_CLIENT_SECRET: Type.Optional(Type.String()),
	// Google OAuth — optional. When present, `Continue with Google` lights up.
	// Authorized redirect URI: `${BETTER_AUTH_URL}/api/auth/callback/google`.
	GOOGLE_CLIENT_ID: Type.Optional(Type.String()),
	GOOGLE_CLIENT_SECRET: Type.Optional(Type.String()),
	// Email sender (Resend). Required for password reset + email verification.
	// When unset, "Forgot your password?" surfaces a not-configured message.
	RESEND_API_KEY: Type.Optional(Type.String()),
	EMAIL_FROM: Type.String({ default: "flipagent <noreply@flipagent.dev>" }),
	// Managed-scraping vendor for `EBAY_*_SOURCE=scrape`. We POST a URL,
	// the vendor returns rendered HTML — whatever rendering / IP routing
	// they perform on their side is their product, under their own
	// upstream-marketplace ToS. flipagent's own code is just an HTTPS
	// client; it does not implement residential-proxy rotation, UA
	// shuffling, or any other vendor-side concern.
	//
	// Today only `oxylabs` is wired. Adding a vendor = drop an adapter
	// at `services/ebay/scrape/scraper-api/<vendor>.ts` and a case in the dispatcher.
	SCRAPER_API_VENDOR: Type.Union([Type.Literal("oxylabs")], { default: "oxylabs" }),
	SCRAPER_API_USERNAME: Type.Optional(Type.String()),
	SCRAPER_API_PASSWORD: Type.Optional(Type.String()),
	// Stripe billing — all five required to enable /v1/billing/*. When any
	// are missing, those routes return 503 billing_not_configured.
	// HOBBY → $19, STANDARD → $99, GROWTH → $399.
	STRIPE_SECRET_KEY: Type.Optional(Type.String()),
	STRIPE_WEBHOOK_SECRET: Type.Optional(Type.String()),
	STRIPE_PRICE_HOBBY: Type.Optional(Type.String()),
	STRIPE_PRICE_STANDARD: Type.Optional(Type.String()),
	STRIPE_PRICE_GROWTH: Type.Optional(Type.String()),
	// LLM provider — gates same-product matcher used by /v1/evaluate.
	// Pick one explicitly via `LLM_PROVIDER`, otherwise the first key
	// set wins (anthropic → openai → google). Without any key the
	// matcher returns a graceful fallback (raw search results, no
	// curation) so endpoints stay up.
	LLM_PROVIDER: Type.Optional(Type.Union([Type.Literal("anthropic"), Type.Literal("openai"), Type.Literal("google")])),
	ANTHROPIC_API_KEY: Type.Optional(Type.String()),
	ANTHROPIC_MODEL: Type.Optional(Type.String()),
	OPENAI_API_KEY: Type.Optional(Type.String()),
	OPENAI_MODEL: Type.Optional(Type.String()),
	GOOGLE_API_KEY: Type.Optional(Type.String()),
	GOOGLE_MODEL: Type.Optional(Type.String()),
	// Per-process LLM concurrency cap. Each provider tier has its own
	// rate-limit window (Anthropic tier-1: 4 concurrent; tier-4: 50+).
	// matchPool fans out N×K verify chunks per evaluate call — without a
	// cap they all hit the provider at once and queue at the provider
	// side, where stuck requests pin downstream steps. Set this to your
	// provider tier's safe concurrency. Default 8 (covers most paid
	// tiers without provoking rate-limit errors).
	LLM_MAX_CONCURRENT: Type.Optional(Type.Integer({ minimum: 1, maximum: 64 })),
	// Per-listing observation archive — hosted-only feature. Each search
	// / detail response writes one row to `listing_observations` for
	// long-tail historical sold-listing depth, matcher fingerprinting, and
	// cross-user seller reputation. Default off (self-host gets only the
	// short-TTL proxy cache); set `OBSERVATION_ENABLED=1` on the hosted
	// instance to start accumulating. ToS-safe: itemWebUrl + image CDN
	// URL only (no binary mirroring), takedown channel honoured.
	OBSERVATION_ENABLED: Type.Boolean({ default: false }),
	// Comma-separated list of email addresses that auto-promote to
	// `role=admin` on sign-up + on every session resolution. The
	// `/v1/admin/*` surface and the `/admin` dashboard page are gated by
	// `requireAdmin` (= requireSession + role==='admin'). Empty list =
	// no admins (closed by default; safe for self-host).
	ADMIN_EMAILS: Type.String({ default: "" }),
});

const raw = {
	DATABASE_URL: process.env.DATABASE_URL,
	PORT: process.env.PORT ? Number(process.env.PORT) : 4000,
	NODE_ENV: process.env.NODE_ENV ?? "development",
	EBAY_CLIENT_ID: process.env.EBAY_CLIENT_ID,
	EBAY_CLIENT_SECRET: process.env.EBAY_CLIENT_SECRET,
	EBAY_RU_NAME: process.env.EBAY_RU_NAME,
	EBAY_DEV_ID: process.env.EBAY_DEV_ID,
	EBAY_NOTIFY_URL: process.env.EBAY_NOTIFY_URL,
	EBAY_LISTINGS_SOURCE: process.env.EBAY_LISTINGS_SOURCE,
	EBAY_DETAIL_SOURCE: process.env.EBAY_DETAIL_SOURCE,
	EBAY_SOLD_SOURCE: process.env.EBAY_SOLD_SOURCE,
	EBAY_BASE_URL: process.env.EBAY_BASE_URL ?? "https://api.ebay.com",
	EBAY_AUTH_URL: process.env.EBAY_AUTH_URL ?? "https://auth.ebay.com",
	EBAY_SCOPES: process.env.EBAY_SCOPES,
	EBAY_ORDER_API_APPROVED: process.env.EBAY_ORDER_API_APPROVED === "1",
	EBAY_INSIGHTS_APPROVED: process.env.EBAY_INSIGHTS_APPROVED === "1",
	EBAY_CATALOG_APPROVED: process.env.EBAY_CATALOG_APPROVED === "1",
	BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET,
	KEYS_ENCRYPTION_KEY: process.env.KEYS_ENCRYPTION_KEY,
	SECRETS_ENCRYPTION_KEY: process.env.SECRETS_ENCRYPTION_KEY,
	APP_URL: process.env.APP_URL ?? "http://localhost:4321",
	BETTER_AUTH_URL: process.env.BETTER_AUTH_URL ?? `http://localhost:${process.env.PORT ?? 4000}`,
	GITHUB_CLIENT_ID: process.env.GITHUB_CLIENT_ID,
	GITHUB_CLIENT_SECRET: process.env.GITHUB_CLIENT_SECRET,
	GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID,
	GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET,
	RESEND_API_KEY: process.env.RESEND_API_KEY,
	EMAIL_FROM: process.env.EMAIL_FROM ?? "flipagent <noreply@flipagent.dev>",
	SCRAPER_API_VENDOR: process.env.SCRAPER_API_VENDOR ?? "oxylabs",
	SCRAPER_API_USERNAME: process.env.SCRAPER_API_USERNAME,
	SCRAPER_API_PASSWORD: process.env.SCRAPER_API_PASSWORD,
	STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY,
	STRIPE_WEBHOOK_SECRET: process.env.STRIPE_WEBHOOK_SECRET,
	STRIPE_PRICE_HOBBY: process.env.STRIPE_PRICE_HOBBY,
	STRIPE_PRICE_STANDARD: process.env.STRIPE_PRICE_STANDARD,
	STRIPE_PRICE_GROWTH: process.env.STRIPE_PRICE_GROWTH,
	LLM_PROVIDER: process.env.LLM_PROVIDER,
	ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
	ANTHROPIC_MODEL: process.env.ANTHROPIC_MODEL,
	OPENAI_API_KEY: process.env.OPENAI_API_KEY,
	OPENAI_MODEL: process.env.OPENAI_MODEL,
	GOOGLE_API_KEY: process.env.GOOGLE_API_KEY,
	GOOGLE_MODEL: process.env.GOOGLE_MODEL,
	LLM_MAX_CONCURRENT: process.env.LLM_MAX_CONCURRENT ? Number.parseInt(process.env.LLM_MAX_CONCURRENT, 10) : undefined,
	OBSERVATION_ENABLED: process.env.OBSERVATION_ENABLED === "1",
	ADMIN_EMAILS: process.env.ADMIN_EMAILS ?? "",
};

const decoded = Value.Default(Schema, raw);
const errors = [...Value.Errors(Schema, decoded)];
if (errors.length > 0) {
	const detail = errors.map((e) => `${e.path}: ${e.message}`).join("; ");
	throw new Error(`Invalid environment: ${detail}`);
}

export const config = decoded as {
	DATABASE_URL: string;
	PORT: number;
	NODE_ENV: "development" | "production" | "test";
	EBAY_CLIENT_ID?: string;
	EBAY_CLIENT_SECRET?: string;
	EBAY_RU_NAME?: string;
	EBAY_DEV_ID?: string;
	EBAY_NOTIFY_URL?: string;
	EBAY_LISTINGS_SOURCE?: "rest" | "scrape" | "bridge";
	EBAY_DETAIL_SOURCE?: "rest" | "scrape" | "bridge";
	EBAY_SOLD_SOURCE?: "rest" | "scrape" | "bridge";
	EBAY_BASE_URL: string;
	EBAY_AUTH_URL: string;
	EBAY_SCOPES: string;
	EBAY_ORDER_API_APPROVED: boolean;
	EBAY_INSIGHTS_APPROVED: boolean;
	EBAY_CATALOG_APPROVED: boolean;
	BETTER_AUTH_SECRET?: string;
	KEYS_ENCRYPTION_KEY?: string;
	SECRETS_ENCRYPTION_KEY?: string;
	APP_URL: string;
	BETTER_AUTH_URL: string;
	GITHUB_CLIENT_ID?: string;
	GITHUB_CLIENT_SECRET?: string;
	GOOGLE_CLIENT_ID?: string;
	GOOGLE_CLIENT_SECRET?: string;
	RESEND_API_KEY?: string;
	EMAIL_FROM: string;
	SCRAPER_API_VENDOR: "oxylabs";
	SCRAPER_API_USERNAME?: string;
	SCRAPER_API_PASSWORD?: string;
	STRIPE_SECRET_KEY?: string;
	STRIPE_WEBHOOK_SECRET?: string;
	STRIPE_PRICE_HOBBY?: string;
	STRIPE_PRICE_STANDARD?: string;
	STRIPE_PRICE_GROWTH?: string;
	LLM_PROVIDER?: "anthropic" | "openai" | "google";
	ANTHROPIC_API_KEY?: string;
	ANTHROPIC_MODEL?: string;
	OPENAI_API_KEY?: string;
	OPENAI_MODEL?: string;
	GOOGLE_API_KEY?: string;
	GOOGLE_MODEL?: string;
	LLM_MAX_CONCURRENT?: number;
	OBSERVATION_ENABLED: boolean;
	ADMIN_EMAILS: string;
};

/**
 * True when `email` (case-insensitive) appears in the comma-separated
 * `ADMIN_EMAILS` list. Whitespace tolerated. Used by Better-Auth's user
 * create hook to auto-promote on sign-up and by `requireSession` to
 * reconcile demotions/promotions on every request.
 */
export function isAdminEmail(email: string | null | undefined): boolean {
	if (!email) return false;
	const target = email.trim().toLowerCase();
	if (!target) return false;
	return config.ADMIN_EMAILS.split(",")
		.map((s) => s.trim().toLowerCase())
		.filter(Boolean)
		.includes(target);
}

/** True when all OAuth-required env is present. Use to gate connect routes. */
export function isEbayOAuthConfigured(): boolean {
	return Boolean(config.EBAY_CLIENT_ID && config.EBAY_CLIENT_SECRET && config.EBAY_RU_NAME);
}

/**
 * True when this flipagent instance has eBay app credentials
 * (`EBAY_CLIENT_ID` + `EBAY_CLIENT_SECRET`). RU_NAME is OAuth-callback
 * specific so it isn't required for app-only Browse/Insights/Taxonomy
 * REST calls. Used by `selectTransport` to gate `needsAuth: "app"`
 * REST paths — when false, listings.* auto-picks scrape; markets.* (no
 * scrape capability) throws TransportUnavailableError.
 */
export function isEbayAppConfigured(): boolean {
	return Boolean(config.EBAY_CLIENT_ID && config.EBAY_CLIENT_SECRET);
}

/**
 * True when Trading-API platform-notification env is fully set:
 * AppID + CertID + DevID (signature verify) + a public callback URL.
 * Gates /v1/notifications/ebay/*.
 */
export function isEbayNotificationsConfigured(): boolean {
	return Boolean(config.EBAY_CLIENT_ID && config.EBAY_CLIENT_SECRET && config.EBAY_DEV_ID && config.EBAY_NOTIFY_URL);
}

/** True when Better-Auth + GitHub OAuth are fully configured. */
export function isAuthConfigured(): boolean {
	return Boolean(config.BETTER_AUTH_SECRET && config.GITHUB_CLIENT_ID && config.GITHUB_CLIENT_SECRET);
}

/** True when Resend is set up — gates password-reset + verification emails. */
export function isEmailConfigured(): boolean {
	return Boolean(config.RESEND_API_KEY);
}

/** True when managed-scraping vendor creds are set — required for `EBAY_*_SOURCE=scrape`. */
export function isScraperApiConfigured(): boolean {
	return Boolean(config.SCRAPER_API_USERNAME && config.SCRAPER_API_PASSWORD);
}

/** True when eBay has approved this tenant for Marketplace Insights REST access. */
export function isInsightsApproved(): boolean {
	return config.EBAY_INSIGHTS_APPROVED;
}

/** True when all five Stripe env vars are present. */
export function isStripeConfigured(): boolean {
	return Boolean(
		config.STRIPE_SECRET_KEY &&
			config.STRIPE_WEBHOOK_SECRET &&
			config.STRIPE_PRICE_HOBBY &&
			config.STRIPE_PRICE_STANDARD &&
			config.STRIPE_PRICE_GROWTH,
	);
}

/** True when at least one LLM provider key is set. Gates the same-product matcher. */
export function isLlmConfigured(): boolean {
	return Boolean(config.ANTHROPIC_API_KEY || config.OPENAI_API_KEY || config.GOOGLE_API_KEY);
}
