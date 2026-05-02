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

import { and, desc, eq, isNull } from "drizzle-orm";
import { createMiddleware } from "hono/factory";
import { getAuth } from "../auth/better-auth.js";
import { findActiveKey, type Tier, touchLastUsed } from "../auth/keys.js";
import { creditsForEndpoint, recordUsage, snapshotBurst, snapshotUsage } from "../auth/limits.js";
import { config, isAuthConfigured, isStripeConfigured } from "../config.js";
import { db } from "../db/client.js";
import { type ApiKey, apiKeys } from "../db/schema.js";

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

	let row: ApiKey | null = null;
	if (plain) {
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
	//      Pricing-driven; what 429 surfaces.
	//   2. Burst (per-minute / per-hour) — abuse protection on raw call rate.
	// Both must pass; both surface as 429 with distinct `error` codes so
	// clients can react differently (upgrade vs back off).
	const tier = row.tier as Tier;
	const credits = creditsForEndpoint(c.req.path);
	const [usage, burst] = await Promise.all([
		snapshotUsage({ apiKeyId: row.id, userId: row.userId }, tier),
		snapshotBurst({ apiKeyId: row.id, userId: row.userId }, tier),
	]);

	if (usage.overLimit) {
		c.header("X-RateLimit-Limit", String(usage.creditsLimit));
		c.header("X-RateLimit-Remaining", "0");
		// `usage.resetAt` is null for the Free tier (one-time grant). Skip the
		// header rather than serialise "null" — clients reading X-RateLimit-Reset
		// expect either an ISO date or absence.
		if (usage.resetAt) c.header("X-RateLimit-Reset", usage.resetAt);
		c.header("X-Flipagent-Credits-Charged", String(credits));
		const upgrade = dashboardUrlIfAvailable("/pricing/", isStripeConfigured());
		// Free is a one-time grant (resetAt = null); paid tiers refill monthly.
		// The message reflects that so users know whether to wait or upgrade.
		const scope = usage.resetAt ? "Monthly" : "One-time";
		return c.json(
			{
				error: "credits_exceeded",
				message: `${scope} credit budget for tier "${row.tier}" is ${usage.creditsLimit}; you've used ${usage.creditsUsed}.`,
				creditsUsed: usage.creditsUsed,
				creditsLimit: usage.creditsLimit,
				resetAt: usage.resetAt,
				...(upgrade ? { upgrade } : {}),
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
	c.header("X-Flipagent-Credits-Charged", String(credits));

	await next();

	const latencyMs = Date.now() - startedAt;
	const statusCode = c.res.status;
	// Cache hits don't count against the monthly quota — the pricing page
	// promises this. The resource service sets `X-Flipagent-From-Cache: true`
	// (via renderResultHeaders) whenever the response was served from the
	// shared cache layer, so we skip the usage_events insert for those.
	// touchLastUsed still runs so "last used" stays meaningful.
	const fromCache = c.res.headers.get("X-Flipagent-From-Cache") === "true";
	await Promise.all([
		fromCache
			? Promise.resolve()
			: recordUsage({ apiKeyId: row.id, userId: row.userId, endpoint: c.req.path, statusCode, latencyMs }).catch(
					(err) => console.error("[auth] recordUsage failed:", err),
				),
		touchLastUsed(row.id).catch((err) => console.error("[auth] touchLastUsed failed:", err)),
	]);
});
