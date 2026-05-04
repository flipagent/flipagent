/**
 * Per-tier credit budget + burst rate limits + transport-aware pricing.
 *
 * One unit, credits, covers every metered endpoint. Each call charges a
 * fixed number of credits depending on what runs on our infrastructure:
 *
 *   /v1/evaluate                = 50 (composite — multi-scrape + LLM)
 *   /v1/{items,products,categories,trends}
 *      via source=scrape        = 2  (Oxylabs $/req)
 *      via source=rest          = 1  (eBay REST roundtrip)
 *      via source=bridge        = 0  (runs in user's own browser)
 *      via source=trading       = 0  (eBay Trading XML — passthrough)
 *      cache hit (fromCache)    = same as source — caches amortise across
 *                                 callers; per-call charge reflects what
 *                                 the data was worth to fetch
 *   sell-side / forwarder /
 *   ship / bridge / browser /
 *   purchases / messages / etc. = 0  (passthrough — burst-only)
 *
 * Pricing page + dashboard + SDK all read from the **same** catalog
 * exported here. Drift between displayed and enforced pricing is a
 * support nightmare; never let those copies diverge.
 *
 * Burst limits (per-min, per-hour) are checked against raw call counts —
 * abuse protection, not pricing. Apply equally to 0-credit endpoints.
 *
 * Reads SUM `usage_events.credits_charged` — a plain integer column
 * written at request time, replacing the legacy SQL CASE expression.
 * Free-tier aggregation filters by `tier='free'` so a user who upgrades
 * to hobby and back doesn't get a fresh 500-credit lifetime window.
 */

import { and, eq, gt, gte, isNull, or, sql } from "drizzle-orm";
import { db } from "../db/client.js";
import { apiKeys, creditGrants, usageEvents, user } from "../db/schema.js";
import type { Tier } from "./keys.js";

export interface TierLimits {
	/** Credit budget. For monthly tiers (paid), this resets on the 1st UTC. */
	credits: number;
	/**
	 * True for tiers whose budget is granted **once, lifetime** (Free). usage
	 * is summed across all events ever — no monthly window — and `resetAt`
	 * surfaces as null. False for paid tiers, where credits refill monthly.
	 */
	oneTime: boolean;
	/** Burst caps — abuse protection on raw call rate. */
	burstPerMin: number;
	burstPerHour: number;
}

/**
 * Source of truth for tier credit budgets. Pricing page and rate-limits
 * docs render their own copies for display; never let those drift from
 * what's enforced here.
 *
 * Free is intentionally lifetime, not monthly — the goal is "real trial,
 * upgrade when you outgrow it" rather than "small monthly stipend forever".
 */
export const TIER_LIMITS: Record<Tier, TierLimits> = {
	free: { credits: 500, oneTime: true, burstPerMin: 30, burstPerHour: 200 },
	hobby: { credits: 3_000, oneTime: false, burstPerMin: 30, burstPerHour: 1_200 },
	standard: { credits: 100_000, oneTime: false, burstPerMin: 120, burstPerHour: 6_000 },
	growth: { credits: 500_000, oneTime: false, burstPerMin: 600, burstPerHour: 25_000 },
};

/**
 * Tier-aware per-credit pricing for one-time top-ups (manual packs +
 * auto-recharge). Higher tiers get a lower per-credit rate — same
 * principle as committed-use discounts on cloud platforms. Free tier
 * isn't listed because top-ups require a card on file (which only
 * arrives via subscription); the route layer 403s a free caller before
 * looking up a rate.
 *
 * Reference points (so the structure stays defensible):
 *   Hobby    $19 / 3k   = $0.00633/credit subscribed
 *   Standard $99 / 100k = $0.00099/credit subscribed
 *   Growth   $399 / 500k = $0.00080/credit subscribed
 * Top-up rates sit *above* the subscribed rate (sustained use should
 * upgrade tier, not stack packs) but cheaper than committing to the
 * next tier for one busy month.
 *
 * Stripe charges using `price_data` constructed at checkout time —
 * no pre-created Stripe Price SKUs to manage, no env vars, one source
 * of truth here.
 */
export const PER_CREDIT_USD: Record<Extract<Tier, "hobby" | "standard" | "growth">, number> = {
	hobby: 0.003,
	standard: 0.002,
	growth: 0.0015,
};

/**
 * Selectable top-up amounts. Used by the price-quote endpoint and as
 * the closed set of valid `auto_recharge_topup` column values.
 *
 * Capped at 100k because beyond that, a tier upgrade is almost always
 * the right answer; we don't want to encourage indefinite top-up
 * stacking that would otherwise mask a real tier-fit problem.
 */
