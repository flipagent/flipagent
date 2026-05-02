/**
 * `/v1/messages/*` — eBay messaging exposed in the conversation-threaded
 * model that REST `commerce/message/v1` uses (verified live 2026-05-02;
 * see notes/ebay-coverage.md G.1).
 *
 *   GET  /v1/messages              → list conversations
 *   GET  /v1/messages/{id}?type=…  → fetch the messages within one thread
 *   POST /v1/messages              → send into existing thread (or open one)
 */

import {
	type Conversation,
	ConversationsListQuery,
	ConversationsListResponse,
	ConversationThreadQuery,
	ConversationThreadResponse,
	type ConversationType,
	MessageSendRequest,
	MessageSendResponse,
	type ThreadMessage,
} from "@flipagent/types";
import { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import { requireApiKey } from "../../middleware/auth.js";
import { getConversationThread, listConversations, sendMessage } from "../../services/ebay/rest/messages.js";
import { scrubMessageBody } from "../../services/ebay/trading/message-hygiene.js";
import { errorResponse, jsonResponse, paramsFor, tbBody, tbCoerce } from "../../utils/openapi.js";

export const messagesRoute = new Hono();

messagesRoute.get(
	"/",
	describeRoute({
		tags: ["Messages"],
		summary: "List conversations",
		parameters: paramsFor("query", ConversationsListQuery),
		responses: {
			200: jsonResponse("Conversation page.", ConversationsListResponse),
			401: errorResponse("Auth missing."),
		},
	}),
	requireApiKey,
	tbCoerce("query", ConversationsListQuery),
	async (c) => {
		const apiKeyId = c.var.apiKey.id;
		const limit = Number(c.req.query("limit") ?? 50);
		const offset = Number(c.req.query("offset") ?? 0);
		const type = c.req.query("type") as ConversationType | undefined;
		const result = await listConversations({ apiKeyId, limit, offset, ...(type ? { type } : {}) });
		return c.json({
			conversations: result.conversations satisfies Conversation[],
			limit: result.limit,
			offset: result.offset,
			...(result.total != null ? { total: result.total } : {}),
			source: "rest" as const,
		});
	},
);

messagesRoute.get(
	"/:conversationId",
	describeRoute({
		tags: ["Messages"],
		summary: "Get the messages in one conversation thread",
		parameters: paramsFor("query", ConversationThreadQuery),
		responses: {
			200: jsonResponse("Conversation thread.", ConversationThreadResponse),
			400: errorResponse("Validation failed (type query param required)."),
			401: errorResponse("Auth missing."),
		},
	}),
	requireApiKey,
	tbCoerce("query", ConversationThreadQuery),
	async (c) => {
		const apiKeyId = c.var.apiKey.id;
		const conversationId = c.req.param("conversationId");
		const type = c.req.query("type") as ConversationType | undefined;
		if (!type) {
			return c.json(
				{
					error: "missing_query_param" as const,
					message: "?type=from_ebay|from_members is required (carry over from the list response).",
				},
				400,
			);
		}
		const limit = Number(c.req.query("limit") ?? 25);
		const offset = Number(c.req.query("offset") ?? 0);
		const result = await getConversationThread({ apiKeyId, conversationId, type, limit, offset });
		return c.json({
			conversation: result.conversation satisfies Conversation,
			messages: result.messages satisfies ThreadMessage[],
			limit: result.limit,
			offset: result.offset,
			...(result.total != null ? { total: result.total } : {}),
			source: "rest" as const,
		});
	},
);

messagesRoute.post(
	"/",
	describeRoute({
		tags: ["Messages"],
		summary: "Send a message (reply into a thread or open a new one)",
		responses: {
			200: jsonResponse("Sent.", MessageSendResponse),
			400: errorResponse("Validation failed."),
			422: errorResponse("Off-eBay contact info detected; edit + retry or pass ?force_send=1."),
		},
	}),
	requireApiKey,
	tbBody(MessageSendRequest),
	async (c) => {
		const apiKeyId = c.var.apiKey.id;
		const body = (await c.req.json()) as MessageSendRequest;
		if (!body.conversationId && !body.otherPartyUsername) {
			return c.json(
				{
					error: "missing_target" as const,
					message: "Provide either `conversationId` (reply) or `otherPartyUsername` (new thread).",
				},
				400,
			);
		}
		// Off-eBay contact strip — prohibited by eBay's "Offering to buy or
		// sell outside of eBay" policy and our AUP. Default behaviour is to
		// reject the send so the caller knows their copy contained a phone /
		// email / external URL; pass `?force_send=1` to ship the redacted
		// body anyway (used by automation pipelines that already vet copy).
		const hygiene = scrubMessageBody(body.messageText);
		const forceSend = c.req.query("force_send") === "1";
		if (hygiene.redactions.length > 0 && !forceSend) {
			return c.json(
				{
					error: "off_ebay_contact_info" as const,
					message:
						"Message contains contact info eBay's User Agreement prohibits in messages: " +
						hygiene.redactions.map((r) => `${r.kind} (${r.original})`).join(", ") +
						". Edit and retry, or pass `?force_send=1` to ship the redacted version.",
					redactions: hygiene.redactions,
					redactedBody: hygiene.cleanBody,
				},
				422,
			);
		}
		const result = await sendMessage({
			apiKeyId,
			...(body.conversationId ? { conversationId: body.conversationId } : {}),
			...(body.otherPartyUsername ? { otherPartyUsername: body.otherPartyUsername } : {}),
			...(body.reference ? { reference: body.reference } : {}),
			messageText: hygiene.cleanBody,
			...(body.emailCopyToSender != null ? { emailCopyToSender: body.emailCopyToSender } : {}),
		});
		return c.json({
			id: result.id,
			...(result.conversationId ? { conversationId: result.conversationId } : {}),
			...(result.senderUsername ? { senderUsername: result.senderUsername } : {}),
			...(result.recipientUsername ? { recipientUsername: result.recipientUsername } : {}),
			...(result.subject ? { subject: result.subject } : {}),
			body: result.body,
			createdAt: result.createdAt,
			source: "rest" as const,
			...(hygiene.redactions.length > 0 ? { redactions: hygiene.redactions } : {}),
		});
	},
);
