/**
 * Auto-orchestration on sold-event arrival.
 *
 * When the inbound Trading API webhook fires `ItemSold` /
 * `FixedPriceTransaction` for a sku that's linked to a forwarder
 * package (via `forwarder_inventory.sku`), this module:
 *
 *   1. Reads the buyer's shipping address from
 *      `/sell/fulfillment/v1/order/{orderId}` using the user's
 *      stored eBay OAuth token.
 *   2. Queues a `forwarder.dispatch` bridge job with that address.
 *
 * Best-effort. Any failure (no OAuth bound, eBay rate-limit, missing
 * sku linkage, no order id available) is logged and swallowed —
 * the cycle event still fires and the agent can fall back to manual
 * dispatch. Idempotent on (packageId, ebayOrderId) at the
 * `dispatchPackage` layer, so a retried sold-event webhook can't
 * book two shipments for the same parcel.
 */

import { config } from "../../config.js";
import { fetchRetry } from "../../utils/fetch-retry.js";
import { getUserAccessToken } from "../ebay/oauth.js";
import { dispatchPackage } from "./inbox.js";
import type { InventoryStatus } from "./inventory.js";
import { findBySku, markSold } from "./inventory.js";

interface AutoDispatchInput {
	apiKeyId: string;
	sku: string;
	ebayOrderId: string | null;
	transactionId: string | null;
}

export interface AutoDispatchOutcome {
	dispatched: boolean;
	packageId: string | null;
	jobId: string | null;
	reason: string | null;
}

/**
 * Returns immediately when there's nothing to do (no linkage, already
 * shipped, OAuth missing, etc) — the caller treats every outcome as
 * non-fatal. The shape returned is recorded as an `auto_dispatch`
 * field on the `item.sold` webhook payload so subscribers can see
 * what happened without polling.
 */
export async function maybeAutoDispatch(input: AutoDispatchInput): Promise<AutoDispatchOutcome> {
	const inventory = await findBySku(input.apiKeyId, input.sku);
	if (!inventory) {
		return { dispatched: false, packageId: null, jobId: null, reason: "sku_not_linked" };
	}
	if (isAlreadyShipped(inventory.status)) {
		return { dispatched: false, packageId: inventory.packageId, jobId: null, reason: "already_shipped" };
	}

	// Step status forward to `sold` regardless of whether dispatch
	// succeeds — the sale happened, that's a fact. Dispatch is the
	// next stage and may fail without invalidating the sold marker.
	await markSold({ apiKeyId: input.apiKeyId, sku: input.sku }).catch((err) =>
		console.error("[auto-dispatch] markSold:", err),
	);

	if (!input.ebayOrderId) {
		return { dispatched: false, packageId: inventory.packageId, jobId: null, reason: "no_order_id" };
	}

	let order: EbayOrderShape;
	try {
		order = await fetchEbayOrder(input.apiKeyId, input.ebayOrderId);
	} catch (err) {
		const reason = err instanceof Error ? err.message : "ebay_fetch_failed";
		console.error("[auto-dispatch] fetchEbayOrder failed:", reason);
		return { dispatched: false, packageId: inventory.packageId, jobId: null, reason };
	}

	const ship = extractShipTo(order);
	if (!ship) {
		return { dispatched: false, packageId: inventory.packageId, jobId: null, reason: "no_ship_address" };
	}

	try {
		const job = await dispatchPackage({
			apiKeyId: input.apiKeyId,
			userId: null,
			provider: inventory.provider as "planetexpress",
			packageId: inventory.packageId,
			request: {
				toAddress: ship,
				ebayOrderId: input.ebayOrderId,
				declaredValueCents: extractDeclaredValueCents(order),
			},
		});
		return { dispatched: true, packageId: inventory.packageId, jobId: job.jobId, reason: null };
	} catch (err) {
		const reason = err instanceof Error ? err.message : "dispatch_queue_failed";
		console.error("[auto-dispatch] dispatchPackage failed:", reason);
		return { dispatched: false, packageId: inventory.packageId, jobId: null, reason };
	}
}

function isAlreadyShipped(s: InventoryStatus): boolean {
	return s === "dispatched" || s === "shipped";
}

interface EbayOrderShape {
	orderId?: string;
	totalFeeBasisAmount?: { value?: string; currency?: string };
	pricingSummary?: { total?: { value?: string; currency?: string } };
	fulfillmentStartInstructions?: Array<{
		shippingStep?: {
			shipTo?: {
				fullName?: string;
				contactAddress?: {
					addressLine1?: string;
					addressLine2?: string;
					city?: string;
					stateOrProvince?: string;
					postalCode?: string;
					countryCode?: string;
				};
				primaryPhone?: { phoneNumber?: string };
				email?: string;
			};
		};
	}>;
}

async function fetchEbayOrder(apiKeyId: string, orderId: string): Promise<EbayOrderShape> {
	const token = await getUserAccessToken(apiKeyId);
	const url = `${config.EBAY_BASE_URL}/sell/fulfillment/v1/order/${encodeURIComponent(orderId)}`;
	const res = await fetchRetry(url, {
		headers: {
			Authorization: `Bearer ${token}`,
			Accept: "application/json",
		},
	});
	if (!res.ok) {
		const text = await res.text().catch(() => "");
		throw new Error(`ebay_${res.status}_${text.slice(0, 80)}`);
	}
	return (await res.json()) as EbayOrderShape;
}

function extractShipTo(order: EbayOrderShape): {
	name: string;
	line1: string;
	line2?: string;
	city: string;
	state: string;
	postalCode: string;
	country: string;
	phone?: string;
	email?: string;
} | null {
	const start = order.fulfillmentStartInstructions?.[0]?.shippingStep;
	const ship = start?.shipTo;
	const addr = ship?.contactAddress;
	if (!ship || !addr || !addr.addressLine1 || !addr.city || !addr.postalCode || !addr.countryCode) {
		return null;
	}
	return {
		name: ship.fullName ?? "Buyer",
		line1: addr.addressLine1,
		line2: addr.addressLine2 || undefined,
		city: addr.city,
		state: addr.stateOrProvince ?? "",
		postalCode: addr.postalCode,
		country: addr.countryCode,
		phone: ship.primaryPhone?.phoneNumber,
		email: ship.email,
	};
}

function extractDeclaredValueCents(order: EbayOrderShape): number | undefined {
	const v = order.pricingSummary?.total?.value;
	if (!v) return undefined;
	const n = Number(v);
	if (!Number.isFinite(n)) return undefined;
	return Math.round(n * 100);
}
