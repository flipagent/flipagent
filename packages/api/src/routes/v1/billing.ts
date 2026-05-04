/**
 * Billing routes:
 *
 *   Subscription (Stripe Checkout — collects card on first run):
 *     POST /v1/billing/checkout              — create Checkout Session for tier upgrade
 *     POST /v1/billing/portal                — Stripe Customer Portal (manage card / cancel)
 *
 *   Auto-recharge (off-session against the saved card — no manual fire,
 *   no separate "buy credits now" surface; target-balance-driven):
 *     GET  /v1/billing/quote                 — per-amount prices at caller's tier
 *     GET  /v1/billing/auto-recharge         — current auto-recharge config
 *     PUT  /v1/billing/auto-recharge         — enable/disable + set target balance
 *
 *   Stripe → us:
 *     POST /v1/billing/webhook               — signature-verified webhook receiver
 *
 * The actual charge fires from `requireApiKey` middleware
 * (`maybeFireAutoRecharge`) when `creditsRemaining` drops below the
 * user's target balance; routes here only manage configuration.
 */

import {
	BillingAutoRechargeConfig,
	BillingAutoRechargeUpdateRequest,
	BillingCheckoutRequest,
	BillingCheckoutResponse,
	BillingHistoryResponse,
	BillingTopUpQuotesResponse,
	BillingWebhookResponse,
} from "@flipagent/types";
import { eq } from "drizzle-orm";
import { type Context, Hono } from "hono";
import { describeRoute } from "hono-openapi";
import type Stripe from "stripe";
import type { Tier } from "../../auth/keys.js";
import { PACK_DENOMINATIONS, pricePerCreditUsd, targetRangeForTier, topUpPriceCents } from "../../auth/limits.js";
import { createCheckoutSession, createPortalSession } from "../../billing/checkout.js";
import { listBillingHistory } from "../../billing/history.js";
import { readStripeConfig } from "../../billing/stripe.js";
import { handleEvent, verifyAndConstructEvent } from "../../billing/webhook.js";
import { db } from "../../db/client.js";
import { type User, user as userTable } from "../../db/schema.js";
import { requireSession } from "../../middleware/session.js";
import { errorResponse, jsonResponse, tbBody } from "../../utils/openapi.js";

export const billingRoute = new Hono();

/**
 * Top-up gate — `/quote` and the `enabled=true` path of PUT
 * `/auto-recharge` require (a) a paid tier and (b) a saved card on
 * file. Returns the resolved paid tier on success, or a 403 Response
 * the route can return verbatim. One source of truth so the two
 * surfaces can't drift.
 */
function requirePaidWithCard(c: Context, user: User): { tier: Exclude<Tier, "free"> } | Response {
	const tier = user.tier as Tier;
	if (tier === "free") {
		return c.json(
			{ error: "free_tier_no_card" as const, message: "Subscribe to a paid tier first to enable top-ups." },
			403,
		);
	}
	if (!user.stripeCustomerId) {
		return c.json(
			{ error: "no_card_on_file" as const, message: "No saved card. Subscribe via Stripe checkout first." },
			403,
		);
	}
	return { tier };
}

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

billingRoute.get(
	"/invoices",
	describeRoute({
		tags: ["Billing"],
		summary: "Billing history — subscription invoices + top-up receipts",
		description:
			"Unified, newest-first list of Stripe invoices (recurring subscription bills) and standalone charges (auto-recharge top-ups). Each row carries a download URL — hosted invoice page for subscriptions, receipt URL for top-ups. Returns an empty list (200) for users without a Stripe customer record.",
		responses: {
			200: jsonResponse("History.", BillingHistoryResponse),
			401: errorResponse("Not signed in."),
			503: errorResponse("Stripe env not configured."),
		},
	}),
	requireSession,
	async (c) => {
		const cfg = readStripeConfig();
		if (!cfg) return c.json({ error: "billing_not_configured" as const }, 503);
		const user = c.var.user;
		try {
			const transactions = await listBillingHistory(cfg, user.stripeCustomerId);
			return c.json({ transactions });
		} catch (err) {
			console.error("[billing] invoices list failed:", err);
			return c.json(
				{ error: "history_failed" as const, message: err instanceof Error ? err.message : String(err) },
				500,
			);
		}
	},
);

