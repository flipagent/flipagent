/**
 * `/v1/messages/*` — buyer ↔ seller messages, normalized.
 * Wraps Trading API XML internally; caller sees flipagent `Message` shape.
 */

import { type Message, type MessageCreate, MessagesListQuery, MessagesListResponse } from "@flipagent/types";
import { Type } from "@sinclair/typebox";
import { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import { requireApiKey } from "../../middleware/auth.js";
import { withTradingAuth } from "../../middleware/with-trading-auth.js";
import { scrubMessageBody } from "../../services/ebay/trading/message-hygiene.js";
import { getMyMessages, type MyMessage, replyToBuyer } from "../../services/ebay/trading/messages.js";
import { errorResponse, jsonResponse, paramsFor, tbBody, tbCoerce } from "../../utils/openapi.js";

function tradingMessageToMessage(m: MyMessage, myUsername: string | undefined): Message {
	const direction: Message["direction"] = myUsername && m.sender === myUsername ? "outgoing" : "incoming";
	return {
		id: m.messageId,
		marketplace: "ebay",
		direction,
		from: m.sender ?? "",
		to: m.recipient ?? "",
		body: m.text ?? "",
		...(m.subject ? { subject: m.subject } : {}),
		...(m.itemId ? { listingId: m.itemId } : {}),
		...(m.read != null ? { read: m.read } : {}),
		createdAt: m.receiveDate ?? "",
	};
}

export const messagesRoute = new Hono();

const MessageCreateSchema = Type.Object(
	{
		to: Type.String(),
		body: Type.String({ minLength: 1, maxLength: 2000 }),
		subject: Type.Optional(Type.String()),
		listingId: Type.Optional(Type.String()),
		replyTo: Type.Optional(Type.String()),
	},
	{ $id: "MessageCreate" },
);

messagesRoute.get(
	"/",
	describeRoute({
		tags: ["Messages"],
		summary: "List messages",
		parameters: paramsFor("query", MessagesListQuery),
		responses: {
			200: jsonResponse("Messages page.", MessagesListResponse),
			401: errorResponse("Auth missing."),
			502: errorResponse("Trading API failed."),
		},
	}),
	requireApiKey,
	tbCoerce("query", MessagesListQuery),
	withTradingAuth(async (c, accessToken) => {
		const limit = Number(c.req.query("limit") ?? 50);
		const direction = c.req.query("direction") as "incoming" | "outgoing" | undefined;
		const raw = await getMyMessages({ accessToken, entriesPerPage: limit, pageNumber: 1 });
		const myUsername = c.var.apiKey.userId ?? undefined;
		const messages = raw.map((m) => tradingMessageToMessage(m, myUsername));
		const filtered = direction ? messages.filter((m) => m.direction === direction) : messages;
		return c.json({ messages: filtered, limit, offset: 0, source: "trading" as const });
	}),
);

messagesRoute.post(
	"/",
	describeRoute({
		tags: ["Messages"],
		summary: "Send / reply to a message",
		responses: {
			200: jsonResponse("Acknowledged.", Type.Object({ ack: Type.String() })),
			400: errorResponse("Validation failed."),
		},
	}),
	requireApiKey,
	tbBody(MessageCreateSchema),
	withTradingAuth(async (c, accessToken) => {
		const body = (await c.req.json()) as MessageCreate;
		if (!body.replyTo || !body.listingId) {
			return c.json(
				{
					error: "missing_reply_context",
					message: "replyTo + listingId are required for now (Trading AddMemberMessageRTQ).",
				},
				400,
			);
		}
		// Off-eBay contact strip — prohibited by eBay's "Offering to buy or
		// sell outside of eBay" policy and our AUP. Default behaviour is to
		// reject the send so the caller knows their copy contained a phone /
		// email / external URL; pass `?force_send=1` to ship the redacted
		// body anyway (used by automation pipelines that already vet copy).
		const hygiene = scrubMessageBody(body.body);
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
		const result = await replyToBuyer({
			accessToken,
			itemId: body.listingId,
			recipientUserId: body.to,
			parentMessageId: body.replyTo,
			subject: body.subject ?? "Re:",
			body: hygiene.cleanBody,
		});
		return c.json({ ...result, redactions: hygiene.redactions });
	}),
);
