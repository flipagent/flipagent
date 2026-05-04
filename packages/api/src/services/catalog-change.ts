/**
 * commerce/catalog change_request — submit product corrections /
 * additions to eBay's product catalog. Niche but useful when a seller
 * lists a product whose master catalog entry is wrong (typo'd model
 * name, missing brand) — they can submit a correction and reference
 * the change request later.
 */

import { sellRequest, sellRequestWithLocation, swallowEbay404 } from "./ebay/rest/user-client.js";

export interface CatalogChangeContext {
	apiKeyId: string;
}

export interface ChangeRequest {
	id: string;
	status?: string;
	type?: string;
	createdAt?: string;
}

interface UpstreamChangeRequest {
	changeRequestId?: string;
	status?: string;
	changeRequestType?: string;
	createdDate?: string;
}

export async function listChangeRequests(ctx: CatalogChangeContext): Promise<{ requests: ChangeRequest[] }> {
	const res = await sellRequest<{ changeRequests?: UpstreamChangeRequest[] }>({
		apiKeyId: ctx.apiKeyId,
		method: "GET",
		path: "/commerce/catalog/v1_beta/change_request",
		marketplace: "EBAY_US",
	}).catch(swallowEbay404);
	return {
		requests: (res?.changeRequests ?? []).map((r) => ({
			id: r.changeRequestId ?? "",
			...(r.status ? { status: r.status } : {}),
			...(r.changeRequestType ? { type: r.changeRequestType } : {}),
			...(r.createdDate ? { createdAt: r.createdDate } : {}),
		})),
	};
}

export async function getChangeRequest(id: string, ctx: CatalogChangeContext): Promise<ChangeRequest | null> {
	const res = await sellRequest<UpstreamChangeRequest>({
		apiKeyId: ctx.apiKeyId,
		method: "GET",
		path: `/commerce/catalog/v1_beta/change_request/${encodeURIComponent(id)}`,
		marketplace: "EBAY_US",
	}).catch(swallowEbay404);
	if (!res) return null;
	return {
		id: res.changeRequestId ?? id,
		...(res.status ? { status: res.status } : {}),
		...(res.changeRequestType ? { type: res.changeRequestType } : {}),
		...(res.createdDate ? { createdAt: res.createdDate } : {}),
	};
}

/**
 * Submit a product-catalog change request. eBay accepts free-form
 * `payload` per change type — the wrapper passes through to keep the
 * caller in control of the spec-defined shape (different per type:
 * PRODUCT_CREATION_REQUEST, ASPECT_ADDITION_REQUEST, etc.).
 */
export async function createChangeRequest(
	body: Record<string, unknown>,
	ctx: CatalogChangeContext,
): Promise<{ id: string }> {
	const { body: res, locationId } = await sellRequestWithLocation<{ changeRequestId?: string }>({
		apiKeyId: ctx.apiKeyId,
		method: "POST",
		path: "/commerce/catalog/v1_beta/change_request",
		body,
		marketplace: "EBAY_US",
		contentLanguage: "en-US",
	});
	return { id: res?.changeRequestId ?? locationId ?? "" };
}
