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
	type BridgeJobSource,
	BridgeLoginStatusRequest,
	BridgeLoginStatusResponse,
	BridgePeLoginStatusRequest,
	BridgePollJob,
	BridgeResultRequest,
	BridgeResultResponse,
	IssueBridgeTokenRequest,
	IssueBridgeTokenResponse,
} from "@flipagent/types";
import { Type } from "@sinclair/typebox";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import { issueBridgeToken } from "../../auth/bridge-tokens.js";
import { db } from "../../db/client.js";
import { bridgeTokens } from "../../db/schema.js";
import { requireApiKey } from "../../middleware/auth.js";
import { requireBridgeToken } from "../../middleware/bridge-auth.js";
import { CaptureRateLimitError, captureDetail } from "../../services/bridge-capture.js";
import { claimNextForApiKey, getJobForApiKey, transition } from "../../services/bridge-jobs.js";
import { bridgeTaskForOrder } from "../../services/ebay/bridge/tasks.js";
import { reconcileBridgeResult } from "../../services/forwarder/reconcile.js";
import { dispatchCycleEvent, dispatchOrderEvent } from "../../services/webhooks.js";
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
			200: jsonResponse("Job claimed.", BridgePollJob),
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
				// Pick the canonical bridge task. `bridgeTaskForOrder` reads
				// metadata.task when set (forwarder photos / dispatch /
				// future per-action jobs) and falls back to source-only
				// mapping otherwise — keeps the extension's recipe runtime
				// keyed on a single discriminator (task name).
				const task = bridgeTaskForOrder(claimed.source, claimed.metadata as Record<string, unknown> | null);
				const job = {
					jobId: claimed.id,
					task,
					args: {
						source: claimed.source as BridgeJobSource,
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

		const job = await getJobForApiKey(body.jobId, apiKeyId);
		if (!job) return c.json({ error: "not_found", message: `No job ${body.jobId} for this token.` }, 404);
		if (job.claimedByTokenId !== tokenId) {
			return c.json({ error: "not_owner", message: "This token did not claim that job." }, 404);
		}

		const updated = await transition({
			id: job.id,
			apiKeyId,
			to: body.outcome,
			ebayOrderId: body.ebayOrderId,
			totalCents: body.totalCents,
			receiptUrl: body.receiptUrl,
			failureReason: body.failureReason,
			result: body.result,
		});
		if (!updated) return c.json({ error: "transition_failed", message: "Could not update job." }, 409);

		dispatchOrderEvent(apiKeyId, updated).catch((err) => console.error("[bridge] dispatch result:", err));
		// Fire cycle webhooks for the agent automation surface and
		// reconcile the local forwarder_inventory table. The job's
		// `metadata.kind` discriminator picks which event/reconcile
		// path to use; buy-side (no metadata.kind) is already covered
		// by `dispatchOrderEvent` above. All cycle events carry just
		// enough payload for the agent to act without a follow-up GET.
		if (updated.status === "completed") {
			const meta = (updated.metadata as Record<string, unknown> | null) ?? null;
			const result = (updated.result as Record<string, unknown> | null) ?? null;
			// Await reconcile so the route doesn't return — and the
			// webhook doesn't fire — until the local forwarder_inventory
			// row reflects the new state. Receivers that immediately query
			// /v1/forwarder/{provider}/inventory then see fresh state, and
			// CI tests that assert the post-result row no longer race the
			// fire-and-forget. Errors are still logged + swallowed so the
			// webhook delivery downstream isn't blocked on reconcile failure.
			await reconcileBridgeResult({
				apiKeyId,
				source: updated.source,
				kind: typeof meta?.kind === "string" ? (meta.kind as string) : null,
				itemId: updated.itemId,
				metadata: meta,
				result,
			}).catch((err) => console.error("[bridge] inventory reconcile:", err));

			if (meta?.kind === "forwarder.refresh") {
				dispatchCycleEvent(apiKeyId, "forwarder.received", {
					provider: updated.source,
					packages: result?.packages ?? [],
				}).catch((err) => console.error("[bridge] forwarder.received webhook:", err));
			} else if (meta?.kind === "forwarder.dispatch") {
				dispatchCycleEvent(apiKeyId, "forwarder.shipped", {
					provider: updated.source,
					packageId: updated.itemId,
					ebayOrderId: (meta.request as Record<string, unknown> | undefined)?.ebayOrderId ?? null,
					shipment: result?.shipment ?? null,
				}).catch((err) => console.error("[bridge] forwarder.shipped webhook:", err));
			}
		}
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

bridgeRoute.post(
	"/pe-login-status",
	describeRoute({
		tags: ["Bridge"],
		summary: "Bridge client reports Planet Express login state",
		description:
			"Auth: bridge token. Sent by the extension's content script after URL-probing app.planetexpress.com. Surfaced back via `/v1/capabilities.checklist` (planetexpress step status) so dashboard + MCP see the same 'done' state the popup does. Mirrors `/v1/bridge/login-status` but for the forwarder — distinct upstream + cookies, no overlap.",
		responses: {
			200: jsonResponse("Acknowledged.", BridgeLoginStatusResponse),
			401: errorResponse("Missing or invalid bridge token."),
		},
	}),
	requireBridgeToken,
	tbBody(BridgePeLoginStatusRequest),
	async (c) => {
		const body = c.req.valid("json");
		await db
			.update(bridgeTokens)
			.set({ peLoggedIn: body.loggedIn, peVerifiedAt: new Date() })
			.where(eq(bridgeTokens.id, c.var.bridgeToken.id));
		return c.json({ ok: true as const });
	},
);

/**
 * `POST /v1/bridge/capture` — passive capture intake.
 *
 * The Chrome extension's content script parses every public eBay PDP /
 * search page the user visits (when they've opted in) via the same
 * `parseEbayDetailHtml` we use for scrape, then pushes the parsed payload
 * here. We normalise + cache it so the next `/v1/items/*` call for that
 * itemId hits the captured copy instead of issuing a fresh scrape —
 * users with the toggle on naturally seed the catalog as they browse.
 *
 * Privacy: the `url` is verified against an allow / deny list inside
 * `captureDetail` before any storage happens. Personal pages (My eBay,
 * checkout, sign-in, seller hub) are rejected with `private_url` and
 * never persisted.
 */
const BridgeCaptureRequest = Type.Object(
	{
		url: Type.String({ description: "The eBay URL the page was captured from. Must be /itm/, /p/, or /sch/." }),
		rawDetail: Type.Any({
			description:
				"`EbayItemDetail` shape returned by `parseEbayDetailHtml` from `@flipagent/ebay-scraper`. Loose-typed here because the schema is owned by the scraper package.",
		}),
	},
	{ $id: "BridgeCaptureRequest" },
);
const BridgeCaptureResponse = Type.Object(
	{
		stored: Type.Boolean(),
		itemId: Type.Optional(Type.String()),
		reason: Type.Optional(Type.String()),
		cachedFor: Type.Optional(Type.Integer({ description: "TTL seconds the cached entry remains valid." })),
	},
	{ $id: "BridgeCaptureResponse" },
);

bridgeRoute.post(
	"/capture",
	describeRoute({
		tags: ["Bridge"],
		summary: "Push a parsed eBay PDP into the response cache",
		description:
			"Auth: bridge token. Validates the source URL, normalises the parsed `EbayItemDetail` payload through the same `ebayDetailToBrowse()` the scrape transport uses, and writes the resulting `ItemDetail` to the response cache. Subsequent `/v1/items/{itemId}` lookups hit the cached copy without scraping. Personal-page URLs and rate-limited callers receive a 200 with `stored: false`.",
		responses: {
			200: jsonResponse("Capture processed (stored or rejected with reason).", BridgeCaptureResponse),
			401: errorResponse("Missing or invalid bridge token."),
			429: errorResponse("Rate limit exceeded — 60 captures per 60 seconds per api key."),
		},
	}),
	requireBridgeToken,
	tbBody(BridgeCaptureRequest),
	async (c) => {
		const body = c.req.valid("json");
		const apiKeyId = c.var.bridgeApiKey.id;
		try {
			const r = await captureDetail({ apiKeyId, url: body.url, rawDetail: body.rawDetail });
			return c.json(r);
		} catch (err) {
			if (err instanceof CaptureRateLimitError) {
				return c.json({ error: "rate_limited", message: "60 captures per 60 seconds per api key." }, 429);
			}
			throw err;
		}
	},
);
