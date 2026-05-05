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

import { NotificationSubscriptionCreate, NotificationSubscriptionsListResponse } from "@flipagent/types";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import { config, isEbayNotificationsConfigured, isEbayOAuthConfigured } from "../../config.js";
import { db } from "../../db/client.js";
import { marketplaceNotifications } from "../../db/schema.js";
import { requireApiKey } from "../../middleware/auth.js";
import { getUserAccessToken } from "../../services/ebay/oauth.js";
import {
	createSubscription,
	createSubscriptionFilter,
	deleteSubscription,
	deleteSubscriptionFilter,
	disableSubscription,
	enableSubscription,
	getNotificationConfig,
	getPublicKey,
	getSubscription,
	getSubscriptionFilter,
	listDestinations,
	listSubscriptions,
	listTopics,
	testSubscription,
	updateNotificationConfig,
} from "../../services/notification-subs.js";
import { dispatchNotification } from "../../services/notifications/dispatch.js";
import {
	dedupeKey,
	getNotificationPreferences,
	parseNotification,
	setNotificationPreferences,
	TRACKED_EVENTS,
	verifySignature,
} from "../../services/notifications/ebay-trading.js";
import { errorResponse, jsonResponse, tbBody } from "../../utils/openapi.js";

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
					marketplace: "ebay_us",
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

/* ----- /v1/notifications subscriptions (user → destinations) -------- */

const SUBS_COMMON = { 401: errorResponse("Auth missing."), 502: errorResponse("Upstream eBay failed.") };

notificationsRoute.get(
	"/topics",
	describeRoute({
		tags: ["Notifications"],
		summary: "List available notification topics",
		responses: { 200: { description: "Topics." }, ...SUBS_COMMON },
	}),
	requireApiKey,
	async (c) => c.json({ ...(await listTopics({ apiKeyId: c.var.apiKey.id })), source: "rest" as const }),
);

notificationsRoute.get(
	"/destinations",
	describeRoute({
		tags: ["Notifications"],
		summary: "List notification destinations",
		responses: { 200: { description: "Destinations." }, ...SUBS_COMMON },
	}),
	requireApiKey,
	async (c) => c.json({ ...(await listDestinations({ apiKeyId: c.var.apiKey.id })), source: "rest" as const }),
);

notificationsRoute.get(
	"/subscriptions",
	describeRoute({
		tags: ["Notifications"],
		summary: "List subscriptions",
		responses: { 200: jsonResponse("Subscriptions.", NotificationSubscriptionsListResponse), ...SUBS_COMMON },
	}),
	requireApiKey,
	async (c) => c.json({ ...(await listSubscriptions({ apiKeyId: c.var.apiKey.id })), source: "rest" as const }),
);

notificationsRoute.post(
	"/subscriptions",
	describeRoute({
		tags: ["Notifications"],
		summary: "Create subscription",
		responses: { 201: { description: "Created." }, ...SUBS_COMMON },
	}),
	requireApiKey,
	tbBody(NotificationSubscriptionCreate),
	async (c) => c.json(await createSubscription(c.req.valid("json"), { apiKeyId: c.var.apiKey.id }), 201),
);

notificationsRoute.get(
	"/subscriptions/:id",
	describeRoute({
		tags: ["Notifications"],
		summary: "Get subscription",
		responses: { 200: { description: "Subscription." }, 404: errorResponse("Not found."), ...SUBS_COMMON },
	}),
	requireApiKey,
	async (c) => {
		const r = await getSubscription(c.req.param("id"), { apiKeyId: c.var.apiKey.id });
		if (!r) return c.json({ error: "subscription_not_found" }, 404);
		return c.json(r);
	},
);

notificationsRoute.delete(
	"/subscriptions/:id",
	describeRoute({
		tags: ["Notifications"],
		summary: "Delete subscription",
		responses: { 204: { description: "Deleted." }, ...SUBS_COMMON },
	}),
	requireApiKey,
	async (c) => {
		await deleteSubscription(c.req.param("id"), { apiKeyId: c.var.apiKey.id });
		return c.body(null, 204);
	},
);

notificationsRoute.post(
	"/subscriptions/:id/enable",
	describeRoute({
		tags: ["Notifications"],
		summary: "Enable a paused subscription",
		responses: { 204: { description: "Enabled." }, ...SUBS_COMMON },
	}),
	requireApiKey,
	async (c) => {
		await enableSubscription(c.req.param("id"), { apiKeyId: c.var.apiKey.id });
		return c.body(null, 204);
	},
);

