/**
 * Agent-facing key inspection. The key itself authenticates these calls
 * (X-API-Key / Authorization: Bearer); the dashboard surface lives at
 * /v1/me/* and uses session cookies.
 *
 *   GET  /v1/keys/me       inspect the calling key
 *   POST /v1/keys/revoke   revoke the calling key
 */

import { KeyInfo, KeyRevokeResponse, PermissionsResponse } from "@flipagent/types";
import { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import { revokeKey, type Tier } from "../../auth/keys.js";
import { effectiveTierForUser, snapshotUsage, usageToWire } from "../../auth/limits.js";
import { computePermissionsForApiKey } from "../../auth/permissions.js";
import { requireApiKey } from "../../middleware/auth.js";
import { errorResponse, jsonResponse } from "../../utils/openapi.js";

export const keysRoute = new Hono();

keysRoute.get(
	"/me",
	describeRoute({
		tags: ["Keys"],
		summary: "Inspect calling key + usage",
		responses: {
			200: jsonResponse("Key info.", KeyInfo),
			401: errorResponse("Missing or invalid API key."),
		},
	}),
	requireApiKey,
	async (c) => {
		const key = c.var.apiKey;
		// Mirror the dashboard / api enforcement view — past-due grace
		// expiry downgrades the rate-limit tier without rewriting
		// key.tier, so SDK pre-flight code sees the same numbers the
		// middleware enforces a request later.
		const enforced = await effectiveTierForUser(key.userId, key.tier as Tier);
		const usage = await snapshotUsage({ apiKeyId: key.id, userId: key.userId }, enforced);
		return c.json({
			id: key.id,
			tier: key.tier,
			prefix: key.keyPrefix,
			suffix: key.keySuffix,
			name: key.name,
			ownerEmail: key.ownerEmail,
			createdAt: key.createdAt,
			lastUsedAt: key.lastUsedAt,
			usage: usageToWire(usage),
		});
	},
);

keysRoute.post(
	"/revoke",
	describeRoute({
		tags: ["Keys"],
		summary: "Revoke calling key",
		responses: {
			200: jsonResponse("Revoked.", KeyRevokeResponse),
			401: errorResponse("Missing or invalid API key."),
		},
	}),
	requireApiKey,
	async (c) => {
		const key = c.var.apiKey;
		await revokeKey(key.id);
		return c.json({ id: key.id, revoked: true });
	},
);

keysRoute.get(
	"/permissions",
	describeRoute({
		tags: ["Keys"],
		summary: "Per-scope permission status for the calling key",
		description:
			"Same response shape as /v1/me/permissions, but auth'd via the API key so SDK / agent code can preflight without going through the dashboard session. Reflects the eBay binding tied to this specific key (not other keys owned by the same user).",
		responses: {
			200: jsonResponse("Permission map.", PermissionsResponse),
			401: errorResponse("Missing or invalid API key."),
		},
	}),
	requireApiKey,
	async (c) => {
		const key = c.var.apiKey;
		const result = await computePermissionsForApiKey(key.id);
		return c.json(result);
	},
);
