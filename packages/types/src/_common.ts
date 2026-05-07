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
 * Marketplace identifier — provider+region combined into one literal.
 *
 * Convention: snake_case `provider_region` (`ebay_us`, `ebay_gb`,
 * `amazon_us`, `mercari_jp`, …). Globally-unregioned providers use the
 * provider name alone (`stockx`).
 *
 * Today only `ebay_us` is wired. The literal expands here when a new
 * adapter+region combo ships. Don't pre-declare literals for combos
 * that aren't supported — silent failure modes (validation accepts,
 * dispatcher routes nowhere) are worse than a compile error when the
 * new literal lands.
 *
 * Used as both the public dispatch knob (input on every list/search/
 * create that targets a marketplace) and the response discriminator
 * (every flipagent record carries its source marketplace). Routes
 * translate to provider-native ids (eBay's `EBAY_US`, etc.) at the
 * adapter boundary via `services/shared/marketplace.ts`.
 */
export const Marketplace = Type.Literal("ebay_us", { $id: "Marketplace" });
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
 * `nextAction` — standard remediation field on flipagent responses.
 * When the API needs the caller to do something (open a URL, install
 * the extension, run an OAuth flow, …), the body carries this shape.
 * `kind` is the discriminator; `url` is absolute; `instructions` is
 * rendered verbatim to LLM agents — no client-side guesswork.
 */
export const NextAction = Type.Object(
	{
		kind: Type.String(),
		url: Type.String(),
		instructions: Type.String(),
	},
	{ $id: "NextAction" },
);
export type NextAction = Static<typeof NextAction>;

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
