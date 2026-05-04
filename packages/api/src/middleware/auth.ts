/**
 * Auth + rate-limit middleware for `/buy/*` proxy routes. Resolution order:
 *
 *   1. `Authorization: Bearer <key>` or `X-API-Key: <key>` — for SDK/agent
 *      callers. Hash → `findActiveKey` lookup.
 *   2. Better-Auth session cookie — used by the dashboard playground so the
 *      browser doesn't need plaintext. Falls back to the user's most recently
 *      created un-revoked key for accounting + tier limits.
 *
 * Either path lands on the same `apiKey` context variable; downstream handlers
 * don't care which one matched.
 */

import { and, desc, eq, isNull, lt, or } from "drizzle-orm";
import { createMiddleware } from "hono/factory";
import { getAuth } from "../auth/better-auth.js";
import { findActiveKey, type Tier, touchLastUsed } from "../auth/keys.js";
import {
	AUTO_RECHARGE_COOLDOWN_MS,
	creditsForCall,
	effectiveTierForUser,
	MIN_TOPUP_CREDITS,
	recordUsage,
	type SourceKindForBilling,
	snapshotBurst,
	snapshotUsage,
	worstCaseCreditsForEndpoint,
} from "../auth/limits.js";
import { triggerAutoRecharge } from "../billing/checkout.js";
import { readStripeConfig } from "../billing/stripe.js";
import { config, isAuthConfigured, isStripeConfigured } from "../config.js";
import { db } from "../db/client.js";
import { type ApiKey, apiKeys, user as userTable } from "../db/schema.js";

/**
 * Build a dashboard-relative URL or return undefined when the host can't
 * actually fulfill that flow. The error body's `signup`/`upgrade` fields are
 * advisory: a self-host instance with Better-Auth disabled has no signup
 * page to point at, so we omit the field rather than mislead the caller.
 */
function dashboardUrlIfAvailable(path: string, available: boolean): string | undefined {
	if (!available) return undefined;
	return `${config.APP_URL.replace(/\/+$/, "")}${path}`;
}

declare module "hono" {
	interface ContextVariableMap {
		apiKey: ApiKey;
		/**
		 * Model the agent route resolved for the current `/v1/agent/chat`
		 * turn. Set by the agent route after validating the request body
		 * against tier permissions. Read by the post-handler in
		 * `requireApiKey` to charge the correct per-turn credit cost
		 * (mini=5, gpt-5.5=25). Undefined for non-agent endpoints.
		 */
		flipagentAgentModel?: string;
	}
}

function extractKey(authHeader: string | undefined, xKeyHeader: string | undefined): string | null {
	if (authHeader?.startsWith("Bearer ")) return authHeader.slice(7).trim() || null;
	if (xKeyHeader) return xKeyHeader.trim() || null;
	return null;
}

async function resolveSessionKey(headers: Headers): Promise<ApiKey | null> {
	const auth = getAuth();
	if (!auth) return null;
	const result = await auth.api.getSession({ headers }).catch(() => null);
	if (!result?.user) return null;
	const sessionUser = result.user as { id?: string; email?: string };
	const userEmail = sessionUser.email;
	if (!userEmail) return null;
	const rows = await db
		.select()
		.from(apiKeys)
		.where(and(eq(apiKeys.ownerEmail, userEmail), isNull(apiKeys.revokedAt)))
		.orderBy(desc(apiKeys.createdAt))
		.limit(1);
	const row = (rows[0] as ApiKey | undefined) ?? null;
	if (!row) return null;
	// Backfill user_id on legacy/script-issued keys. Without this, recordUsage
	// writes null user_id and snapshotUsage's userId-scoped filter undercounts
	// to zero. Best-effort — failure here doesn't block the request.
	if (!row.userId && sessionUser.id) {
		row.userId = sessionUser.id;
		db.update(apiKeys)
			.set({ userId: sessionUser.id })
			.where(eq(apiKeys.id, row.id))
			.catch((err) => console.error("[auth] backfill apiKeys.user_id failed:", err));
	}
	return row;
}