export const PACK_DENOMINATIONS: ReadonlyArray<number> = [5_000, 25_000, 100_000];

/**
 * Default top-up amount per paid tier — what auto-recharge fires
 * when triggered. Picked to feel "natural" relative to the tier's
 * monthly base allotment: small bump for Hobby, standard size for
 * Standard, large size for Growth. The dashboard doesn't expose a
 * per-user picker — keeps the auto-recharge UI to a single threshold
 * input. Operators can override by writing `auto_recharge_topup`
 * directly if a customer needs something else.
 */
const DEFAULT_TOP_UP_CREDITS: Record<Extract<Tier, "hobby" | "standard" | "growth">, number> = {
	hobby: 5_000,
	standard: 25_000,
	growth: 100_000,
};

/** Tier's default auto-recharge top-up amount. Throws on free — the
 *  route layer must gate before calling this. */
export function defaultTopUpForTier(tier: Tier): number {
	if (tier === "free") {
		throw new Error("Free tier has no top-up default — gate before calling.");
	}
	return DEFAULT_TOP_UP_CREDITS[tier];
}

/**
 * Threshold + topup bounds for auto-recharge. The dashboard form
 * enforces these and the route layer revalidates. Threshold lives in
 * credits (not %) so a Standard user with 100k cap and a Hobby user
 * with 3k cap both reason in the same units the rest of the API
 * exposes.
 */
export const AUTO_RECHARGE_MIN_THRESHOLD = 100;
export const AUTO_RECHARGE_MAX_THRESHOLD = 50_000;
/**
 * Cooldown between auto-recharge fires for the same user. Stops a
 * flood of concurrent calls all triggering top-up between the moment
 * the threshold is crossed and the moment the new credits hit
 * credit_grants.
 */
export const AUTO_RECHARGE_COOLDOWN_MS = 60_000;

/** Per-tier top-up unit price. Throws on `free` — callers must gate first. */
export function pricePerCreditUsd(tier: Tier): number {
	if (tier === "free") {
		throw new Error("Free tier has no top-up pricing — upgrade to a paid tier first.");
	}
	return PER_CREDIT_USD[tier];
}

/** Whole-cents amount Stripe will charge for `credits` at the user's tier. */
export function topUpPriceCents(tier: Tier, credits: number): number {
	return Math.round(credits * pricePerCreditUsd(tier) * 100);
}

/**
 * Validate a credits amount against the catalog. Returns the canonical
 * value when valid, throws when not — used by both manual checkout
 * and auto-recharge config persistence so the menu stays a closed set.
 */
export function ensureValidCreditAmount(credits: number): number {
	if (!Number.isInteger(credits)) throw new Error("credits must be an integer");
	if (!PACK_DENOMINATIONS.includes(credits)) {
		throw new Error(`credits must be one of ${PACK_DENOMINATIONS.join(", ")}`);
	}
	return credits;
}

/**
 * `subscription_status='past_due'` to effective-tier-downgrade window.
 * Stripe's default dunning runs ~3 weeks before firing
 * `customer.subscription.deleted`; without this we'd serve paid-tier
 * capacity for the full window to a card that's already been failing.
 *
 * Seven days is the median customer-resolution window: long enough for
 * a real "card got reissued, will update soon" customer to keep working,
 * short enough that a stale card doesn't get free Standard for a month.
 */
export const PAST_DUE_GRACE_DAYS = 7;

/** Internal tier discriminant — same as `Tier` but explicit for readability. */
type EffectiveTierInput = {
	tier: Tier;
	subscriptionStatus: string | null;
	pastDueSince: Date | null;
};

/**
 * Tier the rate-limit middleware enforces against. Equal to `user.tier`
 * 99% of the time; downgrades to `free` only when the subscription has
 * been continuously past_due for `PAST_DUE_GRACE_DAYS`. The user row
 * itself stays truthful so billing UI / admin views don't lie — only
 * the enforcement *view* shifts.
 */
export function effectiveTier(input: EffectiveTierInput, now: Date = new Date()): Tier {
	if (input.tier === "free") return "free";
	if (input.subscriptionStatus !== "past_due") return input.tier;
	if (!input.pastDueSince) return input.tier;
	const ageMs = now.getTime() - input.pastDueSince.getTime();
	const graceMs = PAST_DUE_GRACE_DAYS * 24 * 60 * 60 * 1000;
	return ageMs > graceMs ? "free" : input.tier;
}

