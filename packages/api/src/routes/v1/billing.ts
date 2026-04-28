/**
 * Billing routes (session-cookie auth — dashboard only):
 *   POST /v1/billing/checkout    — create Stripe Checkout Session for the user
 *   POST /v1/billing/portal      — Stripe Customer Portal session (manage card / cancel)
 *   POST /v1/billing/webhook     — Stripe → us; signature verified, no auth
 */

import { BillingCheckoutRequest, BillingCheckoutResponse, BillingWebhookResponse } from "@flipagent/types";
import { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import { createCheckoutSession, createPortalSession } from "../../billing/checkout.js";
import { readStripeConfig } from "../../billing/stripe.js";
import { handleEvent, verifyAndConstructEvent } from "../../billing/webhook.js";
import { requireSession } from "../../middleware/session.js";
import { errorResponse, jsonResponse, tbBody } from "../../utils/openapi.js";

export const billingRoute = new Hono();

billingRoute.post(
	"/checkout",
	describeRoute({
		tags: ["Billing"],
		summary: "Create a Stripe Checkout Session",
		responses: {
			200: jsonResponse("Stripe-hosted checkout URL.", BillingCheckoutResponse),
			400: errorResponse("Validation failed."),
			401: errorResponse("Not signed in."),
			503: errorResponse("Stripe env not configured on this api instance."),
		},
	}),
	requireSession,
	tbBody(BillingCheckoutRequest),
	async (c) => {
		const cfg = readStripeConfig();
		if (!cfg) {
			return c.json({ error: "billing_not_configured" as const, message: "Stripe env vars not set." }, 503);
		}
		const { tier } = c.req.valid("json");
		const user = c.var.user;
		try {
			const session = await createCheckoutSession(cfg, { user, tier });
			return c.json({ url: session.url ?? "" });
		} catch (err) {
			console.error("[billing] checkout failed:", err);
			return c.json(
				{ error: "checkout_failed" as const, message: err instanceof Error ? err.message : String(err) },
				500,
			);
		}
	},
);

billingRoute.post(
	"/portal",
	describeRoute({
		tags: ["Billing"],
		summary: "Open the Stripe Customer Portal",
		responses: {
			200: jsonResponse("Portal URL.", BillingCheckoutResponse),
			401: errorResponse("Not signed in."),
			404: errorResponse("User has no Stripe customer (upgrade first)."),
			503: errorResponse("Stripe env not configured on this api instance."),
		},
	}),
	requireSession,
	async (c) => {
		const cfg = readStripeConfig();
		if (!cfg) {
			return c.json({ error: "billing_not_configured" as const }, 503);
		}
		const user = c.var.user;
		if (!user.stripeCustomerId) {
			return c.json({ error: "not_found" as const, message: "Upgrade first to manage billing." }, 404);
		}
		try {
			const portal = await createPortalSession(cfg, { user });
			return c.json({ url: portal.url });
		} catch (err) {
			console.error("[billing] portal failed:", err);
			return c.json(
				{ error: "checkout_failed" as const, message: err instanceof Error ? err.message : String(err) },
				500,
			);
		}
	},
);

billingRoute.post(
	"/webhook",
	describeRoute({
		tags: ["Billing"],
		summary: "Stripe → flipagent webhook",
		description: "Stripe-signed; calls from anything else return 400.",
		security: [],
		responses: {
			200: jsonResponse("Event accepted.", BillingWebhookResponse),
			400: errorResponse("Missing or invalid signature."),
			503: errorResponse("Stripe env not configured on this api instance."),
		},
	}),
	async (c) => {
		const cfg = readStripeConfig();
		if (!cfg) {
			return c.json({ error: "billing_not_configured" as const }, 503);
		}
		const sig = c.req.header("stripe-signature");
		if (!sig) {
			return c.json({ error: "missing_signature" as const }, 400);
		}
		const rawBody = await c.req.text();
		let event: Awaited<ReturnType<typeof verifyAndConstructEvent>>;
		try {
			event = await verifyAndConstructEvent(cfg, rawBody, sig);
		} catch (err) {
			return c.json(
				{ error: "invalid_signature" as const, message: err instanceof Error ? err.message : String(err) },
				400,
			);
		}
		try {
			await handleEvent(cfg, event);
		} catch (err) {
			console.error("[billing] webhook handler failed:", err);
			return c.json({ error: "handler_failed" as const }, 500);
		}
		return c.json({ received: true });
	},
);
