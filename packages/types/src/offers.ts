/**
 * `/v1/offers/*` — Best Offer in/out. Inbound (buyer → seller) flows
 * through Trading API XML (GetBestOffers / RespondToBestOffer);
 * outbound (seller → watcher) is sell/negotiation REST. Caller sees
 * one unified `Offer` shape with a `direction` discriminator.
 */

import { type Static, Type } from "@sinclair/typebox";
import { Marketplace, Money, Page } from "./_common.js";

export const OfferDirection = Type.Union([Type.Literal("incoming"), Type.Literal("outgoing")], {
	$id: "OfferDirection",
});
export type OfferDirection = Static<typeof OfferDirection>;

export const OfferStatus = Type.Union(
	[
		Type.Literal("pending"),
		Type.Literal("accepted"),
		Type.Literal("declined"),
		Type.Literal("countered"),
		Type.Literal("expired"),
	],
	{ $id: "OfferStatus" },
);
export type OfferStatus = Static<typeof OfferStatus>;

export const Offer = Type.Object(
	{
		id: Type.String(),
		marketplace: Marketplace,
		direction: OfferDirection,
		status: OfferStatus,
		listingId: Type.String(),
		buyer: Type.Optional(Type.String()),
		price: Money,
		quantity: Type.Integer({ minimum: 1, default: 1 }),
		message: Type.Optional(Type.String()),
		expiresAt: Type.Optional(Type.String()),
		createdAt: Type.String(),
	},
	{ $id: "Offer" },
);
export type Offer = Static<typeof Offer>;

/** Outbound: send an offer to a watcher. */
export const OfferCreate = Type.Object(
	{
		listingId: Type.String(),
		watchers: Type.Optional(Type.Array(Type.String(), { description: "Buyer usernames; defaults to all watchers." })),
		discountPercent: Type.Integer({ minimum: 1, maximum: 50 }),
		expiresIn: Type.Optional(Type.Integer({ description: "Hours until expiry. eBay default 48h." })),
		message: Type.Optional(Type.String({ maxLength: 1000 })),
	},
	{ $id: "OfferCreate" },
);
export type OfferCreate = Static<typeof OfferCreate>;

/** Inbound response: accept / decline / counter. */
export const OfferRespond = Type.Object(
	{
		action: Type.Union([Type.Literal("accept"), Type.Literal("decline"), Type.Literal("counter")]),
		counterPrice: Type.Optional(Money),
		message: Type.Optional(Type.String({ maxLength: 1000 })),
	},
	{ $id: "OfferRespond" },
);
export type OfferRespond = Static<typeof OfferRespond>;

export const OffersListQuery = Type.Object(
	{
		limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 200, default: 50 })),
		offset: Type.Optional(Type.Integer({ minimum: 0, default: 0 })),
		direction: Type.Optional(OfferDirection),
		status: Type.Optional(OfferStatus),
		listingId: Type.Optional(Type.String()),
		marketplace: Type.Optional(Marketplace),
	},
	{ $id: "OffersListQuery" },
);
export type OffersListQuery = Static<typeof OffersListQuery>;

export const OffersListResponse = Type.Composite([Page, Type.Object({ offers: Type.Array(Offer) })], {
	$id: "OffersListResponse",
});
export type OffersListResponse = Static<typeof OffersListResponse>;

export const OfferResponse = Type.Composite([Offer], {
	$id: "OfferResponse",
});
export type OfferResponse = Static<typeof OfferResponse>;
