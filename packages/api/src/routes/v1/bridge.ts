/**
 * `/v1/bridge/*` — extension client ↔ hosted-API protocol.
 *
 * The "bridge client" today is the flipagent Chrome extension running in
 * the user's real browser. The protocol is generic enough that any client
 * holding a bridge token (`fbt_…`) can claim and execute jobs — earlier
 * iterations used a Playwright-driven CLI daemon, future ones may use
 * eBay's official Order API once tenant approval lands.
 *
 *   POST /v1/bridge/tokens       issue a long-lived bridge token (auth: api key).
 *   GET  /v1/bridge/poll         client longpolls for the next claimable job.
 *                                Returns 200 { job } or 204 (idle) after the
 *                                longpoll window. Auth: bridge token.
 *   POST /v1/bridge/result       client reports outcome / progress. Auth: bridge token.
 *   POST /v1/bridge/login-status client reports buyer-session state. Auth: bridge token.
 *
 * The longpoll is a lightweight DB poll loop — adequate for the expected
 * volume (one bridge client per user, low order rate). Future: NOTIFY/LISTEN.
 */

import {
	BridgeJob,
	BridgeLoginStatusRequest,
	BridgeLoginStatusResponse,
	BridgeResultRequest,
	BridgeResultResponse,
	IssueBridgeTokenRequest,
	IssueBridgeTokenResponse,
} from "@flipagent/types";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import { issueBridgeToken } from "../../auth/bridge-tokens.js";
import { db } from "../../db/client.js";
import { bridgeTokens } from "../../db/schema.js";
import { requireApiKey } from "../../middleware/auth.js";
import { requireBridgeToken } from "../../middleware/bridge-auth.js";
import { claimNextForApiKey, getOrderForApiKey, transition } from "../../services/orders/queue.js";
import { dispatchOrderEvent } from "../../services/webhooks/dispatch.js";
import { errorResponse, jsonResponse, tbBody } from "../../utils/openapi.js";

export const bridgeRoute = new Hono();

const POLL_WINDOW_MS = Number(process.env.BRIDGE_POLL_WINDOW_MS ?? 25_000);
const POLL_INTERVAL_MS = 1_000;

bridgeRoute.post(
	"/tokens",
	describeRoute({
		tags: ["Bridge"],
		summary: "Issue a bridge token for an extension/bridge client",
		description:
			"Auth: api key. Returns a `fbt_…` plaintext shown once — the flipagent Chrome extension (or any other bridge client) stores it locally and uses it to claim jobs. The bridge token cascades when the parent api key is revoked.",
		responses: {
			201: jsonResponse("Token issued.", IssueBridgeTokenResponse),
			401: errorResponse("Missing or invalid API key."),
		},
	}),
	requireApiKey,
	tbBody(IssueBridgeTokenRequest),
	async (c) => {
		const body = c.req.valid("json");
		const issued = await issueBridgeToken({
			apiKeyId: c.var.apiKey.id,
			userId: c.var.apiKey.userId,
			deviceName: body.deviceName,
		});
		return c.json(
			{ id: issued.id, token: issued.plaintext, prefix: issued.prefix, createdAt: issued.createdAt },
			201,
		);
	},
);