/**
 * One-shot DB lookup that resolves the effective tier for a userId.
 * Returns `fallbackTier` when the userId is null (legacy api-keys not
 * bound to a user) or when the row can't be found. Shared between the
 * api-key middleware and the session-auth /v1/me, /v1/keys routes so
 * dashboard + agent both see the same enforcement view.
 */
export async function effectiveTierForUser(userId: string | null, fallbackTier: Tier): Promise<Tier> {
	if (!userId) return fallbackTier;
	const [row] = await db
		.select({
			tier: user.tier,
			subscriptionStatus: user.subscriptionStatus,
			pastDueSince: user.pastDueSince,
		})
		.from(user)
		.where(eq(user.id, userId))
		.limit(1);
	if (!row) return fallbackTier;
	return effectiveTier({
		tier: row.tier as Tier,
		subscriptionStatus: row.subscriptionStatus,
		pastDueSince: row.pastDueSince,
	});
}

/** Possible upstream/origin kinds recorded on a usage_events row. */
export type SourceKindForBilling = "rest" | "scrape" | "bridge" | "trading" | "llm" | null;

/**
 * Worst-case credits for a given path. Used by the pre-charge gate —
 * we don't know the resolved transport at request entry, so we charge
 * the upper bound on entry and surface the actual `credits_charged`
 * after the response. Prevents a 30-credit-remaining caller from
 * stealth-executing a 50-credit evaluate.
 */
export function worstCaseCreditsForEndpoint(endpoint: string): number {
	if (endpoint.startsWith("/v1/evaluate/featured")) return 0;
	if (endpoint.startsWith("/v1/evaluate/scopes")) return 0;
	// Job polling: GET `/v1/evaluate/jobs/<id>` and `/v1/evaluate/<id>/pool`
	// are cache reads off `compute_jobs` — no LLM, no scrape, just a row
	// fetch. Charging the same as the original evaluate (50¢) double-bills
	// every legitimate poll. Stay free for read paths; the create POST
	// (`/v1/evaluate/jobs`, no trailing slash) still hits the 50 below.
	if (endpoint.startsWith("/v1/evaluate/jobs/")) return 0;
	if (endpoint.includes("/pool")) return 0;
	if (endpoint.startsWith("/v1/evaluate")) return 50;
	// Items/products/categories/trends top out at scrape (2c).
	if (endpoint.startsWith("/v1/items")) return 2;
	if (endpoint.startsWith("/v1/products")) return 2;
	if (endpoint.startsWith("/v1/categories")) return 2;
	if (endpoint.startsWith("/v1/trends")) return 2;
	return 0;
}

/**
 * Credits to charge for a completed call, given its resolved transport.
 * Cache hits charge the same as the underlying source — caches amortise
 * across callers, but each user receives the full data so the per-call
 * cost reflects the work that data took to fetch.
 *
 * Called at `recordUsage` time (post-handler) so `source` is known. Pre-
 * flight, callers use `worstCaseCreditsForEndpoint` instead.
 */
export function creditsForCall(args: { endpoint: string; source: SourceKindForBilling }): number {
	const { endpoint, source } = args;
	if (endpoint.startsWith("/v1/evaluate/featured")) return 0;
	if (endpoint.startsWith("/v1/evaluate/scopes")) return 0;
	// Same exemptions as `worstCaseCreditsForEndpoint`: polling + pool
	// drill-down are reads, not new compute.
	if (endpoint.startsWith("/v1/evaluate/jobs/")) return 0;
	if (endpoint.includes("/pool")) return 0;
	if (endpoint.startsWith("/v1/evaluate")) return 50;
	if (
		endpoint.startsWith("/v1/items") ||
		endpoint.startsWith("/v1/products") ||
		endpoint.startsWith("/v1/categories") ||
		endpoint.startsWith("/v1/trends")
	) {
		switch (source) {
			case "scrape":
				return 2;
			case "rest":
			case "llm":
				return 1;
			case "bridge":
			case "trading":
				return 0;
			default:
				// Unknown / not surfaced. Charge the conservative middle
				// (1c) so we don't accidentally give scrape away free if a
				// future route forgets to set source.
				return 1;
		}
	}
	return 0;
}

