/**
 * `/v1/me/devices/*` — session-cookie auth (Better-Auth via /api/auth).
 * Powers the Chrome extension's OAuth onboarding and the dashboard's
 * "Connected devices" panel.
 *
 *   POST   /v1/me/devices         issue a fresh bridge token (and a default
 *                                 api key if the user has none) — the
 *                                 single endpoint the /extension/connect
 *                                 page hits to mint credentials it forwards
 *                                 to the extension via `chrome.runtime.sendMessage`.
 *   GET    /v1/me/devices         list active bridge tokens for the user
 *   DELETE /v1/me/devices/:id     revoke one bridge token
 *
 * Mounted as a child of `/v1/me`, so `requireSession` from the parent
 * applies — no auth middleware here.
 *
 * Reuse rules:
 *   - Bridge token issuance goes through `auth/bridge-tokens.ts` —
 *     same primitives as the agent-facing `POST /v1/bridge/tokens`. The
 *     two routes diverge only on auth (apiKey vs session) and on whether
 *     they auto-mint a default api key when the user has none.
 *   - API key issuance goes through `auth/keys.ts` `issueKey` — same
 *     plaintext-shown-once contract as `POST /v1/me/keys`.
 *   - No new tables. The "device" view is just the existing
 *     `bridge_tokens` row, projected for the dashboard.
 */

