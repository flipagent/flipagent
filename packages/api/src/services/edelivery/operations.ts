/**
 * `/v1/edelivery/*` — eDelivery International Shipping. Niche cross-
 * border surface (separate from domestic Sell Logistics). Sellers enroll
 * in eDelivery, then create packages/bundles, get rates, print labels,
 * and track shipments through eBay's chosen carriers.
 *
 * eDelivery's response shapes are eBay-specific and dense (carrier
 * codes, customs declarations, dropoff schedules) — flipagent doesn't
 * reshape; routes return `{ data, source }` envelopes that pass through
 * eBay's payload verbatim.
 */

import { sellRequest, sellRequestWithLocation } from "../ebay/rest/user-client.js";

export interface EDeliveryContext {
	apiKeyId: string;
	marketplace?: string;
}

const ROOT = "/sell/edelivery_international_shipping/v1";

/* ---------------- packages ---------------- */

export async function listPackages(q: Record<string, string>, ctx: EDeliveryContext): Promise<unknown> {
	const params = new URLSearchParams(q);
	return sellRequest({
		apiKeyId: ctx.apiKeyId,
		method: "GET",
		path: `${ROOT}/package?${params}`,
		marketplace: ctx.marketplace,
	});
}

export async function createPackage(body: Record<string, unknown>, ctx: EDeliveryContext): Promise<{ id: string }> {
	const { body: res, locationId } = await sellRequestWithLocation<{ packageId?: string }>({
		apiKeyId: ctx.apiKeyId,
		method: "POST",
		path: `${ROOT}/package`,
		body,
		marketplace: ctx.marketplace,
		contentLanguage: "en-US",
	});
	return { id: res?.packageId ?? locationId ?? "" };
}

export async function getPackage(id: string, ctx: EDeliveryContext): Promise<unknown> {
	return sellRequest({
		apiKeyId: ctx.apiKeyId,
		method: "GET",
		path: `${ROOT}/package/${encodeURIComponent(id)}`,
		marketplace: ctx.marketplace,
	});
}

export async function cancelPackage(id: string, ctx: EDeliveryContext): Promise<void> {
	await sellRequest({
		apiKeyId: ctx.apiKeyId,
		method: "POST",
		path: `${ROOT}/package/${encodeURIComponent(id)}/cancel`,
		body: {},
		marketplace: ctx.marketplace,
	});
}

export async function confirmPackage(
	id: string,
	body: Record<string, unknown>,
	ctx: EDeliveryContext,
): Promise<unknown> {
	return sellRequest({
		apiKeyId: ctx.apiKeyId,
		method: "POST",
		path: `${ROOT}/package/${encodeURIComponent(id)}/confirm`,
		body,
		marketplace: ctx.marketplace,
	});
}

export async function clonePackage(
	id: string,
	body: Record<string, unknown>,
	ctx: EDeliveryContext,
): Promise<{ id: string }> {
	const { body: res, locationId } = await sellRequestWithLocation<{ packageId?: string }>({
		apiKeyId: ctx.apiKeyId,
		method: "POST",
		path: `${ROOT}/package/${encodeURIComponent(id)}/clone`,
		body,
		marketplace: ctx.marketplace,
	});
	return { id: res?.packageId ?? locationId ?? "" };
}

export async function getPackageItem(orderLineItemId: string, ctx: EDeliveryContext): Promise<unknown> {
	return sellRequest({
		apiKeyId: ctx.apiKeyId,
		method: "GET",
		path: `${ROOT}/package/${encodeURIComponent(orderLineItemId)}/item`,
		marketplace: ctx.marketplace,
	});
}

export async function bulkCancelPackages(body: Record<string, unknown>, ctx: EDeliveryContext): Promise<unknown> {
	return sellRequest({
		apiKeyId: ctx.apiKeyId,
		method: "POST",
		path: `${ROOT}/package/bulk_cancel_packages`,
		body,
		marketplace: ctx.marketplace,
	});
}

export async function bulkConfirmPackages(body: Record<string, unknown>, ctx: EDeliveryContext): Promise<unknown> {
	return sellRequest({
		apiKeyId: ctx.apiKeyId,
		method: "POST",
		path: `${ROOT}/package/bulk_confirm_packages`,
		body,
		marketplace: ctx.marketplace,
	});
}

export async function bulkDeletePackages(body: Record<string, unknown>, ctx: EDeliveryContext): Promise<unknown> {
	return sellRequest({
		apiKeyId: ctx.apiKeyId,
		method: "POST",
		path: `${ROOT}/package/bulk_delete_packages`,
		body,
		marketplace: ctx.marketplace,
	});
}

/* ---------------- bundles ---------------- */

export async function listBundles(q: Record<string, string>, ctx: EDeliveryContext): Promise<unknown> {
	const params = new URLSearchParams(q);
	return sellRequest({
		apiKeyId: ctx.apiKeyId,
		method: "GET",
		path: `${ROOT}/bundle?${params}`,
		marketplace: ctx.marketplace,
	});
}

export async function createBundle(body: Record<string, unknown>, ctx: EDeliveryContext): Promise<{ id: string }> {
	const { body: res, locationId } = await sellRequestWithLocation<{ bundleId?: string }>({
		apiKeyId: ctx.apiKeyId,
		method: "POST",
		path: `${ROOT}/bundle`,
		body,
		marketplace: ctx.marketplace,
		contentLanguage: "en-US",
	});
	return { id: res?.bundleId ?? locationId ?? "" };
}

