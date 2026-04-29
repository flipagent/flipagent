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

export const tierEnum = pgEnum("api_key_tier", ["free", "hobby", "pro", "business"]);
export const takedownStatusEnum = pgEnum("takedown_status", ["pending", "approved", "rejected"]);
/**
 * Ledger events flipagent records itself. `purchased` / `forwarder_fee` /
 * `expense` are cost-side. `sold` is revenue-side, written when an eBay
 * Trading Notification (ItemSold / FixedPriceTransaction / etc.) lands —
 * closes the P&L loop without polling eBay Finances.
 */
export const expenseEventKindEnum = pgEnum("expense_event_kind", ["purchased", "forwarder_fee", "expense", "sold"]);
export const purchaseOrderStatusEnum = pgEnum("purchase_order_status", [
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
	stripeCustomerId: text("stripe_customer_id"),
	stripeSubscriptionId: text("stripe_subscription_id"),
	subscriptionStatus: text("subscription_status"),
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
		createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
	},
	(t) => ({
		keyTimeIdx: index("usage_events_key_created_idx").on(t.apiKeyId, t.createdAt),
		userTimeIdx: index("usage_events_user_created_idx").on(t.userId, t.createdAt),
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
 * Cached eBay-compat proxy responses. Distinct from `listingsCache`
 * (the per-listing structured cache) — this stores the full envelope that
 * a `/buy/browse/v1/*` endpoint returned, so a repeat call within TTL can
 * be served verbatim. Key by (path, queryHash).
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
 * Per-listing time-to-sell cache. Sold-search returns itemId + soldAt
 * but not the listing's start date — that lives only on the listing
 * detail page (Browse `itemCreationDate` / our scraper's SEMANTIC_DATA
 * extraction). This table caches the duration so that subsequent
 * `summarizeMarket` calls for the same SKU can populate
 * `meanDaysToSell` without re-scraping.
 *
 * Population is best-effort + lazy: detail fetches for cache-miss
 * itemIds populate rows here as they complete. Repeat calls then see
 * filled cache.
 *
 * `fetchAttempts` lets the worker stop retrying after N failures
 * (typically 3) — some itemIds get permanently soft-blocked by eBay.
 */
export const listingDurations = pgTable(
	"listing_durations",
	{
		itemId: text("item_id").primaryKey(),
		listedAt: timestamp("listed_at", { withTimezone: true }),
		soldAt: timestamp("sold_at", { withTimezone: true }),
		/** soldAt − listedAt in days. Null until both timestamps captured. */
		durationDays: integer("duration_days_x100"),
		fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull().defaultNow(),
		fetchAttempts: integer("fetch_attempts").notNull().default(0),
		fetchFailed: boolean("fetch_failed").notNull().default(false),
	},
	(t) => ({
		fetchedAtIdx: index("listing_durations_fetched_at_idx").on(t.fetchedAt),
	}),
);

/**
 * Operator opt-out requests for the eBay-compat proxy. ToS hygiene.
 * Sellers (or anyone else) can ask us to stop serving cached / scraped
 * data for a specific itemId. Status starts pending; manual review
 * promotes to approved (cache flushed, blocklisted) or rejected.
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
	},
	(t) => ({
		itemIdx: index("takedown_item_idx").on(t.itemId),
		statusIdx: index("takedown_status_idx").on(t.status),
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
 * Sales / refunds / eBay fees live in eBay's ledger — read via the
 * existing `/v1/finance/*` mirror. A future `/v1/portfolio/pnl`
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
		marketplace: text("marketplace").notNull().default("ebay"),
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
 * Buy-side orders that a bridge client (today: the flipagent Chrome
 * extension) executes against eBay on the user's behalf. Lifecycle:
 * API queues a row → bridge client claims via /v1/bridge/poll → drives
 * the buy flow inside the user's real eBay session → reports outcome
 * via /v1/bridge/result.
 *
 * `status` is the public state machine; see purchaseOrderStatusEnum. The
 * `awaiting_user_confirm` state lets the client stop at "Confirm and pay"
 * and only proceed after the user OK's it (default for v1 — no auto-confirm).
 *
 * `claimedByTokenId` records which bridge token claimed the job; `claimedAt`
 * starts the lease — if no result lands within `BRIDGE_LEASE_SECONDS` the
 * job becomes claimable again.
 */
export const purchaseOrders = pgTable(
	"purchase_orders",
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
		status: purchaseOrderStatusEnum("status").notNull().default("queued"),
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
		apiKeyIdx: index("purchase_orders_api_key_idx").on(t.apiKeyId, t.createdAt),
		statusIdx: index("purchase_orders_status_idx").on(t.status, t.expiresAt),
		idemUnique: uniqueIndex("purchase_orders_idem_unique").on(t.apiKeyId, t.idempotencyKey),
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
export type ListingDuration = typeof listingDurations.$inferSelect;
export type NewListingDuration = typeof listingDurations.$inferInsert;
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
export type PurchaseOrder = typeof purchaseOrders.$inferSelect;
export type NewPurchaseOrder = typeof purchaseOrders.$inferInsert;
export type BridgeToken = typeof bridgeTokens.$inferSelect;
export type NewBridgeToken = typeof bridgeTokens.$inferInsert;
export type WebhookEndpoint = typeof webhookEndpoints.$inferSelect;
export type NewWebhookEndpoint = typeof webhookEndpoints.$inferInsert;
export type WebhookDelivery = typeof webhookDeliveries.$inferSelect;
export type NewWebhookDelivery = typeof webhookDeliveries.$inferInsert;
