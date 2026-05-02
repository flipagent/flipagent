/**
 * Pre-publish fee preview — wraps eBay Sell Inventory
 * `POST /sell/inventory/v1/offer/get_listing_fees`.
 *
 * Operates on UNPUBLISHED offers only (eBay errors with 25754 on
 * published offerIds). For "what would fees be if I drafted this
 * hypothetical listing?", `services/listings/verify.ts` (Trading
 * VerifyAddItem) is the right call — it doesn't need an existing
 * draft. This wrapper exists for the bulk pre-publish review use case
 * where the caller has already created N drafts via POST /v1/listings
 * and wants the aggregate marketplace fees before flipping the
 * publish switch.
 *
 * eBay returns fees grouped by marketplace, NOT per-offer (eBay's
 * limitation). The summary is a sum across all offerIds in the
 * request that publish to that marketplace.
 */

import type { ListingFeeLine, ListingPreviewFeesResponse } from "@flipagent/types";
import { sellRequest } from "../ebay/rest/user-client.js";
import { toCents } from "../shared/money.js";

interface UpstreamAmount {
	value?: string | number;
	currency?: string;
}

interface UpstreamFee {
	feeType?: string;
	amount?: UpstreamAmount;
	promotionalDiscount?: UpstreamAmount;
}

interface UpstreamFeeSummary {
	marketplaceId?: string;
	fees?: UpstreamFee[];
	warnings?: Array<{ message?: string; errorId?: number; longMessage?: string }>;
}

interface UpstreamFeesSummaryResponse {
	feeSummaries?: UpstreamFeeSummary[];
}

function amountToMoney(a: UpstreamAmount | undefined) {
	const value = a?.value != null ? toCents(String(a.value)) : 0;
	const currency = a?.currency ?? "USD";
	return { value, currency };
}

function toFeeLine(f: UpstreamFee): ListingFeeLine {
	const line: ListingFeeLine = {
		feeType: f.feeType ?? "Unknown",
		amount: amountToMoney(f.amount),
	};
	if (f.promotionalDiscount) line.promotionalDiscount = amountToMoney(f.promotionalDiscount);
	return line;
}

export interface PreviewListingFeesArgs {
	apiKeyId: string;
	offerIds: string[];
}

export async function previewListingFees(
	args: PreviewListingFeesArgs,
): Promise<Omit<ListingPreviewFeesResponse, "source">> {
	const res = await sellRequest<UpstreamFeesSummaryResponse>({
		apiKeyId: args.apiKeyId,
		method: "POST",
		path: "/sell/inventory/v1/offer/get_listing_fees",
		body: { offers: args.offerIds.map((offerId) => ({ offerId })) },
		marketplace: "EBAY_US",
	});
	const summaries = (res.feeSummaries ?? []).map((s) => {
		const fees = (s.fees ?? []).map(toFeeLine);
		const totalCents = fees.reduce((sum, f) => {
			const discount = f.promotionalDiscount?.value ?? 0;
			return sum + Math.max(0, f.amount.value - discount);
		}, 0);
		const warnings = (s.warnings ?? []).map((w) => ({
			message: w.longMessage ?? w.message ?? "Unknown warning",
			...(w.errorId != null ? { errorId: w.errorId } : {}),
		}));
		return {
			marketplaceId: s.marketplaceId ?? "",
			fees,
			totalCents,
			...(warnings.length > 0 ? { warnings } : {}),
		};
	});
	return { summaries };
}
