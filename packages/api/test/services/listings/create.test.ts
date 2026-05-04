/**
 * Orchestrator coverage. We mock the eBay HTTP layer (`fetchRetry` +
 * `getUserAccessToken`) and assert the 3 calls go out in order with
 * the right paths + bodies, and the returned Listing reflects the
 * publish step's `listingId`.
 */

import type { ListingCreate } from "@flipagent/types";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../src/services/ebay/oauth.js", () => ({
	getUserAccessToken: vi.fn().mockResolvedValue("test_token"),
}));

// `sellRequest` short-circuits with 503 when EBAY_CLIENT_ID/SECRET/RU_NAME
// are unset (CI case). The whole point of this suite is to mock the eBay
// HTTP layer, so override the env probe to always succeed.
vi.mock("../../../src/config.js", async (importOriginal) => {
	const actual = (await importOriginal()) as Record<string, unknown>;
	return { ...actual, isEbayOAuthConfigured: () => true };
});

const fetchRetryMock = vi.fn();
vi.mock("../../../src/utils/fetch-retry.js", () => ({
	fetchRetry: (...args: unknown[]) => fetchRetryMock(...args),
}));

import { createListing, PublishFailedError } from "../../../src/services/listings/create.js";

const baseInput: ListingCreate = {
	title: "Apple AirPods Pro 2",
	price: { value: 18999, currency: "USD" },
	quantity: 3,
	condition: "new",
	categoryId: "172465",
	images: ["https://img/a.jpg"],
	policies: { fulfillmentPolicyId: "F1", paymentPolicyId: "P1", returnPolicyId: "R1" },
	merchantLocationKey: "warehouse-01",
	sku: "TEST-SKU-1",
};

function ok(body: unknown): Response {
	return new Response(JSON.stringify(body), {
		status: 200,
		headers: { "Content-Type": "application/json" },
	});
}

function err(status: number, errors: unknown[]): Response {
	return new Response(JSON.stringify({ errors }), {
		status,
		headers: { "Content-Type": "application/json" },
	});
}

beforeEach(() => {
	fetchRetryMock.mockReset();
});

