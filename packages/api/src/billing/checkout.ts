/**
 * Create a Stripe Checkout Session that, on success, attaches a paid
 * subscription to the calling user account. The webhook (billing/webhook.ts)
 * does the actual tier upgrade once Stripe confirms.
 */

import { eq } from "drizzle-orm";
import type Stripe from "stripe";
import { config } from "../config.js";
import { db } from "../db/client.js";
import { type User, user as userTable } from "../db/schema.js";
import { type PaidTier, priceIdForTier, type StripeConfig, stripeClient } from "./stripe.js";

export interface CheckoutInput {
	user: User;
	tier: PaidTier;
}

export async function createCheckoutSession(cfg: StripeConfig, input: CheckoutInput): Promise<Stripe.Checkout.Session> {
	const stripe = stripeClient(cfg);
	let customerId = input.user.stripeCustomerId ?? undefined;
	if (!customerId) {
		const customer = await stripe.customers.create({
			email: input.user.email,
			name: input.user.name,
			metadata: { userId: input.user.id },
		});
		customerId = customer.id;
		await db
			.update(userTable)
			.set({ stripeCustomerId: customerId, updatedAt: new Date() })
			.where(eq(userTable.id, input.user.id));
	}
	return stripe.checkout.sessions.create({
		mode: "subscription",
		line_items: [{ price: priceIdForTier(cfg, input.tier), quantity: 1 }],
		customer: customerId,
		client_reference_id: input.user.id,
		metadata: { userId: input.user.id, tier: input.tier },
		success_url: `${config.APP_URL}/dashboard/?upgraded=1`,
		cancel_url: `${config.APP_URL}/pricing/`,
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
