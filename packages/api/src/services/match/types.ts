/**
 * Internal types for the LLM same-product matcher. Used by the
 * composite intelligence pipelines (`/v1/discover`, `/v1/evaluate`) to
 * curate raw search pools to listings that describe the same product
 * as the seed item. Not a public surface — never reachable via SDK or
 * MCP; the matcher is only invoked server-side from `runEvaluatePipeline`
 * / `runDiscoverPipeline`.
 *
 * The classifier is intentionally strict — different model number,
 * finish, colour, condition, or missing accessories all become
 * `reject`. Decision is made by the LLM reading titles + structured
 * aspects + (optionally) listing images.
 */

import { ItemSummary } from "@flipagent/types/ebay/buy";
import { type Static, Type } from "@sinclair/typebox";

export const MatchBucket = Type.Union([Type.Literal("match"), Type.Literal("reject")], {
	$id: "MatchBucket",
});
export type MatchBucket = Static<typeof MatchBucket>;

export const MatchedItem = Type.Object(
	{
		item: ItemSummary,
		bucket: MatchBucket,
		reason: Type.String({
			description:
				"One-line explanation, e.g. 'Same SKU YA1264153, both Brand New' or 'Different reference YA1264155 (PVD finish)'.",
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
		useImages: Type.Optional(Type.Boolean({ description: "Inspect listing images during matching. Default true." })),
	},
	{ $id: "MatchOptions" },
);
export type MatchOptions = Static<typeof MatchOptions>;

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
