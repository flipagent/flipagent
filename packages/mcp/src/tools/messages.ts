/**
 * Buyer ↔ seller message tools — backed by `/v1/messages` (REST
 * `commerce/message/v1`, conversation-threaded).
 */

import { ConversationsListQuery, ConversationThreadQuery, MessageSendRequest } from "@flipagent/types";
import { Type } from "@sinclair/typebox";
import { getClient, toolErrorEnvelope } from "../client.js";
import type { Config } from "../config.js";

/* ------------------------ flipagent_conversations_list --------------------- */

export { ConversationsListQuery as conversationsListInput };

export const conversationsListDescription =
	"List eBay conversation threads on the connected account. Calls GET /v1/messages. **When to use** — survey the inbox: buyer pre-purchase questions, return updates, payment receipts, listing reminders, promotion offers all surface here. Filter by `type: 'from_members'` for buyer ↔ seller chat only, or `type: 'from_ebay'` for system notifications. **Inputs** — optional `type` (`from_ebay | from_members`), pagination `limit` + `offset`. **Output** — `{ conversations: Conversation[], limit, offset, total? }`. Each `Conversation`: `id`, `type`, `status`, `title`, `referenceId` (item id when present), `unreadCount`, `latestMessage`, ISO `createdAt`. **Prereqs** — eBay seller account connected. **Example** — `{ type: 'from_members', limit: 20 }`.";

export async function conversationsListExecute(config: Config, args: Record<string, unknown>): Promise<unknown> {
	try {
		const client = getClient(config);
		return await client.messages.list(args as Parameters<typeof client.messages.list>[0]);
	} catch (err) {
		return toolErrorEnvelope(err, "conversations_list_failed", "/v1/messages");
	}
}

/* ----------------------- flipagent_conversation_thread --------------------- */

export const conversationThreadInput = Type.Composite([
	Type.Object({ conversationId: Type.String() }),
	ConversationThreadQuery,
]);

export const conversationThreadDescription =
	"Fetch the messages within one conversation thread. Calls GET /v1/messages/{conversationId}. **When to use** — after `flipagent_list_conversations` surfaces a thread, drill in to read the full body of buyer questions or system notifications. **Inputs** — `conversationId` (from list), `type` (carry over from list — eBay routes thread fetches by type), optional `limit` (default 25, max 50) + `offset`. **Output** — `{ conversation, messages: ThreadMessage[], limit, offset, total? }`. Each `ThreadMessage`: `id`, `body`, `senderUsername`, `recipientUsername`, optional `subject`, `readStatus`, `createdAt`. `from_ebay` bodies are HTML; `from_members` bodies are plain text. **Example** — `{ conversationId: '208522829140', type: 'from_members' }`.";

export async function conversationThreadExecute(config: Config, args: Record<string, unknown>): Promise<unknown> {
	try {
		const client = getClient(config);
		const { conversationId, ...query } = args as { conversationId: string } & Record<string, unknown>;
		return await client.messages.thread(conversationId, query as Parameters<typeof client.messages.thread>[1]);
	} catch (err) {
		return toolErrorEnvelope(err, "conversation_thread_failed", "/v1/messages/{id}");
	}
}

/* -------------------------- flipagent_messages_send ------------------------ */

export { MessageSendRequest as messagesSendInput };

export const messagesSendDescription =
	'Send a message into eBay. Calls POST /v1/messages. **When to use** — answer a buyer\'s pre-purchase question, follow up on a slow shipment, ask for clarification on a return request. Pair with `flipagent_list_conversations` + `flipagent_conversation_thread` as a worklist. **Inputs** — exactly ONE of `conversationId` (reply into existing thread) OR `otherPartyUsername` (start new thread with that eBay user). Always include `messageText` (≤2000 chars). Optional `reference: { referenceType: "listing", referenceId: "<itemId>" }` ties new threads to a specific listing. Optional `emailCopyToSender`. **Off-eBay copy is auto-redacted** — phone numbers, emails, external URLs are stripped (caller gets 422 with redaction list; pass `?force_send=1` to ship the redacted version). **Output** — `{ id, conversationId?, senderUsername?, recipientUsername?, body, createdAt, source }`. **Example reply** — `{ conversationId: "208522829140", messageText: "Yes, the lens includes both caps." }`. **Example new thread** — `{ otherPartyUsername: "buyer123", reference: { referenceType: "listing", referenceId: "406338886641" }, messageText: "Following up on your question." }`.';

export async function messagesSendExecute(config: Config, args: Record<string, unknown>): Promise<unknown> {
	try {
		const client = getClient(config);
		return await client.messages.send(args as Parameters<typeof client.messages.send>[0]);
	} catch (err) {
		return toolErrorEnvelope(err, "messages_send_failed", "/v1/messages");
	}
}
