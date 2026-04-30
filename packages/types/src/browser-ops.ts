/**
 * `/v1/browser/*` — synchronous browser primitives that round-trip
 * through the bridge protocol to the user's Chrome extension.
 *
 * Pattern: client calls one of these endpoints, the API queues a
 * `browser_op` bridge job, the extension's content script (active tab)
 * executes the op, posts the result back, the API returns it inline.
 * Caller sees a single sync response — no purchaseOrderId polling.
 *
 * Use cases:
 *   1. Direct DOM access for cases the high-level tools don't cover
 *      — custom marketplaces, new fields, ad-hoc reads. 1st-class
 *      surface, not a fallback for the typed scrapers.
 *   2. Interactive selector tuning during dev — query a page live
 *      without writing & shipping new content-script code.
 */

import { type Static, Type } from "@sinclair/typebox";

export const BrowserOp = Type.Union([Type.Literal("query"), Type.Literal("outerHTML"), Type.Literal("title")], {
	$id: "BrowserOp",
});
export type BrowserOp = Static<typeof BrowserOp>;

/* ----------------------------- query ----------------------------- */

export const BrowserQueryRequest = Type.Object(
	{
		/** CSS selector. Returns a snapshot of every matching element. */
		selector: Type.String({ minLength: 1, maxLength: 1000 }),
		/** Cap the number of matches returned. Default 10. */
		limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 200, default: 10 })),
		/** Include `outerHTML` per match (default true). */
		includeHtml: Type.Optional(Type.Boolean({ default: true })),
		/** Include flattened `textContent` per match (default true). */
		includeText: Type.Optional(Type.Boolean({ default: true })),
		/** Cap each html/text payload to this many chars. Default 2000. */
		truncateAt: Type.Optional(Type.Integer({ minimum: 100, maximum: 20_000, default: 2000 })),
		/** Optional: queue against a tab matching this URL pattern instead of the active tab. */
		tabUrlPattern: Type.Optional(Type.String()),
	},
	{ $id: "BrowserQueryRequest" },
);
export type BrowserQueryRequest = Static<typeof BrowserQueryRequest>;

export const BrowserQueryMatch = Type.Object(
	{
		tag: Type.String(),
		id: Type.Union([Type.String(), Type.Null()]),
		classes: Type.Array(Type.String()),
		text: Type.Union([Type.String(), Type.Null()]),
		html: Type.Union([Type.String(), Type.Null()]),
	},
	{ $id: "BrowserQueryMatch" },
);
export type BrowserQueryMatch = Static<typeof BrowserQueryMatch>;

export const BrowserQueryResponse = Type.Object(
	{
		url: Type.String(),
		matchCount: Type.Integer(),
		matches: Type.Array(BrowserQueryMatch),
		/** Page title for context. */
		title: Type.String(),
	},
	{ $id: "BrowserQueryResponse" },
);
export type BrowserQueryResponse = Static<typeof BrowserQueryResponse>;