export const requireApiKey = createMiddleware(async (c, next) => {
	const startedAt = Date.now();
	const plain = extractKey(c.req.header("Authorization"), c.req.header("X-API-Key"));
	// Distinguishes the two callers we accept on this gate: programmatic
	// (explicit Authorization / X-API-Key header → this is the metered
	// surface) vs. dashboard (logged-in session cookie, no api-key header
	// → flipagent.dev's own UI talking to its api). Session callers still
	// authorize through the user's most-recent active key (so admin RBAC
	// + per-tier capability checks keep working) but the credit budget
	// + usage_events log are SKIPPED — the dashboard rendering itself
	// must not burn the user's lifetime free-tier quota.
	const viaApiKey = plain != null;

	let row: ApiKey | null = null;
	if (viaApiKey) {
		row = (await findActiveKey(plain)) as ApiKey | null;
		if (!row) {
			return c.json({ error: "invalid_key", message: "Key not found or revoked." }, 401);
		}
	} else {
		row = await resolveSessionKey(c.req.raw.headers);
		if (!row) {
			const signup = dashboardUrlIfAvailable("/signup/", isAuthConfigured());
			return c.json(
				{
					error: "unauthorized",
					message: "Provide X-API-Key: fa_xxx, Authorization: Bearer fa_xxx, or sign in.",
					...(signup ? { signup } : {}),
				},
				401,
			);
		}
	}

	// Two independent gates:
	//   1. Monthly credit budget — every metered endpoint charges N credits.
	//      Pricing-driven; what 429 surfaces. Skipped for session callers
	//      (dashboard internal traffic).
	//   2. Burst (per-minute / per-hour) — abuse protection on raw call rate.
	//      Always applies — anti-abuse should fire whether the caller used
	//      an api key or a session cookie.
	//
	// `tier` is the user's enforcement tier — equal to row.tier 99% of
	// the time, but downgrades to 'free' after PAST_DUE_GRACE_DAYS of
	// continuous past_due so a stale-card user doesn't keep consuming
	// paid-tier capacity through Stripe's 3-week dunning window.
	const billingTier = await effectiveTierForUser(row.userId, row.tier as Tier);
	const downgraded = billingTier !== row.tier;

	// Pre-flight credit needed for THIS call. We don't know the resolved
	// agent model yet (the agent route sets `flipagentAgentModel` after
	// validating tier permissions), so charge the worst case for the
	// gate. Post-handler we recompute against the actual model and bill
	// the realised cost. Worst-case gating is what stops a 20-credit
	// caller from stealth-executing an 80-credit evaluate.
	const worstCase = viaApiKey ? worstCaseCreditsForEndpoint(c.req.path) : 0;
	const [usage, burst] = await Promise.all([
		snapshotUsage({ apiKeyId: row.id, userId: row.userId }, billingTier),
		snapshotBurst({ apiKeyId: row.id, userId: row.userId }, billingTier),
	]);

	// Pre-charge gate. Block when worst-case cost > remaining credits,
	// even if `overLimit` is technically false. This is what stops the
	// "20 credits left, 80-credit evaluate sneaks through" foot-gun.
	// Cost-0 endpoints (status / health / account introspection) stay
	// accessible so the user can see WHY they're blocked and upgrade.
	if (viaApiKey && worstCase > 0 && usage.creditsRemaining < worstCase) {
		c.header("X-RateLimit-Limit", String(usage.creditsLimit));
		c.header("X-RateLimit-Remaining", String(usage.creditsRemaining));
		// `usage.resetAt` is null for the Free tier (one-time grant). Skip the
		// header rather than serialise "null" — clients reading X-RateLimit-Reset
		// expect either an ISO date or absence.
		if (usage.resetAt) c.header("X-RateLimit-Reset", usage.resetAt);
		c.header("X-Flipagent-Credits-Required", String(worstCase));
		if (downgraded) c.header("X-Flipagent-Effective-Tier", billingTier);
		const upgrade = dashboardUrlIfAvailable("/pricing/", isStripeConfigured());
		const packs = dashboardUrlIfAvailable("/dashboard/?view=billing", isStripeConfigured());
		const scope = usage.resetAt ? "Monthly" : "One-time";
		const downgradedNote = downgraded ? ` Subscription past_due > grace; effective tier is "${billingTier}".` : "";
		return c.json(
			{
				error: "credits_exceeded",
				message:
					`${scope} credit budget for tier "${billingTier}" is ${usage.creditsLimit}; you've used ` +
					`${usage.creditsUsed}, this call needs ${worstCase}.${downgradedNote}`,
				creditsUsed: usage.creditsUsed,
				creditsLimit: usage.creditsLimit,
				creditsRemaining: usage.creditsRemaining,
				creditsRequired: worstCase,
				resetAt: usage.resetAt,
				effectiveTier: billingTier,
				...(downgraded ? { reason: "past_due_grace_expired" as const } : {}),
				...(upgrade ? { upgrade } : {}),
				...(packs ? { creditPacks: packs } : {}),
			},
			429,
		);
	}

	if (burst.minuteOver || burst.hourOver) {
		const window = burst.minuteOver ? "minute" : "hour";
		c.header("X-RateLimit-Reset", new Date(Date.now() + (burst.minuteOver ? 60_000 : 3_600_000)).toISOString());
		return c.json(
			{
				error: "burst_rate_limited",
				window,
				message: `Burst rate limit hit (per-${window}). Slow down or upgrade for higher limits.`,
			},
			429,
		);
	}

	c.set("apiKey", row);
	c.header("X-RateLimit-Limit", String(usage.creditsLimit));
	c.header("X-RateLimit-Remaining", String(usage.creditsRemaining));
	if (usage.resetAt) c.header("X-RateLimit-Reset", usage.resetAt);
	c.header("X-Flipagent-Credits-Required", String(worstCase));
	if (downgraded) c.header("X-Flipagent-Effective-Tier", billingTier);

	// 90% warning. Surfaces while the call is still allowed — gives
	// agents a head's-up to top up (credit pack) or upgrade before the
	// hard 429 lands. Free tier (no resetAt) gets the same warning;
	// for paid the dashboard renders with "monthly", for free with
	// "one-time".
	if (usage.creditsLimit > 0 && usage.creditsUsed * 10 >= usage.creditsLimit * 9) {
		const pct = Math.floor((usage.creditsUsed / usage.creditsLimit) * 100);
		c.header(
			"X-RateLimit-Warning",
			`approaching=${pct}%; remaining=${usage.creditsRemaining}; limit=${usage.creditsLimit}`,
		);
	}

	await next();

	const latencyMs = Date.now() - startedAt;
	const statusCode = c.res.status;
	const source = (c.var.flipagentSource ?? null) as SourceKindForBilling;
	const agentModel = c.var.flipagentAgentModel ?? null;
	// Don't charge credits for transient infra failures: 5xx (our or
	// upstream's bug) and 429 from upstream (e.g. eBay Browse hit its
	// app-credential daily cap — caller did nothing wrong). The audit
	// row still gets written so we can see the failure in usage_events,
	// but with creditsCharged=0 — and `snapshotBurst` filters those out
	// too, so a flurry of upstream 5xx/429s doesn't lock the caller out
	// of legitimate retries via the burst gate.
	const isTransientFailure = statusCode >= 500 || statusCode === 429;
	const realisedCredits =
		viaApiKey && !isTransientFailure ? creditsForCall({ endpoint: c.req.path, source, agentModel }) : 0;
	c.res.headers.set("X-Flipagent-Credits-Charged", String(realisedCredits));

	// Skip usage_events insert ONLY when the caller is the dashboard
	// (session cookie, no api-key header) — dashboard internal data fetches
	// (panel mounts, taxonomy reads, "featured" curation) must not show up
	// as the user's API consumption nor charge against their credit budget.
	// Cache hits DO charge (per `creditsForCall`) — we used to skip them but
	// the inconsistency surprised callers (a tool that "sometimes burns a
	// credit") and made description-level pricing claims wobbly. Charging
	// on every successful api-key call is the simpler, more honest contract.
	// touchLastUsed runs in both cases so "last used" stays meaningful.
	const skipUsageLog = !viaApiKey;
	await Promise.all([
		skipUsageLog
			? Promise.resolve()
			: recordUsage({
					apiKeyId: row.id,
					userId: row.userId,
					endpoint: c.req.path,
					statusCode,
					latencyMs,
					creditsCharged: realisedCredits,
					tier: billingTier,
					source,
				}).catch((err) => console.error("[auth] recordUsage failed:", err)),
		touchLastUsed(row.id).catch((err) => console.error("[auth] touchLastUsed failed:", err)),
	]);

	// Auto-recharge check. Fire AFTER recordUsage so the next request's
	// snapshot reflects what we just billed. Cheap top-line gate
	// (api-key call only, has a userId, charged something) — the real
	// "is it on / cooldown / tier" decisions live in maybeFireAutoRecharge.
	if (viaApiKey && realisedCredits > 0 && row.userId) {
		const remainingAfter = Math.max(0, usage.creditsRemaining - realisedCredits);
		void maybeFireAutoRecharge(row.userId, billingTier, remainingAfter);
	}
});