billingRoute.get(
	"/quote",
	describeRoute({
		tags: ["Billing"],
		summary: "Top-up price catalog for the caller's tier",
		description:
			"Lists each catalogued top-up amount (5k/25k/100k credits) with the price in cents at the caller's current tier. Use this to render the dashboard's \"Top up\" dropdown without doing tier math on the frontend.",
		responses: {
			200: jsonResponse("Quotes.", BillingTopUpQuotesResponse),
			401: errorResponse("Not signed in."),
			403: errorResponse("Free tier — upgrade first."),
			503: errorResponse("Stripe env not configured."),
		},
	}),
	requireSession,
	async (c) => {
		if (!readStripeConfig()) {
			return c.json({ error: "billing_not_configured" as const }, 503);
		}
		const gate = requirePaidWithCard(c, c.var.user);
		if (gate instanceof Response) return gate;
		const { tier } = gate;
		const perCredit = pricePerCreditUsd(tier);
		return c.json({
			tier,
			quotes: PACK_DENOMINATIONS.map((credits) => {
				const priceCents = topUpPriceCents(tier, credits);
				return {
					credits,
					priceCents,
					priceDisplay: `$${(priceCents / 100).toFixed(2)}`,
					perCreditUsd: perCredit,
				};
			}),
		});
	},
);

billingRoute.get(
	"/auto-recharge",
	describeRoute({
		tags: ["Billing"],
		summary: "Current auto-recharge config",
		responses: {
			200: jsonResponse("Config.", BillingAutoRechargeConfig),
			401: errorResponse("Not signed in."),
		},
	}),
	requireSession,
	async (c) => {
		const u = c.var.user as typeof c.var.user & {
			autoRechargeEnabled?: boolean | null;
			autoRechargeTarget?: number | null;
			lastAutoRechargeAt?: Date | string | null;
		};
		const lastAt = u.lastAutoRechargeAt
			? typeof u.lastAutoRechargeAt === "string"
				? u.lastAutoRechargeAt
				: u.lastAutoRechargeAt.toISOString()
			: null;
		return c.json({
			enabled: Boolean(u.autoRechargeEnabled),
			targetCredits: u.autoRechargeTarget ?? null,
			lastRechargedAt: lastAt,
		});
	},
);

billingRoute.put(
	"/auto-recharge",
	describeRoute({
		tags: ["Billing"],
		summary: "Enable/disable + configure auto-recharge",
		description:
			"Set a target balance — when credits drop below the target, the saved card is charged for the gap (Stripe-min-bounded). Target range is tier-specific: Hobby 500–10k, Standard 500–50k, Growth 500–200k. Free-tier callers and users with no Stripe customer (no card on file) get 403 — auto-recharge requires a saved card from a prior subscription checkout.",
		responses: {
			200: jsonResponse("Updated.", BillingAutoRechargeConfig),
			400: errorResponse("Target out of range for this tier."),
			401: errorResponse("Not signed in."),
			403: errorResponse("Free tier or no card on file — subscribe first."),
		},
	}),
	requireSession,
	tbBody(BillingAutoRechargeUpdateRequest),
	async (c) => {
		const body = c.req.valid("json");
		const user = c.var.user;

		if (body.enabled) {
			const gate = requirePaidWithCard(c, user);
			if (gate instanceof Response) return gate;
			const range = targetRangeForTier(gate.tier);
			if (body.targetCredits < range.min || body.targetCredits > range.max) {
				return c.json(
					{
						error: "validation_failed",
						message: `targetCredits must be between ${range.min} and ${range.max} for tier '${gate.tier}'.`,
					},
					400,
				);
			}
			await db
				.update(userTable)
				.set({
					autoRechargeEnabled: true,
					autoRechargeTarget: body.targetCredits,
					updatedAt: new Date(),
				})
				.where(eq(userTable.id, user.id));
			return c.json({
				enabled: true,
				targetCredits: body.targetCredits,
				lastRechargedAt: null,
			});
		}

		// Disable path. Keep `autoRechargeTarget` null so the next enable
		// starts from a fresh, explicit choice rather than a stale value.
		await db
			.update(userTable)
			.set({
				autoRechargeEnabled: false,
				autoRechargeTarget: null,
				updatedAt: new Date(),
			})
			.where(eq(userTable.id, user.id));
		return c.json({
			enabled: false,
			targetCredits: null,
			lastRechargedAt: null,
		});
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
		let event: Stripe.Event;
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
