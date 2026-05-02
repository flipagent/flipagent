/**
 * Buyer ↔ seller message tools — backed by `/v1/messages` (Trading XML
 * internally, normalized to a flat `Message` shape).
 */

import { MessageCreate, MessagesListQuery } from "@flipagent/types";
import { getClient, toApiCallError } from "../client.js";
import type { Config } from "../config.js";

/* -------------------------- flipagent_messages_list ------------------------ */

export { MessagesListQuery as messagesListInput };

export const messagesListDescription =
	"List buyer ↔ seller messages for the connected account. GET /v1/messages. Filter via `direction` (incoming|outgoing), `unreadOnly`, `limit`, `offset`. Each `Message` carries `id`, `subject`, `body`, `counterparty`, `listingId?`, `orderId?`, ISO `sentAt`. Use this to surface buyer questions (`unreadOnly: true`).";

export async function messagesListExecute(config: Config, args: Record<string, unknown>): Promise<unknown> {
	try {
		const client = getClient(config);
		return await client.messages.list(args as Parameters<typeof client.messages.list>[0]);
	} catch (err) {
		const e = toApiCallError(err, "/v1/messages");
		return { error: "messages_list_failed", status: e.status, url: e.url, message: e.message };
	}
}

/* -------------------------- flipagent_messages_send ------------------------ */

export { MessageCreate as messagesSendInput };

export const messagesSendDescription =
	"Send a message (or reply) to a buyer. POST /v1/messages. Required: `recipient` (buyer eBay user id or `messageId` to reply to), `subject`, `body`. Use to answer buyer Q&A from `flipagent_messages_list({ unreadOnly: true })`.";

export async function messagesSendExecute(config: Config, args: Record<string, unknown>): Promise<unknown> {
	try {
		const client = getClient(config);
		return await client.messages.send(args as Parameters<typeof client.messages.send>[0]);
	} catch (err) {
		const e = toApiCallError(err, "/v1/messages");
		return { error: "messages_send_failed", status: e.status, url: e.url, message: e.message };
	}
}
