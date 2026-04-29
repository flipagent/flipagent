/**
 * Trading API: incoming Best Offer triage. The Sell Negotiation REST
 * API only covers *outbound* offers (seller → watcher / cart-
 * abandoner). Inbound offers (buyer → seller, on a listing the buyer
 * found organically) still flow through Trading.
 *
 *   GetBestOffers       — list pending offers across all listings
 *   RespondToBestOffer  — accept / decline / counter
 */

import { arrayify, escapeXml, parseTrading, stringFrom, tradingCall } from "./client.js";

export type BestOfferStatus = "All" | "Active" | "Accepted" | "Declined" | "Expired" | "Pending" | "Countered";

export interface BestOffer {
	bestOfferId: string;
	itemId: string | null;
	buyer: string | null;
	priceValue: string | null;
	priceCurrency: string | null;
	quantity: number | null;
	status: string | null;
	expirationTime: string | null;
	message: string | null;
}

export async function getBestOffers(args: {
	accessToken: string;
	itemId?: string;
	bestOfferStatus?: BestOfferStatus;
	pageNumber?: number;
	entriesPerPage?: number;
}): Promise<BestOffer[]> {
	const body = `<?xml version="1.0" encoding="utf-8"?>
<GetBestOffersRequest xmlns="urn:ebay:apis:eBLBaseComponents">
	${args.itemId ? `<ItemID>${escapeXml(args.itemId)}</ItemID>` : ""}
	<BestOfferStatus>${args.bestOfferStatus ?? "Active"}</BestOfferStatus>
	<Pagination>
		<EntriesPerPage>${args.entriesPerPage ?? 25}</EntriesPerPage>
		<PageNumber>${args.pageNumber ?? 1}</PageNumber>
	</Pagination>
</GetBestOffersRequest>`;
	const xml = await tradingCall({ callName: "GetBestOffers", accessToken: args.accessToken, body });
	const parsed = parseTrading(xml, "GetBestOffers");
	const container = (parsed.BestOfferArray ?? {}) as Record<string, unknown>;
	const rows = arrayify(container.BestOffer);
	return rows.map((o) => {
		const price = (o.Price ?? {}) as Record<string, unknown>;
		const buyer = (o.Buyer ?? {}) as Record<string, unknown>;
		const item = (o.Item ?? {}) as Record<string, unknown>;
		const qty = stringFrom(o.Quantity);
		return {
			bestOfferId: stringFrom(o.BestOfferID) ?? "",
			itemId: stringFrom(item.ItemID),
			buyer: stringFrom(buyer.UserID),
			priceValue: stringFrom(price["#text"] ?? price.Value),
			priceCurrency: stringFrom(price["@_currencyID"] ?? price.CurrencyID),
			quantity: qty != null ? Number(qty) : null,
			status: stringFrom(o.Status),
			expirationTime: stringFrom(o.ExpirationTime),
			message: stringFrom(o.BuyerMessage),
		};
	});
}

export type BestOfferAction = "Accept" | "Decline" | "Counter";

export async function respondToBestOffer(args: {
	accessToken: string;
	itemId: string;
	bestOfferIds: string[];
	action: BestOfferAction;
	sellerResponse?: string;
	counterOfferPriceValue?: string;
	counterOfferPriceCurrency?: string;
	counterOfferQuantity?: number;
}): Promise<{ ack: string }> {
	const ids = args.bestOfferIds.map((id) => `<BestOfferID>${escapeXml(id)}</BestOfferID>`).join("");
	const counter =
		args.action === "Counter" && args.counterOfferPriceValue
			? `<CounterOfferPrice currencyID="${escapeXml(args.counterOfferPriceCurrency ?? "USD")}">${escapeXml(
					args.counterOfferPriceValue,
				)}</CounterOfferPrice>${
					args.counterOfferQuantity != null
						? `<CounterOfferQuantity>${args.counterOfferQuantity}</CounterOfferQuantity>`
						: ""
				}`
			: "";
	const body = `<?xml version="1.0" encoding="utf-8"?>
<RespondToBestOfferRequest xmlns="urn:ebay:apis:eBLBaseComponents">
	<ItemID>${escapeXml(args.itemId)}</ItemID>
	${ids}
	<Action>${args.action}</Action>
	${args.sellerResponse ? `<SellerResponse>${escapeXml(args.sellerResponse)}</SellerResponse>` : ""}
	${counter}
</RespondToBestOfferRequest>`;
	const xml = await tradingCall({ callName: "RespondToBestOffer", accessToken: args.accessToken, body });
	const parsed = parseTrading(xml, "RespondToBestOffer");
	return { ack: stringFrom(parsed.Ack) ?? "Unknown" };
}
