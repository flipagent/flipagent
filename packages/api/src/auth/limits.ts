/**
 * Per-tier credit budget + burst rate limits + endpoint pricing.
 *
 * One unit, credits, covers every metered endpoint. Calibration:
 *   1 credit ≈ $0.0025 worth of internal work (~ 1 Oxylabs scrape).
 * Endpoint costs are transport-uniform — users don't see the
 * scrape/rest/bridge distinction; same logical request = same price.
 *
 *   /v1/evaluate                       = 80  (cold: 1 detail + 2 search
 *                                              + ~30 enrich scrapes
 *                                              + ~4 triage LLM
 *                                              + ~30 verify LLM)
 *   /v1/{items,products,categories,trends}
 *                                      = 1   (search / get / list)
 *   /v1/agent/chat (gpt-5.4-mini turn)     =  5
 *   /v1/agent/chat (gemini-2.5-flash turn) =  3
 *   /v1/agent/chat (claude-sonnet-4-7 turn)= 15
 *   /v1/agent/chat (gpt-5.5 turn)          = 25
 *   sell-side / forwarder / ship /
 *   bridge / browser / purchases /
 *   messages / etc.                    = 0   (no upstream cost — burst-only)
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
 * to hobby and back doesn't get a fresh 1000-credit lifetime window.
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
 *
 * Sizing (1 credit ≈ $0.0025 of work):
 *   Free      1,000 lifetime    — ~12 evaluates worth of trial
 *   Hobby     3,000 / month     — ~37 evaluates (≈ 1/day)
 *   Standard 25,000 / month     — ~310 evaluates (≈ 10/day)
 *   Growth  120,000 / month     — ~1,500 evaluates (≈ 50/day)
 */
