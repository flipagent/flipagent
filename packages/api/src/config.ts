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
		].join(" "),
	}),
	// Order API is Limited Release. Set to `1` only after eBay approves
	// flipagent's tenant — otherwise /buy/order/v1/* returns 501.
	EBAY_ORDER_API_APPROVED: Type.Boolean({ default: false }),
	// Marketplace Insights program approval (sold-listing history). Set to
	// `1` only after eBay grants Insights access to the tenant. With this
	// flag, /v1/sold/* hits api.ebay.com/buy/marketplace_insights/v1_beta/...
	// using the app token; without it, /v1/sold/* falls back to scraping.
	EBAY_INSIGHTS_APPROVED: Type.Boolean({ default: false }),
	// Better-Auth + GitHub OAuth. All three required to enable session auth
	// (the /api/auth/* handler + /v1/me/* routes return 503 if not set).
	//   APP_URL          dashboard origin (the docs site) — used for
	//                    trusted-origin/CORS + success_url after upgrade
	//   BETTER_AUTH_URL  this api's own external URL — what GitHub redirects
	//                    to after auth ({BETTER_AUTH_URL}/api/auth/callback/github)
	BETTER_AUTH_SECRET: Type.Optional(Type.String()),
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
	// Managed-scraping vendor for `EBAY_*_SOURCE=scrape`. The vendor owns
	// the anti-bot dance; we just POST a URL and get rendered HTML.
	// flipagent does not ship its own residential-proxy + UA-rotation
	// path on purpose — detection evasion is ToS-grey and belongs at
	// vendors whose business is exactly that.
	//
	// Today only `oxylabs` is wired. Adding a vendor = drop an adapter
	// at `proxy/scraper-api/<vendor>.ts` and a case in the dispatcher.
	SCRAPER_API_VENDOR: Type.Union([Type.Literal("oxylabs")], { default: "oxylabs" }),
	SCRAPER_API_USERNAME: Type.Optional(Type.String()),
	SCRAPER_API_PASSWORD: Type.Optional(Type.String()),
	// Stripe billing — all four required to enable /v1/billing/*. When any
	// are missing, those routes return 503 billing_not_configured.
	STRIPE_SECRET_KEY: Type.Optional(Type.String()),
	STRIPE_WEBHOOK_SECRET: Type.Optional(Type.String()),
	STRIPE_PRICE_HOBBY: Type.Optional(Type.String()),
	STRIPE_PRICE_PRO: Type.Optional(Type.String()),
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
	BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET,
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
	STRIPE_PRICE_PRO: process.env.STRIPE_PRICE_PRO,
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
	BETTER_AUTH_SECRET?: string;
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
	STRIPE_PRICE_PRO?: string;
};

/** True when all OAuth-required env is present. Use to gate connect routes. */
export function isEbayOAuthConfigured(): boolean {
	return Boolean(config.EBAY_CLIENT_ID && config.EBAY_CLIENT_SECRET && config.EBAY_RU_NAME);
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

/** True when all four Stripe env vars are present. */
export function isStripeConfigured(): boolean {
	return Boolean(
		config.STRIPE_SECRET_KEY && config.STRIPE_WEBHOOK_SECRET && config.STRIPE_PRICE_HOBBY && config.STRIPE_PRICE_PRO,
	);
}
