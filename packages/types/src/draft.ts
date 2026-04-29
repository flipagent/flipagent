/**
 * `/v1/draft` schema — generate an optimal listing recommendation
 * given an item and a market summary. Pure compute: returns the
 * EV-optimal list price + suggested title. The agent merges this with
 * its own category + business-policy choices, then pushes via
 * `PUT /v1/sell/inventory/inventory_item/{sku}`.
 */

import { type Static, Type } from "@sinclair/typebox";
import { ListPriceRecommendation, MarketStats } from "./research.js";
import { Listing } from "./ship.js";

export const DraftRequest = Type.Object(
	{
		item: Listing,
		market: MarketStats,
		outboundShippingCents: Type.Optional(
			Type.Integer({ minimum: 0, description: "Shipping cost on outbound sale (cents). Default 0 — buyer pays." }),
		),
	},
	{ $id: "DraftRequest" },
);
export type DraftRequest = Static<typeof DraftRequest>;

export const DraftResponse = Type.Object(
	{
		/** Title to use on the new listing. Pass-through of input title for now; a future rewriter slots in here. */
		titleSuggestion: Type.String(),
		/**
		 * EV-optimal list price + expected outcomes. Null when the market
		 * lacks `meanDaysToSell` (no time-to-sell data, no model).
		 */
		listPriceRecommendation: Type.Union([ListPriceRecommendation, Type.Null()]),
		/** Human-readable rationale. */
		reason: Type.String(),
	},
	{ $id: "DraftResponse" },
);
export type DraftResponse = Static<typeof DraftResponse>;
