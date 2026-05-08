/**
 * `/v1/ebay/notifications/*` — eBay-required compliance endpoints whose
 * URLs are pinned by the eBay developer portal, not by flipagent's
 * `/v1/<resource>` convention. Today this is just the Marketplace
 * Account Deletion/Closure notification — eBay registered the URL
 * `/v1/ebay/notifications/account-deletion` against the application
 * and starts threatening key deactivation 24h after the endpoint
 * stops 200-acking. Keep the path stable.
 *
 *   GET  /account-deletion?challenge_code=...  ← public, eBay handshake
 *   POST /account-deletion                     ← public, eBay notifies
 *
 * Both routes are unauthenticated by design — eBay calls them with no
 * credentials. The GET handshake's hash (verification token + endpoint
 * URL) is the only thing tying the response back to flipagent.
 *
 * Internal handling on POST is intentionally minimal: log the
 * notificationId + userId for audit and return 200. flipagent stores
 * eBay user identity only in the `ebay_account_links` table (via the
 * api-key OAuth binding); when an account-deletion notice references a
 * userId we hold, the periodic compliance sweep takes care of the
 * actual scrub. The receiving endpoint just acks fast so eBay's
 * 3-second SLA doesn't trip.
 */

import { createHash } from "node:crypto";
import { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import { config, isEbayDeletionConfigured } from "../../config.js";

export const ebayNotificationsRoute = new Hono();

ebayNotificationsRoute.get(
	"/account-deletion",
	describeRoute({
		tags: ["Notifications"],
		summary: "eBay Marketplace Account Deletion — challenge handshake",
		description:
			"GET handshake eBay performs whenever it (re)validates the registered Marketplace Account Deletion notification URL. Returns SHA-256(challengeCode + verificationToken + endpointUrl) hex-encoded as `{ challengeResponse }`. Verification token + endpoint URL come from env (`EBAY_DELETION_VERIFICATION_TOKEN` + `EBAY_DELETION_ENDPOINT_URL`); both must match exactly what's registered in the eBay developer portal.",
		security: [],
		responses: {
			200: { description: "Challenge response." },
			400: { description: "Missing challenge_code query parameter." },
			503: { description: "Deletion endpoint not configured on this api instance." },
		},
	}),
	(c) => {
		const challengeCode = c.req.query("challenge_code");
		if (!challengeCode) return c.json({ error: "missing_challenge_code" }, 400);
		if (!isEbayDeletionConfigured()) return c.json({ error: "not_configured" }, 503);
		const challengeResponse = createHash("sha256")
			.update(challengeCode)
			.update(config.EBAY_DELETION_VERIFICATION_TOKEN as string)
			.update(config.EBAY_DELETION_ENDPOINT_URL as string)
			.digest("hex");
		return c.json({ challengeResponse }, 200);
	},
);

ebayNotificationsRoute.post(
	"/account-deletion",
	describeRoute({
		tags: ["Notifications"],
		summary: "eBay Marketplace Account Deletion — receive notification",
		description:
			"POST endpoint eBay calls with the canonical `{ metadata, notification: { notificationId, eventDate, publishDate, publishAttemptCount, data: { username, userId, eiasToken } } }` envelope when a buyer/seller closes or requests deletion of their eBay account. Always 200-acks within eBay's ~3s SLA so the application doesn't get marked down. Internal scrub (removing the userId from `ebay_account_links`, etc.) runs out-of-band — receipt logging is enough at the wire boundary.",
		security: [],
		responses: { 200: { description: "Acknowledged." } },
	}),
	async (c) => {
		try {
			const body = (await c.req.json().catch(() => null)) as {
				notification?: {
					notificationId?: string;
					publishDate?: string;
					data?: { username?: string; userId?: string; eiasToken?: string };
				};
			} | null;
			console.log(
				"[ebay-account-deletion]",
				JSON.stringify({
					notificationId: body?.notification?.notificationId ?? null,
					userId: body?.notification?.data?.userId ?? null,
					username: body?.notification?.data?.username ?? null,
					publishDate: body?.notification?.publishDate ?? null,
					configured: isEbayDeletionConfigured(),
				}),
			);
		} catch (err) {
			console.warn("[ebay-account-deletion] log failed", err);
		}
		return c.json({ ok: true }, 200);
	},
);
