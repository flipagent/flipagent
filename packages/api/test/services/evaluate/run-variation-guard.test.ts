/**
 * Variation-required guard at evaluate step 1. Two converging paths:
 *
 *   1. REST `fetchItemDetailRest` raises `MultiVariationParentError`
 *      (eBay 11006 → enumerated variations from get_items_by_item_group).
 *      The pipeline catches the typed error and re-throws as
 *      `EvaluateError("variation_required", 422, …, {variations})`.
 *
 *   2. Scrape / bridge happily return an `ItemDetail` with `variations[]`
 *      populated and a default-rendered top-level price. The pipeline
 *      itself rejects that shape when no `variationId` was supplied,
 *      surfacing the same structured error.
 *
 * Either way the wire response is identical, so an agent client treats
 * "you gave us a multi-SKU parent without picking a SKU" as one error.
 */

import type { EbayVariation } from "@flipagent/ebay-scraper";
import { afterEach, describe, expect, it, vi } from "vitest";

const getItemDetailMock = vi.fn();
vi.mock("../../../src/services/items/detail.js", () => ({
	getItemDetail: (...args: unknown[]) => getItemDetailMock(...args),
	detailFetcherFor: () => () => null,
}));

// Short-circuit step 2 (search) for the "guard does not fire" case: the
// pipeline reaches search after a successful detail with a pinned
// variation, so we surface a fast, non-variation_required failure
// instead of touching the network. The other two tests throw at step 1
// so these mocks are inert for them.
const searchActiveMock = vi.fn();
vi.mock("../../../src/services/items/search.js", () => ({
	searchActiveListings: (...args: unknown[]) => searchActiveMock(...args),
}));
const searchSoldMock = vi.fn();
vi.mock("../../../src/services/items/sold.js", () => ({
	searchSoldListings: (...args: unknown[]) => searchSoldMock(...args),
}));

import { EvaluateError } from "../../../src/services/evaluate/pipeline.js";
import { runEvaluatePipeline } from "../../../src/services/evaluate/run.js";
import { MultiVariationParentError } from "../../../src/services/items/errors.js";

const VARIATIONS: EbayVariation[] = [
	{
		variationId: "626382683495",
		priceCents: 35990,
		currency: "USD",
		aspects: [
			{ name: "Size", value: "US M8 / W9.5" },
			{ name: "Color", value: "Black" },
		],
	},
	{
		variationId: "626578342371",
		priceCents: 13500,
		currency: "USD",
		aspects: [
			{ name: "Size", value: "PS 3Y / W4.5" },
			{ name: "Color", value: "Black" },
		],
	},
];

afterEach(() => {
	getItemDetailMock.mockReset();
	searchActiveMock.mockReset();
	searchSoldMock.mockReset();
});

describe("runEvaluatePipeline variation_required", () => {
	it("REST path: MultiVariationParentError → EvaluateError variation_required (422) carrying enumerated variations", async () => {
		getItemDetailMock.mockRejectedValueOnce(new MultiVariationParentError("357966166544", VARIATIONS));

		let caught: unknown;
		try {
			await runEvaluatePipeline({ itemId: "357966166544" });
		} catch (err) {
			caught = err;
		}
		const e = caught as EvaluateError & { details?: { legacyId?: string; variations?: EbayVariation[] } };
		expect(e).toBeInstanceOf(EvaluateError);
		expect(e.code).toBe("variation_required");
		expect(e.status).toBe(422);
		expect(e.details).toBeDefined();
		expect(e.details?.legacyId).toBe("357966166544");
		expect(e.details?.variations).toEqual(VARIATIONS);
	});

	it("scrape path: detail with variations[] but no variationId → same EvaluateError variation_required", async () => {
		// scrape's `ebayDetailToBrowse` attaches `variations` as a runtime
		// extension — the wire ItemDetail mirror doesn't declare it, so the
		// guard reads it through a `Record<string, unknown>` cast at the
		// call site.
		const detailWithVariations: Record<string, unknown> = {
			itemId: "v1|357966166544|0",
			legacyItemId: "357966166544",
			title: "Nike Air Jordan 4 Retro Black Cat",
			variations: VARIATIONS,
		};
		getItemDetailMock.mockResolvedValueOnce({ body: detailWithVariations, source: "scrape" });

		let caught: unknown;
		try {
			await runEvaluatePipeline({ itemId: "357966166544" });
		} catch (err) {
			caught = err;
		}
		const e = caught as EvaluateError & { details?: { variations?: EbayVariation[] } };
		expect(e).toBeInstanceOf(EvaluateError);
		expect(e.code).toBe("variation_required");
		expect(e.status).toBe(422);
		expect(e.details?.variations).toEqual(VARIATIONS);
	});

	it("scrape path: variations[] present but variationId WAS supplied → guard does not fire", async () => {
		// Caller pinned a SKU explicitly via the URL form — the guard must
		// stay silent so the pipeline carries on past step 1. We force the
		// search step to fail fast with a generic upstream error, then
		// assert the surfaced error is NOT variation_required.
		const detailWithVariations: Record<string, unknown> = {
			itemId: "v1|357966166544|626578342371",
			legacyItemId: "357966166544",
			title: "Nike Air Jordan 4 Retro Black Cat",
			variations: VARIATIONS,
		};
		getItemDetailMock.mockResolvedValueOnce({ body: detailWithVariations, source: "scrape" });
		searchSoldMock.mockRejectedValue(new Error("search disabled in test"));
		searchActiveMock.mockRejectedValue(new Error("search disabled in test"));

		let caught: unknown;
		try {
			await runEvaluatePipeline({ itemId: "v1|357966166544|626578342371" });
		} catch (err) {
			caught = err;
		}
		expect(caught).toBeDefined();
		if (caught instanceof EvaluateError) {
			expect(caught.code).not.toBe("variation_required");
		}
	});
});