export interface UsageSnapshot {
	creditsUsed: number;
	creditsLimit: number;
	creditsRemaining: number;
	overLimit: boolean;
	/**
	 * Sum of active (`revoked_at IS NULL` and unexpired) grants for the
	 * user, in credits. Already added to `creditsLimit`; surfaced
	 * separately so the dashboard can render a "+N admin bonus" hint.
	 * 0 when the caller has no active grants (or no userId scope).
	 */
	bonusCredits: number;
	/** ISO timestamp of the next refill, or null for lifetime (Free) tiers. */
	resetAt: string | null;
	/**
	 * Tier used for limit math. Equal to `user.tier` except when the user
	 * is past_due-grace-expired; then this is `'free'` while `user.tier`
	 * keeps its real value.
	 */
	effectiveTier: Tier;
}

/**
 * Sum of active credit grants for `userId`. A grant is active when
 * `revoked_at IS NULL` AND (`expires_at IS NULL` OR `expires_at > now()`).
 * Both positive (bonus) and negative (clawback) grants are summed —
 * the result is the net adjustment to the tier credit budget.
 */
export async function sumActiveCreditGrants(userId: string): Promise<number> {
	const [row] = await db
		.select({ total: sql<number>`cast(coalesce(sum(${creditGrants.creditsDelta}), 0) as int)` })
		.from(creditGrants)
		.where(
			and(
				eq(creditGrants.userId, userId),
				isNull(creditGrants.revokedAt),
				or(isNull(creditGrants.expiresAt), gt(creditGrants.expiresAt, sql`now()`)),
			),
		);
	return row?.total ?? 0;
}

function nextMonthBoundary(): Date {
	const now = new Date();
	return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
}

/**
 * Resolve the credit-counting epoch — the timestamp from which usage
 * events start counting against the current tier's budget. For session/
 * keys-bound users we read `user.creditsResetAt` (set on signup, bumped
 * by the Stripe webhook on tier-up transitions only — downgrade-to-free
 * does NOT bump, since free is now tier-filtered and any prior free
 * usage stays counted regardless). For legacy api-key-only callers (no
 * userId) we fall back to the key's own `createdAt`. Falls back to the
 * unix epoch when no row resolves.
 */
async function resolveCreditsResetAt(scope: { apiKeyId: string; userId: string | null }): Promise<Date> {
	if (scope.userId) {
		const [row] = await db
			.select({ resetAt: user.creditsResetAt })
			.from(user)
			.where(eq(user.id, scope.userId))
			.limit(1);
		if (row?.resetAt) return row.resetAt;
	}
	if (scope.apiKeyId) {
		const [row] = await db
			.select({ createdAt: apiKeys.createdAt })
			.from(apiKeys)
			.where(eq(apiKeys.id, scope.apiKeyId))
			.limit(1);
		if (row?.createdAt) return row.createdAt;
	}
	return new Date(0);
}

/**
 * Credit usage snapshot. Aggregates across **all keys belonging to the
 * same user** when `userId` is provided — multiple named keys share one
 * budget. Falls back to per-key counting for legacy keys with no userId.
 *
 * Counting window depends on the (effective) tier:
 *   - Free (oneTime) → events from `user.creditsResetAt` onwards,
 *                       FILTERED to `tier='free'` rows. The tier filter
 *                       is what kills the free→hobby→free cycle abuse:
 *                       prior free usage stays counted regardless of
 *                       intervening upgrade/downgrade cycles.
 *   - Paid (monthly) → events from `max(creditsResetAt, monthStart)` —
 *                       monthly refill, but never count events from a
 *                       prior tier (a mid-month upgrade only counts
 *                       post-upgrade events against the new tier's cap).
 *
 * `creditsLimit` already folds in active credit_grants (positive bonus
 * or negative clawback); `bonusCredits` surfaces the same total
 * separately so dashboards can render "+N admin bonus" without
 * recomputing.
 *
 * `tier` is the **effective** tier for enforcement — caller passes the
 * output of `effectiveTier(user)`, which may be lower than `user.tier`
 * during past-due grace expiry.
 */
