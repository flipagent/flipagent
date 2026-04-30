/**
 * Schemas for flipagent-specific endpoints — anything under `/v1/*` that
 * isn't a mirror of an eBay path. Currently scoped to ToS-hygiene
 * endpoints, key issuance, billing, and shared error/health shapes.
 */

import { type Static, Type } from "@sinclair/typebox";

/* ----------------------------------- tier ---------------------------------- */

export const Tier = Type.Union(
	[Type.Literal("free"), Type.Literal("hobby"), Type.Literal("standard"), Type.Literal("growth")],
	{
		$id: "Tier",
	},
);
export type Tier = Static<typeof Tier>;

/**
 * Operator role. `admin` unlocks the `/v1/admin/*` surface and the
 * `/admin` dashboard page; everyone else is `user`. Bootstrap by adding
 * the email to `ADMIN_EMAILS` on the api host.
 */
export const Role = Type.Union([Type.Literal("user"), Type.Literal("admin")], { $id: "Role" });
export type Role = Static<typeof Role>;

/* ------------------------------- error codes ------------------------------- */

/**
 * Every `error` string the API can return. Keep in sync with route handlers
 * and the `errors.astro` docs page (which imports this list at build time).
 */
export const ErrorCode = Type.Union(
	[
		Type.Literal("validation_failed"),
		Type.Literal("invalid_key"),
		Type.Literal("unauthorized"),
		Type.Literal("unauthenticated"),
		Type.Literal("forbidden"),
		// "rate_limited" is the legacy alias kept for backward compat with
		// older self-host releases; the live API now emits "credits_exceeded"
		// (monthly budget) or "burst_rate_limited" (per-min/per-hour) instead.
		Type.Literal("rate_limited"),
		Type.Literal("credits_exceeded"),
		Type.Literal("burst_rate_limited"),
		Type.Literal("not_found"),
		Type.Literal("upstream_failed"),
		Type.Literal("billing_not_configured"),
		Type.Literal("checkout_failed"),
		Type.Literal("missing_signature"),
		Type.Literal("invalid_signature"),
		Type.Literal("handler_failed"),
		Type.Literal("internal_error"),
		Type.Literal("auth_not_configured"),
		Type.Literal("ebay_not_configured"),
		Type.Literal("not_connected"),
	],
	{ $id: "ErrorCode" },
);
export type ErrorCode = Static<typeof ErrorCode>;

export const ApiError = Type.Object(
	{
		error: ErrorCode,
		message: Type.Optional(Type.String()),
		details: Type.Optional(
			Type.Array(
				Type.Object({
					path: Type.String(),
					message: Type.String(),
				}),
			),
		),
	},
	{ $id: "ApiError" },
);
export type ApiError = Static<typeof ApiError>;

/* --------------------------------- /healthz -------------------------------- */

export const Health = Type.Object(
	{
		status: Type.Union([Type.Literal("ok"), Type.Literal("degraded")]),
		db: Type.Object({
			ok: Type.Boolean(),
			error: Type.Optional(Type.String()),
		}),
		proxy: Type.Union([Type.Literal("configured"), Type.Literal("missing")]),
		latencyMs: Type.Integer(),
		version: Type.String(),
		ts: Type.String({ format: "date-time" }),
	},
	{ $id: "Health" },
);
export type Health = Static<typeof Health>;

/* ----------------------------- /v1/health/features ----------------------------- */

/**
 * Feature flags driven by env presence — used by the dashboard to hide panels
 * for unconfigured features (self-host) and by the docs to render the right
 * onboarding step. Public, no auth required: knowing what's wired is fine.
 */
