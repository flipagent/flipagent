/**
 * Stripe-side aggregation for the user-facing billing history.
 *
 * Two reads merged into one stream:
 *   - `invoices.list` — subscription bills (monthly recurring).
 *     Carries an invoice number + a hosted PDF URL.
 *   - `charges.list` filtered to charges *without* an invoice —
 *     standalone PaymentIntents (auto-recharge top-ups). No invoice
 *     number; we surface the receipt URL instead.
 *
 * Returns transactions newest-first. Stripe's pagination caps each
 * list at 100; we take the most recent 50 of each, which is
 * comfortably more than any user inspects in the dashboard. If the
 * customer has no Stripe customer id (free user, never subscribed),
 * returns an empty list — the route layer surfaces it as "no
 * invoices found." rather than 404, since the absence is normal.
 */

import type { BillingTransaction } from "@flipagent/types";
import type Stripe from "stripe";
import { type StripeConfig, stripeClient } from "./stripe.js";

export async function listBillingHistory(cfg: StripeConfig, customerId: string | null): Promise<BillingTransaction[]> {
	if (!customerId) return [];
	const stripe = stripeClient(cfg);
	const [invoices, charges] = await Promise.all([
		stripe.invoices.list({ customer: customerId, limit: 50 }),
		stripe.charges.list({ customer: customerId, limit: 50 }),
	]);

	const invoiceRows: BillingTransaction[] = invoices.data.map((inv) => ({
		id: inv.id ?? "",
		type: "subscription" as const,
		number: inv.number ?? null,
		// `created` is unix seconds; pin to ISO for the wire.
		createdAt: new Date(inv.created * 1000).toISOString(),
		amountCents: inv.amount_paid > 0 ? inv.amount_paid : inv.amount_due,
		amountDisplay: formatUsd(inv.amount_paid > 0 ? inv.amount_paid : inv.amount_due),
		status: invoiceStatus(inv.status),
		// `hosted_invoice_url` is the human-readable page; `invoice_pdf`
		// is the direct PDF. Prefer the hosted page so the user lands
		// on a Stripe-rendered "View invoice" with a download button.
		downloadUrl: inv.hosted_invoice_url ?? inv.invoice_pdf ?? null,
	}));

	const topUpRows: BillingTransaction[] = charges.data
		// Standalone charges only — charges with `invoice` set are the
		// underlying charge of a subscription invoice (already counted
		// above as a `subscription` row).
		.filter((ch) => !ch.invoice)
		.map((ch) => ({
			id: ch.id,
			type: "top_up" as const,
			number: null,
			createdAt: new Date(ch.created * 1000).toISOString(),
			amountCents: ch.amount,
			amountDisplay: formatUsd(ch.amount),
			status: chargeStatus(ch),
			downloadUrl: ch.receipt_url ?? null,
		}));

	return [...invoiceRows, ...topUpRows].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

function formatUsd(cents: number): string {
	return `$${(cents / 100).toFixed(2)}`;
}

function invoiceStatus(s: Stripe.Invoice["status"]): BillingTransaction["status"] {
	switch (s) {
		case "paid":
			return "paid";
		case "void":
			return "void";
		case "uncollectible":
			return "failed";
		case "open":
		case "draft":
			return "open";
		default:
			return "open";
	}
}

function chargeStatus(ch: Stripe.Charge): BillingTransaction["status"] {
	if (ch.refunded) return "refunded";
	if (ch.status === "succeeded") return "paid";
	if (ch.status === "failed") return "failed";
	return "open";
}