/**
 * Fire-and-forget auto-recharge. Called after every billable api-key
 * request; bails out fast when the feature is off, the user's tier
 * doesn't qualify, the cooldown is still warm, or the running balance
 * is still above the threshold.
 *
 * Errors here are ALWAYS swallowed — auto-recharge failure must not
 * fail or slow down the request that triggered it. The webhook
 * handler turns success into a credit_grants row; on declined cards
 * the failed-intent webhook turns auto-recharge off.
 */
/** Subscription statuses where charging the saved card is appropriate.
 *  Mirrors the webhook's HEALTHY_STATUSES — must stay in sync. Anything
 *  else (`past_due`, `unpaid`, `incomplete`, `canceled`) means we
 *  shouldn't be firing off-session intents until the user resolves it
 *  via the portal. */
const AUTO_RECHARGE_OK_STATUSES = new Set(["active", "trialing"]);

async function maybeFireAutoRecharge(userId: string, tier: Tier, creditsRemainingAfter: number): Promise<void> {
	try {
		const [u] = await db.select().from(userTable).where(eq(userTable.id, userId)).limit(1);
		if (!u) return;
		if (!u.autoRechargeEnabled) return;
		if (!u.autoRechargeTarget) return;
		if (creditsRemainingAfter >= u.autoRechargeTarget) return;
		if (tier === "free") return;
		if (!u.stripeCustomerId) return;
		// Subscription must be in good standing. Catches the cancel-vs-fire
		// race: between the user clicking cancel in the portal and our
		// `customer.subscription.deleted` webhook landing, `tier` is still
		// paid + `stripeCustomerId` is still set, but `subscriptionStatus`
		// flips to `canceled` immediately on Stripe's side. Without this
		// gate, one last threshold-crossing would charge a customer who's
		// already canceled.
		if (!u.subscriptionStatus || !AUTO_RECHARGE_OK_STATUSES.has(u.subscriptionStatus)) return;

		// Cooldown — last successful recharge within the window? Skip.
		// Lock-style guard against double-fire when 50 concurrent
		// requests cross the threshold at the same time.
		const now = new Date();
		const last = u.lastAutoRechargeAt;
		if (last && now.getTime() - last.getTime() < AUTO_RECHARGE_COOLDOWN_MS) return;

		const cfg = readStripeConfig();
		if (!cfg) return;

		// Optimistic stamp: set lastAutoRechargeAt NOW, gated by the
		// same cooldown predicate. If two concurrent workers both pass
		// the read above, only one wins this UPDATE — the other sees
		// `affected: 0` and bails. The webhook will re-stamp on
		// successful intent for accuracy.
		const claim = await db
			.update(userTable)
			.set({ lastAutoRechargeAt: now, updatedAt: now })
			.where(
				and(
					eq(userTable.id, userId),
					or(
						isNull(userTable.lastAutoRechargeAt),
						lt(userTable.lastAutoRechargeAt, new Date(now.getTime() - AUTO_RECHARGE_COOLDOWN_MS)),
					),
				),
			)
			.returning({ id: userTable.id });
		if (claim.length === 0) return;

		// Charge the gap to target. Stripe's per-charge floor (~$0.50) +
		// the no-op cycle of "balance ticked 1 below target → fire 1 →
		// stuck at target − ε" both push us to a min size. The recharge
		// may overshoot `target` slightly when the gap is tiny; that's
		// fine and matches the user's intent ("at least target").
		const gap = u.autoRechargeTarget - creditsRemainingAfter;
		const credits = Math.max(gap, MIN_TOPUP_CREDITS);
		await triggerAutoRecharge(cfg, { user: u, tier, credits });
		console.log(
			`[auto-recharge] fired ${credits} credits for ${userId} (target=${u.autoRechargeTarget}, balance=${creditsRemainingAfter})`,
		);
	} catch (err) {
		// Declined / authentication_required / Stripe errors all land
		// here. The webhook payment_intent.payment_failed handler
		// disables the feature so we don't keep firing.
		console.error("[auto-recharge] failed:", err);
	}
}
