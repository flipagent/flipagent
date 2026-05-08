/**
 * Extract a flipagent-shape `Returns` summary from an eBay item-detail
 * object. `returnTerms` is now formally declared on the mirror
 * `ItemDetail` (Browse REST parity), so all three transports populate
 * the same field: REST passes the upstream block through verbatim,
 * scrape parses the JSON-LD `hasMerchantReturnPolicy` block, and bridge
 * fills the same shape from its raw payload. We still read it
 * permissively because eBay sometimes omits sub-fields (`returnPeriod`
 * unit/value pair) and we want to fail soft to null.
 */

import type { Returns } from "@flipagent/types";
import type { ItemDetail } from "@flipagent/types/ebay/buy";

interface RawReturnTerms {
	returnsAccepted?: unknown;
	returnPeriod?: { value?: unknown; unit?: unknown } | null;
	returnShippingCostPayer?: unknown;
}

export function extractReturns(detail: ItemDetail | unknown): Returns | null {
	const raw = (detail as { returnTerms?: RawReturnTerms } | null | undefined)?.returnTerms;
	if (!raw || typeof raw !== "object") return null;

	const accepted = raw.returnsAccepted;
	if (typeof accepted !== "boolean") return null;

	const out: Returns = { accepted };

	const period = raw.returnPeriod;
	if (period && typeof period === "object") {
		const value = period.value;
		const unit = period.unit;
		if (typeof value === "number" && Number.isFinite(value) && value >= 0 && unit === "DAY") {
			out.periodDays = Math.round(value);
		}
	}

	const payer = raw.returnShippingCostPayer;
	if (payer === "BUYER" || payer === "SELLER") {
		out.shippingCostPaidBy = payer;
	}

	return out;
}
