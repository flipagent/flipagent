import { sql } from "drizzle-orm";
import {
	bigint,
	boolean,
	index,
	integer,
	jsonb,
	pgEnum,
	pgTable,
	text,
	timestamp,
	uniqueIndex,
	uuid,
} from "drizzle-orm/pg-core";

export const tierEnum = pgEnum("api_key_tier", ["free", "hobby", "standard", "growth"]);
export const userRoleEnum = pgEnum("user_role", ["user", "admin"]);
export const takedownStatusEnum = pgEnum("takedown_status", ["pending", "approved", "rejected"]);
/**
 * Ledger events flipagent records itself. `purchased` / `forwarder_fee` /
 * `expense` are cost-side. `sold` is revenue-side, written when an eBay
 * Trading Notification (ItemSold / FixedPriceTransaction / etc.) lands —
 * closes the P&L loop without polling eBay Finances.
 */
export const expenseEventKindEnum = pgEnum("expense_event_kind", ["purchased", "forwarder_fee", "expense", "sold"]);
export const computeJobKindEnum = pgEnum("compute_job_kind", ["evaluate", "search"]);
export const computeJobStatusEnum = pgEnum("compute_job_status", [
	"queued",
	"running",
	"completed",
	"failed",
	"cancelled",
]);
export const bridgeJobStatusEnum = pgEnum("bridge_job_status", [
	"queued",
	"claimed",
	"awaiting_user_confirm",
	"placing",
	"completed",
	"failed",
	"cancelled",
	"expired",
]);
export const webhookDeliveryStatusEnum = pgEnum("webhook_delivery_status", ["pending", "delivered", "failed"]);

/**
 * Better-Auth canonical tables. Names are `user`/`session`/`account`/`verification`
 * (singular) to match the default drizzle adapter mapping. We extend `user`
 * with `tier` (the per-account quota tier) and `stripeCustomerId` (lazily
 * created on first checkout) — those are flipagent fields, not Better-Auth's.
 */