export const TIER_LIMITS: Record<Tier, TierLimits> = {
	free: { credits: 1_000, oneTime: true, burstPerMin: 60, burstPerHour: 600 },
	hobby: { credits: 3_000, oneTime: false, burstPerMin: 120, burstPerHour: 2_400 },
	standard: { credits: 25_000, oneTime: false, burstPerMin: 300, burstPerHour: 9_000 },
	growth: { credits: 120_000, oneTime: false, burstPerMin: 1_200, burstPerHour: 36_000 },
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
 *   Hobby    $19  /  3k = $0.00633/credit subscribed
 *   Standard $99  / 25k = $0.00396/credit subscribed
 *   Growth   $399 /120k = $0.00333/credit subscribed
 * Top-up rates sit ~1.5× *above* the subscribed rate (sustained use
 * should upgrade tier, not stack packs) but cheaper than committing
 * to the next tier for one busy month.
 *
 * Stripe charges using `price_data` constructed at checkout time —
 * no pre-created Stripe Price SKUs to manage, no env vars, one source
 * of truth here.
 */
export const PER_CREDIT_USD: Record<Extract<Tier, "hobby" | "standard" | "growth">, number> = {
	hobby: 0.0095,
	standard: 0.006,
	growth: 0.005,
};

/**
 * Default `auto_recharge_target` value when a user first enables the
 * feature without picking a number. Uniform across paid tiers so the
 * UI doesn't have to special-case per-tier defaults — the dashboard
 * form prefills this, the user adjusts up or down within the tier's
 * range. Single value chosen to feel "comfortable but small" — about
 * 1 day of agent chat at Hobby's monthly volume.
 */
export const DEFAULT_AUTO_RECHARGE_TARGET = 1_000;

/**
 * Per-tier bounds on `auto_recharge_target`. The lower bound is the
 * same everywhere (a meaningful balance to maintain), the upper bound
 * scales with tier so a Growth user can hold a bigger buffer without
 * triggering 50× recharges per day. Numbers picked so the bound
 * roughly equals the tier's monthly base allotment — beyond that, a
 * tier upgrade is almost always the better fit.
 */
export const TARGET_RANGE_BY_TIER: Record<
	Extract<Tier, "hobby" | "standard" | "growth">,
	{ min: number; max: number }
> = {
	hobby: { min: 500, max: 10_000 },
	standard: { min: 500, max: 50_000 },
	growth: { min: 500, max: 200_000 },
};

/** Range (min/max target) for the user's tier. Throws on `free` —
 *  the route layer gates before calling. */
export function targetRangeForTier(tier: Tier): { min: number; max: number } {
	if (tier === "free") {
		throw new Error("Free tier has no auto-recharge — gate before calling.");
	}
	return TARGET_RANGE_BY_TIER[tier];
}

/**
 * Minimum top-up size in credits. Stripe rejects charges below ~$0.50;
 * at Growth's $0.005/credit that's 100 credits. We always charge at
 * least this — even if the user's gap to target is smaller — so a
 * recharge isn't blocked by Stripe's floor and a flicker of activity
 * doesn't cause a tight loop of tiny declined charges. The recharge
 * may bring the balance slightly above `target` as a result; that's
 * fine and matches the user's intent ("at least target").
 */
export const MIN_TOPUP_CREDITS = 100;

/**
 * Selectable manual top-up amounts. Used by the price-quote endpoint
 * for one-off pack purchases. Auto-recharge no longer uses this list
 * (it picks a dynamic credit amount based on the gap to target), so
 * the menu only constrains the manual checkout flow.
 *
 * Capped at 30k because beyond that, a tier upgrade is almost always
 * the right answer; we don't want to encourage indefinite top-up
 * stacking that would otherwise mask a real tier-fit problem.
 */
export const PACK_DENOMINATIONS: ReadonlyArray<number> = [1_500, 7_500, 30_000];

/**
 * Cooldown between auto-recharge fires for the same user. Stops a
 * flood of concurrent calls all triggering top-up between the moment
 * the balance crosses target and the moment the new credits hit
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
 * Per-turn credit cost for the agent endpoint, by model. Calibrated so
 * each entry tracks ~$0.001 raw cost per credit at the average turn shape
 * (~5k input + 1k output tokens).
 *
 *   gpt-5.4-mini      →  5  ($0.005 OpenAI ≈ 5c)
 *   gpt-5.5           → 25  ($0.025 OpenAI ≈ 25c)
 *   claude-sonnet-4-7 → 15  ($0.015 Anthropic ≈ 15c; prompt caching makes our cost lower)
 *   gemini-2.5-flash  →  3  ($0.003 Google ≈ 3c, the cheapest option)
 *
 * Unknown model → 5 credits (treat as mini so a future model addition that
 * forgets to register here doesn't accidentally undercharge.)
 */
const AGENT_TURN_CREDITS: Record<string, number> = {
	"gpt-5.4-mini": 5,
	"gpt-5.5": 25,
	"claude-sonnet-4-7": 15,
	"gemini-2.5-flash": 3,
};

/** Credits the agent endpoint charges for one turn of `model`. */
export function agentTurnCreditsFor(model: string | null | undefined): number {
	if (!model) return AGENT_TURN_CREDITS["gpt-5.4-mini"]!;
	return AGENT_TURN_CREDITS[model] ?? AGENT_TURN_CREDITS["gpt-5.4-mini"]!;
}

/**
 * Worst-case credits for a given path. Used by the pre-charge gate —
 * we don't know which agent model (or whether evaluate will short-circuit
 * on cache) at request entry, so we charge the upper bound on entry and
 * surface the actual `credits_charged` after the response. Prevents a
 * 30-credit-remaining caller from stealth-executing an 80-credit evaluate.
 */
export function worstCaseCreditsForEndpoint(endpoint: string, method?: string): number {
	if (endpoint.startsWith("/v1/evaluate/featured")) return 0;
	if (endpoint.startsWith("/v1/evaluate/scopes")) return 0;
	// Job polling: GET `/v1/evaluate/jobs/<id>` and `/v1/evaluate/<id>/pool`
	// are cache reads off `compute_jobs` — no LLM, no scrape, just a row
	// fetch. Charging the same as the original evaluate double-bills every
	// legitimate poll. Stay free for read paths; the create POST
	// (`/v1/evaluate/jobs`, no trailing slash) still hits the evaluate cost.
	if (endpoint.startsWith("/v1/evaluate/jobs/")) return 0;
	// `GET /v1/jobs*` — cross-surface activity history. Pure reads off
	// `compute_jobs`; never charged.
	if (endpoint.startsWith("/v1/jobs") && method === "GET") return 0;
	if (endpoint.includes("/pool")) return 0;
	if (endpoint.startsWith("/v1/evaluate")) return 80;
	if (endpoint.startsWith("/v1/agent/chat")) {
		// Worst case is the most expensive model (gpt-5.5). Real charge
		// is recomputed against the resolved model at recordUsage time.
		return AGENT_TURN_CREDITS["gpt-5.5"]!;
	}
	// Items/products/categories/trends — uniform 1 credit regardless of
	// transport (sourcing surface; user shouldn't see scrape vs rest in
	// pricing). Internal Oxylabs cost is absorbed by the credit
	// calibration ($0.0025/credit covers a single scrape with margin).
	if (endpoint.startsWith("/v1/items")) return 1;
	if (endpoint.startsWith("/v1/products")) return 1;
	if (endpoint.startsWith("/v1/categories")) return 1;
	if (endpoint.startsWith("/v1/trends")) return 1;
	return 0;
}

/**
 * Credits to charge for a completed call. Endpoint-uniform pricing (no
 * transport split) — users see one number per logical request and we
 * absorb internal cost variance through the credit-unit calibration.
 *
 * Called at `recordUsage` time (post-handler). Pre-flight, callers use
 * `worstCaseCreditsForEndpoint` for the budget gate.
 */
export function creditsForCall(args: {
	endpoint: string;
	method?: string;
	source: SourceKindForBilling;
	agentModel?: string | null;
}): number {
	const { endpoint, method, agentModel } = args;
	if (endpoint.startsWith("/v1/evaluate/featured")) return 0;
	if (endpoint.startsWith("/v1/evaluate/scopes")) return 0;
	// Same exemptions as `worstCaseCreditsForEndpoint`: polling + pool
	// drill-down + history list are reads, not new compute.
	if (endpoint.startsWith("/v1/evaluate/jobs/")) return 0;
	if (endpoint.startsWith("/v1/jobs") && method === "GET") return 0;
	if (endpoint.includes("/pool")) return 0;
	if (endpoint.startsWith("/v1/evaluate")) return 80;
	if (endpoint.startsWith("/v1/agent/chat")) {
		return agentTurnCreditsFor(agentModel);
	}
	if (
		endpoint.startsWith("/v1/items") ||
		endpoint.startsWith("/v1/products") ||
		endpoint.startsWith("/v1/categories") ||
		endpoint.startsWith("/v1/trends")
	) {
		return 1;
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
 * Burst usage over a sliding window. Counts billable events (not credits) —
 * the goal is abuse protection. A flood of cheap search calls can still
 * DOS the upstream just like a flood of expensive ones; both burn a
 * credit and both count.
 *
 * **Excludes 0-credit calls.** Job polling (`/v1/evaluate/jobs/<id>`),
 * activity-history reads (`/v1/jobs`), session list, capabilities,
 * `/v1/me`, `/v1/keys/me`, etc. all return 0 credits — the route layer
 * marks them as cheap reads off existing rows, no upstream cost. They
 * must not gate the caller's burst either: an evaluate emits 5–30
 * polls until it finishes, and a dashboard idle-tabbed in the
 * background polls jobs/sessions every few seconds. Counting those
 * toward burst made "I ran one evaluate and got 429" the default
 * Free-tier experience until this filter landed.
 *
 * Also excludes transient infra failures (5xx, 429): when our upstream
 * falls over or eBay rate-limits our app credential, the caller did
 * nothing wrong; counting those toward the caller's burst would lock
 * them out of legitimate retries during an outage that's our (or
 * eBay's) fault. 4xx caller-error responses (401/404/etc.) DO count —
 * those represent real upstream calls the caller initiated, even if
 * the input was bad — provided they were credit-charged.
 */
export async function snapshotBurst(
	scope: { apiKeyId: string; userId: string | null },
	tier: Tier,
): Promise<{ perMinute: number; perHour: number; minuteOver: boolean; hourOver: boolean }> {
	const limits = TIER_LIMITS[tier];
	const filter = scope.userId ? eq(usageEvents.userId, scope.userId) : eq(usageEvents.apiKeyId, scope.apiKeyId);
	const transientExcluded = sql`(${usageEvents.statusCode} < 500 AND ${usageEvents.statusCode} <> 429)`;
	const billableOnly = sql`${usageEvents.creditsCharged} > 0`;
	const [row] = await db
		.select({
			minute: sql<number>`cast(count(*) filter (where ${usageEvents.createdAt} >= now() - interval '1 minute') as int)`,
			hour: sql<number>`cast(count(*) filter (where ${usageEvents.createdAt} >= now() - interval '1 hour') as int)`,
		})
		.from(usageEvents)
		.where(
			and(filter, gte(usageEvents.createdAt, sql`now() - interval '1 hour'`), transientExcluded, billableOnly),
		);
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
