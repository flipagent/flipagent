/**
 * Extract a flipagent-shape `Returns` summary from a runtime eBay item-detail
 * object. eBay's Browse REST `getItem` carries a `returnTerms` block; our
 * mirror `ItemDetail` doesn't declare it (mirror is intentionally narrow),
 * so we read it permissively from the runtime payload.
 *
 * Sources today:
 *   - rest:   upstream JSON passes through `fetchItemDetailRest` as a cast,
 *             so `returnTerms` lives on the runtime object verbatim.
 *   - scrape: `ebayDetailToBrowse` (services/listings/transform.ts) doesn't
 *             yet emit `returnTerms`. Returns null until the scraper learns
 *             the policy block — UI renders that as "—".
 *   - bridge: same as scrape — extension's raw payload could attach the
 *             shape on its own, in which case it surfaces here for free.
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
