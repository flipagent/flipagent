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
 *   checkout.session.completed       → upgrade tier (subscription only —
 *                                      top-ups don't go through Checkout
 *                                      anymore, they're off-session
 *                                      PaymentIntents against the saved
 *                                      card)
 *   payment_intent.succeeded         → top-up landed (auto-recharge OR
 *                                      manual "fire now" button) —
 *                                      insert credit_grants row,
 *                                      idempotency-keyed by intent id
 *   payment_intent.payment_failed    → top-up declined; for auto-recharge
 *                                      we disable the feature so we
 *                                      don't keep retrying a dead card
 *   customer.subscription.updated    → keep tier in sync, capture status,
 *                                      clear pastDueSince on healthy active
 *   customer.subscription.deleted    → downgrade to free
 *   invoice.payment_failed           → flip status to past_due,
 *                                      anchor pastDueSince on first hit
 */

import { eq, sql } from "drizzle-orm";
import type Stripe from "stripe";
import { sendAutoRechargeFailedEmail } from "../auth/email.js";
import type { Tier } from "../auth/keys.js";
import { MIN_TOPUP_CREDITS } from "../auth/limits.js";
import { config, isEmailConfigured } from "../config.js";
import { db } from "../db/client.js";
import { apiKeys, creditGrants, user as userTable } from "../db/schema.js";
import { type StripeConfig, stripeClient, tierForPriceId } from "./stripe.js";

/** Subscription statuses we treat as "in good standing — clear pastDueSince". */
const HEALTHY_STATUSES = new Set(["active", "trialing"]);

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
		case "payment_intent.succeeded":
			await handlePaymentIntentSucceeded(event.data.object);
			break;
		case "payment_intent.payment_failed":
			await handlePaymentIntentFailed(event.data.object);
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
	const [current] = await db.select({ tier: userTable.tier }).from(userTable).where(eq(userTable.id, userId)).limit(1);
	const tierChanged = current?.tier !== tier;
	// Bump `creditsResetAt` only on tier *upgrades* (or paid→paid moves)
	// — status-only updates (`active` → `past_due`) keep the existing
	// counting window. The bump gives the user a fresh budget on entry
	// to a new paid tier so prior-tier usage doesn't carry over.
	//
	// Down-to-free transitions deliberately DO NOT bump anymore: the
	// snapshot now filters by `usage_events.tier='free'` for free
	// aggregation, so a free→hobby→free cycle correctly inherits the
	// pre-upgrade free usage without a reset. Bumping here would
	// re-open the cycle exploit (subscribe for $19, downgrade, get
	// fresh 1,000 credits, repeat).
	const now = new Date();
	const tierFields = tierChanged && tier !== "free" ? { creditsResetAt: now } : {};
	await db
		.update(userTable)
		.set({ tier, ...tierFields, ...fields, updatedAt: now })
		.where(eq(userTable.id, userId));
	// Only cascade tier to api_keys when it actually moved — status-only
	// events (active → past_due) and idempotent re-applies don't need to
	// touch the keys table.
	if (tierChanged) {
		await db.update(apiKeys).set({ tier }).where(eq(apiKeys.userId, userId));
	}
}

