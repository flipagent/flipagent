/**
 * `/v1/notifications/*` — **inbound** events from marketplaces (eBay etc.)
 * → flipagent. Distinct from `/v1/webhooks/*`, which is **outbound**
 * (flipagent → caller).
 *
 *   POST /v1/notifications/ebay/inbound   ← public, called by eBay
 *   POST /v1/notifications/ebay/subscribe ← auth, run after /v1/connect/ebay
 *   GET  /v1/notifications/ebay/subscribe ← auth, read current prefs
 *
 * The inbound route deliberately returns 200 even on parse / signature
 * failure — eBay retries non-2xx for 24h with exponential backoff, and
 * we'd rather log the bad delivery once than have eBay flood us. We mark
 * `signature_valid=false` on the row so suspect rows are easy to filter
 * (and can be ignored downstream).
 */

import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import { config, isEbayNotificationsConfigured, isEbayOAuthConfigured } from "../../config.js";
import { db } from "../../db/client.js";
import { marketplaceNotifications } from "../../db/schema.js";
import { requireApiKey } from "../../middleware/auth.js";
import { getUserAccessToken } from "../../services/ebay/oauth.js";
import { dispatchNotification } from "../../services/notifications/dispatch.js";
import {
	dedupeKey,
	getNotificationPreferences,
	parseNotification,
	setNotificationPreferences,
	TRACKED_EVENTS,
	verifySignature,
} from "../../services/notifications/ebay-trading.js";
import { errorResponse } from "../../utils/openapi.js";

export const notificationsRoute = new Hono();

notificationsRoute.post(
	"/ebay/inbound",
	describeRoute({
		tags: ["Notifications"],
		summary: "eBay Trading API Platform Notifications receiver",
		description:
			"Public endpoint eBay POSTs SOAP/XML envelopes to. Signature verified locally via DevID + AppID + CertID + message Timestamp. Always returns 200 once the row is logged so eBay does not retry — replays are dropped via sha256 dedupe.",
		responses: {
			200: { description: "Notification logged (idempotent)." },
		},
	}),
	async (c) => {
		const xml = await c.req.text();
		const parsed = parseNotification(xml);
		if (!parsed) {
			// Don't 4xx — eBay would retry. Log and move on.
			await db
				.insert(marketplaceNotifications)
				.values({
					marketplace: "ebay",
					eventType: "unparseable",
					signatureValid: false,
					dedupeKey: dedupeKey(xml),
					payload: { rawXml: xml.slice(0, 8192) },
				})
				.onConflictDoNothing({
					target: [marketplaceNotifications.marketplace, marketplaceNotifications.dedupeKey],
				});
			return c.json({ ok: true, parsed: false }, 200);
		}
		const signatureValid = verifySignature(parsed);
		const result = await dispatchNotification({
			eventType: parsed.eventType,
			timestamp: parsed.timestamp,
			recipientUserId: parsed.recipientUserId,
			transactionId: parsed.transactionId,
			itemId: parsed.itemId,
			amountCents: parsed.amountCents,
			currency: parsed.currency,
			signatureValid,
			dedupeKey: dedupeKey(xml),
			rawPayload: parsed.raw,
		});
		return c.json(
			{
				ok: true,
				parsed: true,
				stored: result.stored,
				signatureValid,
				eventType: parsed.eventType,
				notificationId: result.notificationId?.toString() ?? null,
				recordedExpense: result.expense?.id?.toString() ?? null,
				processError: result.error,
			},
			200,
		);
	},
);

