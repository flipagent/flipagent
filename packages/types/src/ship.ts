/**
 * `/v1/ship/*` schemas — forwarder leg + landed-cost. Also re-used by
 * `/v1/evaluate` for the optional `opts.forwarder` block.
 */

import { type Static, Type } from "@sinclair/typebox";
import { ItemDetail, ItemSummary } from "./ebay/buy.js";

/** Either an ItemSummary (search result) or ItemDetail (single fetch). */
export const Listing = Type.Union([ItemSummary, ItemDetail], { $id: "Listing" });
export type Listing = Static<typeof Listing>;

/* ----------------------------- forwarder leg ----------------------------- */

export const ForwarderInput = Type.Object(
	{
		destState: Type.String({
			minLength: 2,
			maxLength: 2,
			description: "ISO 3166-2 US state code, e.g. NY, TX, HI.",
		}),
		weightG: Type.Integer({ minimum: 1, description: "Package weight in grams." }),
		dimsCm: Type.Optional(
			Type.Object({
				l: Type.Number({ minimum: 0 }),
				w: Type.Number({ minimum: 0 }),
				h: Type.Number({ minimum: 0 }),
			}),
		),
		provider: Type.Optional(Type.String({ description: "Forwarder provider id. Defaults to planet-express." })),
		itemCount: Type.Optional(Type.Integer({ minimum: 1, description: "Items consolidated; default 1." })),
	},
	{ $id: "ForwarderInput" },
);
export type ForwarderInput = Static<typeof ForwarderInput>;

/* --------------------------- POST /v1/ship/quote --------------------------- */

export const LandedCostBreakdown = Type.Object(
	{
		itemPriceCents: Type.Integer(),
		shippingCents: Type.Integer(),
		forwarderCents: Type.Integer(),
		taxCents: Type.Integer(),
		totalCents: Type.Integer(),
		forwarderProviderId: Type.String(),
		forwarderEtaDays: Type.Tuple([Type.Integer(), Type.Integer()]),
		forwarderCaveats: Type.Array(Type.String()),
	},
	{ $id: "LandedCostBreakdown" },
);
export type LandedCostBreakdown = Static<typeof LandedCostBreakdown>;

export const ShipQuoteRequest = Type.Object(
	{
		item: Listing,
		forwarder: ForwarderInput,
	},
	{ $id: "ShipQuoteRequest" },
);
export type ShipQuoteRequest = Static<typeof ShipQuoteRequest>;

export const ShipQuoteResponse = LandedCostBreakdown;
export type ShipQuoteResponse = LandedCostBreakdown;
