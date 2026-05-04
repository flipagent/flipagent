/**
 * sell/logistics — eBay-issued shipping labels.
 */

import type { Label, LabelOption, LabelPurchaseRequest, LabelQuoteRequest, LabelQuoteResponse } from "@flipagent/types";
import { sellRequest } from "./ebay/rest/user-client.js";
import { toCents } from "./shared/money.js";

interface EbayQuote {
	shippingQuoteId: string;
	rates?: Array<{
		rateId: string;
		baseAmount: { value: string; currency: string };
		shippingCarrierCode: string;
		shippingServiceCode: string;
		minEstimatedDeliveryDate?: string;
		maxEstimatedDeliveryDate?: string;
	}>;
}

export interface LabelsContext {
	apiKeyId: string;
}

export async function quoteLabel(input: LabelQuoteRequest, ctx: LabelsContext): Promise<LabelQuoteResponse> {
	const body = {
		shipFrom: input.shipFrom,
		shipTo: input.shipTo,
		weight: input.weight,
		...(input.dimensions ? { dimensions: input.dimensions } : {}),
	};
	const res = await sellRequest<EbayQuote>({
		apiKeyId: ctx.apiKeyId,
		method: "POST",
		path: "/sell/logistics/v1_beta/shipping_quote",
		body,
	});
	const options: LabelOption[] = (res?.rates ?? []).map((r) => ({
		quoteId: `${res.shippingQuoteId}:${r.rateId}`,
		serviceCode: r.shippingServiceCode,
		carrier: r.shippingCarrierCode,
		cost: { value: toCents(r.baseAmount.value), currency: r.baseAmount.currency },
		...(r.minEstimatedDeliveryDate ? { estimatedDeliveryFrom: r.minEstimatedDeliveryDate } : {}),
		...(r.maxEstimatedDeliveryDate ? { estimatedDeliveryTo: r.maxEstimatedDeliveryDate } : {}),
	}));
	return { options };
}

export async function purchaseLabel(input: LabelPurchaseRequest, ctx: LabelsContext): Promise<Label> {
	const [shippingQuoteId, rateId] = input.quoteId.split(":");
	const res = await sellRequest<{
		shipmentId: string;
		labelDownloadUrl?: string;
		shippingCarrierCode: string;
		shippingServiceCode: string;
		trackingNumber?: string;
		baseShippingCost?: { value: string; currency: string };
	}>({
		apiKeyId: ctx.apiKeyId,
		method: "POST",
		// Verified live 2026-05-03 against the OAS3 spec at
		// `references/ebay-mcp/docs/_mirror/sell_logistics_v1_oas3.json`:
		// the only POST under /shipment is `create_from_shipping_quote`.
		// The bare path `/sell/logistics/v1_beta/shipment` returns
		// errorId 2002 ("Resource not found") — wrong path. The wrapper
		// silently 404'd whenever a label purchase was attempted.
		path: "/sell/logistics/v1_beta/shipment/create_from_shipping_quote",
		// `CreateShipmentFromQuoteRequest` per OAS3 spec only accepts:
		// `shippingQuoteId`, `rateId`, `additionalOptions`,
		// `labelCustomMessage`, `labelSize`, `returnTo`. There is NO
		// `orderId` field — verified via field-diff 2026-05-03. Sending
		// `orderId` was a no-op (eBay silently dropped it). The order
		// linkage actually happens earlier on the shipping quote itself.
		body: { shippingQuoteId, rateId },
	});
	return {
		id: res.shipmentId,
		serviceCode: res.shippingServiceCode,
		carrier: res.shippingCarrierCode,
		...(res.trackingNumber ? { trackingNumber: res.trackingNumber } : {}),
		...(res.labelDownloadUrl ? { labelUrl: res.labelDownloadUrl } : {}),
		cost: res.baseShippingCost
			? { value: toCents(res.baseShippingCost.value), currency: res.baseShippingCost.currency }
			: { value: 0, currency: "USD" },
		voidable: true,
		purchasedAt: new Date().toISOString(),
	};
}

export async function voidLabel(id: string, ctx: LabelsContext): Promise<{ success: boolean }> {
	await sellRequest({
		apiKeyId: ctx.apiKeyId,
		method: "POST",
		path: `/sell/logistics/v1_beta/shipment/${encodeURIComponent(id)}/cancel`,
	});
	return { success: true };
}

/* ---------- additional Sell Logistics paths (LR — wrappers in place) ---------- */

export async function getShipment(id: string, ctx: LabelsContext): Promise<unknown> {
	return await sellRequest({
		apiKeyId: ctx.apiKeyId,
		method: "GET",
		path: `/sell/logistics/v1_beta/shipment/${encodeURIComponent(id)}`,
	});
}

export async function downloadLabelFile(id: string, ctx: LabelsContext): Promise<unknown> {
	return await sellRequest({
		apiKeyId: ctx.apiKeyId,
		method: "GET",
		path: `/sell/logistics/v1_beta/shipment/${encodeURIComponent(id)}/download_label_file`,
	});
}

export async function getShippingQuote(id: string, ctx: LabelsContext): Promise<unknown> {
	return await sellRequest({
		apiKeyId: ctx.apiKeyId,
		method: "GET",
		path: `/sell/logistics/v1_beta/shipping_quote/${encodeURIComponent(id)}`,
	});
}
