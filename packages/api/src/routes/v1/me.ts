/**
 * Dashboard surface — session-cookie auth (Better-Auth via /api/auth).
 *
 *   GET    /v1/me                     current user + tier + monthly usage
 *   GET    /v1/me/keys                list keys owned by the user
 *   POST   /v1/me/keys                issue a new named key (plaintext shown once)
 *   POST   /v1/me/keys/:id/reveal     decrypt + return plaintext for one key
 *   DELETE /v1/me/keys/:id            revoke a key (must belong to the user)
 *   GET    /v1/me/usage               same usage snapshot as /v1/me, on its own
 */

import {
	KeyCreateResponse,
	KeyRevokeResponse,
	MeKeyCreateRequest,
	MeKeyList,
	MeKeyRevealResponse,
	MeProfile,
	MeUsageResponse,
	PermissionsResponse,
} from "@flipagent/types";
import { and, desc, eq, gte, inArray, isNull, sql } from "drizzle-orm";
import { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import { decryptKeyPlaintext, isKeyRevealConfigured } from "../../auth/key-cipher.js";
import { issueKey, revokeKey, type Tier } from "../../auth/keys.js";
import { snapshotUsage } from "../../auth/limits.js";
import { computePermissionsForUser } from "../../auth/permissions.js";
import { db } from "../../db/client.js";
import { apiKeys, usageEvents } from "../../db/schema.js";
import { requireSession } from "../../middleware/session.js";
import { errorResponse, jsonResponse, tbBody } from "../../utils/openapi.js";
import { meEbayRoute } from "./me/ebay.js";

export const meRoute = new Hono();

meRoute.use("*", requireSession);
meRoute.route("/ebay", meEbayRoute);

meRoute.get(
	"/",
	describeRoute({
		tags: ["Keys"],
		summary: "Current user (session) + monthly usage",
		responses: {
			200: jsonResponse("User profile.", MeProfile),
			401: errorResponse("Not signed in."),
			503: errorResponse("Auth not configured."),
		},
	}),
	async (c) => {
		const user = c.var.user;
		const tier = user.tier as Tier;
		const usage = await snapshotUsage({ apiKeyId: "", userId: user.id }, tier);
		return c.json({
			id: user.id,
			email: user.email,
			emailVerified: Boolean((user as { emailVerified?: boolean }).emailVerified),
			name: user.name,
			image: user.image ?? null,
			tier,
			usage: {
				used: usage.used,
				limit: Number.isFinite(usage.limit) ? usage.limit : null,
				remaining: Number.isFinite(usage.remaining) ? usage.remaining : null,
				resetAt: usage.resetAt,
			},
		});
	},
);

meRoute.get(
	"/usage",
	describeRoute({
		tags: ["Keys"],
		summary: "Monthly usage snapshot",
		responses: {
			200: jsonResponse("Usage.", MeUsageResponse),
			401: errorResponse("Not signed in."),
		},
	}),
	async (c) => {
		const user = c.var.user;
		const usage = await snapshotUsage({ apiKeyId: "", userId: user.id }, user.tier as Tier);
		return c.json({
			used: usage.used,
			limit: Number.isFinite(usage.limit) ? usage.limit : null,
			remaining: Number.isFinite(usage.remaining) ? usage.remaining : null,
			resetAt: usage.resetAt,
		});
	},
);

meRoute.get(
	"/usage/breakdown",
	describeRoute({
		tags: ["Keys"],
		summary: "Per-endpoint usage breakdown for the current calendar month (UTC)",
		description: "Aggregates usage_events by endpoint over the user's keys. Drives the dashboard's Usage chart.",
		responses: {
			200: { description: "Breakdown rows ordered by call count (descending)." },
			401: errorResponse("Not signed in."),
		},
	}),
	async (c) => {
		const user = c.var.user;
		const userKeys = await db.select({ id: apiKeys.id }).from(apiKeys).where(eq(apiKeys.ownerEmail, user.email));
		const ids = userKeys.map((k) => k.id);
		if (ids.length === 0) return c.json({ breakdown: [] });
		const rows = await db
			.select({
				endpoint: usageEvents.endpoint,
				count: sql<number>`cast(count(*) as int)`,
				avgLatencyMs: sql<number>`cast(coalesce(round(avg(${usageEvents.latencyMs})), 0) as int)`,
				errorCount: sql<number>`cast(count(*) filter (where ${usageEvents.statusCode} >= 400) as int)`,
				p95LatencyMs: sql<number>`cast(coalesce(percentile_cont(0.95) within group (order by ${usageEvents.latencyMs}), 0) as int)`,
			})
			.from(usageEvents)
			.where(
				and(
					inArray(usageEvents.apiKeyId, ids),
					gte(usageEvents.createdAt, sql`date_trunc('month', now() at time zone 'utc') at time zone 'utc'`),
				),
			)
			.groupBy(usageEvents.endpoint)
			.orderBy(desc(sql`count(*)`));
		return c.json({
			breakdown: rows.map((r) => ({
				endpoint: r.endpoint,
				count: r.count,
				avgLatencyMs: r.avgLatencyMs,
				p95LatencyMs: r.p95LatencyMs,
				errorCount: r.errorCount,
			})),
		});
	},
);

meRoute.get(
	"/usage/recent",
	describeRoute({
		tags: ["Keys"],
		summary: "Recent metered API events for the signed-in user",
		description: "Latest usage_events rows tied to keys owned by the user. Drives the dashboard's Activity panel.",
		responses: {
			200: { description: "Recent events." },
			401: errorResponse("Not signed in."),
		},
	}),
	async (c) => {
		const user = c.var.user;
		const userKeys = await db
			.select({ id: apiKeys.id, name: apiKeys.name, prefix: apiKeys.keyPrefix })
			.from(apiKeys)
			.where(and(eq(apiKeys.ownerEmail, user.email), isNull(apiKeys.revokedAt)));
		const keyMap = new Map(userKeys.map((k) => [k.id, { name: k.name, prefix: k.prefix }]));
		const ids = userKeys.map((k) => k.id);
		if (ids.length === 0) return c.json({ events: [] });
		const events = await db
			.select({
				id: usageEvents.id,
				apiKeyId: usageEvents.apiKeyId,
				endpoint: usageEvents.endpoint,
				statusCode: usageEvents.statusCode,
				latencyMs: usageEvents.latencyMs,
				createdAt: usageEvents.createdAt,
			})
			.from(usageEvents)
			.where(inArray(usageEvents.apiKeyId, ids))
			.orderBy(desc(usageEvents.createdAt))
			.limit(50);
		return c.json({
			events: events.map((e) => ({
				id: String(e.id),
				keyName: keyMap.get(e.apiKeyId)?.name ?? null,
				keyPrefix: keyMap.get(e.apiKeyId)?.prefix ?? null,
				endpoint: e.endpoint,
				statusCode: e.statusCode,
				latencyMs: e.latencyMs,
				createdAt: e.createdAt.toISOString(),
			})),
		});
	},
);

meRoute.get(
	"/keys",
	describeRoute({
		tags: ["Keys"],
		summary: "List the caller's API keys",
		responses: {
			200: jsonResponse("Keys.", MeKeyList),
			401: errorResponse("Not signed in."),
		},
	}),
	async (c) => {
		const user = c.var.user;
		const rows = await db
			.select({
				id: apiKeys.id,
				name: apiKeys.name,
				prefix: apiKeys.keyPrefix,
				suffix: apiKeys.keySuffix,
				tier: apiKeys.tier,
				createdAt: apiKeys.createdAt,
				lastUsedAt: apiKeys.lastUsedAt,
			})
			.from(apiKeys)
			.where(and(eq(apiKeys.userId, user.id), isNull(apiKeys.revokedAt)))
			.orderBy(desc(apiKeys.createdAt));
		return c.json({
			keys: rows.map((r) => ({
				id: r.id,
				name: r.name,
				prefix: r.prefix,
				suffix: r.suffix,
				tier: r.tier,
				createdAt: r.createdAt.toISOString(),
				lastUsedAt: r.lastUsedAt ? r.lastUsedAt.toISOString() : null,
			})),
		});
	},
);

meRoute.post(
	"/keys",
	describeRoute({
		tags: ["Keys"],
		summary: "Issue a new named key for the caller",
		description: "The plaintext is returned exactly once. Store it immediately.",
		responses: {
			201: jsonResponse("Key created.", KeyCreateResponse),
			400: errorResponse("Validation failed."),
			401: errorResponse("Not signed in."),
		},
	}),
	tbBody(MeKeyCreateRequest),
	async (c) => {
		const user = c.var.user;
		const valid = c.req.valid("json");
		const issued = await issueKey({
			tier: user.tier as Tier,
			name: valid.name,
			ownerEmail: user.email,
			userId: user.id,
		});
		return c.json(
			{
				id: issued.id,
				tier: issued.tier,
				prefix: issued.prefix,
				suffix: issued.suffix,
				plaintext: issued.plaintext,
				notice: "Save plaintext now — it will never be shown again.",
			},
			201,
		);
	},
);

meRoute.post(
	"/keys/:id/reveal",
	describeRoute({
		tags: ["Keys"],
		summary: "Decrypt + return plaintext for one of the caller's keys",
		description:
			"Plaintext is decrypted from the at-rest ciphertext stored at issue time. Keys created before plaintext storage was wired return 410 (recreate to make revealable). Returns 503 when KEYS_ENCRYPTION_KEY is unset in production.",
		responses: {
			200: jsonResponse("Plaintext.", MeKeyRevealResponse),
			401: errorResponse("Not signed in."),
			404: errorResponse("Key not found or not owned by caller."),
			410: errorResponse("Legacy key without stored plaintext — recreate to reveal."),
			503: errorResponse("Plaintext storage not configured on this host."),
		},
	}),
	async (c) => {
		const user = c.var.user;
		const id = c.req.param("id");
		if (!isKeyRevealConfigured()) {
			return c.json({ error: "not_configured" as const }, 503);
		}
		const [row] = await db.select().from(apiKeys).where(eq(apiKeys.id, id)).limit(1);
		if (!row || row.userId !== user.id || row.revokedAt) {
			return c.json({ error: "not_found" as const }, 404);
		}
		if (!row.keyCiphertext) {
			return c.json({ error: "legacy_key" as const }, 410);
		}
		const plaintext = decryptKeyPlaintext(row.keyCiphertext);
		c.header("Cache-Control", "no-store");
		return c.json({ id: row.id, plaintext });
	},
);

meRoute.delete(
	"/keys/:id",
	describeRoute({
		tags: ["Keys"],
		summary: "Revoke one of the caller's keys",
		responses: {
			200: jsonResponse("Revoked.", KeyRevokeResponse),
			401: errorResponse("Not signed in."),
			404: errorResponse("Key not found or not owned by caller."),
		},
	}),
	async (c) => {
		const user = c.var.user;
		const id = c.req.param("id");
		const [row] = await db.select().from(apiKeys).where(eq(apiKeys.id, id)).limit(1);
		if (!row || row.userId !== user.id) {
			return c.json({ error: "not_found" as const }, 404);
		}
		await revokeKey(id);
		return c.json({ id, revoked: true });
	},
);

meRoute.get(
	"/permissions",
	describeRoute({
		tags: ["Dashboard"],
		summary: "Per-scope permission status for the signed-in user",
		description:
			"Tells the dashboard (and SDK consumers) what they can call right now: `ok` works, `scrape_fallback` uses the scraper because REST isn't approved/wired, `needs_oauth` means the user must connect eBay, `approval_pending` means eBay program approval pending, `unavailable` means the host has no env wired (self-host case).",
		responses: {
			200: jsonResponse("Permission map.", PermissionsResponse),
			401: errorResponse("Not signed in."),
		},
	}),
	async (c) => {
		const user = c.var.user;
		const result = await computePermissionsForUser(user.email);
		return c.json(result);
	},
);
