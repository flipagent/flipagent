import { estimateForwarderFee } from "../forwarder/index.js";
import { toCents } from "./adapter.js";
import type { ForwarderInput, Listing } from "./types.js";

const DEFAULT_PROVIDER = "planet-express";

export type LandedCostBreakdown = {
	itemPriceCents: number;
	shippingCents: number;
	forwarderCents: number;
	taxCents: number;
	totalCents: number;
	/** Raw forwarder quote when caller wants to surface caveats / ETA. */
	forwarderProviderId: string;
	forwarderEtaDays: [number, number];
	forwarderCaveats: ReadonlyArray<string>;
};

/**
 * Compute total delivered cost in cents:
 *
 *   itemPrice + eBay seller's listed shipping + forwarder fees + tax
 *
 * `taxCents` is currently zero — destination-state sales tax is left to the
 * caller until we ship a per-state estimator. Forwarder caveats (e.g. "billed
 * on dim weight", "service does not serve AK/HI") are surfaced verbatim.
 */
export function landedCost(item: Listing, fwd: ForwarderInput): LandedCostBreakdown {
	const itemPriceCents = toCents(item.price?.value);
	const shippingCents = item.shippingOptions?.[0]?.shippingCost
		? toCents(item.shippingOptions[0].shippingCost.value)
		: 0;

	const quote = estimateForwarderFee(fwd.provider ?? DEFAULT_PROVIDER, {
		weightG: fwd.weightG,
		destState: fwd.destState,
		dimsCm: fwd.dimsCm,
		itemCount: fwd.itemCount,
	});

	const taxCents = 0;
	return {
		itemPriceCents,
		shippingCents,
		forwarderCents: quote.totalCents,
		taxCents,
		totalCents: itemPriceCents + shippingCents + quote.totalCents + taxCents,
		forwarderProviderId: quote.providerId,
		forwarderEtaDays: quote.etaDays,
		forwarderCaveats: quote.caveats,
	};
}
