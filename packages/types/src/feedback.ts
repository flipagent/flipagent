/**
 * `/v1/feedback/*` — buyer/seller post-transaction feedback. Backed
 * by REST `commerce/feedback/v1` (verified live 2026-05-02; see
 * notes/ebay-coverage.md G.1).
 */

import { type Static, Type } from "@sinclair/typebox";
import { Marketplace, Page, ResponseSource } from "./_common.js";

export const FeedbackRating = Type.Union(
	[Type.Literal("positive"), Type.Literal("neutral"), Type.Literal("negative")],
	{ $id: "FeedbackRating" },
);
export type FeedbackRating = Static<typeof FeedbackRating>;

export const FeedbackRole = Type.Union([Type.Literal("buyer"), Type.Literal("seller")], { $id: "FeedbackRole" });
export type FeedbackRole = Static<typeof FeedbackRole>;

export const Feedback = Type.Object(
	{
		id: Type.String(),
		marketplace: Marketplace,
		role: FeedbackRole,
		rating: FeedbackRating,
		comment: Type.String(),
		fromUser: Type.String(),
		toUser: Type.String(),
		listingId: Type.Optional(Type.String()),
		orderId: Type.Optional(Type.String()),
		createdAt: Type.String(),
	},
	{ $id: "Feedback" },
);
export type Feedback = Static<typeof Feedback>;

export const FeedbackCreate = Type.Object(
	{
		orderId: Type.String(),
		toUser: Type.String(),
		rating: FeedbackRating,
		comment: Type.String({ minLength: 1, maxLength: 80 }),
	},
	{ $id: "FeedbackCreate" },
);
export type FeedbackCreate = Static<typeof FeedbackCreate>;

export const FeedbackListQuery = Type.Object(
	{
		limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 200, default: 50 })),
		offset: Type.Optional(Type.Integer({ minimum: 0, default: 0 })),
		role: Type.Optional(FeedbackRole),
		marketplace: Type.Optional(Marketplace),
	},
	{ $id: "FeedbackListQuery" },
);
export type FeedbackListQuery = Static<typeof FeedbackListQuery>;

export const FeedbackListResponse = Type.Composite(
	[Page, Type.Object({ feedback: Type.Array(Feedback), source: Type.Optional(ResponseSource) })],
	{ $id: "FeedbackListResponse" },
);
export type FeedbackListResponse = Static<typeof FeedbackListResponse>;
