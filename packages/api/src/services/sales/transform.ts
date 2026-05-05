/**
 * eBay sell/fulfillment Order → flipagent Sale.
 *
 * eBay's `getOrders` returns a rich `Order` record. We pull the
 * fields a reseller actually uses — line items, buyer, shipping
 * state, pricing summary — into the normalized `Sale` shape with
 * cents-int Money. Status enum maps eBay's `orderFulfillmentStatus`
 * + `orderPaymentStatus` to flipagent's 5-state lifecycle.
 */

import type { Marketplace, Sale, SaleLineItem, SaleStatus } from "@flipagent/types";
import { moneyFrom, moneyFromOrZero } from "../shared/money.js";

interface EbayLineItem {
	lineItemId: string;
	legacyItemId?: string;
	sku?: string;
	title: string;
	quantity: number;
	lineItemCost?: { value: string; currency: string };
	image?: { imageUrl: string };
	variationId?: string;
}

interface EbayShippingStep {
	shippingCarrierCode?: string;
	trackingNumber?: string;
	shippedDate?: string;
	actualDeliveryDate?: string;
}

export interface EbayOrder {
	orderId: string;
	creationDate: string;
	orderFulfillmentStatus?: string;
	orderPaymentStatus?: string;
	cancelStatus?: { cancelState?: string };
	buyer?: { username?: string; email?: string };
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
			};
		};
	}>;
	lineItems?: EbayLineItem[];
	pricingSummary?: {
		priceSubtotal?: { value: string; currency: string };
		deliveryCost?: { value: string; currency: string };
		totalDueSeller?: { value: string; currency: string };
		total?: { value: string; currency: string };
		tax?: { value: string; currency: string };
	};
	fulfillmentHrefs?: string[];
	fulfillments?: EbayShippingStep[];
	paymentSummary?: { totalDueSeller?: { value: string; currency: string } };
}

function inferStatus(o: EbayOrder): SaleStatus {
	if (o.cancelStatus?.cancelState && o.cancelStatus.cancelState !== "NONE_REQUESTED") return "cancelled";
	if (o.orderPaymentStatus === "REFUNDED" || o.orderPaymentStatus === "PARTIALLY_REFUNDED") return "refunded";
	const fulfillment = o.orderFulfillmentStatus;
	if (fulfillment === "FULFILLED") {
		const f = o.fulfillments?.[0];
		if (f?.actualDeliveryDate) return "delivered";
		return "shipped";
	}
	if (fulfillment === "IN_PROGRESS" || fulfillment === "NOT_STARTED") return "paid";
	return "paid";
}

export function ebayOrderToSale(order: EbayOrder, marketplace: Marketplace = "ebay_us"): Sale {
	const items: SaleLineItem[] = (order.lineItems ?? []).map((li) => ({
		lineItemId: li.lineItemId,
		itemId: li.legacyItemId ?? li.lineItemId,
		title: li.title,
		quantity: li.quantity,
		price: moneyFromOrZero(li.lineItemCost),
		...(li.sku ? { sku: li.sku } : {}),
		...(li.image?.imageUrl ? { image: li.image.imageUrl } : {}),
		...(li.variationId ? { variationId: li.variationId } : {}),
	}));

	const ship = order.fulfillmentStartInstructions?.[0]?.shippingStep?.shipTo;
	const addr = ship?.contactAddress;
	const out: Sale = {
		id: order.orderId,
		marketplace,
		status: inferStatus(order),
		items,
		pricing: {
			total: moneyFrom(order.pricingSummary?.total) ?? moneyFromOrZero(order.pricingSummary?.totalDueSeller),
			...(order.pricingSummary?.priceSubtotal ? { subtotal: moneyFrom(order.pricingSummary.priceSubtotal) } : {}),
			...(order.pricingSummary?.deliveryCost ? { shipping: moneyFrom(order.pricingSummary.deliveryCost) } : {}),
			...(order.pricingSummary?.tax ? { tax: moneyFrom(order.pricingSummary.tax) } : {}),
		},
		paidAt: order.creationDate,
		createdAt: order.creationDate,
	};
	if (order.buyer?.username) {
		out.buyer = { username: order.buyer.username, ...(order.buyer.email ? { email: order.buyer.email } : {}) };
	}
	if (addr?.addressLine1 && addr.city && addr.postalCode && addr.countryCode) {
		out.shipTo = {
			line1: addr.addressLine1,
			...(addr.addressLine2 ? { line2: addr.addressLine2 } : {}),
			city: addr.city,
			...(addr.stateOrProvince ? { region: addr.stateOrProvince } : {}),
			postalCode: addr.postalCode,
			country: addr.countryCode,
			...(ship?.fullName ? { name: ship.fullName } : {}),
			...(ship?.primaryPhone?.phoneNumber ? { phone: ship.primaryPhone.phoneNumber } : {}),
		};
	}
	const f = order.fulfillments?.[0];
	if (f) {
		const shipping: NonNullable<Sale["shipping"]> = {};
		if (f.shippingCarrierCode) shipping.carrier = f.shippingCarrierCode;
		if (f.trackingNumber) shipping.trackingNumber = f.trackingNumber;
		if (f.shippedDate) shipping.shippedAt = f.shippedDate;
		if (f.actualDeliveryDate) shipping.deliveredAt = f.actualDeliveryDate;
		if (Object.keys(shipping).length > 0) out.shipping = shipping;
	}
	return out;
}
