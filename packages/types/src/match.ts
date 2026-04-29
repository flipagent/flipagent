/**
 * `/v1/match` — does this comp describe the same product as the
 * candidate? Two-bucket classifier (`match` / `reject`) over a pool of
 * `ItemSummary`, decided by an LLM that reads titles + structured
 * aspects, optionally including listing images.
 *
 * Distinct from `/v1/research/thesis` (statistics over already-
 * matched comps) and `/v1/evaluate` (margin verdict given comps).
 * Match is product identity; research is distribution; evaluate
 * is decision. The matcher is intentionally strict — different
 * model number, different finish, different colour, different
 * condition, missing accessories all count as different products.
 */

import { type Static, Type } from "@sinclair/typebox";
import { ItemSummary } from "./ebay/buy.js";

export const MatchBucket = Type.Union([Type.Literal("match"), Type.Literal("reject")], {
	$id: "MatchBucket",
});
export type MatchBucket = Static<typeof MatchBucket>;

export const MatchedItem = Type.Object(
	{
		item: ItemSummary,
		bucket: MatchBucket,
		reason: Type.String({
			description: "One-line explanation, e.g. 'Same SKU YA1264153, both Brand New' or 'Different reference YA1264155 (PVD finish)'.",
		}),
	},
	{ $id: "MatchedItem" },
);
export type MatchedItem = Static<typeof MatchedItem>;

export const MatchOptions = Type.Object(
	{
		/**
		 * When true (default), the matcher inspects thumbnails + detail
		 * images alongside titles + structured aspects. Strictly more
		 * accurate but ~2× the cost of text-only mode. Set false for
		 * faster, cheaper runs on SKUs whose listings reliably carry
		 * the reference number in the title.
		 */
		useImages: Type.Optional(
			Type.Boolean({ description: "Inspect listing images during matching. Default true." }),
		),
	},
	{ $id: "MatchOptions" },
);
export type MatchOptions = Static<typeof MatchOptions>;

export const MatchRequest = Type.Object(
	{
		candidate: ItemSummary,
		pool: Type.Array(ItemSummary, {
			description:
				"Items to classify against the candidate. Typically the `itemSales` (or `itemSummaries`) array from a fresh `/v1/sold/search` (or `/v1/listings/search`) call.",
		}),
		options: Type.Optional(MatchOptions),
	},
	{ $id: "MatchRequest" },
);
export type MatchRequest = Static<typeof MatchRequest>;

export const MatchResponse = Type.Object(
	{
		match: Type.Array(MatchedItem),
		reject: Type.Array(MatchedItem),
		totals: Type.Object({
			match: Type.Integer(),
			reject: Type.Integer(),
		}),
	},
	{ $id: "MatchResponse" },
);
export type MatchResponse = Static<typeof MatchResponse>;