export async function getBundle(id: string, ctx: EDeliveryContext): Promise<unknown> {
	return sellRequest({
		apiKeyId: ctx.apiKeyId,
		method: "GET",
		path: `${ROOT}/bundle/${encodeURIComponent(id)}`,
		marketplace: ctx.marketplace,
	});
}

export async function cancelBundle(id: string, ctx: EDeliveryContext): Promise<void> {
	await sellRequest({
		apiKeyId: ctx.apiKeyId,
		method: "POST",
		path: `${ROOT}/bundle/${encodeURIComponent(id)}/cancel`,
		body: {},
		marketplace: ctx.marketplace,
	});
}

export async function getBundleLabel(id: string, ctx: EDeliveryContext): Promise<unknown> {
	return sellRequest({
		apiKeyId: ctx.apiKeyId,
		method: "GET",
		path: `${ROOT}/bundle/${encodeURIComponent(id)}/label`,
		marketplace: ctx.marketplace,
	});
}

/* ---------------- labels / tracking / handover ---------------- */

export async function getLabels(q: Record<string, string>, ctx: EDeliveryContext): Promise<unknown> {
	const params = new URLSearchParams(q);
	return sellRequest({
		apiKeyId: ctx.apiKeyId,
		method: "GET",
		path: `${ROOT}/labels?${params}`,
		marketplace: ctx.marketplace,
	});
}

export async function getTracking(q: Record<string, string>, ctx: EDeliveryContext): Promise<unknown> {
	const params = new URLSearchParams(q);
	return sellRequest({
		apiKeyId: ctx.apiKeyId,
		method: "GET",
		path: `${ROOT}/tracking?${params}`,
		marketplace: ctx.marketplace,
	});
}

export async function getHandoverSheet(q: Record<string, string>, ctx: EDeliveryContext): Promise<unknown> {
	const params = new URLSearchParams(q);
	return sellRequest({
		apiKeyId: ctx.apiKeyId,
		method: "GET",
		path: `${ROOT}/handover_sheet?${params}`,
		marketplace: ctx.marketplace,
	});
}

/* ---------------- preferences / config ---------------- */

export async function getActualCosts(q: Record<string, string>, ctx: EDeliveryContext): Promise<unknown> {
	const params = new URLSearchParams(q);
	return sellRequest({
		apiKeyId: ctx.apiKeyId,
		method: "GET",
		path: `${ROOT}/actual_costs?${params}`,
		marketplace: ctx.marketplace,
	});
}

export async function getAddressPreference(ctx: EDeliveryContext): Promise<unknown> {
	return sellRequest({
		apiKeyId: ctx.apiKeyId,
		method: "GET",
		path: `${ROOT}/address_preference`,
		marketplace: ctx.marketplace,
	});
}

export async function setAddressPreference(body: Record<string, unknown>, ctx: EDeliveryContext): Promise<unknown> {
	return sellRequest({
		apiKeyId: ctx.apiKeyId,
		method: "POST",
		path: `${ROOT}/address_preference`,
		body,
		marketplace: ctx.marketplace,
	});
}

export async function getConsignPreference(ctx: EDeliveryContext): Promise<unknown> {
	return sellRequest({
		apiKeyId: ctx.apiKeyId,
		method: "GET",
		path: `${ROOT}/consign_preference`,
		marketplace: ctx.marketplace,
	});
}

export async function setConsignPreference(body: Record<string, unknown>, ctx: EDeliveryContext): Promise<unknown> {
	return sellRequest({
		apiKeyId: ctx.apiKeyId,
		method: "POST",
		path: `${ROOT}/consign_preference`,
		body,
		marketplace: ctx.marketplace,
	});
}

export async function listAgents(q: Record<string, string>, ctx: EDeliveryContext): Promise<unknown> {
	const params = new URLSearchParams(q);
	return sellRequest({
		apiKeyId: ctx.apiKeyId,
		method: "GET",
		path: `${ROOT}/agents?${params}`,
		marketplace: ctx.marketplace,
	});
}

export async function listDropoffSites(q: Record<string, string>, ctx: EDeliveryContext): Promise<unknown> {
	const params = new URLSearchParams(q);
	return sellRequest({
		apiKeyId: ctx.apiKeyId,
		method: "GET",
		path: `${ROOT}/dropoff_sites?${params}`,
		marketplace: ctx.marketplace,
	});
}

export async function getBatteryQualifications(q: Record<string, string>, ctx: EDeliveryContext): Promise<unknown> {
	const params = new URLSearchParams(q);
	return sellRequest({
		apiKeyId: ctx.apiKeyId,
		method: "GET",
		path: `${ROOT}/battery_qualifications?${params}`,
		marketplace: ctx.marketplace,
	});
}

export async function getServices(q: Record<string, string>, ctx: EDeliveryContext): Promise<unknown> {
	const params = new URLSearchParams(q);
	return sellRequest({
		apiKeyId: ctx.apiKeyId,
		method: "GET",
		path: `${ROOT}/services?${params}`,
		marketplace: ctx.marketplace,
	});
}

export async function listComplaints(q: Record<string, string>, ctx: EDeliveryContext): Promise<unknown> {
	const params = new URLSearchParams(q);
	return sellRequest({
		apiKeyId: ctx.apiKeyId,
		method: "GET",
		path: `${ROOT}/complaint?${params}`,
		marketplace: ctx.marketplace,
	});
}

export async function createComplaint(body: Record<string, unknown>, ctx: EDeliveryContext): Promise<unknown> {
	return sellRequest({
		apiKeyId: ctx.apiKeyId,
		method: "POST",
		path: `${ROOT}/complaint`,
		body,
		marketplace: ctx.marketplace,
	});
}
