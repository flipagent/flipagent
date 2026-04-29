/**
 * `/v1/match` — does this comparable describe the same product as the
 * candidate? Two-bucket classifier (`match` / `reject`) over a pool of
 * `ItemSummary`, decided by an LLM that reads titles + structured
 * aspects, optionally including listing images.
 *
 * Distinct from `/v1/research/summary` (statistics over already-
 * matched comparables) and `/v1/evaluate` (margin evaluation given comparables).
 * Match is product identity; market is distribution; evaluate
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
			description:
				"One-line explanation, e.g. 'Same SKU YA1264153, both Brand New' or 'Different reference YA1264155 (PVD finish)'.",
		}),
	},
	{ $id: "MatchedItem" },
);
export type MatchedItem = Static<typeof MatchedItem>;

/**
 * Where the LLM call runs.
 *
 * - `hosted` (default) — flipagent runs the two-pass matcher on its
 *   own infrastructure. The caller pays one usage event regardless of
 *   pool size; we eat the LLM bill. Best when the host has no LLM of
 *   its own (HTTP scripts, cron jobs, weak-model agents) or wants
 *   deterministic batched performance.
 *
 * - `delegate` — the server returns a ready-to-run prompt + JSON
 *   schema; the *caller's* LLM does the inference. Useful when the
 *   caller is already a strong agent (Claude Code / Cursor) that can
 *   reason for free in-band, and wants to avoid paying for an inference
 *   call we'd just bill back to them. The caller materialises the
 *   `MatchResponse` locally and may post results to `/v1/traces/match`
 *   so we can keep our calibration data warm. Single-call (no detail
 *   fetch / no two-pass) — the host's strong model handles it in one
 *   pass on titles + aspects + images.
 */
export const MatchMode = Type.Union([Type.Literal("hosted"), Type.Literal("delegate")], {
	$id: "MatchMode",
});
export type MatchMode = Static<typeof MatchMode>;

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
		/**
		 * `hosted` (default) runs the LLM on flipagent's infrastructure.
		 * `delegate` returns a prompt + schema for the caller's own LLM
		 * — see `MatchMode` for when each makes sense.
		 */
		mode: Type.Optional(MatchMode),
	},
	{ $id: "MatchOptions" },
);
export type MatchOptions = Static<typeof MatchOptions>;

export const MatchRequest = Type.Object(
	{
		candidate: ItemSummary,
		pool: Type.Array(ItemSummary, {
			description:
				"Items to classify against the candidate. Typically the `itemSales` (or `itemSummaries`) array from a fresh `/v1/buy/marketplace_insights/item_sales/search` (or `/v1/buy/browse/item_summary/search`) call.",
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

/**
 * Returned when `options.mode === "delegate"`. The caller feeds
 * `system` + `user` to its own LLM, parses a JSON array matching
 * `outputSchema`, and joins each entry back to its pool item via
 * `pool[i].itemId === itemIds[i]`. The server does not invoke any LLM
 * on this code path and does not bill an inference call.
 *
 * The caller is encouraged (but not required) to POST the resulting
 * decisions to `/v1/traces/match` so we can keep our calibration data
 * fresh. Telemetry is opt-out via `FLIPAGENT_TELEMETRY=0`.
 */
export const MatchDelegateContent = Type.Union(
	[
		Type.Object({ type: Type.Literal("text"), text: Type.String() }),
		Type.Object({ type: Type.Literal("image"), imageUrl: Type.String() }),
	],
	{ $id: "MatchDelegateContent" },
);
export type MatchDelegateContent = Static<typeof MatchDelegateContent>;

export const MatchDelegateResponse = Type.Object(
	{
		mode: Type.Literal("delegate"),
		/** System prompt for the caller's LLM. */
		system: Type.String(),
		/**
		 * User content blocks. Mixed text + image entries; pass straight
		 * to any provider that accepts multimodal input (Anthropic
		 * messages, OpenAI chat completions with image_url, Gemini
		 * inline_data via fetch).
		 */
		user: Type.Array(MatchDelegateContent),
		/**
		 * itemId for each pool index. The LLM returns indexed decisions;
		 * `itemIds[i]` is the pool item index `i` is talking about.
		 */
		itemIds: Type.Array(Type.String()),
		/**
		 * JSON Schema (Draft 7-ish) the LLM is expected to produce. The
		 * server does not validate this — it's a hint the caller can pass
		 * verbatim to provider-side structured-output features.
		 */
		outputSchema: Type.Unknown(),
		/**
		 * Short instruction the caller should append if its LLM doesn't
		 * support structured output natively. Mirrors the JSON shape.
		 */
		outputHint: Type.String(),
		/**
		 * Server-issued correlation id. Echo back in `/v1/traces/match`
		 * so we can join the prompt to the resulting decisions without
		 * the caller re-uploading the pool.
		 */
		traceId: Type.String(),
	},
	{ $id: "MatchDelegateResponse" },
);
export type MatchDelegateResponse = Static<typeof MatchDelegateResponse>;

/**
 * Trace upload from a delegate-mode caller. Posted to
 * `POST /v1/traces/match` after the caller's LLM has classified the
 * pool. Used for ongoing calibration / regression detection. Opt-out
 * via `FLIPAGENT_TELEMETRY=0` on the CLI / SDK / MCP.
 *
 * We do not store API-key → trace links; rows are keyed by `traceId`
 * and a hashed key prefix for rate-limit accounting.
 */
export const MatchTraceRequest = Type.Object(
	{
		traceId: Type.String({ description: "From `MatchDelegateResponse.traceId`." }),
		candidateId: Type.String(),
		decisions: Type.Array(
			Type.Object({
				itemId: Type.String(),
				bucket: MatchBucket,
				reason: Type.String(),
			}),
		),
		/** Free-form model identifier the host used, e.g. `claude-opus-4-7`. */
		llmModel: Type.Optional(Type.String()),
		/** Caller name+version for diagnostics, e.g. `flipagent-mcp/0.2.0`. */
		clientVersion: Type.Optional(Type.String()),
	},
	{ $id: "MatchTraceRequest" },
);
export type MatchTraceRequest = Static<typeof MatchTraceRequest>;

export const MatchTraceResponse = Type.Object(
	{
		ok: Type.Literal(true),
		stored: Type.Integer(),
	},
	{ $id: "MatchTraceResponse" },
);
export type MatchTraceResponse = Static<typeof MatchTraceResponse>;
