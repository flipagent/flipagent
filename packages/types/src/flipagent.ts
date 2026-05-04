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
 * Cross-cutting `error` codes — auth, billing, validation, transport. The
 * full union is intentionally curated; individual routes also emit
 * feature-specific codes (e.g. `extension_not_paired`,
 * `ebay_account_not_connected`, `disclaimer_not_acknowledged`,
 * `image_too_large`) that don't belong on this short list. The docs page
 * `apps/docs/src/pages/docs/errors.astro` mirrors this catalog plus
 * notes the long tail; keep both in sync when adding cross-cutting codes.
 */
export const ErrorCode = Type.Union(
	[
		Type.Literal("validation_failed"),
		Type.Literal("invalid_key"),
		Type.Literal("unauthorized"),
		Type.Literal("unauthenticated"),
		Type.Literal("forbidden"),
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
		orderApi: Type.Boolean({ description: "EBAY_ORDER_APPROVED=1 (Limited Release tenant approval)." }),
		insightsApi: Type.Boolean({
			description: "EBAY_INSIGHTS_APPROVED=1 (Marketplace Insights program approval — REST sold history).",
		}),
		biddingApi: Type.Boolean({
			description:
				"EBAY_BIDDING_APPROVED=1 (Buy Offer / Bidding API — Limited Release per-tenant approval; gates /v1/bids).",
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
				"At least one of ANTHROPIC_API_KEY / OPENAI_API_KEY / GOOGLE_API_KEY set — gates the same-product matcher used internally by /v1/evaluate.",
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
			order: ScopeStatus,
			bidding: ScopeStatus,
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
	// what it does (1 marketplace data / 80 evaluate / 5 mini agent turn /
	// 25 gpt-5.5 agent turn / 0 passthrough — see /docs/rate-limits for the
	// full table).
	creditsUsed: Type.Integer(),
	creditsLimit: Type.Integer(),
	creditsRemaining: Type.Integer(),
	// Sum of active admin-granted credit adjustments folded into
	// `creditsLimit`. 0 when the user has no grants. Surfaced separately
	// so the dashboard can render a "+N admin bonus" hint without
	// re-querying the grant ledger.
	bonusCredits: Type.Integer({ default: 0 }),
	// Refill timestamp. Null for the Free tier — its 1,000 credits are a
	// one-time grant, not a monthly allotment. Paid tiers refill on the
	// 1st of each month (UTC).
	resetAt: Type.Union([Type.String({ format: "date-time" }), Type.Null()]),
	// Tier the rate-limit middleware *enforces against* — equal to the
	// caller's `tier` 99% of the time, but downgrades to `free` after
	// PAST_DUE_GRACE_DAYS of continuous past_due. The user's `tier`
	// stays truthful (so billing copy doesn't lie); only this view
	// shifts. Agents should plan against `effectiveTier` for budget
	// math and surface a "card declined — fix in dashboard" hint when
	// it disagrees with `tier`.
	effectiveTier: Tier,
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
		/**
		 * Clickwrap consent state. `currentTermsVersion` is what /legal/terms
		 * is at right now; `termsAcceptedVersion` is what the user actually
		 * agreed to (null if never accepted, e.g. OAuth users created before
		 * the gate landed). When the two differ — including null — the
		 * dashboard surfaces a re-consent modal that POSTs to
		 * /v1/me/terms-acceptance.
		 */
		currentTermsVersion: Type.String(),
		termsAcceptedAt: Type.Union([Type.String({ format: "date-time" }), Type.Null()]),
		termsAcceptedVersion: Type.Union([Type.String(), Type.Null()]),
	},
	{ $id: "MeProfile" },
);
export type MeProfile = Static<typeof MeProfile>;

export const MeTermsAcceptRequest = Type.Object(
	{
		version: Type.String({ minLength: 4, maxLength: 32 }),
	},
	{ $id: "MeTermsAcceptRequest" },
);
export type MeTermsAcceptRequest = Static<typeof MeTermsAcceptRequest>;

export const MeTermsAcceptResponse = Type.Object(
	{
		acceptedAt: Type.String({ format: "date-time" }),
		version: Type.String(),
	},
	{ $id: "MeTermsAcceptResponse" },
);
export type MeTermsAcceptResponse = Static<typeof MeTermsAcceptResponse>;

export const MeAccountDeleteResponse = Type.Object(
	{
		deletedAt: Type.String({ format: "date-time" }),
		userId: Type.String(),
	},
	{ $id: "MeAccountDeleteResponse" },
);
export type MeAccountDeleteResponse = Static<typeof MeAccountDeleteResponse>;

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

/* -------------------------- /v1/me/devices -------------------------- */

/**
 * A device-facing view of a bridge token. The plaintext token is *only*
 * returned by `POST /v1/me/devices` (one-shot at issue time); the list
 * + revoke endpoints return metadata only. `apiKeyId` is omitted from
 * the wire because devices don't need to know which underlying key they
 * inherit from — the token alone is sufficient credential.
 */
export const MeDevice = Type.Object(
	{
		id: Type.String(),
		deviceName: Type.Union([Type.String(), Type.Null()]),
		tokenPrefix: Type.String(),
		ebayLoggedIn: Type.Boolean(),
		ebayUserName: Type.Union([Type.String(), Type.Null()]),
		createdAt: Type.String({ format: "date-time" }),
		lastSeenAt: Type.Union([Type.String({ format: "date-time" }), Type.Null()]),
	},
	{ $id: "MeDevice" },
);
export type MeDevice = Static<typeof MeDevice>;

export const MeDeviceList = Type.Object({ devices: Type.Array(MeDevice) }, { $id: "MeDeviceList" });
export type MeDeviceList = Static<typeof MeDeviceList>;

export const MeDeviceConnectRequest = Type.Object(
	{
		/** Free-text label so the user can recognise this device on the
		 * dashboard's "Connected devices" list — e.g. "macbook", "work
		 * chrome". The extension passes a UA-derived default. */
		deviceName: Type.Optional(Type.String({ minLength: 1, maxLength: 80 })),
	},
	{ $id: "MeDeviceConnectRequest" },
);
export type MeDeviceConnectRequest = Static<typeof MeDeviceConnectRequest>;

/**
 * One-shot bundle returned from `POST /v1/me/devices`: a usable
 * `apiKey` plaintext + a `bridgeToken` plaintext bound to it. Both
 * values are shown exactly once; the caller (today: the
 * `/extension/connect` page) hands them off to the Chrome extension
 * via `chrome.runtime.sendMessage` and discards them.
 *
 * If the user already has an active API key, that one is reused — the
 * device dashboard remains a list of bridge tokens, not a list of keys.
 */
export const MeDeviceConnectResponse = Type.Object(
	{
		device: MeDevice,
		apiKey: Type.Object({
			id: Type.String(),
			plaintext: Type.String(),
			tier: Tier,
		}),
		bridgeToken: Type.Object({
			id: Type.String(),
			plaintext: Type.String(),
			prefix: Type.String(),
		}),
	},
	{ $id: "MeDeviceConnectResponse" },
);
export type MeDeviceConnectResponse = Static<typeof MeDeviceConnectResponse>;

export const MeDeviceRevokeResponse = Type.Object(
	{
		id: Type.String(),
		revoked: Type.Boolean(),
	},
	{ $id: "MeDeviceRevokeResponse" },
);
export type MeDeviceRevokeResponse = Static<typeof MeDeviceRevokeResponse>;

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

/* ------------------------ /v1/billing — history --------------------------- */

/**
 * One row of the unified billing history — a Stripe invoice
 * (subscription bill) OR a top-up charge (off-session PaymentIntent
 * for auto-recharge). Both kinds carry a downloadable receipt; the
 * row itself is uniform so the dashboard renders a single table.
 */
export const BillingTransaction = Type.Object(
	{
		id: Type.String(),
		// Discriminator. `subscription` rows have a Stripe invoice
		// number and `hostedInvoiceUrl`; `top_up` rows are standalone
		// charges (no invoice number) and link to the receipt URL.
		type: Type.Union([Type.Literal("subscription"), Type.Literal("top_up")]),
		// Stripe invoice number (e.g. "1A2B3C4D-0001") for subscription
		// rows; null for top-up charges (Stripe doesn't issue invoice
		// numbers for standalone charges).
		number: Type.Union([Type.String(), Type.Null()]),
		createdAt: Type.String({ format: "date-time" }),
		amountCents: Type.Integer(),
		amountDisplay: Type.String(),
		// Subset of Stripe's invoice + charge statuses we surface.
		// `failed` covers a declined top-up; `void` covers admin-voided
		// invoices; the others map 1:1 from Stripe.
		status: Type.Union([
			Type.Literal("paid"),
			Type.Literal("open"),
			Type.Literal("failed"),
			Type.Literal("refunded"),
			Type.Literal("void"),
		]),
		// Hosted invoice URL or top-up receipt URL. Null when Stripe
		// hasn't generated one yet (rare, but possible for very fresh
		// rows the webhook just landed).
		downloadUrl: Type.Union([Type.String({ format: "uri" }), Type.Null()]),
	},
	{ $id: "BillingTransaction" },
);
export type BillingTransaction = Static<typeof BillingTransaction>;

export const BillingHistoryResponse = Type.Object(
	{
		transactions: Type.Array(BillingTransaction),
	},
	{ $id: "BillingHistoryResponse" },
);
export type BillingHistoryResponse = Static<typeof BillingHistoryResponse>;

/* --------------------- /v1/billing — auto-recharge ------------------------ */

/**
 * Selectable top-up amounts. Same set across all paid tiers — only the
 * per-credit unit price varies. Auto-recharge fires one of these every
 * time the user's `creditsRemaining` drops below their configured
 * threshold (the only top-up entry point — there's no manual fire).
 *
 * Off-session PaymentIntent against the customer's saved card (the
 * one Stripe stored at subscription checkout). Free-tier users have
 * no card on file → 403 on the config endpoints; they need to
 * subscribe first.
 */
export const BillingTopUpCredits = Type.Union([Type.Literal(1_500), Type.Literal(7_500), Type.Literal(30_000)], {
	$id: "BillingTopUpCredits",
	description: "One of the catalogued top-up amounts (5k / 25k / 100k).",
});
export type BillingTopUpCredits = Static<typeof BillingTopUpCredits>;

/**
 * Quote for one top-up amount, at the caller's current tier. The
 * dashboard renders "$X for N credits" off this without doing tier
 * math on the frontend. Free callers get 403.
 */
export const BillingTopUpQuote = Type.Object(
	{
		credits: Type.Integer(),
		priceCents: Type.Integer(),
		// Pre-formatted USD ("$10.00") so JS doesn't need a currency
		// formatter just to render the catalog.
		priceDisplay: Type.String(),
		perCreditUsd: Type.Number(),
	},
	{ $id: "BillingTopUpQuote" },
);
export type BillingTopUpQuote = Static<typeof BillingTopUpQuote>;

export const BillingTopUpQuotesResponse = Type.Object(
	{
		tier: Type.Union([Type.Literal("hobby"), Type.Literal("standard"), Type.Literal("growth")]),
		quotes: Type.Array(BillingTopUpQuote),
	},
	{ $id: "BillingTopUpQuotesResponse" },
);
export type BillingTopUpQuotesResponse = Static<typeof BillingTopUpQuotesResponse>;

export const BillingAutoRechargeConfig = Type.Object(
	{
		enabled: Type.Boolean(),
		// Target balance in credits — when creditsRemaining drops below
		// this, the next billable request charges the saved card to
		// bring the balance back to (or just above) the target. One
		// number replaces the previous threshold + topup pair. Bounds
		// are tier-dependent — see `targetRangeForTier()` in the API.
		// Null when `enabled` is false.
		targetCredits: Type.Union([Type.Integer({ minimum: 500 }), Type.Null()]),
		// Last successful auto-recharge. Null when disabled or never fired.
		// Dashboard renders "Last recharged: 3h ago" off this.
		lastRechargedAt: Type.Union([Type.String({ format: "date-time" }), Type.Null()]),
	},
	{ $id: "BillingAutoRechargeConfig" },
);
export type BillingAutoRechargeConfig = Static<typeof BillingAutoRechargeConfig>;

/**
 * Request body for `PUT /v1/billing/auto-recharge`. Client supplies
 * `targetCredits` — the desired floor balance. The server validates
 * it against the user's tier-specific range; out-of-range values 400.
 * Disabling carries no fields.
 */
export const BillingAutoRechargeUpdateRequest = Type.Union(
	[
		Type.Object({ enabled: Type.Literal(false) }),
		Type.Object({
			enabled: Type.Literal(true),
			targetCredits: Type.Integer({ minimum: 500 }),
		}),
	],
	{ $id: "BillingAutoRechargeUpdateRequest" },
);
export type BillingAutoRechargeUpdateRequest = Static<typeof BillingAutoRechargeUpdateRequest>;

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

/**
 * 17 U.S.C. §512(g) counter-notice. Submitted when content was removed in
 * response to a takedown the affected party believes was mistaken or
 * misidentified. The four `agree*` fields are the statutory attestations;
 * sending any of them as `false` is a 400. The flipagent endpoint forwards
 * approved counter-notices to the original takedown's submitter and
 * restores the listing observation by clearing `takedownAt`.
 */
export const CounterNoticeRequest = Type.Object(
	{
		itemId: Type.String({ minLength: 1 }),
		contactName: Type.String({ minLength: 1, maxLength: 200 }),
		contactEmail: Type.String({ format: "email" }),
		contactAddress: Type.String({ minLength: 1, maxLength: 500 }),
		contactPhone: Type.String({ minLength: 1, maxLength: 60 }),
		signature: Type.String({ minLength: 1, maxLength: 200, description: "Typed legal name." }),
		agreePenaltyOfPerjury: Type.Boolean({
			description:
				"I swear under penalty of perjury that I have a good-faith belief the material was removed as a result of mistake or misidentification.",
		}),
		agreeJurisdiction: Type.Boolean({
			description:
				"I consent to the jurisdiction of the U.S. District Court for the District of Delaware (Wilmington), or, if I am outside the U.S., to any judicial district where flipagent may be found.",
		}),
		agreeServiceOfProcess: Type.Boolean({
			description:
				"I will accept service of process from the person who submitted the original takedown notice (or their agent).",
		}),
		notes: Type.Optional(Type.String({ maxLength: 2000 })),
	},
	{ $id: "CounterNoticeRequest" },
);
export type CounterNoticeRequest = Static<typeof CounterNoticeRequest>;

export const CounterNoticeResponse = Type.Object(
	{
		id: Type.String(),
		status: Type.Literal("received"),
		message: Type.String(),
	},
	{ $id: "CounterNoticeResponse" },
);
export type CounterNoticeResponse = Static<typeof CounterNoticeResponse>;
