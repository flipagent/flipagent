/**
 * Cross-resource primitives. Every flipagent-native `/v1/*` endpoint
 * builds on these. Kept separate from resource files so adding a new
 * marketplace literal or fixing the Money convention touches one file.
 *
 * Underscore-prefixed because the file is foundational, not a resource —
 * importers should reach for `Money`, `Marketplace`, `Page` directly.
 */

import { type Static, Type } from "@sinclair/typebox";

/**
 * Marketplace identifier. eBay only today; Amazon / Mercari / Poshmark
 * land here when their adapters ship. The string union (not an enum)
 * keeps it forward-compatible: a self-hoster can add a custom value
 * without forking types.
 */
export const Marketplace = Type.Union(
	[Type.Literal("ebay"), Type.Literal("amazon"), Type.Literal("mercari"), Type.Literal("poshmark")],
	{ $id: "Marketplace" },
);
export type Marketplace = Static<typeof Marketplace>;

/**
 * Money — cents-denominated integer + ISO 4217 currency.
 *
 * Every flipagent-native shape uses this. eBay's wire format is dollar
 * strings (`"12.99"`); we convert at the resource-service boundary so
 * code never juggles decimals. Self-hosters extending to Amazon/Mercari
 * convert the same way.
 */
export const Money = Type.Object(
	{
		value: Type.Integer({ description: "Amount in minor units (cents for USD, etc.)" }),
		currency: Type.String({ description: "ISO 4217 currency code", minLength: 3, maxLength: 3 }),
	},
	{ $id: "Money" },
);
export type Money = Static<typeof Money>;

/**
 * Page envelope shared across list endpoints. `next` is opaque (cursor
 * or token); when null, this is the last page. `total` is best-effort —
 * some upstream sources (eBay scrape) can't return an exact count, in
 * which case it's omitted.
 */
export const Page = Type.Object(
	{
		limit: Type.Integer({ minimum: 1, maximum: 200, default: 50 }),
		offset: Type.Integer({ minimum: 0, default: 0 }),
		total: Type.Optional(Type.Integer({ minimum: 0 })),
		next: Type.Optional(Type.Union([Type.String(), Type.Null()])),
	},
	{ $id: "Page" },
);
export type Page = Static<typeof Page>;

/**
 * Source of a fetched response — strictly the data origin. Mirrors
 * `X-Flipagent-Source` header so SDK clients reading the body alone can
 * render which transport ran. Cache hits flip the separate `fromCache`
 * field; `source` keeps naming the underlying transport.
 */
export const ResponseSource = Type.Union(
	[Type.Literal("rest"), Type.Literal("scrape"), Type.Literal("bridge"), Type.Literal("trading"), Type.Literal("llm")],
	{ $id: "ResponseSource" },
);
export type ResponseSource = Static<typeof ResponseSource>;

/**
 * Address — used by Purchase shipping_address, Sale ship_to,
 * Forwarder package destinations, etc. `line2` and `region` optional;
 * marketplaces vary on what's required. `country` is ISO 3166-1 alpha-2.
 */
export const Address = Type.Object(
	{
		name: Type.Optional(Type.String()),
		line1: Type.String(),
		line2: Type.Optional(Type.String()),
		city: Type.String(),
		region: Type.Optional(Type.String({ description: "State / province" })),
		postalCode: Type.String(),
		country: Type.String({ minLength: 2, maxLength: 2 }),
		phone: Type.Optional(Type.String()),
	},
	{ $id: "Address" },
);
export type Address = Static<typeof Address>;
