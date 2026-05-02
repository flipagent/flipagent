/**
 * `/v1/me/selling` + `/v1/me/buying` + `/v1/feedback/awaiting` —
 * eBay's "MyeBay" unified views (Trading API only — no REST equivalent).
 * `/v1/listings/verify` — VerifyAddItem dry-run.
 */

import { type Static, Type } from "@sinclair/typebox";
import { Money, ResponseSource } from "./_common.js";
import { Item } from "./items.js";

export const SellingOverview = Type.Object(
	{
		active: Type.Object({
			items: Type.Array(Item),
			total: Type.Integer({ minimum: 0 }),
		}),
		sold: Type.Object({
			items: Type.Array(Item),
			total: Type.Integer({ minimum: 0 }),
		}),
		unsold: Type.Object({
			items: Type.Array(Item),
			total: Type.Integer({ minimum: 0 }),
		}),
		scheduled: Type.Optional(
			Type.Object({
				items: Type.Array(Item),
				total: Type.Integer({ minimum: 0 }),
			}),
		),
		source: Type.Optional(ResponseSource),
	},
	{ $id: "SellingOverview" },
);
export type SellingOverview = Static<typeof SellingOverview>;

export const BuyingOverview = Type.Object(
	{
		bidding: Type.Object({
			items: Type.Array(Item),
			total: Type.Integer({ minimum: 0 }),
		}),
		watching: Type.Object({
			items: Type.Array(Item),
			total: Type.Integer({ minimum: 0 }),
		}),
		won: Type.Object({
			items: Type.Array(Item),
			total: Type.Integer({ minimum: 0 }),
		}),
		lost: Type.Optional(
			Type.Object({
				items: Type.Array(Item),
				total: Type.Integer({ minimum: 0 }),
			}),
		),
		bestOffers: Type.Optional(
			Type.Object({
				items: Type.Array(Item),
				total: Type.Integer({ minimum: 0 }),
			}),
		),
		source: Type.Optional(ResponseSource),
	},
	{ $id: "BuyingOverview" },
);
export type BuyingOverview = Static<typeof BuyingOverview>;

export const FeedbackAwaiting = Type.Object(
	{
		role: Type.Union([Type.Literal("seller"), Type.Literal("buyer")]),
		items: Type.Array(
			Type.Object({
				orderId: Type.String(),
				listingId: Type.String(),
				counterparty: Type.String(),
				title: Type.String(),
				price: Money,
				transactionDate: Type.String(),
			}),
		),
		source: Type.Optional(ResponseSource),
	},
	{ $id: "FeedbackAwaiting" },
);
export type FeedbackAwaiting = Static<typeof FeedbackAwaiting>;

export const ListingVerifyRequest = Type.Object(
	{
		title: Type.String(),
		description: Type.Optional(Type.String()),
		price: Money,
		quantity: Type.Optional(Type.Integer({ minimum: 1, default: 1 })),
		categoryId: Type.String(),
		condition: Type.String(),
		images: Type.Array(Type.String(), { minItems: 1 }),
		aspects: Type.Optional(Type.Record(Type.String(), Type.Array(Type.String()))),
		duration: Type.Optional(Type.String({ description: "Days_30 | GTC | …" })),
	},
	{ $id: "ListingVerifyRequest" },
);
export type ListingVerifyRequest = Static<typeof ListingVerifyRequest>;

export const ListingVerifyResponse = Type.Object(
	{
		passed: Type.Boolean(),
		fees: Type.Optional(Money),
		errors: Type.Optional(Type.Array(Type.Object({ code: Type.String(), message: Type.String() }))),
		warnings: Type.Optional(Type.Array(Type.Object({ code: Type.String(), message: Type.String() }))),
		source: Type.Optional(ResponseSource),
	},
	{ $id: "ListingVerifyResponse" },
);
export type ListingVerifyResponse = Static<typeof ListingVerifyResponse>;

/* ----- watch list ---------------------------------------------------- */

export const WatchEntry = Type.Composite([Item, Type.Object({ addedAt: Type.Optional(Type.String()) })], {
	$id: "WatchEntry",
});
export type WatchEntry = Static<typeof WatchEntry>;

export const WatchListResponse = Type.Object(
	{ items: Type.Array(WatchEntry), total: Type.Integer({ minimum: 0 }), source: Type.Optional(ResponseSource) },
	{ $id: "WatchListResponse" },
);
export type WatchListResponse = Static<typeof WatchListResponse>;

export const WatchAddRequest = Type.Object({ itemId: Type.String() }, { $id: "WatchAddRequest" });
export type WatchAddRequest = Static<typeof WatchAddRequest>;

/* ----- saved searches ------------------------------------------------ */

export const SavedSearch = Type.Object(
	{
		id: Type.String(),
		name: Type.String(),
		query: Type.Optional(Type.String()),
		categoryId: Type.Optional(Type.String()),
		filter: Type.Optional(Type.String()),
		emailNotifications: Type.Optional(Type.Boolean()),
		createdAt: Type.Optional(Type.String()),
	},
	{ $id: "SavedSearch" },
);
export type SavedSearch = Static<typeof SavedSearch>;

export const SavedSearchCreate = Type.Object(
	{
		name: Type.String(),
		query: Type.Optional(Type.String()),
		categoryId: Type.Optional(Type.String()),
		filter: Type.Optional(Type.String()),
		emailNotifications: Type.Optional(Type.Boolean({ default: true })),
	},
	{ $id: "SavedSearchCreate" },
);
export type SavedSearchCreate = Static<typeof SavedSearchCreate>;

export const SavedSearchesListResponse = Type.Object(
	{ searches: Type.Array(SavedSearch), source: Type.Optional(ResponseSource) },
	{ $id: "SavedSearchesListResponse" },
);
export type SavedSearchesListResponse = Static<typeof SavedSearchesListResponse>;