notificationsRoute.post(
	"/subscriptions/:id/disable",
	describeRoute({
		tags: ["Notifications"],
		summary: "Disable an active subscription (events stop firing)",
		responses: { 204: { description: "Disabled." }, ...SUBS_COMMON },
	}),
	requireApiKey,
	async (c) => {
		await disableSubscription(c.req.param("id"), { apiKeyId: c.var.apiKey.id });
		return c.body(null, 204);
	},
);

notificationsRoute.post(
	"/subscriptions/:id/test",
	describeRoute({
		tags: ["Notifications"],
		summary: "Send a test event to the destination",
		description:
			"eBay POSTs a synthetic event payload to the destination URL wired on this subscription. Use this to verify webhook delivery + signature verification round-trip end-to-end before relying on live events.",
		responses: { 204: { description: "Test dispatched." }, ...SUBS_COMMON },
	}),
	requireApiKey,
	async (c) => {
		await testSubscription(c.req.param("id"), { apiKeyId: c.var.apiKey.id });
		return c.body(null, 204);
	},
);

notificationsRoute.get(
	"/subscriptions/:id/filters/:filterId",
	describeRoute({
		tags: ["Notifications"],
		summary: "Get one subscription filter",
		responses: { 200: { description: "Filter." }, 404: errorResponse("Not found."), ...SUBS_COMMON },
	}),
	requireApiKey,
	async (c) => {
		const filter = await getSubscriptionFilter(c.req.param("id"), c.req.param("filterId"), {
			apiKeyId: c.var.apiKey.id,
		});
		if (!filter) return c.json({ error: "filter_not_found" }, 404);
		return c.json(filter);
	},
);

notificationsRoute.post(
	"/subscriptions/:id/filters",
	describeRoute({
		tags: ["Notifications"],
		summary: "Add a filter expression to a subscription",
		description:
			"Filter expressions narrow which events fire on this subscription (e.g. only events for a specific listing). See eBay docs for filter expression syntax.",
		responses: { 201: { description: "Filter created." }, ...SUBS_COMMON },
	}),
	requireApiKey,
	async (c) => {
		const body = (await c.req.json()) as { expression: string };
		const result = await createSubscriptionFilter(c.req.param("id"), body.expression, {
			apiKeyId: c.var.apiKey.id,
		});
		return c.json(result, 201);
	},
);

notificationsRoute.delete(
	"/subscriptions/:id/filters/:filterId",
	describeRoute({
		tags: ["Notifications"],
		summary: "Remove a subscription filter",
		responses: { 204: { description: "Removed." }, ...SUBS_COMMON },
	}),
	requireApiKey,
	async (c) => {
		await deleteSubscriptionFilter(c.req.param("id"), c.req.param("filterId"), {
			apiKeyId: c.var.apiKey.id,
		});
		return c.body(null, 204);
	},
);

notificationsRoute.get(
	"/config",
	describeRoute({
		tags: ["Notifications"],
		summary: "Get notification config (alert email)",
		responses: { 200: { description: "Config." }, ...SUBS_COMMON },
	}),
	requireApiKey,
	async (c) => c.json(await getNotificationConfig({ apiKeyId: c.var.apiKey.id })),
);

notificationsRoute.put(
	"/config",
	describeRoute({
		tags: ["Notifications"],
		summary: "Update notification config (alert email destination)",
		responses: { 204: { description: "Updated." }, ...SUBS_COMMON },
	}),
	requireApiKey,
	async (c) => {
		const body = (await c.req.json()) as { alertEmail?: string | null };
		await updateNotificationConfig(body, { apiKeyId: c.var.apiKey.id });
		return c.body(null, 204);
	},
);

notificationsRoute.get(
	"/public-keys/:id",
	describeRoute({
		tags: ["Notifications"],
		summary: "Get a notification signing public key",
		description:
			"eBay rotates webhook signing keys. The kid header on inbound notifications references one of these keys; fetch it here to verify signatures locally.",
		responses: { 200: { description: "Public key." }, 404: errorResponse("Not found."), ...SUBS_COMMON },
	}),
	requireApiKey,
	async (c) => {
		const key = await getPublicKey(c.req.param("id"), { apiKeyId: c.var.apiKey.id });
		if (!key) return c.json({ error: "key_not_found" }, 404);
		return c.json(key);
	},
);
