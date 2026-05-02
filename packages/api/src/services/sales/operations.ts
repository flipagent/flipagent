/**
 * sell/fulfillment ops — list, get, ship, refund.
 *
 * Reuses the `sellRequest` programmatic eBay client built for
 * `services/listings/manage/`. Same auth + error envelope.
 */

import type { Sale, SaleRefundRequest, SaleShipRequest } from "@flipagent/types";
import { type EbayApiError, sellRequest } from "../ebay/rest/user-client.js";
import { type EbayOrder, ebayOrderToSale } from "./transform.js";

interface OrdersListResponse {
	orders?: EbayOrder[];
	total?: number;
	limit?: number;
	offset?: number;
}

export interface SalesContext {
	apiKeyId: string;
	marketplace?: string;
}

export async function listSales(
	{ limit = 50, offset = 0 }: { limit?: number; offset?: number },
	ctx: SalesContext,
): Promise<{ sales: Sale[]; limit: number; offset: number; total?: number }> {
	const res = await sellRequest<OrdersListResponse>({
		apiKeyId: ctx.apiKeyId,
		method: "GET",
		path: `/sell/fulfillment/v1/order?limit=${limit}&offset=${offset}`,
		marketplace: ctx.marketplace,
	});
	const sales = (res?.orders ?? []).map((o) => ebayOrderToSale(o));
	return { sales, limit, offset, ...(res?.total !== undefined ? { total: res.total } : {}) };
}

export async function getSale(orderId: string, ctx: SalesContext): Promise<Sale | null> {
	const order = await sellRequest<EbayOrder>({
		apiKeyId: ctx.apiKeyId,
		method: "GET",
		path: `/sell/fulfillment/v1/order/${encodeURIComponent(orderId)}`,
		marketplace: ctx.marketplace,
	}).catch((err: EbayApiError) => {
		if (err.status === 404) return null;
		throw err;
	});
	if (!order) return null;
	return ebayOrderToSale(order);
}

export async function shipSale(orderId: string, req: SaleShipRequest, ctx: SalesContext): Promise<Sale | null> {
	const current = await getSale(orderId, ctx);
	if (!current) return null;
	const lineItemIds = req.lineItemIds ?? current.items.map((it) => it.lineItemId);
	await sellRequest({
		apiKeyId: ctx.apiKeyId,
		method: "POST",
		path: `/sell/fulfillment/v1/order/${encodeURIComponent(orderId)}/shipping_fulfillment`,
		body: {
			lineItems: lineItemIds.map((id) => ({ lineItemId: id, quantity: 1 })),
			shippingCarrierCode: req.carrier,
			trackingNumber: req.trackingNumber,
			...(req.shippedAt ? { shippedDate: req.shippedAt } : {}),
		},
		marketplace: ctx.marketplace,
	});
	return getSale(orderId, ctx);
}

export async function refundSale(orderId: string, req: SaleRefundRequest, ctx: SalesContext): Promise<Sale | null> {
	const current = await getSale(orderId, ctx);
	if (!current) return null;
	const lineItemIds = req.lineItemIds ?? current.items.map((it) => it.lineItemId);
	const body: Record<string, unknown> = {
		reasonForRefund: req.reason,
		refundItems: lineItemIds.map((id) => ({ lineItemId: id, quantity: 1 })),
	};
	if (req.amount) {
		body.refundAmount = { value: (req.amount.value / 100).toFixed(2), currency: req.amount.currency };
	}
	if (req.comment) body.comment = req.comment;
	await sellRequest({
		apiKeyId: ctx.apiKeyId,
		method: "POST",
		path: `/sell/fulfillment/v1/order/${encodeURIComponent(orderId)}/issue_refund`,
		body,
		marketplace: ctx.marketplace,
	});
	return getSale(orderId, ctx);
}
