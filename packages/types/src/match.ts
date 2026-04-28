/**
 * `/v1/match` — does this comp describe the same product as the
 * candidate? Three-bucket classifier (`match` / `borderline` /
 * `reject`) over a pool of `ItemSummary`. Pure title + condition
 * signal today; later passes can fold in `localizedAspects` and
 * image perceptual hashes once we have those for both sides.
 *
 * Distinct from `/v1/research/thesis` (statistics over already-
 * matched comps) and `/v1/evaluate` (margin verdict given comps).
 * Match is product identity; research is distribution; evaluate
 * is decision.
 */

import { type Static, Type } from "@sinclair/typebox";
import { ItemSummary } from "./ebay/buy.js";

export const MatchBucket = Type.Union([Type.Literal("match"), Type.Literal("borderline"), Type.Literal("reject")], {
	$id: "MatchBucket",
});
export type MatchBucket = Static<typeof MatchBucket>;

export const MatchedItem = Type.Object(
	{
		item: ItemSummary,
		score: Type.Number({ minimum: 0, maximum: 1, description: "Match confidence in [0,1]." }),
		bucket: MatchBucket,
		reason: Type.String({ description: "Human-readable explanation, e.g. 'title overlap 72%; condition match'." }),
	},
	{ $id: "MatchedItem" },
);
export type MatchedItem = Static<typeof MatchedItem>;

export const MatchOptions = Type.Object(
	{
		matchThreshold: Type.Optional(
			Type.Number({ minimum: 0, maximum: 1, description: "Score floor for `match` bucket. Default 0.7." }),
		),
		borderlineThreshold: Type.Optional(
			Type.Number({
				minimum: 0,
				maximum: 1,
				description: "Score floor for `borderline` bucket (anything below → `reject`). Default 0.4.",
			}),
		),
		conditionPenalty: Type.Optional(
			Type.Number({
				minimum: 0,
				maximum: 1,
				description:
					"Score multiplier when candidate.conditionId and comp.conditionId differ (both must be known). Default 0.5.",
			}),
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
		borderline: Type.Array(MatchedItem),
		reject: Type.Array(MatchedItem),
		totals: Type.Object({
			match: Type.Integer(),
			borderline: Type.Integer(),
			reject: Type.Integer(),
		}),
	},
	{ $id: "MatchResponse" },
);
export type MatchResponse = Static<typeof MatchResponse>;