bridgeRoute.get(
	"/poll",
	describeRoute({
		tags: ["Bridge"],
		summary: "Bridge client longpoll — claim next job (or 204 after window)",
		description:
			"Auth: bridge token. Polls every second within the longpoll window for queued jobs belonging to the bridge token's api key. The first match is atomically claimed (FOR UPDATE SKIP LOCKED) and returned. 204 indicates an idle window — the client should reissue immediately. The flipagent Chrome extension's service worker drives this loop on a `chrome.alarms` tick.",
		responses: {
			200: jsonResponse("Job claimed.", BridgeJob),
			204: { description: "No job within the longpoll window. Reissue." },
			401: errorResponse("Missing or invalid bridge token."),
		},
	}),
	requireBridgeToken,
	async (c) => {
		const apiKeyId = c.var.bridgeApiKey.id;
		const tokenId = c.var.bridgeToken.id;
		const deadline = Date.now() + POLL_WINDOW_MS;

		while (Date.now() < deadline) {
			const claimed = await claimNextForApiKey(apiKeyId, tokenId);
			if (claimed) {
				dispatchOrderEvent(apiKeyId, claimed).catch((err) => console.error("[bridge] dispatch claimed:", err));
				// Map source → task. eBay buy queues `ebay_buy_item`; forwarders
				// queue service-specific tasks (`pull_packages` for PE today);
				// `control` queues meta tasks (`reload_extension`); `browser`
				// is the generic primitive (`browser_op`); `ebay_data` is
				// the bridge transport for public-data reads (`ebay_query`).
				const task =
					claimed.source === "planetexpress"
						? ("pull_packages" as const)
						: claimed.source === "control"
							? ("reload_extension" as const)
							: claimed.source === "browser"
								? ("browser_op" as const)
								: claimed.source === "ebay_data"
									? ("ebay_query" as const)
									: ("ebay_buy_item" as const);
				const job = {
					jobId: claimed.id,
					task,
					args: {
						marketplace: claimed.source as "ebay" | "planetexpress" | "control" | "browser" | "ebay_data",
						itemId: claimed.itemId,
						quantity: claimed.quantity,
						maxPriceCents: claimed.maxPriceCents,
						metadata: (claimed.metadata as Record<string, unknown> | null) ?? null,
					},
					issuedAt: new Date().toISOString(),
					expiresAt: claimed.expiresAt.toISOString(),
				};
				return c.json(job);
			}
			// Bail early if the client gave up.
			if (c.req.raw.signal.aborted) return new Response(null, { status: 204 });
			await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
		}
		return new Response(null, { status: 204 });
	},
);

bridgeRoute.post(
	"/result",
	describeRoute({
		tags: ["Bridge"],
		summary: "Bridge client reports outcome / progress for a claimed job",
		description:
			"Auth: bridge token. The same token that claimed must report. Intermediate transitions (`claimed`, `awaiting_user_confirm`, `placing`) are accepted; terminal outcomes (`completed`, `failed`) are sticky — re-reporting is a no-op rather than an error.",
		responses: {
			200: jsonResponse("Acknowledged.", BridgeResultResponse),
			401: errorResponse("Missing or invalid bridge token."),
			404: errorResponse("Job not found or not owned by this token."),
			409: errorResponse("Job already in a terminal state."),
		},
	}),
	requireBridgeToken,
	tbBody(BridgeResultRequest),
	async (c) => {
		const body = c.req.valid("json");
		const apiKeyId = c.var.bridgeApiKey.id;
		const tokenId = c.var.bridgeToken.id;

		const order = await getOrderForApiKey(body.jobId, apiKeyId);
		if (!order) return c.json({ error: "not_found", message: `No job ${body.jobId} for this token.` }, 404);
		if (order.claimedByTokenId !== tokenId) {
			return c.json({ error: "not_owner", message: "This token did not claim that job." }, 404);
		}

		const updated = await transition({
			id: order.id,
			apiKeyId,
			to: body.outcome,
			ebayOrderId: body.ebayOrderId,
			totalCents: body.totalCents,
			receiptUrl: body.receiptUrl,
			failureReason: body.failureReason,
			result: body.result,
		});
		if (!updated) return c.json({ error: "transition_failed", message: "Could not update order." }, 409);

		dispatchOrderEvent(apiKeyId, updated).catch((err) => console.error("[bridge] dispatch result:", err));
		return c.json({ ok: true as const });
	},
);

bridgeRoute.post(
	"/login-status",
	describeRoute({
		tags: ["Bridge"],
		summary: "Bridge client reports browser eBay-login state",
		description:
			"Auth: bridge token. Sent by the flipagent Chrome extension after probing eBay cookies (via `chrome.cookies`) to verify the user is signed into ebay.com. Surfaced back via `GET /v1/connect/ebay/status` and `GET /v1/me/ebay/status` under `bridge.ebayLoggedIn`. Distinct from the server-side seller OAuth (`oauth.*`) — different access mechanism: browser automation vs API token.",
		responses: {
			200: jsonResponse("Acknowledged.", BridgeLoginStatusResponse),
			401: errorResponse("Missing or invalid bridge token."),
		},
	}),
	requireBridgeToken,
	tbBody(BridgeLoginStatusRequest),
	async (c) => {
		const body = c.req.valid("json");
		await db
			.update(bridgeTokens)
			.set({
				ebayLoggedIn: body.loggedIn,
				ebayUserName: body.ebayUserName ?? null,
				verifiedAt: new Date(),
			})
			.where(eq(bridgeTokens.id, c.var.bridgeToken.id));
		return c.json({ ok: true as const });
	},
);