describe("createListing — 3-step orchestrator", () => {
	it("runs PUT inventory_item → POST offer → POST publish in order, returns active Listing", async () => {
		fetchRetryMock
			.mockResolvedValueOnce(new Response(null, { status: 204 })) // PUT inventory_item
			.mockResolvedValueOnce(ok({ offerId: "OFR-77" })) // POST offer
			.mockResolvedValueOnce(ok({ listingId: "123456789012" })); // POST publish

		const result = await createListing(baseInput, { apiKeyId: "ak_1" });

		expect(result.published).toBe(true);
		expect(result.listing.id).toBe("123456789012");
		expect(result.listing.sku).toBe("TEST-SKU-1");
		expect(result.listing.offerId).toBe("OFR-77");
		expect(result.listing.status).toBe("active");
		expect(result.listing.url).toBe("https://www.ebay.com/itm/123456789012");

		expect(fetchRetryMock).toHaveBeenCalledTimes(3);

		const [putUrl, putInit] = fetchRetryMock.mock.calls[0]!;
		expect(String(putUrl)).toContain("/sell/inventory/v1/inventory_item/TEST-SKU-1");
		expect(putInit.method).toBe("PUT");
		const putBody = JSON.parse(putInit.body as string);
		expect(putBody.product.title).toBe("Apple AirPods Pro 2");
		expect(putBody.condition).toBe("NEW");
		expect(putBody.availability.shipToLocationAvailability.quantity).toBe(3);

		const [offerUrl, offerInit] = fetchRetryMock.mock.calls[1]!;
		expect(String(offerUrl)).toContain("/sell/inventory/v1/offer");
		expect(offerInit.method).toBe("POST");
		const offerBody = JSON.parse(offerInit.body as string);
		expect(offerBody.sku).toBe("TEST-SKU-1");
		expect(offerBody.pricingSummary.price.value).toBe("189.99");
		expect(offerBody.categoryId).toBe("172465");
		expect(offerBody.merchantLocationKey).toBe("warehouse-01");

		const [publishUrl, publishInit] = fetchRetryMock.mock.calls[2]!;
		expect(String(publishUrl)).toContain("/sell/inventory/v1/offer/OFR-77/publish");
		expect(publishInit.method).toBe("POST");
	});

	it("auto-generates SKU when caller omits it", async () => {
		const noSku: ListingCreate = { ...baseInput, sku: undefined };
		fetchRetryMock
			.mockResolvedValueOnce(new Response(null, { status: 204 }))
			.mockResolvedValueOnce(ok({ offerId: "O" }))
			.mockResolvedValueOnce(ok({ listingId: "1" }));

		const result = await createListing(noSku, { apiKeyId: "ak_1" });
		expect(result.listing.sku).toMatch(/^flipagent-[A-Z0-9]{12}$/);
	});

	it("throws PublishFailedError surfacing the partial Listing on publish-step failure", async () => {
		fetchRetryMock
			.mockResolvedValueOnce(new Response(null, { status: 204 }))
			.mockResolvedValueOnce(ok({ offerId: "OFR-88" }))
			.mockResolvedValueOnce(err(400, [{ longMessage: "Insufficient permissions" }]));

		await expect(createListing(baseInput, { apiKeyId: "ak_1" })).rejects.toBeInstanceOf(PublishFailedError);
	});

	it("auto-discovers policies + location when caller omits them", async () => {
		const noPrereqs: ListingCreate = {
			...baseInput,
			policies: undefined,
			merchantLocationKey: undefined,
		};
		fetchRetryMock
			.mockResolvedValueOnce(ok({ returnPolicies: [{ returnPolicyId: "R-default" }] }))
			.mockResolvedValueOnce(ok({ paymentPolicies: [{ paymentPolicyId: "P-default" }] }))
			.mockResolvedValueOnce(ok({ fulfillmentPolicies: [{ fulfillmentPolicyId: "F-default" }] }))
			.mockResolvedValueOnce(ok({ locations: [{ merchantLocationKey: "wh-default" }] }))
			.mockResolvedValueOnce(new Response(null, { status: 204 }))
			.mockResolvedValueOnce(ok({ offerId: "OFR-99" }))
			.mockResolvedValueOnce(ok({ listingId: "999" }));

		const result = await createListing(noPrereqs, { apiKeyId: "ak_auto" });
		expect(result.published).toBe(true);
		expect(result.listing.merchantLocationKey).toBe("wh-default");
	});

	it("412s with missing_seller_policies when seller has no return / fulfillment policies", async () => {
		const noPrereqs: ListingCreate = {
			...baseInput,
			policies: undefined,
			merchantLocationKey: undefined,
		};
		// Empty return + fulfillment lists → MissingSellerPoliciesError (no
		// hidden auto-create — agent must collect prefs from user and POST
		// /v1/policies/setup). Payment auto-creates because eBay's managed
		// payments are uniform across sellers.
		fetchRetryMock
			.mockResolvedValueOnce(ok({ returnPolicies: [] }))
			.mockResolvedValueOnce(ok({ paymentPolicies: [{ paymentPolicyId: "PP_AUTO" }] }))
			.mockResolvedValueOnce(ok({ fulfillmentPolicies: [] }))
			.mockResolvedValueOnce(ok({ locations: [{ merchantLocationKey: "LOC_1" }] }));

		await expect(createListing(noPrereqs, { apiKeyId: "ak_empty" })).rejects.toMatchObject({
			name: "MissingSellerPoliciesError",
			missing: ["return", "fulfillment"],
			status: 412,
		});
	});

	it("propagates EbayApiError on offer-step failure (no publish call)", async () => {
		fetchRetryMock
			.mockResolvedValueOnce(new Response(null, { status: 204 }))
			.mockResolvedValueOnce(err(400, [{ longMessage: "Invalid category" }]));

		await expect(createListing(baseInput, { apiKeyId: "ak_1" })).rejects.toMatchObject({
			name: "EbayApiError",
			status: 400,
		});
		expect(fetchRetryMock).toHaveBeenCalledTimes(2);
	});
});