export const FeaturesResponse = Type.Object(
	{
		ebayOAuth: Type.Boolean({ description: "EBAY_CLIENT_ID/SECRET/RU_NAME all set." }),
		orderApi: Type.Boolean({ description: "EBAY_ORDER_API_APPROVED=1 (Limited Release tenant approval)." }),
		insightsApi: Type.Boolean({
			description: "EBAY_INSIGHTS_APPROVED=1 (Marketplace Insights program approval — REST sold history).",
		}),
		scraperApi: Type.Boolean({
			description:
				"SCRAPER_API_USERNAME/PASSWORD set — `EBAY_*_SOURCE=scrape` lights up (vendor: SCRAPER_API_VENDOR).",
		}),
		betterAuth: Type.Boolean({ description: "BETTER_AUTH_SECRET + GitHub OAuth — gates /v1/me/* and signup." }),
		googleOAuth: Type.Boolean({ description: "GOOGLE_CLIENT_ID/SECRET — `Continue with Google` lights up." }),
		email: Type.Boolean({ description: "RESEND_API_KEY — password reset + email verification." }),
		stripe: Type.Boolean({ description: "All four STRIPE_* vars — gates /v1/billing/*." }),
		llm: Type.Boolean({
			description:
				"At least one of ANTHROPIC_API_KEY / OPENAI_API_KEY / GOOGLE_API_KEY set — gates the same-product matcher used internally by /v1/evaluate and /v1/discover.",
		}),
	},
	{ $id: "FeaturesResponse" },
);
export type FeaturesResponse = Static<typeof FeaturesResponse>;

/* ---------------------------- /v1/me/permissions --------------------------- */

/**
 * Per-scope status. Tells the dashboard (and SDK consumers) what they can
 * actually call right now, separating "the host doesn't have it wired" from
 * "you haven't connected your eBay account" from "eBay hasn't approved you".
 *
 *   ok                — endpoint works for this user
 *   scrape            — served by the scrape transport (REST not
 *                       approved/wired, or resource is scrape-only).
 *                       1st-class data path, not a degradation.
 *   needs_oauth       — host is configured but user hasn't completed OAuth
 *   approval_pending  — needs eBay program approval (Order API, Insights)
 *   unavailable       — host doesn't have the env wired (self-host case)
 */
export const ScopeStatus = Type.Union(
	[
		Type.Literal("ok"),
		Type.Literal("scrape"),
		Type.Literal("needs_oauth"),
		Type.Literal("approval_pending"),
		Type.Literal("unavailable"),
	],
	{ $id: "ScopeStatus" },
);
export type ScopeStatus = Static<typeof ScopeStatus>;

export const PermissionsResponse = Type.Object(
	{
		ebayConnected: Type.Boolean(),
		ebayUserName: Type.Union([Type.String(), Type.Null()]),
		ebayUserId: Type.Union([Type.String(), Type.Null()]),
		scopes: Type.Object({
			browse: ScopeStatus,
			marketplaceInsights: ScopeStatus,
			inventory: ScopeStatus,
			fulfillment: ScopeStatus,
			finance: ScopeStatus,
			orderApi: ScopeStatus,
		}),
	},
	{ $id: "PermissionsResponse" },
);
export type PermissionsResponse = Static<typeof PermissionsResponse>;

/* ----------------------------------- root ---------------------------------- */

export const RootDescriptor = Type.Object(
	{
		name: Type.String(),
		docs: Type.String(),
		ebay_compatible: Type.Boolean(),
		paths: Type.Array(Type.String()),
	},
	{ $id: "RootDescriptor" },
);
export type RootDescriptor = Static<typeof RootDescriptor>;

/* --------------------------------- /v1/keys -------------------------------- */

export const KeyCreateRequest = Type.Object(
	{
		ownerEmail: Type.String({ format: "email" }),
		name: Type.Optional(Type.String({ maxLength: 80 })),
	},
	{ $id: "KeyCreateRequest" },
);
export type KeyCreateRequest = Static<typeof KeyCreateRequest>;

