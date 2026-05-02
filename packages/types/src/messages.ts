/**
 * `/v1/messages/*` — eBay messaging, exposed natively in eBay's
 * conversation-threaded model (`commerce/message/v1`).
 *
 *   GET  /v1/messages              → list conversations (one row per thread)
 *   GET  /v1/messages/{id}?type=…  → fetch the messages within one thread
 *   POST /v1/messages              → send into existing thread (or open one)
 *
 * `Conversation` is the seller's inbox unit — it can be a buyer chat
 * (`from_members`) or an eBay system notification stream (`from_ebay`,
 * which carries return updates, payment receipts, listing reminders,
 * promotion offers). Each conversation owns N `ThreadMessage` entries
 * with the actual bodies; the list endpoint returns summaries +
 * `latestMessage` so callers can render an inbox without fanout.
 */

import { type Static, Type } from "@sinclair/typebox";
import { Marketplace, Page, ResponseSource } from "./_common.js";

export const ConversationType = Type.Union(
	[
		Type.Literal("from_ebay", {
			description: "System messages from eBay (returns, payments, listing reminders, promos).",
		}),
		Type.Literal("from_members", { description: "Member-to-member chat (buyer ↔ seller)." }),
	],
	{ $id: "ConversationType" },
);
export type ConversationType = Static<typeof ConversationType>;

export const ConversationStatus = Type.Union([Type.Literal("active"), Type.Literal("archived")], {
	$id: "ConversationStatus",
});
export type ConversationStatus = Static<typeof ConversationStatus>;

/**
 * One message within a conversation thread. `body` may contain HTML
 * for `from_ebay` system notifications; `from_members` bodies are
 * plain text. `senderUsername` / `recipientUsername` are eBay user
 * identifiers, not flipagent api-key user ids.
 */
export const ThreadMessage = Type.Object(
	{
		id: Type.String(),
		body: Type.String(),
		senderUsername: Type.Optional(Type.String()),
		recipientUsername: Type.Optional(Type.String()),
		subject: Type.Optional(Type.String()),
		readStatus: Type.Optional(Type.Boolean()),
		createdAt: Type.String(),
	},
	{ $id: "ThreadMessage" },
);
export type ThreadMessage = Static<typeof ThreadMessage>;

export const Conversation = Type.Object(
	{
		id: Type.String(),
		marketplace: Marketplace,
		type: ConversationType,
		status: ConversationStatus,
		title: Type.Optional(Type.String()),
		referenceId: Type.Optional(Type.String({ description: "Item ID when referenceType=listing." })),
		referenceType: Type.Optional(Type.String({ description: "Currently always `listing` from eBay." })),
		unreadCount: Type.Integer({ minimum: 0 }),
		latestMessage: Type.Optional(ThreadMessage),
		createdAt: Type.String(),
	},
	{ $id: "Conversation" },
);
export type Conversation = Static<typeof Conversation>;

export const ConversationsListQuery = Type.Object(
	{
		limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 200, default: 50 })),
		offset: Type.Optional(Type.Integer({ minimum: 0, default: 0 })),
		type: Type.Optional(ConversationType),
		marketplace: Type.Optional(Marketplace),
	},
	{ $id: "ConversationsListQuery" },
);
export type ConversationsListQuery = Static<typeof ConversationsListQuery>;

export const ConversationsListResponse = Type.Composite(
	[Page, Type.Object({ conversations: Type.Array(Conversation), source: Type.Optional(ResponseSource) })],
	{ $id: "ConversationsListResponse" },
);
export type ConversationsListResponse = Static<typeof ConversationsListResponse>;

/**
 * `type` is required because eBay routes thread fetches by
 * conversation_type; the same conversation_id can mean different
 * things across types. The list response surfaces `type` on every
 * row so callers can chain `list → fetch thread` naturally.
 */
export const ConversationThreadQuery = Type.Object(
	{
		type: ConversationType,
		limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 50, default: 25 })),
		offset: Type.Optional(Type.Integer({ minimum: 0, default: 0 })),
	},
	{ $id: "ConversationThreadQuery" },
);
export type ConversationThreadQuery = Static<typeof ConversationThreadQuery>;

export const ConversationThreadResponse = Type.Composite(
	[
		Page,
		Type.Object({
			conversation: Conversation,
			messages: Type.Array(ThreadMessage),
			source: Type.Optional(ResponseSource),
		}),
	],
	{ $id: "ConversationThreadResponse" },
);
export type ConversationThreadResponse = Static<typeof ConversationThreadResponse>;

/**
 * Send into an existing conversation OR open a new one with another
 * eBay user. Exactly one of `conversationId` / `otherPartyUsername`
 * must be set. `reference` ties the new conversation to a listing
 * (recommended for buyer-question replies).
 */
export const MessageSendRequest = Type.Object(
	{
		conversationId: Type.Optional(Type.String({ description: "Reply into this thread." })),
		otherPartyUsername: Type.Optional(Type.String({ description: "Open a new thread with this eBay user." })),
		reference: Type.Optional(
			Type.Object({
				referenceType: Type.String({ description: "Currently `listing` only." }),
				referenceId: Type.String({ description: "eBay item ID for `listing` references." }),
			}),
		),
		messageText: Type.String({ minLength: 1, maxLength: 2000 }),
		emailCopyToSender: Type.Optional(Type.Boolean()),
	},
	{ $id: "MessageSendRequest" },
);
export type MessageSendRequest = Static<typeof MessageSendRequest>;

export const MessageSendResponse = Type.Object(
	{
		id: Type.String(),
		conversationId: Type.Optional(Type.String()),
		senderUsername: Type.Optional(Type.String()),
		recipientUsername: Type.Optional(Type.String()),
		subject: Type.Optional(Type.String()),
		body: Type.String(),
		createdAt: Type.String(),
		source: Type.Optional(ResponseSource),
		redactions: Type.Optional(Type.Array(Type.Object({ kind: Type.String(), original: Type.String() }))),
	},
	{ $id: "MessageSendResponse" },
);
export type MessageSendResponse = Static<typeof MessageSendResponse>;
