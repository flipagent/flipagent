/**
 * `/v1/reprice` schema — decide hold/drop/delist for a sitting
 * listing based on time elapsed vs the market's expected
 * time-to-sell. Pure compute: caller passes the listing's current
 * price + listed-at timestamp + a fresh market summary.
 */

import { type Static, Type } from "@sinclair/typebox";
import { MarketStats } from "./research.js";

export const RepriceState = Type.Object(
	{
		currentPriceCents: Type.Integer({ minimum: 1 }),
		listedAt: Type.String({ format: "date-time" }),
	},
	{ $id: "RepriceState" },
);
export type RepriceState = Static<typeof RepriceState>;

export const RepriceRequest = Type.Object(
	{
		market: MarketStats,
		state: RepriceState,
	},
	{ $id: "RepriceRequest" },
);
export type RepriceRequest = Static<typeof RepriceRequest>;

export const RepriceAction = Type.Union([Type.Literal("hold"), Type.Literal("drop"), Type.Literal("delist")], {
	$id: "RepriceAction",
});
export type RepriceAction = Static<typeof RepriceAction>;

export const RepriceResponse = Type.Object(
	{
		action: RepriceAction,
		daysListed: Type.Number(),
		/** Set when `action === "drop"`. New list price in cents. */
		suggestedPriceCents: Type.Optional(Type.Integer()),
		reason: Type.String(),
	},
	{ $id: "RepriceResponse" },
);
export type RepriceResponse = Static<typeof RepriceResponse>;
