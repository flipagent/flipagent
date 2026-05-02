/**
 * Trading XML `VerifyAddItem` — dry-run a listing, return fees +
 * errors without publishing. Used by `POST /v1/listings/verify`.
 */

import type { ListingVerifyRequest, ListingVerifyResponse } from "@flipagent/types";
import { verifyAddItem } from "../ebay/trading/listing.js";
import { toCents } from "../shared/money.js";

const CONDITION_TO_EBAY: Record<string, string> = {
	new: "1000",
	like_new: "1500",
	new_other: "1500",
	new_with_defects: "1750",
	manufacturer_refurbished: "2000",
	certified_refurbished: "2000",
	excellent_refurbished: "2010",
	very_good_refurbished: "2020",
	good_refurbished: "2030",
	seller_refurbished: "2500",
	used_excellent: "3000",
	used_very_good: "3000",
	used_good: "3000",
	used_acceptable: "3000",
	for_parts_or_not_working: "7000",
};

export async function verifyListing(accessToken: string, input: ListingVerifyRequest): Promise<ListingVerifyResponse> {
	const r = await verifyAddItem(accessToken, {
		title: input.title,
		description: input.description ?? "",
		price: { value: (input.price.value / 100).toFixed(2), currency: input.price.currency },
		quantity: input.quantity ?? 1,
		categoryId: input.categoryId,
		condition: CONDITION_TO_EBAY[input.condition] ?? "3000",
		duration: input.duration ?? "GTC",
	});
	return {
		passed: r.ack === "Success" || r.ack === "Warning",
		...(r.fees ? { fees: { value: toCents(r.fees.value), currency: r.fees.currency } } : {}),
		...(r.errors.length ? { errors: r.errors } : {}),
	};
}