async function handleCheckoutCompleted(cfg: StripeConfig, session: Stripe.Checkout.Session): Promise<void> {
	const userId = (session.metadata?.userId ?? session.client_reference_id) as string | null;
	if (!userId) {
		console.warn("[stripe] checkout.session.completed without userId");
		return;
	}
	// Top-ups are off-session PaymentIntents (no Checkout Session at
	// all); only mode='subscription' reaches us here. If we ever see a
	// mode='payment' session, it's leftover from a stale dashboard
	// build — log + ignore, don't crash.
	if (session.mode !== "subscription") {
		console.warn(`[stripe] unexpected checkout.session.completed mode=${session.mode} session=${session.id}`);
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
	const fields: Partial<typeof userTable.$inferInsert> = {
		stripeCustomerId: customerId,
		stripeSubscriptionId: subscription.id,
		subscriptionStatus: subscription.status,
	};
	// Fresh subscription = card just succeeded; clear any prior dunning
	// anchor so the new sub starts in good standing.
	if (HEALTHY_STATUSES.has(subscription.status)) fields.pastDueSince = null;
	await applyTier(userId, tier, fields);
	console.log(`[stripe] upgraded user ${userId} → ${tier}`);
}

/**
 * Auto-recharge succeeded. The off-session PaymentIntent we fired
 * carries `metadata.kind='auto_recharge'`, `metadata.userId`, and
 * `metadata.credits`; we re-validate then insert one credit_grants
 * row deduped by `paymentIntent.id`. Idempotency matters here because
 * Stripe retries `payment_intent.succeeded` across hours when our
 * webhook 5xxs.
 *
 * Subscription invoices ALSO produce payment_intent.succeeded events
 * but without our `kind` metadata — the fence keeps the handler
 * honest if we ever add other off-session intents later.
 */
async function handlePaymentIntentSucceeded(intent: Stripe.PaymentIntent): Promise<void> {
	if (intent.metadata?.kind !== "auto_recharge") return;
	const userId = intent.metadata?.userId;
	const rawCredits = Number(intent.metadata?.credits);
	if (!userId) {
		console.warn(`[stripe] auto-recharge intent ${intent.id} missing userId metadata`);
		return;
	}
	// Auto-recharge fires dynamic credit amounts (gap-to-target,
	// floored at MIN_TOPUP_CREDITS) — not the fixed PACK_DENOMINATIONS
	// the manual checkout uses. Validate here as "positive integer ≥
	// the same floor" so a corrupt metadata payload doesn't insert a
	// negative or fractional grant.
	if (!Number.isFinite(rawCredits) || !Number.isInteger(rawCredits) || rawCredits < MIN_TOPUP_CREDITS) {
		console.warn(`[stripe] auto-recharge intent ${intent.id} bad credits=${rawCredits}`);
		return;
	}
	const credits = rawCredits;
	await insertTopUpGrant({
		userId,
		credits,
		reason: `Auto-recharge: ${credits.toLocaleString()} credits`,
		idempotencyKey: intent.id,
	});
	// Stamp lastAutoRechargeAt so the cooldown guard in the middleware
	// doesn't refire while the previous attempt was still mid-flight.
	await db
		.update(userTable)
		.set({ lastAutoRechargeAt: new Date(), updatedAt: new Date() })
		.where(eq(userTable.id, userId));
}

/**
 * Auto-recharge declined (insufficient funds, expired card, 3DS
 * required, authentication_required, etc.). Disable the feature so
 * we don't keep firing every threshold-trigger against a dead card,
 * then email the user so they don't only notice when the dashboard
 * toggle shows off later. They re-enable via PUT /v1/billing/auto-recharge
 * once they've fixed the card.
 */
async function handlePaymentIntentFailed(intent: Stripe.PaymentIntent): Promise<void> {
	if (intent.metadata?.kind !== "auto_recharge") return;
	const userId = intent.metadata?.userId;
	if (!userId) return;
	await db
		.update(userTable)
		.set({ autoRechargeEnabled: false, updatedAt: new Date() })
		.where(eq(userTable.id, userId));
	console.warn(`[stripe] disabled auto-recharge for ${userId} after intent ${intent.id} failed`);

	if (!isEmailConfigured()) return;
	const [u] = await db
		.select({ email: userTable.email, name: userTable.name })
		.from(userTable)
		.where(eq(userTable.id, userId))
		.limit(1);
	if (!u) return;
	const credits = Number(intent.metadata?.credits) || 0;
	const declineReason = intent.last_payment_error?.message ?? intent.last_payment_error?.decline_code ?? null;
	const manageBillingUrl = `${config.APP_URL.replace(/\/+$/, "")}/dashboard/?view=settings`;
	await sendAutoRechargeFailedEmail({
		to: u.email,
		name: u.name,
		amountDisplay: `$${(intent.amount / 100).toFixed(2)}`,
		creditsDisplay: `${credits.toLocaleString()} credits`,
		declineReason,
		manageBillingUrl,
	}).catch((err) => {
		// Don't throw — Stripe would redeliver the webhook indefinitely
		// for a Resend outage. Log it; the operator sees the warning
		// and the user still has the disabled toggle as fallback signal.
		console.error(`[stripe] failed to email ${u.email} about auto-recharge:`, err);
	});
}

/**
 * Single insert path for top-up grants — manual checkout, auto-recharge,
 * any future top-up source. Idempotent against the partial unique index
 * on `credit_grants.idempotency_key` so Stripe webhook replays no-op.
 */
async function insertTopUpGrant(args: {
	userId: string;
	credits: number;
	reason: string;
	idempotencyKey: string;
}): Promise<void> {
	const inserted = await db
		.insert(creditGrants)
		.values({
			userId: args.userId,
			creditsDelta: args.credits,
			reason: args.reason,
			grantedByUserId: null,
			expiresAt: null,
			idempotencyKey: args.idempotencyKey,
		})
		.onConflictDoNothing({ target: creditGrants.idempotencyKey })
		.returning({ id: creditGrants.id });
	if (inserted.length === 0) {
		console.log(`[stripe] top-up ${args.idempotencyKey} already granted (idempotent replay)`);
		return;
	}
	console.log(`[stripe] granted ${args.credits} credits to ${args.userId} (${args.idempotencyKey})`);
}

async function handleSubscriptionUpdated(cfg: StripeConfig, subscription: Stripe.Subscription): Promise<void> {
	const priceId = subscription.items.data[0]?.price.id;
	const tier = priceId ? tierForPriceId(cfg, priceId) : null;
	if (!tier) return;
	const [u] = await db.select().from(userTable).where(eq(userTable.stripeSubscriptionId, subscription.id)).limit(1);
	if (!u) return;
	const fields: Partial<typeof userTable.$inferInsert> = { subscriptionStatus: subscription.status };
	// Card resolved → clear the past_due anchor. We don't touch tier
	// here even though the user may have hit grace expiry — the api
	// middleware reads pastDueSince live, so as soon as it's null the
	// next request bills against the real tier again.
	if (HEALTHY_STATUSES.has(subscription.status)) fields.pastDueSince = null;
	await applyTier(u.id, tier, fields);
}

async function handleSubscriptionDeleted(subscription: Stripe.Subscription): Promise<void> {
	const [u] = await db.select().from(userTable).where(eq(userTable.stripeSubscriptionId, subscription.id)).limit(1);
	if (!u) return;
	// Final cancel — clear all subscription artefacts including
	// pastDueSince. The user keeps any unspent credit-pack grants
	// (those live independently in credit_grants).
	await applyTier(u.id, "free", {
		stripeSubscriptionId: null,
		subscriptionStatus: "canceled",
		pastDueSince: null,
	});
	console.log(`[stripe] downgraded user ${u.id} → free`);
}

async function handlePaymentFailed(invoice: Stripe.Invoice): Promise<void> {
	const subId = typeof invoice.subscription === "string" ? invoice.subscription : invoice.subscription?.id;
	if (!subId) return;
	// Single atomic update:
	//   - subscriptionStatus → 'past_due' every retry (Stripe re-fires
	//     payment_failed across dunning; status sync is idempotent)
	//   - pastDueSince anchored ONLY on first failure (COALESCE keeps
	//     the original timestamp on subsequent retries — the grace
	//     clock starts at the original failure, not the latest retry)
	const now = new Date();
	await db
		.update(userTable)
		.set({
			subscriptionStatus: "past_due",
			pastDueSince: sql`coalesce(${userTable.pastDueSince}, ${now})`,
			updatedAt: now,
		})
		.where(eq(userTable.stripeSubscriptionId, subId));
}