export async function snapshotUsage(
	scope: { apiKeyId: string; userId: string | null },
	tier: Tier,
): Promise<UsageSnapshot> {
	const cfg = TIER_LIMITS[tier];
	const ownerFilter = scope.userId ? eq(usageEvents.userId, scope.userId) : eq(usageEvents.apiKeyId, scope.apiKeyId);

	// `floor` is the earliest createdAt we count. Free uses the bare epoch;
	// paid tiers take whichever is later between the tier-change epoch and
	// the start of the current calendar month — so a mid-month upgrade
	// doesn't sweep up the user's pre-upgrade Free events into the new
	// tier's monthly budget.
	const epoch = await resolveCreditsResetAt(scope);
	const now = new Date();
	const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
	const floor = cfg.oneTime ? epoch : epoch > monthStart ? epoch : monthStart;

	// Free filters to tier='free' rows so a user who briefly subscribed
	// to a paid tier and downgraded back doesn't reset their lifetime
	// counter. Paid tiers don't filter by tier — the floor (which jumps
	// forward on upgrade) already bounds prior-tier usage out.
	const tierFilter = cfg.oneTime ? eq(usageEvents.tier, "free") : undefined;

	const [usageRow, bonus] = await Promise.all([
		db
			.select({ credits: sql<number>`cast(coalesce(sum(${usageEvents.creditsCharged}), 0) as int)` })
			.from(usageEvents)
			.where(and(ownerFilter, gte(usageEvents.createdAt, floor), tierFilter))
			.then((rows) => rows[0]),
		scope.userId ? sumActiveCreditGrants(scope.userId) : Promise.resolve(0),
	]);
	const used = usageRow?.credits ?? 0;
	const limit = Math.max(0, cfg.credits + bonus);
	return {
		creditsUsed: used,
		creditsLimit: limit,
		creditsRemaining: Math.max(0, limit - used),
		overLimit: used >= limit,
		bonusCredits: bonus,
		resetAt: cfg.oneTime ? null : nextMonthBoundary().toISOString(),
		effectiveTier: tier,
	};
}

/**
 * Burst usage over a sliding window. Counts raw events (not credits) —
 * the goal is abuse protection, not pricing. A flood of cheap search
 * calls can still DOS the upstream just like a flood of expensive ones.
 *
 * Excludes transient infra failures (5xx, 429): when our upstream falls
 * over or eBay rate-limits our app credential, the caller did nothing
 * wrong; counting those toward the caller's burst would lock them out
 * of legitimate retries during an outage that's our (or eBay's) fault.
 * 4xx caller-error responses (401/404/etc.) DO count — those represent
 * real upstream calls the caller initiated, even if the input was bad.
 */
export async function snapshotBurst(
	scope: { apiKeyId: string; userId: string | null },
	tier: Tier,
): Promise<{ perMinute: number; perHour: number; minuteOver: boolean; hourOver: boolean }> {
	const limits = TIER_LIMITS[tier];
	const filter = scope.userId ? eq(usageEvents.userId, scope.userId) : eq(usageEvents.apiKeyId, scope.apiKeyId);
	const transientExcluded = sql`(${usageEvents.statusCode} < 500 AND ${usageEvents.statusCode} <> 429)`;
	const [row] = await db
		.select({
			minute: sql<number>`cast(count(*) filter (where ${usageEvents.createdAt} >= now() - interval '1 minute') as int)`,
			hour: sql<number>`cast(count(*) filter (where ${usageEvents.createdAt} >= now() - interval '1 hour') as int)`,
		})
		.from(usageEvents)
		.where(and(filter, gte(usageEvents.createdAt, sql`now() - interval '1 hour'`), transientExcluded));
	const perMinute = row?.minute ?? 0;
	const perHour = row?.hour ?? 0;
	return {
		perMinute,
		perHour,
		minuteOver: perMinute >= limits.burstPerMin,
		hourOver: perHour >= limits.burstPerHour,
	};
}

/**
 * Shape an internal `UsageSnapshot` for the wire (`/v1/me`,
 * `/v1/keys/me`). Just JSON-safes the numeric fields; resetAt passes
 * through unchanged.
 */
export function usageToWire(snapshot: UsageSnapshot): {
	creditsUsed: number;
	creditsLimit: number;
	creditsRemaining: number;
	bonusCredits: number;
	resetAt: string | null;
	effectiveTier: Tier;
} {
	return {
		creditsUsed: snapshot.creditsUsed,
		creditsLimit: snapshot.creditsLimit,
		creditsRemaining: snapshot.creditsRemaining,
		bonusCredits: snapshot.bonusCredits,
		resetAt: snapshot.resetAt,
		effectiveTier: snapshot.effectiveTier,
	};
}

export async function recordUsage(input: {
	apiKeyId: string;
	userId: string | null;
	endpoint: string;
	statusCode: number;
	latencyMs: number;
	creditsCharged: number;
	tier: Tier;
	source: SourceKindForBilling;
}): Promise<void> {
	await db.insert(usageEvents).values({
		apiKeyId: input.apiKeyId,
		userId: input.userId,
		endpoint: input.endpoint,
		statusCode: input.statusCode,
		latencyMs: input.latencyMs,
		creditsCharged: input.creditsCharged,
		tier: input.tier,
		source: input.source,
	});
}
