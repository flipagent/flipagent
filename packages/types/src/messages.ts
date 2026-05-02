/**
 * `/v1/messages/*` — buyer ↔ seller messaging. Wraps Trading XML
 * (`GetMyMessages` / `AddMemberMessageRTQ`) internally.
 */

import { type Static, Type } from "@sinclair/typebox";
import { Marketplace, Page, ResponseSource } from "./_common.js";

export const MessageDirection = Type.Union([Type.Literal("incoming"), Type.Literal("outgoing")], {
	$id: "MessageDirection",
});
export type MessageDirection = Static<typeof MessageDirection>;

export const Message = Type.Object(
	{
		id: Type.String(),
		marketplace: Marketplace,
		direction: MessageDirection,
		from: Type.String({ description: "Sender username." }),
		to: Type.String({ description: "Recipient username." }),
		subject: Type.Optional(Type.String()),
		body: Type.String(),
		listingId: Type.Optional(Type.String()),
		read: Type.Optional(Type.Boolean()),
		createdAt: Type.String(),
		replyTo: Type.Optional(Type.String({ description: "Message id this is in reply to." })),
	},
	{ $id: "Message" },
);
export type Message = Static<typeof Message>;

export const MessageCreate = Type.Object(
	{
		to: Type.String(),
		body: Type.String({ minLength: 1, maxLength: 2000 }),
		subject: Type.Optional(Type.String()),
		listingId: Type.Optional(Type.String()),
		replyTo: Type.Optional(Type.String()),
	},
	{ $id: "MessageCreate" },
);
export type MessageCreate = Static<typeof MessageCreate>;

export const MessagesListQuery = Type.Object(
	{
		limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 200, default: 50 })),
		offset: Type.Optional(Type.Integer({ minimum: 0, default: 0 })),
		direction: Type.Optional(MessageDirection),
		listingId: Type.Optional(Type.String()),
		marketplace: Type.Optional(Marketplace),
	},
	{ $id: "MessagesListQuery" },
);
export type MessagesListQuery = Static<typeof MessagesListQuery>;

export const MessagesListResponse = Type.Composite(
	[Page, Type.Object({ messages: Type.Array(Message), source: Type.Optional(ResponseSource) })],
	{ $id: "MessagesListResponse" },
);
export type MessagesListResponse = Static<typeof MessagesListResponse>;

export const MessageResponse = Type.Composite([Message, Type.Object({ source: Type.Optional(ResponseSource) })], {
	$id: "MessageResponse",
});
export type MessageResponse = Static<typeof MessageResponse>;
