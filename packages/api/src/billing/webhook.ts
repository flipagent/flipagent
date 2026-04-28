/**
 * Stripe webhook event handler. Verifies the signature, then dispatches
 * by event.type to the relevant tier mutator.
 *
 * Tier lives on `user.tier`. Each event:
 *   - looks up the user (by metadata.userId on first event, then by
 *     `stripe_customer_id` thereafter)
 *   - updates `user.tier` + subscription fields
 *   - cascades the new tier to every active api_key the user owns,
 *     so the per-request middleware (which reads api_key.tier) sees
 *     the upgrade immediately
 *
 * Events:
 *   checkout.session.completed       → upgrade tier
 *   customer.subscription.updated    → keep tier in sync, capture status
 *   customer.subscription.deleted    → downgrade to free
 *   invoice.payment_failed           → flip status to past_due
 */

import { eq } from "drizzle-orm";
import type Stripe from "stripe";
import type { Tier } from "../auth/keys.js";
import { db } from "../db/client.js";
import { apiKeys, user as userTable } from "../db/schema.js";
import { type StripeConfig, stripeClient, tierForPriceId } from "./stripe.js";

export async function verifyAndConstructEvent(
	cfg: StripeConfig,
	rawBody: string,
	signature: string,
): Promise<Stripe.Event> {
	return stripeClient(cfg).webhooks.constructEvent(rawBody, signature, cfg.webhookSecret);
}

export async function handleEvent(cfg: StripeConfig, event: Stripe.Event): Promise<void> {
	switch (event.type) {
		case "checkout.session.completed":
			await handleCheckoutCompleted(cfg, event.data.object);
			break;
		case "customer.subscription.updated":
			await handleSubscriptionUpdated(cfg, event.data.object);
			break;
		case "customer.subscription.deleted":
			await handleSubscriptionDeleted(event.data.object);
			break;
		case "invoice.payment_failed":
			await handlePaymentFailed(event.data.object);
			break;
		default:
			break;
	}
}

async function applyTier(userId: string, tier: Tier, fields: Partial<typeof userTable.$inferInsert>): Promise<void> {
	await db
		.update(userTable)
		.set({ tier, ...fields, updatedAt: new Date() })
		.where(eq(userTable.id, userId));
	await db.update(apiKeys).set({ tier }).where(eq(apiKeys.userId, userId));
}

async function handleCheckoutCompleted(cfg: StripeConfig, session: Stripe.Checkout.Session): Promise<void> {
	const userId = (session.metadata?.userId ?? session.client_reference_id) as string | null;
	if (!userId) {
		console.warn("[stripe] checkout.session.completed without userId");
		return;
	}
	const subscriptionId = typeof session.subscription === "string" ? session.subscription : session.subscription?.id;
	if (!subscriptionId) {
		console.warn("[stripe] checkout.session.completed without subscription");
		return;
	}
	const subscription = await stripeClient(cfg).subscriptions.retrieve(subscriptionId);
	const priceId = subscription.items.data[0]?.price.id;
	const tier = priceId ? tierForPriceId(cfg, priceId) : null;
	if (!tier) {
		console.warn(`[stripe] unknown price id ${priceId}; cannot upgrade ${userId}`);
		return;
	}
	const customerId = typeof subscription.customer === "string" ? subscription.customer : subscription.customer.id;
	await applyTier(userId, tier, {
		stripeCustomerId: customerId,
		stripeSubscriptionId: subscription.id,
		subscriptionStatus: subscription.status,
	});
	console.log(`[stripe] upgraded user ${userId} → ${tier}`);
}

async function handleSubscriptionUpdated(cfg: StripeConfig, subscription: Stripe.Subscription): Promise<void> {
	const priceId = subscription.items.data[0]?.price.id;
	const tier = priceId ? tierForPriceId(cfg, priceId) : null;
	if (!tier) return;
	const [u] = await db.select().from(userTable).where(eq(userTable.stripeSubscriptionId, subscription.id)).limit(1);
	if (!u) return;
	await applyTier(u.id, tier, { subscriptionStatus: subscription.status });
}

async function handleSubscriptionDeleted(subscription: Stripe.Subscription): Promise<void> {
	const [u] = await db.select().from(userTable).where(eq(userTable.stripeSubscriptionId, subscription.id)).limit(1);
	if (!u) return;
	await applyTier(u.id, "free", { stripeSubscriptionId: null, subscriptionStatus: "canceled" });
	console.log(`[stripe] downgraded user ${u.id} → free`);
}

async function handlePaymentFailed(invoice: Stripe.Invoice): Promise<void> {
	const subId = typeof invoice.subscription === "string" ? invoice.subscription : invoice.subscription?.id;
	if (!subId) return;
	await db
		.update(userTable)
		.set({ subscriptionStatus: "past_due", updatedAt: new Date() })
		.where(eq(userTable.stripeSubscriptionId, subId));
}