export const user = pgTable("user", {
	id: text("id").primaryKey(),
	name: text("name").notNull(),
	email: text("email").notNull().unique(),
	emailVerified: boolean("email_verified").notNull().default(false),
	image: text("image"),
	tier: tierEnum("tier").notNull().default("free"),
	/**
	 * Operator role. `admin` unlocks the `/v1/admin/*` surface and the
	 * `/admin` dashboard page; everyone else is `user`. Bootstrap admins
	 * via the `ADMIN_EMAILS` env var — Better-Auth's `databaseHooks`
	 * promotes those addresses on first sign-up and on every session
	 * resolution (idempotent), so demoting in env effectively
	 * downgrades on the user's next request.
	 */
	role: userRoleEnum("role").notNull().default("user"),
	stripeCustomerId: text("stripe_customer_id"),
	stripeSubscriptionId: text("stripe_subscription_id"),
	subscriptionStatus: text("subscription_status"),
	/**
	 * Epoch from which the current tier's credit budget starts counting.
	 * Bumped on every tier transition (Stripe webhook) so a downgrade gives
	 * the user a fresh credit window — without this, a Standard user who
	 * burned 100k this month would arrive on Free already over the 500-credit
	 * cap (Free is one-time, so snapshotUsage aggregates lifetime events).
	 * For paid tiers the floor used is `max(creditsResetAt, monthStart)`.
	 */
	creditsResetAt: timestamp("credits_reset_at", { withTimezone: true }).notNull().defaultNow(),
	/**
	 * Stripe dunning anchor. Set the first time `invoice.payment_failed`
	 * fires for this user's subscription; cleared when the subscription
	 * returns to `active`. After `PAST_DUE_GRACE_DAYS` of continuous
	 * past_due, `effectiveTier()` treats this user as free for rate-limit
	 * purposes — their `user.tier` column stays truthful (so billing copy
	 * + admin views don't lie), only the enforcement view downgrades. If
	 * the card resolves later, the next webhook clears this and they snap
	 * back without losing their tier or any usage history.
	 */
	pastDueSince: timestamp("past_due_since", { withTimezone: true }),
	/**
	 * Auto-recharge target balance. When `autoRechargeEnabled` is true
	 * and the user's `creditsRemaining` falls below `autoRechargeTarget`,
	 * the api charges their saved card to bring the balance back up to
	 * the target (gap-bounded by `MIN_TOPUP_CREDITS` so we never fire
	 * sub-Stripe-min charges). One column instead of separate threshold
	 * + topup amount: simpler UX, simpler invariant, and matches how
	 * Vercel / AWS expose auto-top-up. Nullable while `enabled=false`;
	 * the route layer enforces "enabled implies target set" on PUT.
	 *
	 * `lastAutoRechargeAt` guards against double-fire during the
	 * check-window race — middleware only triggers if the stamp is
	 * older than 60s. Card-on-file comes from the user's existing
	 * subscription (Stripe `customer.invoice_settings.default_payment_method`).
	 * Auto-recharge is only available on paid tiers (free has no card).
	 */
	autoRechargeEnabled: boolean("auto_recharge_enabled").notNull().default(false),
	autoRechargeTarget: integer("auto_recharge_target"),
	lastAutoRechargeAt: timestamp("last_auto_recharge_at", { withTimezone: true }),
	/**
	 * Clickwrap consent record. Set the moment the user submits the sign-up
	 * form (or accepts a re-consent prompt). `termsVersion` matches the
	 * `Last updated` date stamped on /legal/terms; bumping that date and
	 * shipping a new clickwrap row gives us a clean audit trail of which
	 * version each user agreed to. Both nullable for users created before
	 * the column existed; backfilled lazily on next sign-in.
	 */
	termsAcceptedAt: timestamp("terms_accepted_at", { withTimezone: true }),
	termsVersion: text("terms_version"),
	termsAcceptedIp: text("terms_accepted_ip"),
	createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
	updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const session = pgTable("session", {
	id: text("id").primaryKey(),
	expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
	token: text("token").notNull().unique(),
	createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
	updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
	ipAddress: text("ip_address"),
	userAgent: text("user_agent"),
	userId: text("user_id")
		.notNull()
		.references(() => user.id, { onDelete: "cascade" }),
});

export const account = pgTable("account", {
	id: text("id").primaryKey(),
	accountId: text("account_id").notNull(),
	providerId: text("provider_id").notNull(),
	userId: text("user_id")
		.notNull()
		.references(() => user.id, { onDelete: "cascade" }),
	accessToken: text("access_token"),
	refreshToken: text("refresh_token"),
	idToken: text("id_token"),
	accessTokenExpiresAt: timestamp("access_token_expires_at", { withTimezone: true }),
	refreshTokenExpiresAt: timestamp("refresh_token_expires_at", { withTimezone: true }),
	scope: text("scope"),
	password: text("password"),
	createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
	updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const verification = pgTable("verification", {
	id: text("id").primaryKey(),
	identifier: text("identifier").notNull(),
	value: text("value").notNull(),
	expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
	createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
	updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Issued API keys. The plaintext key is shown to the user exactly once at
 * creation; we store only the sha256 hash. `keyPrefix` is the first 12
 * characters of plaintext (e.g. "fa_free_a3b1"); `keySuffix` is the last 4
 * characters. Together they let dashboards render `prefix······suffix` so
 * users can recognize a key at a glance without exposing the secret middle.
 * Nullable for keys issued before the column was added — display falls back
 * to prefix-only.
 */
export const apiKeys = pgTable(
	"api_keys",
	{
		id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
		keyHash: text("key_hash").notNull(),
		keyPrefix: text("key_prefix").notNull(),
		keySuffix: text("key_suffix"),
		// AES-256-GCM ciphertext of the plaintext, encrypted with
		// KEYS_ENCRYPTION_KEY. Format: `<b64 iv>:<b64 ct+tag>`. Lets the
		// dashboard reveal the full key on demand without us storing
		// recoverable plaintext. Null for legacy keys + when the env key
		// is absent (production: required; dev: derived fallback).
		keyCiphertext: text("key_ciphertext"),
		tier: tierEnum("tier").notNull().default("free"),
		name: text("name"),
		ownerEmail: text("owner_email"),
		userId: text("user_id").references(() => user.id, { onDelete: "cascade" }),
		stripeCustomerId: text("stripe_customer_id"),
		stripeSubscriptionId: text("stripe_subscription_id"),
		subscriptionStatus: text("subscription_status"),
		createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
		lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
		revokedAt: timestamp("revoked_at", { withTimezone: true }),
	},
	(t) => ({
		hashUnique: uniqueIndex("api_keys_key_hash_unique").on(t.keyHash),
		ownerIdx: index("api_keys_owner_email_idx").on(t.ownerEmail),
		userIdx: index("api_keys_user_id_idx").on(t.userId),
		stripeSubIdx: index("api_keys_stripe_sub_idx").on(t.stripeSubscriptionId),
	}),
);

/**
 * One row per API call against a metered endpoint. Powers per-key usage
 * counters and billing. Partitioning by month is left for later.
 */
export const usageEvents = pgTable(
	"usage_events",
	{
		id: bigint("id", { mode: "bigint" }).primaryKey().generatedAlwaysAsIdentity(),
		apiKeyId: uuid("api_key_id")
			.notNull()
			.references(() => apiKeys.id, { onDelete: "cascade" }),
		userId: text("user_id").references(() => user.id, { onDelete: "set null" }),
		endpoint: text("endpoint").notNull(),
		statusCode: integer("status_code").notNull(),
		latencyMs: integer("latency_ms").notNull(),
		/**
		 * Credits charged for this call, snapshotted at write time. Lets
		 * snapshotUsage() SUM a plain integer instead of a hand-synced SQL
		 * CASE expression — and lets endpoint-specific pricing (e.g. agent
		 * cost varying by selected model) ride on a single column without
		 * another schema bump. Defaults to 0 because billing principle is
		 * "charge for what runs on our infra"; passthrough endpoints stay
		 * free.
		 */
		creditsCharged: integer("credits_charged").notNull().default(0),
		/**
		 * The user's tier at the moment of the call. Recorded so a free user
		 * who upgrades to hobby and downgrades back doesn't get a fresh
		 * 1000-credit lifetime window: snapshotUsage filters by tier='free'
		 * when computing free aggregation, so prior free usage stays counted
		 * regardless of how many subscription cycles happen in between.
		 */
		tier: tierEnum("tier").notNull().default("free"),
		/**
		 * Where the data came from for this call (`rest`/`scrape`/`bridge`/
		 * `trading`/`llm`). Mirrors the `X-Flipagent-Source` response header
		 * sent on the wire. Nullable for rows written before the column
		 * existed and for endpoints that don't surface a transport (auth
		 * health, /v1/me/*).
		 */
		source: text("source"),
		createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
	},
	(t) => ({
		keyTimeIdx: index("usage_events_key_created_idx").on(t.apiKeyId, t.createdAt),
		userTimeIdx: index("usage_events_user_created_idx").on(t.userId, t.createdAt),
		userTierTimeIdx: index("usage_events_user_tier_created_idx").on(t.userId, t.tier, t.createdAt),
	}),
);

/**
 * Cached eBay listings the alpha logic has fetched. Source-agnostic for
 * future expansion; today everything is `ebay_us`. Upsert key is
 * (source, sourceId).
 */
export const listingsCache = pgTable(
	"listings_cache",
	{
		id: bigint("id", { mode: "bigint" }).primaryKey().generatedAlwaysAsIdentity(),
		source: text("source").notNull().default("ebay_us"),
		sourceId: text("source_id").notNull(),
		url: text("url").notNull(),
		title: text("title").notNull(),
		condition: text("condition"),
		priceCents: integer("price_cents"),
		currency: text("currency").notNull().default("USD"),
		shippingCents: integer("shipping_cents"),
		buyingFormat: text("buying_format"),
		bidCount: integer("bid_count"),
		watchCount: integer("watch_count"),
		sellerId: text("seller_id"),
		sellerFeedback: integer("seller_feedback"),
		endTime: timestamp("end_time", { withTimezone: true }),
		rawJson: jsonb("raw_json"),
		scrapedAt: timestamp("scraped_at", { withTimezone: true }).notNull().defaultNow(),
	},
	(t) => ({
		sourceUnique: uniqueIndex("listings_source_unique").on(t.source, t.sourceId),
		titleIdx: index("listings_title_idx").on(t.title),
	}),
);

/**
 * Sold-price observations. Feeds the median estimator that the
 * deal-finding heuristics compare active prices against.
 */
export const priceHistory = pgTable(
	"price_history",
	{
		id: bigint("id", { mode: "bigint" }).primaryKey().generatedAlwaysAsIdentity(),
		keyword: text("keyword").notNull(),
		marketplace: text("marketplace").notNull().default("EBAY_US"),
		title: text("title").notNull(),
		priceCents: integer("price_cents").notNull(),
		currency: text("currency").notNull().default("USD"),
		shippingCents: integer("shipping_cents"),
		condition: text("condition"),
		url: text("url"),
		soldAt: timestamp("sold_at", { withTimezone: true }),
		observedAt: timestamp("observed_at", { withTimezone: true }).notNull().defaultNow(),
	},
	(t) => ({
		keywordIdx: index("price_history_keyword_idx").on(t.keyword, t.marketplace),
		soldAtIdx: index("price_history_sold_at_idx").on(t.soldAt),
	}),
);

/**
 * Cached upstream response envelopes for read-heavy resources (items,
 * categories, products). Anti-thundering-herd, not archival —
 * `withCache` reads/writes here keyed by (path, queryHash) with a
 * short TTL. Distinct from `listingsCache`, which holds the
 * per-listing structured cache.
 */
export const proxyResponseCache = pgTable(
	"proxy_response_cache",
	{
		id: bigint("id", { mode: "bigint" }).primaryKey().generatedAlwaysAsIdentity(),
		path: text("path").notNull(),
		queryHash: text("query_hash").notNull(),
		body: jsonb("body").notNull(),
		source: text("source").notNull(),
		createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
		expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
	},
	(t) => ({
		pathQueryUnique: uniqueIndex("proxy_cache_path_query_unique").on(t.path, t.queryHash),
		expiresIdx: index("proxy_cache_expires_idx").on(t.expiresAt),
	}),
);

/**
 * Operator opt-out requests. ToS hygiene. Sellers (or anyone else)
 * can ask us to stop serving cached / scraped data for a specific
 * itemId. Status starts pending; manual review promotes to approved
 * (cache flushed, blocklisted) or rejected.
 */
export const takedownRequests = pgTable(
	"takedown_requests",
	{
		id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
		itemId: text("item_id").notNull(),
		reason: text("reason"),
		contactEmail: text("contact_email").notNull(),
		status: takedownStatusEnum("status").notNull().default("pending"),
		createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
		processedAt: timestamp("processed_at", { withTimezone: true }),
		/**
		 * Timestamp the SLA-breach alert fired for this row. Set by the
		 * maintenance sweeper after a row sits in `pending` past the 48h
		 * SLA. Idempotency guard — once set, the sweeper does not re-alert
		 * even if the row stays pending for days. Cleared by triage actions
		 * (approve/reject) implicitly by virtue of `status` flipping.
		 */
		slaBreachedAt: timestamp("sla_breached_at", { withTimezone: true }),
	},
	(t) => ({
		itemIdx: index("takedown_item_idx").on(t.itemId),
		statusIdx: index("takedown_status_idx").on(t.status),
	}),
);

/**
 * Per-listing observation archive. Each row is one snapshot of an item
 * captured during a request — title, condition, price, seller, image
 * URL, aspects — plus the canonical `itemWebUrl` for ToS-compliant
 * attribution. Distinct from `proxyResponseCache` (short-TTL bulk
 * payload, dropped at TTL): observations persist long-term as time-
 * series data for the historical sold-listing depth + matcher fingerprint
 * + cross-user reputation use cases. Self-host turns this off via
 * `OBSERVATION_ENABLED=0`; hosted runs always-on.
 *
 * ToS guards baked in:
 *   - `itemWebUrl` is NOT NULL — every read joins back to the source.
 *   - `imageUrl` stores eBay's CDN URL only (no binary mirroring).
 *   - `takedownAt` flags rows that need to be hidden from queries when
 *     a seller opts out via `/v1/takedown`. Rows aren't deleted
 *     (audit trail), just filtered.
 *
 * Index strategy: lookups by (marketplace, legacyItemId) for per-listing
 * history, by (categoryId, observedAt) for category-level analytics,
 * by sellerUsername for reputation queries.
 */
export const listingObservations = pgTable(
	"listing_observations",
	{
		id: bigint("id", { mode: "bigint" }).primaryKey().generatedAlwaysAsIdentity(),
		marketplace: text("marketplace").notNull().default("ebay_us"),
		legacyItemId: text("legacy_item_id").notNull(),
		itemId: text("item_id"),
		observedAt: timestamp("observed_at", { withTimezone: true }).notNull().defaultNow(),
		sourceQueryHash: text("source_query_hash"),
		// Attribution — every archive read includes this; never null.
		itemWebUrl: text("item_web_url").notNull(),
		// Listing snapshot fields.
		title: text("title"),
		condition: text("condition"),
		conditionId: text("condition_id"),
		priceCents: integer("price_cents"),
		currency: text("currency").default("USD"),
		shippingCents: integer("shipping_cents"),
		lastSoldPriceCents: integer("last_sold_price_cents"),
		lastSoldDate: timestamp("last_sold_date", { withTimezone: true }),
		sellerUsername: text("seller_username"),
		sellerFeedbackScore: integer("seller_feedback_score"),
		sellerFeedbackPercentage: text("seller_feedback_percentage"),
		categoryId: text("category_id"),
		categoryPath: text("category_path"),
		// eBay CDN URL only, no binary mirror.
		imageUrl: text("image_url"),
		// Structured aspects (Brand, Color, Size, Style Code, …).
		aspects: jsonb("aspects"),
		// Listing lifecycle dates — drives hazard model duration math.
		itemCreationDate: timestamp("item_creation_date", { withTimezone: true }),
		itemEndDate: timestamp("item_end_date", { withTimezone: true }),
		// Takedown flag — non-null hides row from all archive queries.
		takedownAt: timestamp("takedown_at", { withTimezone: true }),
		/**
		 * Full normalised `ItemDetail` body — only populated for detail
		 * fetches (search-result rows leave it NULL). Lets the data lake
		 * double as runtime cache: `getFreshDetailObservation(legacyId,
		 * ttlMs)` reads the latest `raw_response IS NOT NULL` row and
		 * `getItemDetail` skips upstream when fresh.
		 *
		 * Stored shape is the flipagent-normalised `ItemDetail`, not the
		 * raw eBay/scraper response — so reads are transport-uniform
		 * (REST, scrape, bridge produce the same shape post-conversion).
		 */
		rawResponse: jsonb("raw_response"),
		/** Which transport served the underlying fetch — `rest` | `scrape` | `bridge`. NULL for legacy rows. */
		source: text("source"),
	},
	(t) => ({
		legacyIdx: index("listing_obs_legacy_idx").on(t.marketplace, t.legacyItemId, t.observedAt),
		categoryIdx: index("listing_obs_category_idx").on(t.categoryId, t.observedAt),
		sellerIdx: index("listing_obs_seller_idx").on(t.sellerUsername, t.observedAt),
		takedownIdx: index("listing_obs_takedown_idx").on(t.takedownAt),
		soldDateIdx: index("listing_obs_sold_date_idx").on(t.lastSoldDate),
	}),
);

/**
 * Per-category fitted elasticity (β). Nightly worker regresses observed
 * duration vs price-z over `listing_observations`; result lands here.
 * `categoryBeta()` reads from this table when present, falls back to the
 * hardcoded map. Hosted-only: self-host has no observations to fit, stays
 * on defaults — but the hosted version's recommendations grow more
 * accurate with every additional row of data.
 */
export const categoryCalibration = pgTable("category_calibration", {
	categoryId: text("category_id").primaryKey(),
	betaEstimate: text("beta_estimate").notNull(), // numeric stored as text — drizzle doesn't have a numeric type that round-trips well; toFloat at read site
	nObservations: integer("n_observations").notNull(),
	fitQuality: text("fit_quality"),
	lastFitAt: timestamp("last_fit_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Anonymized query frequency by hour × category × query-hash. Drives the
 * "trending" surface (`/v1/trends/categories`) without storing user query
 * content as text — `queryHash` is a stable hash of the keyword set, so
 * we capture frequency / pulse without holding identifiable strings.
 */
export const queryPulse = pgTable(
	"query_pulse",
	{
		hourBucket: timestamp("hour_bucket", { withTimezone: true }).notNull(),
		categoryId: text("category_id").notNull().default(""),
		queryHash: text("query_hash").notNull().default(""),
		queryCount: integer("query_count").notNull().default(0),
	},
	(t) => ({
		pk: uniqueIndex("query_pulse_pkey").on(t.hourBucket, t.categoryId, t.queryHash),
		categoryIdx: index("query_pulse_category_idx").on(t.categoryId, t.hourBucket),
	}),
);

/**
 * Per-pair match decision cache. Pass-2 of the LLM matcher consults
 * `(candidateId, itemId)` here before paying for inference — same pair
 * = same answer most of the time. TTL 30 days because eBay listings
 * expire and seller framing shifts; older decisions go stale and are
 * re-evaluated when next encountered.
 */
export const matchDecisions = pgTable(
	"match_decisions",
	{
		candidateId: text("candidate_id").notNull(),
		itemId: text("item_id").notNull(),
		decision: text("decision").notNull(),
		reason: text("reason"),
		decidedAt: timestamp("decided_at", { withTimezone: true }).notNull().defaultNow(),
		expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
	},
	(t) => ({
		pk: uniqueIndex("match_decisions_pkey").on(t.candidateId, t.itemId),
		expiresIdx: index("match_decisions_expires_idx").on(t.expiresAt),
	}),
);

/**
 * Append-only ML-grade history of matcher decisions. Parallel write to
 * `match_decisions` (which is the runtime cache, latest-only, 30d TTL).
 * Every LLM verify decision lands here permanently — same pair can have
 * multiple rows over time as model revs ship, letting us A/B new
 * matchers against the historical seed→candidate corpus.
 *
 * Reproducibility: pair this with the seed/candidate snapshots in
 * `listing_observations` (looked up by `legacy_item_id` + nearest
 * `observed_at`) to reconstruct exactly what the matcher saw at decision
 * time. `model_id` carries `${provider.name}/${provider.model}` so
 * cross-model evals are direct.
 *
 * Read pattern: `WHERE candidate_id=? AND item_id=? ORDER BY observed_at
 * DESC` for per-pair history; `WHERE model_id=? AND observed_at IN
 * range` for ML training set extraction.
 */
export const matchHistory = pgTable(
	"match_history",
	{
		id: bigint("id", { mode: "bigint" }).primaryKey().generatedAlwaysAsIdentity(),
		candidateId: text("candidate_id").notNull(),
		itemId: text("item_id").notNull(),
		decision: text("decision").notNull(),
		reason: text("reason"),
		/** wrong_product | bundle_or_lot | off_condition | other (populated for rejects). */
		category: text("category"),
		/** `${provider.name}/${provider.model}` — e.g. `gemini/gemini-3.1-flash-lite-preview`. */
		modelId: text("model_id"),
		observedAt: timestamp("observed_at", { withTimezone: true }).notNull().defaultNow(),
	},
	(t) => ({
		pairIdx: index("match_history_pair_idx").on(t.candidateId, t.itemId, t.observedAt.desc()),
		modelTimeIdx: index("match_history_model_time_idx").on(t.modelId, t.observedAt),
	}),
);

/**
 * Append-only catalog product capture — parallel to
 * `listing_observations` but for `/v1/products/{epid}` reads (Catalog
 * REST + scrape JSON-LD). One row per upstream fetch (deduped at the
 * transport layer's in-flight Map; the cache hit path doesn't insert).
 *
 * Snapshot is the full `Product` body as JSONB — keeps schema-free so
 * future Product field additions don't need migrations. ML / dedup reads
 * can land on the latest fresh row by `(epid, observed_at desc)`.
 *
 * Takedown: matches `listing_observations.takedown_at` semantics — the
 * `/v1/takedown` route flips `takedown_at` on approval; live reads
 * filter `takedown_at IS NULL`.
 */
export const productObservations = pgTable(
	"product_observations",
	{
		id: bigint("id", { mode: "bigint" }).primaryKey().generatedAlwaysAsIdentity(),
		marketplace: text("marketplace").notNull().default("ebay_us"),
		epid: text("epid").notNull(),
		observedAt: timestamp("observed_at", { withTimezone: true }).notNull().defaultNow(),
		/** Full `Product` body. Schema-free for forward-compat. */
		snapshot: jsonb("snapshot").notNull(),
		/** Which transport served this fetch — `rest` | `scrape`. */
		source: text("source").notNull(),
		takedownAt: timestamp("takedown_at", { withTimezone: true }),
	},
	(t) => ({
		epidIdx: index("product_observations_epid_observed_idx").on(t.epid, t.observedAt.desc()),
	}),
);

/**
 * eBay category-tree snapshots, change-only. eBay revs categories
 * quarterly-ish; instead of snapshotting on every fetch (the tree is
 * large — hundreds of KB), we hash the canonical-JSON payload and only
 * insert when the hash differs from the latest row for `(marketplace,
 * root)`.
 *
 * `root` = the subtree root id (or `"0"` for the full tree). Lets us
 * track partial-fetch deltas without forcing a full refetch.
 */
export const categorySnapshots = pgTable(
	"category_snapshots",
	{
		id: bigint("id", { mode: "bigint" }).primaryKey().generatedAlwaysAsIdentity(),
		marketplace: text("marketplace").notNull().default("ebay_us"),
		root: text("root").notNull(),
		/** SHA-256 of canonical-JSON serialised snapshot. Insert dedup'd on this per (marketplace, root). */
		hash: text("hash").notNull(),
		snapshot: jsonb("snapshot").notNull(),
		observedAt: timestamp("observed_at", { withTimezone: true }).notNull().defaultNow(),
	},
	(t) => ({
		rootIdx: index("category_snapshots_root_observed_idx").on(t.marketplace, t.root, t.observedAt.desc()),
	}),
);

/**
 * One row per (api_key) ↔ eBay account binding. Stores the user's eBay
 * refresh + access tokens so flipagent can passthrough sell-side / order
 * calls to api.ebay.com on their behalf. The plaintext tokens live here for
 * v1 — wrap with libsodium / KMS at a later stage. Refresh tokens are very
 * long-lived (eBay: 18 months); access tokens 2h.
 */
export const userEbayOauth = pgTable(
	"user_ebay_oauth",
	{
		id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
		apiKeyId: uuid("api_key_id")
			.notNull()
			.references(() => apiKeys.id, { onDelete: "cascade" }),
		ebayUserId: text("ebay_user_id"),
		ebayUserName: text("ebay_user_name"),
		accessToken: text("access_token").notNull(),
		accessTokenExpiresAt: timestamp("access_token_expires_at", { withTimezone: true }).notNull(),
		refreshToken: text("refresh_token").notNull(),
		refreshTokenExpiresAt: timestamp("refresh_token_expires_at", { withTimezone: true }),
		scopes: text("scopes").notNull(),
		/**
		 * Just-in-time consent record. The eBay-connect flow surfaces a
		 * disclosure (scopes, 18-month refresh token, disconnect-here-doesn't-
		 * revoke-at-eBay) before redirecting to eBay's authorize page. We
		 * persist the acknowledgement timestamp + version on the OAuth row
		 * so we have a per-binding audit trail distinct from the global
		 * Terms acceptance on the user table. Nullable for bindings created
		 * before the column existed.
		 */
		disclaimerAcceptedAt: timestamp("disclaimer_accepted_at", { withTimezone: true }),
		disclaimerVersion: text("disclaimer_version"),
		createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
		updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
	},
	(t) => ({
		apiKeyUnique: uniqueIndex("user_ebay_oauth_api_key_unique").on(t.apiKeyId),
	}),
);

/**
 * Reseller cost-side events — append-only log of what eBay's Finances
 * API doesn't know about: acquisition cost, forwarder fees, external
 * expenses (packaging, supplies, off-platform ad spend). All amounts
 * are positive magnitudes; kind disambiguates.
 *
 * Sales / refunds / eBay fees live in eBay's ledger — read via
 * `/v1/payouts` + `/v1/transactions`. A future `/v1/portfolio/pnl`
 * endpoint will join the two server-side for full P&L; for now
 * `/v1/expenses/summary` returns only the cost side.
 *
 * Scoped by `apiKeyId` — `summary` joins through `api_keys` to find
 * sibling keys belonging to the same owner (userId or ownerEmail) so
 * a user with multiple keys sees one expense ledger.
 *
 * `payload` carries free-form context: predictions on `purchased`
 * events (predictedNetCents, predictedDaysToSell) are stored for the
 * calibration loop, which will run once a P&L endpoint can pair them
 * with actual eBay sales.
 */
export const expenseEvents = pgTable(
	"expense_events",
	{
		id: bigint("id", { mode: "bigint" }).primaryKey().generatedAlwaysAsIdentity(),
		apiKeyId: uuid("api_key_id")
			.notNull()
			.references(() => apiKeys.id, { onDelete: "cascade" }),
		kind: expenseEventKindEnum("kind").notNull(),
		sku: text("sku").notNull(),
		marketplace: text("marketplace").notNull().default("ebay_us"),
		externalId: text("external_id"),
		amountCents: integer("amount_cents").notNull(),
		occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
		createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
		payload: jsonb("payload"),
	},
	(t) => ({
		apiKeyTimeIdx: index("expense_events_api_key_time_idx").on(t.apiKeyId, t.occurredAt),
		apiKeySkuIdx: index("expense_events_api_key_sku_idx").on(t.apiKeyId, t.sku),
	}),
);

/**
 * Raw inbound platform-notification log. Today: eBay Trading API platform
 * notifications (ItemSold / FixedPriceTransaction / OutBid / ItemUnsold /
 * AuctionCheckoutComplete) delivered to /v1/notifications/ebay/inbound.
 * Future: Amazon SQS, Mercari webhooks, etc. — same envelope.
 *
 * Resolution to api_key_id is best-effort via user_ebay_oauth.ebay_user_name
 * == RecipientUserID; nullable so unresolved deliveries still get logged
 * (we still want to see the raw event in case we need to backfill).
 *
 * dedupe_key is sha256(raw body) so eBay's at-least-once redelivery
 * doesn't double-write the ledger. Composite unique with marketplace.
 */
export const marketplaceNotifications = pgTable(
	"marketplace_notifications",
	{
		id: bigint("id", { mode: "bigint" }).primaryKey().generatedAlwaysAsIdentity(),
		apiKeyId: uuid("api_key_id").references(() => apiKeys.id, { onDelete: "set null" }),
		marketplace: text("marketplace").notNull().default("ebay_us"),
		eventType: text("event_type").notNull(),
		recipientUserId: text("recipient_user_id"),
		externalId: text("external_id"),
		signatureValid: boolean("signature_valid").notNull(),
		dedupeKey: text("dedupe_key").notNull(),
		payload: jsonb("payload").notNull(),
		receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
		processedAt: timestamp("processed_at", { withTimezone: true }),
		processError: text("process_error"),
	},
	(t) => ({
		dedupeUnique: uniqueIndex("marketplace_notifications_dedupe_unique").on(t.marketplace, t.dedupeKey),
		apiKeyTimeIdx: index("marketplace_notifications_api_key_time_idx").on(t.apiKeyId, t.receivedAt),
		eventIdx: index("marketplace_notifications_event_idx").on(t.marketplace, t.eventType, t.receivedAt),
	}),
);

/**
 * Bridge-job queue. One row per unit of work the bridge client (today:
 * the flipagent Chrome extension) executes inside the user's real
 * browser session. `source` discriminates the surface: `ebay` for
 * `/v1/purchases` buys, `planetexpress` for forwarder ops,
 * `browser` for `/v1/browser/*` DOM queries, `control` for extension-
 * reload jobs. Lifecycle: API queues a row → bridge client claims via
 * /v1/bridge/poll → executes → reports outcome via /v1/bridge/result.
 *
 * `status` is the public state machine; see bridgeJobStatusEnum. The
 * `awaiting_user_confirm` state lets the client stop at "Confirm and pay"
 * and only proceed after the user OK's it (default for v1 — no auto-confirm).
 *
 * `claimedByTokenId` records which bridge token claimed the job; `claimedAt`
 * starts the lease — if no result lands within `BRIDGE_LEASE_SECONDS` the
 * job becomes claimable again.
 *
 * Naming: when `source = 'ebay'` this row IS a purchase order, surfaced
 * via the `Purchase` shape from `/v1/purchases/*`. The linked column
 * on `buy_checkout_sessions` is still `purchase_order_id` (the link
 * is purchase-order-specific by context).
 */
export const bridgeJobs = pgTable(
	"bridge_jobs",
	{
		id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
		apiKeyId: uuid("api_key_id")
			.notNull()
			.references(() => apiKeys.id, { onDelete: "cascade" }),
		userId: text("user_id").references(() => user.id, { onDelete: "set null" }),
		source: text("source").notNull().default("ebay"),
		itemId: text("item_id").notNull(),
		quantity: integer("quantity").notNull().default(1),
		maxPriceCents: integer("max_price_cents"),
		status: bridgeJobStatusEnum("status").notNull().default("queued"),
		ebayOrderId: text("ebay_order_id"),
		totalCents: integer("total_cents"),
		receiptUrl: text("receipt_url"),
		failureReason: text("failure_reason"),
		metadata: jsonb("metadata"),
		/**
		 * Task-specific result payload reported by the bridge client (Chrome
		 * extension) on completion. For `ebay_buy_item`: receipt fields go on
		 * dedicated columns (ebayOrderId, totalCents, receiptUrl). For
		 * `pull_packages` (Planet Express): shape is `{ packages: [...] }`.
		 * Other tasks define their own shapes.
		 */
		result: jsonb("result"),
		idempotencyKey: text("idempotency_key"),
		expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
		claimedByTokenId: uuid("claimed_by_token_id"),
		claimedAt: timestamp("claimed_at", { withTimezone: true }),
		completedAt: timestamp("completed_at", { withTimezone: true }),
		createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
		updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
	},
	(t) => ({
		apiKeyIdx: index("bridge_jobs_api_key_idx").on(t.apiKeyId, t.createdAt),
		statusIdx: index("bridge_jobs_status_idx").on(t.status, t.expiresAt),
		idemUnique: uniqueIndex("bridge_jobs_idem_unique").on(t.apiKeyId, t.idempotencyKey),
	}),
);

/**
 * Buy Order checkout sessions — bridge-implementation backing for the
 * pre-place_order stage of `/v1/purchases` when EBAY_ORDER_APPROVED=0.
 *
 * eBay's Buy Order REST API has a 2-step flow: `initiate` creates a
 * session (no execution); `place_order` triggers the actual purchase.
 * In bridge mode we model that with this table — `initiate` writes a
 * row here, `place_order` creates a corresponding `bridge_jobs` row
 * (with `source='ebay'`) and links it via `purchaseOrderId`. Get-session
 * reads from here; get-purchase-order reads the bridge_jobs row and maps
 * to eBay's shape. The link column stays `purchase_order_id` because in
 * this context the row IS an eBay purchase order.
 *
 * Sessions auto-expire after 24h. Once placed, the session row stays
 * but `status='placed'` and the link points to the purchase order.
 */
export const buyCheckoutSessionStatusEnum = pgEnum("buy_checkout_session_status", ["created", "placed", "expired"]);

/**
 * Forwarder inventory — per-package lifecycle row that the bridge
 * reconciles into. One row per (api key, provider, packageId) so the
 * inbox refresh handler upserts cleanly. Status moves forward
 * monotonically (`received → photographed → listed → sold →
 * dispatched → shipped`) but the column reflects whichever signal
 * arrived last; out-of-order updates are tolerated.
 *
 * Created so the sold-event handler can find the packageId for a
 * sku without the agent threading the linkage by hand. The
 * `linkSku` flow (called after `flipagent_relist_listing`) populates
 * `sku` + `ebayOfferId`; the `item.sold` notification looks the
 * row up by sku and queues an outbound dispatch automatically.
 */
export const forwarderInventoryStatusEnum = pgEnum("forwarder_inventory_status", [
	"received",
	"photographed",
	"listed",
	"sold",
	"dispatched",
	"shipped",
]);

export const forwarderInventory = pgTable(
	"forwarder_inventory",
	{
		id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
		apiKeyId: uuid("api_key_id")
			.notNull()
			.references(() => apiKeys.id, { onDelete: "cascade" }),
		provider: text("provider").notNull(),
		packageId: text("package_id").notNull(),
		// Set by the agent after publishing a listing for this package.
		// Joined on by the sold-event handler.
		sku: text("sku"),
		ebayOfferId: text("ebay_offer_id"),
		// What brought this package to the forwarder. Populated when
		// known — agent sets it via /link, or future inbound-tracking
		// reconciliation matches by carrier-tracking.
		ebayInboundOrderId: text("ebay_inbound_order_id"),
		status: forwarderInventoryStatusEnum("status").notNull().default("received"),
		// Captured at intake by the forwarder.
		photos: jsonb("photos"),
		weightG: integer("weight_g"),
		dimsCm: jsonb("dims_cm"),
		inboundTracking: text("inbound_tracking"),
		// Outbound — set when dispatch completes.
		outboundShipmentId: text("outbound_shipment_id"),
		outboundCarrier: text("outbound_carrier"),
		outboundTracking: text("outbound_tracking"),
		outboundCostCents: integer("outbound_cost_cents"),
		outboundLabelUrl: text("outbound_label_url"),
		shippedAt: timestamp("shipped_at", { withTimezone: true }),
		createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
		updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
	},
	(t) => ({
		pkgUnique: uniqueIndex("forwarder_inventory_pkg_unique").on(t.apiKeyId, t.provider, t.packageId),
		apiKeyIdx: index("forwarder_inventory_api_key_idx").on(t.apiKeyId, t.createdAt),
	}),
);

export const buyCheckoutSessions = pgTable(
	"buy_checkout_sessions",
	{
		id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
		apiKeyId: uuid("api_key_id")
			.notNull()
			.references(() => apiKeys.id, { onDelete: "cascade" }),
		userId: text("user_id").references(() => user.id, { onDelete: "set null" }),
		// eBay-shape lineItems array — kept verbatim for re-emission on get session.
		lineItems: jsonb("line_items").notNull(),
		// Optional shipping/payment hints; preserved in REST passthrough mode,
		// ignored in bridge mode (extension uses the user's eBay defaults).
		shippingAddresses: jsonb("shipping_addresses"),
		paymentInstruments: jsonb("payment_instruments"),
		pricingSummary: jsonb("pricing_summary"),
		status: buyCheckoutSessionStatusEnum("status").notNull().default("created"),
		// When `place_order` is called, links to the bridge-queue row that
		// actually executes the buy.
		purchaseOrderId: uuid("purchase_order_id").references(() => bridgeJobs.id, {
			onDelete: "set null",
		}),
		createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
		expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
		placedAt: timestamp("placed_at", { withTimezone: true }),
	},
	(t) => ({
		apiKeyIdx: index("buy_checkout_sessions_api_key_idx").on(t.apiKeyId, t.createdAt),
		expiresIdx: index("buy_checkout_sessions_expires_idx").on(t.expiresAt),
	}),
);

/**
 * Long-lived credentials issued to a bridge client (today: the flipagent
 * Chrome extension; tomorrow possibly eBay's official Order API or a
 * native helper). Bound to an api key — when the api key is revoked the
 * bridge token cascades. Plaintext (`fbt_…`) is shown once at creation;
 * we persist sha256 only.
 */
export const bridgeTokens = pgTable(
	"bridge_tokens",
	{
		id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
		apiKeyId: uuid("api_key_id")
			.notNull()
			.references(() => apiKeys.id, { onDelete: "cascade" }),
		userId: text("user_id").references(() => user.id, { onDelete: "set null" }),
		tokenHash: text("token_hash").notNull(),
		tokenPrefix: text("token_prefix").notNull(),
		deviceName: text("device_name"),
		/**
		 * Browser eBay-login state, reported by the bridge extension via
		 * `chrome.cookies`. Distinct from `user_ebay_oauth` (server-side
		 * seller OAuth tokens). The same eBay account is usually behind
		 * both — but they're different access mechanisms (browser
		 * automation vs API call), so we track them separately.
		 *
		 * Column names kept for backwards compat with existing rows;
		 * JS properties renamed to drop the misleading "buyer" framing.
		 */
		ebayLoggedIn: boolean("buyer_logged_in").notNull().default(false),
		ebayUserName: text("buyer_ebay_user_name"),
		verifiedAt: timestamp("buyer_verified_at", { withTimezone: true }),
		/**
		 * Planet Express (US package forwarder) login state, reported by the
		 * extension's content script via URL probe on planetexpress.com.
		 * Mirrors the eBay buyer-state pattern: distinct from any future
		 * server-side OAuth (PE has no public API today), tracked here so
		 * `/v1/capabilities.checklist` can show real "done" status across
		 * all surfaces — popup, dashboard, MCP — instead of just popup.
		 */
		peLoggedIn: boolean("pe_logged_in").notNull().default(false),
		peVerifiedAt: timestamp("pe_verified_at", { withTimezone: true }),
		createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
		lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
		revokedAt: timestamp("revoked_at", { withTimezone: true }),
	},
	(t) => ({
		hashUnique: uniqueIndex("bridge_tokens_hash_unique").on(t.tokenHash),
		apiKeyIdx: index("bridge_tokens_api_key_idx").on(t.apiKeyId),
	}),
);

/**
 * Audit / rate-limit table for `POST /v1/bridge/capture`. Each row is one
 * captured eBay PDP pushed by the extension's content script. The actual
 * parsed payload lives in `proxy_response_cache` keyed on the same
 * itemId — this table tracks provenance + drives the per-api-key rate
 * limit (60 captures / 60s).
 *
 * Unique on (api_key_id, item_id) so the same user re-visiting the same
 * page doesn't multiply rows; we just bump `captured_at`.
 */
export const bridgeCaptures = pgTable(
	"bridge_captures",
	{
		id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
		apiKeyId: uuid("api_key_id")
			.notNull()
			.references(() => apiKeys.id, { onDelete: "cascade" }),
		itemId: text("item_id").notNull(),
		url: text("url").notNull(),
		capturedAt: timestamp("captured_at", { withTimezone: true }).notNull().defaultNow(),
	},
	(t) => ({
		apiKeyItemUnique: uniqueIndex("bridge_captures_api_key_item_unique").on(t.apiKeyId, t.itemId),
		capturedAtIdx: index("bridge_captures_captured_at_idx").on(t.capturedAt),
	}),
);

/**
 * Subscribed webhook endpoints. One row per (api_key, url). `secret` is the
 * shared HMAC-SHA256 key for delivery signing (Stripe-style header:
 * `Flipagent-Signature: t=…,v1=…`). Plaintext shown once at registration.
 */
export const webhookEndpoints = pgTable(
	"webhook_endpoints",
	{
		id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
		apiKeyId: uuid("api_key_id")
			.notNull()
			.references(() => apiKeys.id, { onDelete: "cascade" }),
		userId: text("user_id").references(() => user.id, { onDelete: "set null" }),
		url: text("url").notNull(),
		secret: text("secret").notNull(),
		events: text("events").array().notNull(),
		description: text("description"),
		createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
		lastDeliveryAt: timestamp("last_delivery_at", { withTimezone: true }),
		lastErrorAt: timestamp("last_error_at", { withTimezone: true }),
		revokedAt: timestamp("revoked_at", { withTimezone: true }),
	},
	(t) => ({
		apiKeyIdx: index("webhook_endpoints_api_key_idx").on(t.apiKeyId),
	}),
);

/**
 * Per-attempt log for webhook deliveries. Driven off purchase_orders status
 * transitions. Retried with exponential backoff up to a cap; `nextRetryAt`
 * is consulted by the dispatcher.
 */
export const webhookDeliveries = pgTable(
	"webhook_deliveries",
	{
		id: bigint("id", { mode: "bigint" }).primaryKey().generatedAlwaysAsIdentity(),
		endpointId: uuid("endpoint_id")
			.notNull()
			.references(() => webhookEndpoints.id, { onDelete: "cascade" }),
		eventType: text("event_type").notNull(),
		payload: jsonb("payload").notNull(),
		status: webhookDeliveryStatusEnum("status").notNull().default("pending"),
		attempt: integer("attempt").notNull().default(0),
		responseStatus: integer("response_status"),
		responseBody: text("response_body"),
		nextRetryAt: timestamp("next_retry_at", { withTimezone: true }),
		createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
		deliveredAt: timestamp("delivered_at", { withTimezone: true }),
	},
	(t) => ({
		endpointIdx: index("webhook_deliveries_endpoint_idx").on(t.endpointId, t.createdAt),
		nextRetryIdx: index("webhook_deliveries_next_retry_idx").on(t.status, t.nextRetryAt),
	}),
);

/**
 * Server-side compute job queue. Backs `/v1/evaluate/jobs/*` so a tab
 * close mid-run doesn't lose the result and the user can cancel
 * cooperatively. Distinct from `bridge_jobs`
 * (which targets the user's Chrome extension); these run inside a
 * dedicated worker container against eBay scrape + LLM filter, with
 * intermediate events accumulated in `events` so a /stream subscriber
 * can replay.
 *
 * Status machine:
 *   queued ─► running ─► completed | failed | cancelled
 *   queued ─► cancelled  (cancel called before worker picked up)
 *   running (lease expired) ─► queued | failed  (recovery sweep)
 *
 * Cancellation is cooperative — the worker checks `cancel_requested`
 * between steps and throws to the dispatcher, which transitions to
 * `cancelled`. Mid-step IO can't be aborted (eBay scrape, LLM call) but
 * step boundaries are tight enough (≤ a few s each) for UX purposes.
 *
 * Crash recovery: workers claim with a `lease_until` deadline and renew
 * via heartbeat. On crash, lease expires and a recovery sweep either
 * requeues (if `attempts < max`) or marks `failed` with code
 * `worker_lease_expired`. Step results land in `checkpoints` so a
 * requeued job resumes from the last completed step instead of
 * re-billing LLM/scrape calls.
 */
export const computeJobs = pgTable(
	"compute_jobs",
	{
		id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
		apiKeyId: uuid("api_key_id")
			.notNull()
			.references(() => apiKeys.id, { onDelete: "cascade" }),
		userId: text("user_id").references(() => user.id, { onDelete: "set null" }),
		kind: computeJobKindEnum("kind").notNull(),
		status: computeJobStatusEnum("status").notNull().default("queued"),
		/** Inputs (eBay item id, lookback, sample size, opts, …). Pipeline-specific shape. */
		params: jsonb("params").notNull(),
		/** Accumulated pipeline events (step lifecycle + partial state hydration) for SSE replay. Append-only across the run. */
		events: jsonb("events").notNull().default(sql`'[]'::jsonb`),
		/** Final pipeline output. Only set when status='completed'. */
		result: jsonb("result"),
		errorCode: text("error_code"),
		errorMessage: text("error_message"),
		/**
		 * Structured payload that the failing pipeline step attaches to
		 * its `EvaluateError` (`details` field). `variation_required` uses
		 * it to ship the enumerated `variations[]` so an agent client can
		 * pick a SKU and retry without a second round-trip. JSON-shaped;
		 * routes pass it through verbatim under a top-level `details` key.
		 */
		errorDetails: jsonb("error_details"),
		cancelRequested: boolean("cancel_requested").notNull().default(false),
		/**
		 * Lease deadline for the worker holding this job. NULL when not
		 * claimed (status='queued') or terminal. Worker heartbeats renew
		 * this to `now() + WORKER_LEASE_MS`; if it falls in the past while
		 * status='running', the recovery sweep releases the row.
		 */
		leaseUntil: timestamp("lease_until", { withTimezone: true }),
		/** Worker identifier of the current lease holder, e.g. `worker-<podId>-<pid>`. */
		claimedBy: text("claimed_by"),
		/** How many times the job has been claimed; incremented on each (re)claim. */
		attempts: integer("attempts").notNull().default(0),
		/**
		 * Step-keyed cache of intermediate results, written when each step
		 * completes. On retry, the dispatcher consults this map and skips
		 * any step whose hashed key is already present — protects against
		 * re-billing LLM/scrape calls when a job is requeued after lease
		 * expiry.
		 */
		checkpoints: jsonb("checkpoints").notNull().default(sql`'{}'::jsonb`),
		startedAt: timestamp("started_at", { withTimezone: true }),
		completedAt: timestamp("completed_at", { withTimezone: true }),
		createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
		updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
		expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
	},
	(t) => ({
		apiKeyIdx: index("compute_jobs_api_key_idx").on(t.apiKeyId, t.createdAt.desc()),
		statusIdx: index("compute_jobs_status_idx").on(t.status, t.startedAt),
		expiresIdx: index("compute_jobs_expires_idx").on(t.expiresAt),
		// Drives the worker's `claimNextJob` query: scan claimable rows
		// (status='queued' OR expired lease) in FIFO order.
		claimIdx: index("compute_jobs_claim_idx").on(t.status, t.leaseUntil, t.createdAt),
	}),
);

/**
 * Cross-user cache of the upstream digest assembled by the evaluate
 * pipeline (item detail + sold pool + active pool + same-product LLM
 * filter + market stats). Keyed on the **itemId-side** inputs only —
 * `(itemId, lookbackDays, soldLimit)` — never on user opts. Per-user
 * scoring (forwarder cost, minNet thresholds) runs on top and lands in
 * `compute_jobs.result` as a self-contained snapshot; this table is
 * the dedup/cache layer below it.
 *
 * Lifecycle: a compute_job that misses cache fetches upstream and
 * inserts here on success. Concurrent fetches lose the unique-index
 * race — one redundant fetch is cheaper than coordinating a lock. TTL
 * aligns with the sold-search transport cache (12h).
 *
 * Takedown: `/v1/takedown` approval deletes by `item_id`; subsequent
 * evaluate calls see a miss and the takedown blocklist short-circuits
 * before any re-fetch.
 */
export const marketDataCache = pgTable(
	"market_data_cache",
	{
		id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
		itemId: text("item_id").notNull(),
		lookbackDays: integer("lookback_days").notNull(),
		soldLimit: integer("sold_limit").notNull(),
		/** Assembled upstream digest. Shape: { item, soldPool, activePool, filter, returns, market, meta }. Pre-scoring. */
		digest: jsonb("digest").notNull(),
		/** compute_jobs row that originally produced this digest. Audit / debugging only — readers don't need it. */
		sourceJobId: uuid("source_job_id").references(() => computeJobs.id, { onDelete: "set null" }),
		createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
		expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
	},
	(t) => ({
		keyIdx: uniqueIndex("market_data_cache_key").on(t.itemId, t.lookbackDays, t.soldLimit),
		expiresIdx: index("market_data_cache_expires_idx").on(t.expiresAt),
	}),
);

/**
 * Append-only ledger of admin-granted credits. Each row adjusts the
 * caller's monthly credit budget by `creditsDelta` (positive = bonus,
 * negative = clawback) for as long as it's not revoked and not
 * expired. `snapshotUsage` sums the active rows and adds the total to
 * `TIER_LIMITS[tier].creditsPerMonth` — so a "give Acme 10k extra
 * credits this month" admin action is one INSERT with `expiresAt`
 * set to the next month boundary.
 *
 * Append-only by convention: revoke writes a `revokedAt` timestamp,
 * never deletes. `grantedByUserId` records which admin made the
 * call for audit. `reason` is required at the API boundary.
 */
export const creditGrants = pgTable(
	"credit_grants",
	{
		id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
		userId: text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		creditsDelta: integer("credits_delta").notNull(),
		reason: text("reason").notNull(),
		grantedByUserId: text("granted_by_user_id").references(() => user.id, { onDelete: "set null" }),
		expiresAt: timestamp("expires_at", { withTimezone: true }),
		revokedAt: timestamp("revoked_at", { withTimezone: true }),
		revokedByUserId: text("revoked_by_user_id").references(() => user.id, { onDelete: "set null" }),
		revokeReason: text("revoke_reason"),
		/**
		 * Carries the Stripe Checkout Session id when the grant comes from a
		 * credit-pack purchase. The webhook `INSERT ... ON CONFLICT DO
		 * NOTHING` against the partial unique index turns Stripe's
		 * at-least-once redelivery into a no-op. Null for admin-issued
		 * grants — those go through human review and don't need
		 * deduplication.
		 */
		idempotencyKey: text("idempotency_key"),
		createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
	},
	(t) => ({
		userIdx: index("credit_grants_user_idx").on(t.userId, t.createdAt),
		activeIdx: index("credit_grants_active_idx").on(t.userId, t.revokedAt, t.expiresAt),
	}),
);

export type ApiKey = typeof apiKeys.$inferSelect;
export type NewApiKey = typeof apiKeys.$inferInsert;
export type UsageEvent = typeof usageEvents.$inferSelect;
export type NewUsageEvent = typeof usageEvents.$inferInsert;
export type ListingCache = typeof listingsCache.$inferSelect;
export type NewListingCache = typeof listingsCache.$inferInsert;
export type PriceObservation = typeof priceHistory.$inferSelect;
export type NewPriceObservation = typeof priceHistory.$inferInsert;
export type ProxyCache = typeof proxyResponseCache.$inferSelect;
export type NewProxyCache = typeof proxyResponseCache.$inferInsert;
export type TakedownRequest = typeof takedownRequests.$inferSelect;
export type NewTakedownRequest = typeof takedownRequests.$inferInsert;
export type UserEbayOauth = typeof userEbayOauth.$inferSelect;
export type NewUserEbayOauth = typeof userEbayOauth.$inferInsert;
export type User = typeof user.$inferSelect;
export type NewUser = typeof user.$inferInsert;
export type Session = typeof session.$inferSelect;
export type NewSession = typeof session.$inferInsert;
export type Account = typeof account.$inferSelect;
export type NewAccount = typeof account.$inferInsert;
export type Verification = typeof verification.$inferSelect;
export type NewVerification = typeof verification.$inferInsert;
export type ExpenseEvent = typeof expenseEvents.$inferSelect;
export type NewExpenseEvent = typeof expenseEvents.$inferInsert;
export type MarketplaceNotification = typeof marketplaceNotifications.$inferSelect;
export type NewMarketplaceNotification = typeof marketplaceNotifications.$inferInsert;
export type BridgeJob = typeof bridgeJobs.$inferSelect;
export type NewBridgeJob = typeof bridgeJobs.$inferInsert;
export type ComputeJob = typeof computeJobs.$inferSelect;
export type NewComputeJob = typeof computeJobs.$inferInsert;
export type MarketDataCache = typeof marketDataCache.$inferSelect;
export type NewMarketDataCache = typeof marketDataCache.$inferInsert;
export type BuyCheckoutSession = typeof buyCheckoutSessions.$inferSelect;
export type NewBuyCheckoutSession = typeof buyCheckoutSessions.$inferInsert;
export type ForwarderInventory = typeof forwarderInventory.$inferSelect;
export type NewForwarderInventory = typeof forwarderInventory.$inferInsert;
export type BridgeToken = typeof bridgeTokens.$inferSelect;
export type NewBridgeToken = typeof bridgeTokens.$inferInsert;
export type WebhookEndpoint = typeof webhookEndpoints.$inferSelect;
export type NewWebhookEndpoint = typeof webhookEndpoints.$inferInsert;
export type WebhookDelivery = typeof webhookDeliveries.$inferSelect;
export type NewWebhookDelivery = typeof webhookDeliveries.$inferInsert;
export type ListingObservation = typeof listingObservations.$inferSelect;
export type NewListingObservation = typeof listingObservations.$inferInsert;
export type CategoryCalibration = typeof categoryCalibration.$inferSelect;
export type NewCategoryCalibration = typeof categoryCalibration.$inferInsert;
export type QueryPulse = typeof queryPulse.$inferSelect;
export type NewQueryPulse = typeof queryPulse.$inferInsert;
export type MatchDecision = typeof matchDecisions.$inferSelect;
export type NewMatchDecision = typeof matchDecisions.$inferInsert;
export type MatchHistory = typeof matchHistory.$inferSelect;
export type NewMatchHistory = typeof matchHistory.$inferInsert;
export type ProductObservation = typeof productObservations.$inferSelect;
export type NewProductObservation = typeof productObservations.$inferInsert;
export type CategorySnapshot = typeof categorySnapshots.$inferSelect;
export type NewCategorySnapshot = typeof categorySnapshots.$inferInsert;
export type CreditGrant = typeof creditGrants.$inferSelect;
export type NewCreditGrant = typeof creditGrants.$inferInsert;

/**
 * Agent (preview) — chat-style sessions multi-provider via the Vercel
 * AI SDK (OpenAI / Anthropic / Google). The full conversation history
 * lives in `messages` (JSONB array of `ModelMessage`); none of the three
 * providers expose a stateful thread API, so we send the full array on
 * every turn. Sessions are scoped per api_key so a user's agent thread
 * doesn't leak across keys. `title` is either user-set or derived from
 * the first user message (first ~60 chars).
 */
export const agentSessions = pgTable(
	"agent_sessions",
	{
		id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
		apiKeyId: uuid("api_key_id")
			.notNull()
			.references(() => apiKeys.id, { onDelete: "cascade" }),
		userId: text("user_id").references(() => user.id, { onDelete: "set null" }),
		/**
		 * Full conversation history as Vercel AI SDK `UIMessage[]`. Preserves
		 * text, tool-call, tool-result, and reasoning parts in one structure.
		 * Replaces the prior OpenAI-Responses-API-only `previous_response_id`
		 * chain so the agent runs against any provider (OpenAI / Anthropic /
		 * Gemini) — neither Anthropic nor Gemini exposes a server-held thread
		 * equivalent, so we hold history locally for all providers and pass
		 * the full array on every turn. Each turn appends user + assistant
		 * messages.
		 */
		messages: jsonb("messages").notNull().default(sql`'[]'::jsonb`),
		title: text("title"),
		/** Set when the user pins/favorites the thread. List queries sort
		 *  pinned threads above unpinned ones (pinnedAt desc, then
		 *  lastActiveAt desc). Null = not pinned. */
		pinnedAt: timestamp("pinned_at", { withTimezone: true }),
		createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
		lastActiveAt: timestamp("last_active_at", { withTimezone: true }).notNull().defaultNow(),
	},
	(t) => ({
		apiKeyIdx: index("agent_sessions_api_key_idx").on(t.apiKeyId, t.lastActiveAt),
	}),
);

/**
 * Agent rules / preferences / notes. Kept small (10–50 rows / api key)
 * and stuffed into the system instructions on every chat turn. NOT a
 * vector memory: this is structured user-stated guidance the agent
 * must follow. Domain facts (sales, listings, inventory) come from the
 * normal `/v1/*` query surface, not here.
 *
 * `kind` is free-form text ('rule' | 'preference' | 'note' today; we
 * may grow it). Routes validate the enum at the boundary so the column
 * stays portable across migrations.
 */
export const agentRules = pgTable(
	"agent_rules",
	{
		id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
		apiKeyId: uuid("api_key_id")
			.notNull()
			.references(() => apiKeys.id, { onDelete: "cascade" }),
		userId: text("user_id").references(() => user.id, { onDelete: "set null" }),
		kind: text("kind").notNull(),
		content: text("content").notNull(),
		createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
	},
	(t) => ({
		apiKeyIdx: index("agent_rules_api_key_idx").on(t.apiKeyId, t.createdAt),
	}),
);

/**
 * One row per agent execution. Powers the "Activity feed" UI and the
 * usage / cost panel. `triggerKind` is 'chat' today; 'cron' / 'webhook'
 * land later when we wire scheduled + event-driven runs (no enum so
 * adding kinds is migration-free). `costCents` is rounded; pair it with
 * (`tokensIn`, `tokensOut`, `model`) when sub-cent precision matters.
 */
export const agentRuns = pgTable(
	"agent_runs",
	{
		id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
		apiKeyId: uuid("api_key_id")
			.notNull()
			.references(() => apiKeys.id, { onDelete: "cascade" }),
		userId: text("user_id").references(() => user.id, { onDelete: "set null" }),
		sessionId: uuid("session_id").references(() => agentSessions.id, { onDelete: "set null" }),
		triggerKind: text("trigger_kind").notNull().default("chat"),
		model: text("model"),
		userMessage: text("user_message"),
		reply: text("reply"),
		tokensIn: integer("tokens_in").notNull().default(0),
		tokensOut: integer("tokens_out").notNull().default(0),
		costCents: integer("cost_cents").notNull().default(0),
		errorMessage: text("error_message"),
		/**
		 * MCP Apps UI resource hint for inline rendering. When the tool
		 * call attached `_meta.ui.resourceUri`, we capture it here along
		 * with the structured content. Frontend chat renderer keys off
		 * `uiResourceUri` to mount an `<iframe>` (via @mcp-ui/client's
		 * UIResourceRenderer) instead of plain markdown text. Null for
		 * runs that produced only text or no tool call.
		 */
		uiResourceUri: text("ui_resource_uri"),
		uiProps: jsonb("ui_props"),
		startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
		finishedAt: timestamp("finished_at", { withTimezone: true }),
	},
	(t) => ({
		apiKeyTimeIdx: index("agent_runs_api_key_time_idx").on(t.apiKeyId, t.startedAt),
		sessionIdx: index("agent_runs_session_idx").on(t.sessionId, t.startedAt),
	}),
);

export type AgentSessionRow = typeof agentSessions.$inferSelect;
export type NewAgentSession = typeof agentSessions.$inferInsert;
export type AgentRuleRow = typeof agentRules.$inferSelect;
export type NewAgentRule = typeof agentRules.$inferInsert;
export type AgentRunRow = typeof agentRuns.$inferSelect;
export type NewAgentRun = typeof agentRuns.$inferInsert;