export const KeyCreateResponse = Type.Object(
	{
		id: Type.String(),
		tier: Tier,
		prefix: Type.String(),
		suffix: Type.String(),
		plaintext: Type.String(),
		notice: Type.String(),
	},
	{ $id: "KeyCreateResponse" },
);
export type KeyCreateResponse = Static<typeof KeyCreateResponse>;

const Usage = Type.Object({
	// One unified credit budget. Each call charges N credits depending on
	// what it does (1 for search/marketplace mirror, 50 for evaluate, 250
	// for discover, 5 for browser ops, 0 for cache hits). See
	// /docs/rate-limits for the full table.
	creditsUsed: Type.Integer(),
	creditsLimit: Type.Integer(),
	creditsRemaining: Type.Integer(),
	// Sum of active admin-granted credit adjustments folded into
	// `creditsLimit`. 0 when the user has no grants. Surfaced separately
	// so the dashboard can render a "+N admin bonus" hint without
	// re-querying the grant ledger.
	bonusCredits: Type.Integer({ default: 0 }),
	// Refill timestamp. Null for the Free tier — its 500 credits are a
	// one-time grant, not a monthly allotment. Paid tiers refill on the
	// 1st of each month (UTC).
	resetAt: Type.Union([Type.String({ format: "date-time" }), Type.Null()]),
});

export const KeyInfo = Type.Object(
	{
		id: Type.String(),
		tier: Tier,
		prefix: Type.String(),
		suffix: Type.Union([Type.String(), Type.Null()]),
		name: Type.Union([Type.String(), Type.Null()]),
		ownerEmail: Type.Union([Type.String({ format: "email" }), Type.Null()]),
		createdAt: Type.String({ format: "date-time" }),
		lastUsedAt: Type.Union([Type.String({ format: "date-time" }), Type.Null()]),
		usage: Usage,
	},
	{ $id: "KeyInfo" },
);
export type KeyInfo = Static<typeof KeyInfo>;

export const KeyRevokeResponse = Type.Object(
	{
		id: Type.String(),
		revoked: Type.Boolean(),
	},
	{ $id: "KeyRevokeResponse" },
);
export type KeyRevokeResponse = Static<typeof KeyRevokeResponse>;

/* ----------------------------- /v1/me (dashboard) ---------------------------- */

export const MeProfile = Type.Object(
	{
		id: Type.String(),
		email: Type.String({ format: "email" }),
		emailVerified: Type.Boolean(),
		name: Type.String(),
		image: Type.Union([Type.String(), Type.Null()]),
		tier: Tier,
		role: Role,
		usage: Usage,
	},
	{ $id: "MeProfile" },
);
export type MeProfile = Static<typeof MeProfile>;

export const MeUsageResponse = Type.Object(Usage.properties, { $id: "MeUsageResponse" });
export type MeUsageResponse = Static<typeof MeUsageResponse>;

export const MeKeyCreateRequest = Type.Object(
	{
		name: Type.Optional(Type.String({ maxLength: 80 })),
	},
	{ $id: "MeKeyCreateRequest" },
);
export type MeKeyCreateRequest = Static<typeof MeKeyCreateRequest>;

export const MeKey = Type.Object(
	{
		id: Type.String(),
		name: Type.Union([Type.String(), Type.Null()]),
		prefix: Type.String(),
		suffix: Type.Union([Type.String(), Type.Null()]),
		tier: Tier,
		createdAt: Type.String({ format: "date-time" }),
		lastUsedAt: Type.Union([Type.String({ format: "date-time" }), Type.Null()]),
	},
	{ $id: "MeKey" },
);
export type MeKey = Static<typeof MeKey>;

export const MeKeyList = Type.Object({ keys: Type.Array(MeKey) }, { $id: "MeKeyList" });
export type MeKeyList = Static<typeof MeKeyList>;

export const MeKeyRevealResponse = Type.Object(
	{
		id: Type.String(),
		plaintext: Type.String(),
	},
	{ $id: "MeKeyRevealResponse" },
);
export type MeKeyRevealResponse = Static<typeof MeKeyRevealResponse>;

