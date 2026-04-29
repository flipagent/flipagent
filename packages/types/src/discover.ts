/**
 * `/v1/discover` schema — batch deal ranking. Overnight pillar.
 * Inputs accept a Browse search response shape so callers can pipe
 * `/v1/buy/browse/item_summary/search` results straight in.
 */

import { type Static, Type } from "@sinclair/typebox";
import { BrowseSearchResponse } from "./ebay/buy.js";
import { EvaluateOptions, Evaluation } from "./evaluate.js";

export const RankedDeal = Type.Object(
	{
		itemId: Type.String(),
		evaluation: Evaluation,
	},
	{ $id: "RankedDeal" },
);
export type RankedDeal = Static<typeof RankedDeal>;

export const DiscoverRequest = Type.Object(
	{
		results: BrowseSearchResponse,
		opts: Type.Optional(EvaluateOptions),
	},
	{ $id: "DiscoverRequest" },
);
export type DiscoverRequest = Static<typeof DiscoverRequest>;

export const DiscoverResponse = Type.Object(
	{
		deals: Type.Array(RankedDeal),
	},
	{ $id: "DiscoverResponse" },
);
export type DiscoverResponse = Static<typeof DiscoverResponse>;
