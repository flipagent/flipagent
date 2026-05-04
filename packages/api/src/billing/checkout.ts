/**
 * Stripe checkout helpers — two flows, one billing/stripe client:
 *
 *   createCheckoutSession  → mode=subscription, tier upgrade.
 *                            Stripe-hosted page so the *first*
 *                            transaction sets up + saves the card.
 *   triggerAutoRecharge    → off-session PaymentIntent against
 *                            `customer.invoice_settings.
 *                            default_payment_method` (the card
 *                            saved by the subscription checkout
 *                            above). Fires from the api middleware
 *                            when the user's `creditsRemaining`
 *                            drops below their configured threshold.
 *                            No manual / "buy credits now" surface —
 *                            auto-recharge is the only top-up path.
 *
 * The webhook (billing/webhook.ts) does the actual grant insertion or
 * tier upgrade once Stripe confirms.
 */

import { eq } from "drizzle-orm";
import type Stripe from "stripe";
import type { Tier } from "../auth/keys.js";
import { ensureValidCreditAmount, topUpPriceCents } from "../auth/limits.js";
import { config } from "../config.js";
import { db } from "../db/client.js";
import { type User, user as userTable } from "../db/schema.js";
import { type PaidTier, priceIdForTier, type StripeConfig, stripeClient } from "./stripe.js";

export interface CheckoutInput {
	user: User;
	tier: PaidTier;
}

/**
 * Lazy customer.create — first checkout creates the Stripe customer
 * row + persists `stripeCustomerId` on the user. Subsequent checkouts
 * reuse it. Pulled into a helper so manual + auto-recharge share the
 * exact same path (and `customer.invoice_settings.default_payment_method`
 * gets populated by the very first subscription checkout).
 */
async function ensureStripeCustomer(cfg: StripeConfig, user: User): Promise<string> {
	if (user.stripeCustomerId) return user.stripeCustomerId;
	const customer = await stripeClient(cfg).customers.create({
		email: user.email,
		name: user.name,
		metadata: { userId: user.id },
	});
	await db
		.update(userTable)
		.set({ stripeCustomerId: customer.id, updatedAt: new Date() })
		.where(eq(userTable.id, user.id));
	return customer.id;
}

export async function createCheckoutSession(cfg: StripeConfig, input: CheckoutInput): Promise<Stripe.Checkout.Session> {
	const customerId = await ensureStripeCustomer(cfg, input.user);
	return stripeClient(cfg).checkout.sessions.create({
		mode: "subscription",
		line_items: [{ price: priceIdForTier(cfg, input.tier), quantity: 1 }],
		customer: customerId,
		client_reference_id: input.user.id,
		metadata: { userId: input.user.id, tier: input.tier },
		success_url: `${config.APP_URL}/dashboard/?upgraded=1`,
		cancel_url: `${config.APP_URL}/pricing/`,
	});
}

/**
 * Off-session auto-recharge. Charges the customer's default payment
 * method without any UI — implicit consent is "you subscribed, saved
 * a card, and enabled auto-recharge". Stripe automatically picks
 * `customer.invoice_settings.default_payment_method` (set by the
 * original subscription checkout).
 *
 * Returns the created PaymentIntent so the caller can audit the
 * intent id (becomes the credit_grants idempotency key on success).
 * On a synchronous failure (no card on file, declined, 3DS required,
 * authentication_required), the underlying Stripe API throws — the
 * caller swallows it and the next failed-intent webhook flips
 * `autoRechargeEnabled=false` so we don't keep retrying a dead card.
 *
 * `payment_intent.succeeded` / `payment_intent.payment_failed`
 * webhooks complete the flow.
 */
export async function triggerAutoRecharge(
	cfg: StripeConfig,
	input: { user: User; tier: Exclude<Tier, "free">; credits: number },
): Promise<Stripe.PaymentIntent> {
	const credits = ensureValidCreditAmount(input.credits);
	const customerId = await ensureStripeCustomer(cfg, input.user);
	const amountCents = topUpPriceCents(input.tier, credits);
	return stripeClient(cfg).paymentIntents.create({
		amount: amountCents,
		currency: "usd",
		customer: customerId,
		// `off_session` + `confirm` is the canonical "merchant-initiated
		// transaction" pattern. Stripe picks the customer's default
		// payment method automatically. If 3DS is required, Stripe
		// returns an `authentication_required` error — we catch that
		// at the call site and disable the feature until the user
		// re-confirms via the dashboard.
		off_session: true,
		confirm: true,
		description: `flipagent auto-recharge: ${credits.toLocaleString()} credits`,
		// Webhook keys credit_grants idempotency off intent.id — kind
		// just labels the ledger row. Auto-recharge is the only
		// off-session path so this is a constant.
		metadata: {
			userId: input.user.id,
			kind: "auto_recharge",
			credits: String(credits),
			tier: input.tier,
		},
	});
}

export async function createPortalSession(
	cfg: StripeConfig,
	input: { user: User },
): Promise<Stripe.BillingPortal.Session> {
	const stripe = stripeClient(cfg);
	if (!input.user.stripeCustomerId) {
		throw new Error("user has no stripe customer — upgrade first");
	}
	return stripe.billingPortal.sessions.create({
		customer: input.user.stripeCustomerId,
		return_url: `${config.APP_URL}/dashboard/`,
	});
}

/**
 * Best-effort customer close on account deletion. Detaches any active
 * subscriptions and deletes the Stripe customer record so we don't keep
 * billing relationships with departed users. Caller should swallow
 * exceptions — Stripe failures must not block local data removal.
 */
export async function closeStripeCustomer(cfg: StripeConfig, customerId: string): Promise<void> {
	const stripe = stripeClient(cfg);
	await stripe.customers.del(customerId);
}