/* -------------------------------- /v1/billing ------------------------------ */

export const BillingCheckoutRequest = Type.Object(
	{
		// Tier the user wants to subscribe to.
		// hobby = $19/mo, standard = $99/mo, growth = $399/mo.
		tier: Type.Union([Type.Literal("hobby"), Type.Literal("standard"), Type.Literal("growth")]),
	},
	{ $id: "BillingCheckoutRequest" },
);
export type BillingCheckoutRequest = Static<typeof BillingCheckoutRequest>;

export const BillingCheckoutResponse = Type.Object(
	{
		url: Type.String({ format: "uri" }),
	},
	{ $id: "BillingCheckoutResponse" },
);
export type BillingCheckoutResponse = Static<typeof BillingCheckoutResponse>;

export const BillingWebhookResponse = Type.Object(
	{
		received: Type.Boolean(),
	},
	{ $id: "BillingWebhookResponse" },
);
export type BillingWebhookResponse = Static<typeof BillingWebhookResponse>;

/* ------------------------------- /v1/takedown ------------------------------ */

/**
 * Taxonomy of takedown reasons. Single endpoint, three regulatory regimes:
 * - `dmca_copyright`: 17 U.S.C. §512(c)(3) infringement notice
 * - `gdpr_erasure`: GDPR Article 17 right-to-erasure (EU data subjects)
 * - `ccpa_deletion`: CCPA §1798.105 deletion request (CA residents)
 * - `seller_optout`: voluntary seller opt-out (eBay seller wants their listing
 *   removed from our cache; not legally required but honored)
 * - `other`: anything else — manual review.
 */
export const TakedownKind = Type.Union(
	[
		Type.Literal("dmca_copyright"),
		Type.Literal("gdpr_erasure"),
		Type.Literal("ccpa_deletion"),
		Type.Literal("seller_optout"),
		Type.Literal("other"),
	],
	{ $id: "TakedownKind" },
);
export type TakedownKind = Static<typeof TakedownKind>;

/**
 * Optional DMCA §512(c)(3) attestation block. Required only when
 * `kind === "dmca_copyright"`. The route handler enforces this conditionally.
 */
export const DmcaAttestation = Type.Object(
	{
		copyrightedWork: Type.String({
			description: "Identification of the copyrighted work claimed to have been infringed.",
		}),
		goodFaithStatement: Type.Boolean({
			description:
				"Statement of good faith belief that the use is not authorized by the copyright owner, its agent, or the law (§512(c)(3)(A)(v)).",
		}),
		accuracyStatement: Type.Boolean({
			description:
				"Statement under penalty of perjury that the information is accurate and the requester is authorized to act on behalf of the rights holder (§512(c)(3)(A)(vi)).",
		}),
		signature: Type.String({
			description: "Physical or electronic signature of the authorized person.",
		}),
	},
	{ $id: "DmcaAttestation" },
);
export type DmcaAttestation = Static<typeof DmcaAttestation>;

export const TakedownRequest = Type.Object(
	{
		itemId: Type.String({ description: "eBay itemId to remove from cache and blocklist." }),
		kind: Type.Optional(TakedownKind),
		reason: Type.Optional(Type.String({ description: "Free-form context for the request." })),
		contactEmail: Type.String({ format: "email" }),
		dmca: Type.Optional(DmcaAttestation),
	},
	{ $id: "TakedownRequest" },
);
export type TakedownRequest = Static<typeof TakedownRequest>;

export const TakedownResponse = Type.Object(
	{
		id: Type.String(),
		status: Type.Literal("pending"),
		slaHours: Type.Integer({
			description:
				"Maximum business hours until triage. Approved takedowns flush the cache and blocklist the itemId.",
		}),
	},
	{ $id: "TakedownResponse" },
);
export type TakedownResponse = Static<typeof TakedownResponse>;