notificationsRoute.post(
	"/ebay/subscribe",
	describeRoute({
		tags: ["Notifications"],
		summary: "Subscribe the connected eBay seller to flipagent notifications",
		description:
			"Calls Trading API SetNotificationPreferences with EBAY_NOTIFY_URL as the callback and enables ItemSold + AuctionCheckoutComplete + FixedPriceTransaction + OutBid + ItemUnsold for this user. Idempotent — safe to retry.",
		responses: {
			200: { description: "Subscription updated." },
			401: errorResponse("API key missing or eBay account not connected."),
			503: errorResponse(
				"EBAY_DEV_ID / EBAY_NOTIFY_URL unset — set both alongside EBAY_CLIENT_ID/SECRET to enable.",
			),
			502: errorResponse("Upstream Trading API call failed."),
		},
	}),
	requireApiKey,
	async (c) => {
		if (!isEbayOAuthConfigured() || !isEbayNotificationsConfigured()) {
			return c.json({ error: "not_configured" }, 503);
		}
		const apiKey = c.get("apiKey") as { id: string };
		let accessToken: string;
		try {
			accessToken = await getUserAccessToken(apiKey.id);
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			if (msg === "not_connected") return c.json({ error: "not_connected" }, 401);
			return c.json({ error: "token_refresh_failed", detail: msg }, 502);
		}
		try {
			const out = await setNotificationPreferences(accessToken);
			if (out.ack === "Failure") {
				return c.json({ error: "set_prefs_failed", errors: out.errors }, 502);
			}
			return c.json(
				{
					ok: true,
					ack: out.ack,
					callbackUrl: config.EBAY_NOTIFY_URL,
					events: TRACKED_EVENTS,
					warnings: out.errors,
				},
				200,
			);
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			return c.json({ error: "upstream_failed", detail: msg }, 502);
		}
	},
);

notificationsRoute.get(
	"/ebay/subscribe",
	describeRoute({
		tags: ["Notifications"],
		summary: "Read the current eBay notification subscription for this seller",
		responses: {
			200: { description: "Current ApplicationURL + enabled events." },
			401: errorResponse("API key missing or eBay account not connected."),
			503: errorResponse("EBAY_DEV_ID / EBAY_NOTIFY_URL unset."),
		},
	}),
	requireApiKey,
	async (c) => {
		if (!isEbayOAuthConfigured() || !isEbayNotificationsConfigured()) {
			return c.json({ error: "not_configured" }, 503);
		}
		const apiKey = c.get("apiKey") as { id: string };
		let accessToken: string;
		try {
			accessToken = await getUserAccessToken(apiKey.id);
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			if (msg === "not_connected") return c.json({ error: "not_connected" }, 401);
			return c.json({ error: "token_refresh_failed", detail: msg }, 502);
		}
		try {
			const out = await getNotificationPreferences(accessToken);
			return c.json(
				{
					ok: true,
					ack: out.ack,
					applicationUrl: out.applicationUrl,
					applicationEnabled: out.applicationEnabled,
					enabledEvents: out.enabledEvents,
					trackedEvents: TRACKED_EVENTS,
					expectedCallbackUrl: config.EBAY_NOTIFY_URL,
				},
				200,
			);
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			return c.json({ error: "upstream_failed", detail: msg }, 502);
		}
	},
);

notificationsRoute.get(
	"/recent",
	describeRoute({
		tags: ["Notifications"],
		summary: "Last 50 inbound platform notifications for this account (debug)",
		responses: { 200: { description: "Recent notifications." } },
	}),
	requireApiKey,
	async (c) => {
		const apiKey = c.get("apiKey") as { id: string };
		const rows = await db
			.select({
				id: marketplaceNotifications.id,
				eventType: marketplaceNotifications.eventType,
				externalId: marketplaceNotifications.externalId,
				signatureValid: marketplaceNotifications.signatureValid,
				receivedAt: marketplaceNotifications.receivedAt,
				processedAt: marketplaceNotifications.processedAt,
				processError: marketplaceNotifications.processError,
			})
			.from(marketplaceNotifications)
			.where(eq(marketplaceNotifications.apiKeyId, apiKey.id))
			.orderBy(marketplaceNotifications.receivedAt)
			.limit(50);
		return c.json({
			notifications: rows.map((r) => ({
				...r,
				id: r.id.toString(),
			})),
		});
	},
);