import {
	MeDeviceConnectRequest,
	MeDeviceConnectResponse,
	MeDeviceList,
	MeDeviceRevokeResponse,
} from "@flipagent/types";
import { and, desc, eq, isNull } from "drizzle-orm";
import { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import {
	getBridgeTokenForUser,
	issueBridgeToken,
	listBridgeTokensForUser,
	revokeBridgeToken,
} from "../../auth/bridge-tokens.js";
import { issueKey, type Tier } from "../../auth/keys.js";
import { db } from "../../db/client.js";
import { apiKeys, type BridgeToken } from "../../db/schema.js";
import { errorResponse, jsonResponse, tbBody } from "../../utils/openapi.js";

export const meDevicesRoute = new Hono();

meDevicesRoute.get(
	"/",
	describeRoute({
		tags: ["Dashboard"],
		summary: "List active bridge tokens (connected devices) for the caller",
		description:
			"One row per device that completed the `/extension/connect` handshake. Drives the dashboard's Connected Devices panel. Plaintext token is never returned here — only metadata (name, prefix, last seen, eBay login state).",
		responses: {
			200: jsonResponse("Devices.", MeDeviceList),
			401: errorResponse("Not signed in."),
		},
	}),
	async (c) => {
		const user = c.var.user;
		const rows = await listBridgeTokensForUser(user.id);
		return c.json({ devices: rows.map(toWire) });
	},
);

meDevicesRoute.post(
	"/",
	describeRoute({
		tags: ["Dashboard"],
		summary: "Connect a new device — issues bridgeToken (and an api key if absent)",
		description:
			"Called from the `/extension/connect` page after the user clicks Connect. Resolves the user's most recent active api key, auto-issuing a default one when the user has none, and mints a fresh bridge token bound to that key. Both plaintext values are returned exactly once; the page hands them off to the Chrome extension via `chrome.runtime.sendMessage` and discards them.",
		responses: {
			201: jsonResponse("Device connected; credentials returned (one-shot).", MeDeviceConnectResponse),
			401: errorResponse("Not signed in."),
		},
	}),
	tbBody(MeDeviceConnectRequest),
	async (c) => {
		const user = c.var.user;
		const body = c.req.valid("json");
		const deviceName = body.deviceName?.trim() || "browser";

		// Resolve the api key this device's bridge token binds to. Most
		// recent active key wins (matches `pickPrimaryKey` in me-ebay.ts).
		// When the user has none — common for fresh sign-ups whose only
		// auth is the dashboard session — auto-issue a default key so the
		// extension has an api-key credential to use for non-bridge calls
		// like `POST /v1/evaluate/jobs`.
		const existing = await db
			.select({ id: apiKeys.id, plaintext: apiKeys.keyCiphertext, tier: apiKeys.tier })
			.from(apiKeys)
			.where(and(eq(apiKeys.userId, user.id), isNull(apiKeys.revokedAt)))
			.orderBy(desc(apiKeys.createdAt))
			.limit(1);

		let apiKeyId: string;
		let apiKeyPlaintext: string;
		let apiKeyTier: Tier;

		if (existing[0]) {
			// Reveal the at-rest ciphertext so the extension gets a usable
			// plaintext. Same path the dashboard's "reveal" button uses.
			const { decryptKeyPlaintext, isKeyRevealConfigured } = await import("../../auth/key-cipher.js");
			if (existing[0].plaintext && isKeyRevealConfigured()) {
				apiKeyId = existing[0].id;
				apiKeyPlaintext = decryptKeyPlaintext(existing[0].plaintext);
				apiKeyTier = existing[0].tier as Tier;
			} else {
				// Legacy key without stored ciphertext, or KEYS_ENCRYPTION_KEY
				// unset — we can't surface a plaintext. Issue a fresh key so
				// the extension always walks away with something usable.
				const issued = await issueKey({
					tier: user.tier as Tier,
					name: `extension-${deviceName}`,
					ownerEmail: user.email,
					userId: user.id,
				});
				apiKeyId = issued.id;
				apiKeyPlaintext = issued.plaintext;
				apiKeyTier = issued.tier;
			}
		} else {
			const issued = await issueKey({
				tier: user.tier as Tier,
				name: `extension-${deviceName}`,
				ownerEmail: user.email,
				userId: user.id,
			});
			apiKeyId = issued.id;
			apiKeyPlaintext = issued.plaintext;
			apiKeyTier = issued.tier;
		}

		const issuedToken = await issueBridgeToken({
			apiKeyId,
			userId: user.id,
			deviceName,
		});

		// Re-fetch the freshly inserted row to project the wire shape via
		// the same `toWire` mapper the list endpoint uses — keeps a single
		// source of truth for what a "device" looks like on the wire.
		const fresh = await getBridgeTokenForUser(issuedToken.id, user.id);
		if (!fresh) {
			// Should never happen — we just inserted it under this userId.
			throw new Error("bridge token missing after issue");
		}

		return c.json(
			{
				device: toWire(fresh),
				apiKey: {
					id: apiKeyId,
					plaintext: apiKeyPlaintext,
					tier: apiKeyTier,
				},
				bridgeToken: {
					id: issuedToken.id,
					plaintext: issuedToken.plaintext,
					prefix: issuedToken.prefix,
				},
			},
			201,
		);
	},
);

meDevicesRoute.delete(
	"/:id",
	describeRoute({
		tags: ["Dashboard"],
		summary: "Revoke a connected device's bridge token",
		description:
			"Idempotent — calling on an already-revoked or missing-for-this-user token returns 404. Does not revoke the parent api key (other devices keep working).",
		responses: {
			200: jsonResponse("Revoked.", MeDeviceRevokeResponse),
			401: errorResponse("Not signed in."),
			404: errorResponse("Device not found or not owned by caller."),
		},
	}),
	async (c) => {
		const user = c.var.user;
		const id = c.req.param("id");
		const row = await getBridgeTokenForUser(id, user.id);
		if (!row || row.revokedAt) {
			return c.json({ error: "not_found" as const }, 404);
		}
		await revokeBridgeToken(id);
		return c.json({ id, revoked: true });
	},
);

function toWire(row: BridgeToken) {
	return {
		id: row.id,
		deviceName: row.deviceName,
		tokenPrefix: row.tokenPrefix,
		ebayLoggedIn: row.ebayLoggedIn,
		ebayUserName: row.ebayUserName,
		createdAt: row.createdAt.toISOString(),
		lastSeenAt: row.lastSeenAt ? row.lastSeenAt.toISOString() : null,
	};
}
