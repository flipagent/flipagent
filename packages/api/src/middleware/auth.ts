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
import { recordUsage, snapshotUsage } from "../auth/limits.js";
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
	const userEmail = (result.user as { email?: string }).email;
	if (!userEmail) return null;
	const rows = await db
		.select()
		.from(apiKeys)
		.where(and(eq(apiKeys.ownerEmail, userEmail), isNull(apiKeys.revokedAt)))
		.orderBy(desc(apiKeys.createdAt))
		.limit(1);
	return (rows[0] as ApiKey | undefined) ?? null;
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

	const usage = await snapshotUsage({ apiKeyId: row.id, userId: row.userId }, row.tier as Tier);
	if (usage.overLimit) {
		c.header("X-RateLimit-Limit", String(usage.limit));
		c.header("X-RateLimit-Remaining", "0");
		c.header("X-RateLimit-Reset", usage.resetAt);
		const upgrade = dashboardUrlIfAvailable("/pricing/", isStripeConfigured());
		return c.json(
			{
				error: "rate_limited",
				message: `Tier "${row.tier}" allows ${usage.limit}/mo; you've used ${usage.used}.`,
				resetAt: usage.resetAt,
				...(upgrade ? { upgrade } : {}),
			},
			429,
		);
	}

	c.set("apiKey", row);
	c.header("X-RateLimit-Limit", Number.isFinite(usage.limit) ? String(usage.limit) : "unlimited");
	c.header("X-RateLimit-Remaining", Number.isFinite(usage.remaining) ? String(usage.remaining) : "unlimited");
	c.header("X-RateLimit-Reset", usage.resetAt);

	await next();

	const latencyMs = Date.now() - startedAt;
	const statusCode = c.res.status;
	await Promise.all([
		recordUsage({ apiKeyId: row.id, userId: row.userId, endpoint: c.req.path, statusCode, latencyMs }).catch((err) =>
			console.error("[auth] recordUsage failed:", err),
		),
		touchLastUsed(row.id).catch((err) => console.error("[auth] touchLastUsed failed:", err)),
	]);
});
