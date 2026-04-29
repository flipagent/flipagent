/**
 * `/v1/messages/*` — buyer ↔ seller messages. eBay never built a
 * REST messaging surface, so we wrap the legacy Trading API
 * (`GetMyMessages` for read, `AddMemberMessageRTQ` for reply).
 *
 *   GET  /v1/messages           — list inbox messages (paginated)
 *   POST /v1/messages/reply     — reply to a buyer's question on a listing
 *
 * Auth: `Authorization: Bearer fa_…`. `withTradingAuth` resolves the
 * api key's connected eBay refresh token, mints an access token, and
 * hands it to the handler. Trading API errors are mapped uniformly
 * to 502 by the middleware — handlers stay focused on shaping.
 */

import { type Static, Type } from "@sinclair/typebox";
import { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import { requireApiKey } from "../../middleware/auth.js";
import { withTradingAuth } from "../../middleware/with-trading-auth.js";
import { getMyMessages, replyToBuyer } from "../../services/ebay/trading/messages.js";
import { errorResponse, jsonResponse, tbBody } from "../../utils/openapi.js";

export const messagesRoute = new Hono();

const MyMessage = Type.Object(
	{
		messageId: Type.String(),
		externalMessageId: Type.Union([Type.String(), Type.Null()]),
		sender: Type.Union([Type.String(), Type.Null()]),
		recipient: Type.Union([Type.String(), Type.Null()]),
		subject: Type.Union([Type.String(), Type.Null()]),
		text: Type.Union([Type.String(), Type.Null()]),
		receiveDate: Type.Union([Type.String(), Type.Null()]),
		expirationDate: Type.Union([Type.String(), Type.Null()]),
		read: Type.Union([Type.Boolean(), Type.Null()]),
		replied: Type.Union([Type.Boolean(), Type.Null()]),
		flagged: Type.Union([Type.Boolean(), Type.Null()]),
		itemId: Type.Union([Type.String(), Type.Null()]),
		folderId: Type.Union([Type.String(), Type.Null()]),
		messageType: Type.Union([Type.String(), Type.Null()]),
	},
	{ $id: "MyMessage" },
);

const ListResponse = Type.Object({ messages: Type.Array(MyMessage) }, { $id: "MessagesListResponse" });

const ReplyRequest = Type.Object(
	{
		itemId: Type.String(),
		recipientUserId: Type.String(),
		parentMessageId: Type.String(),
		subject: Type.String(),
		body: Type.String(),
		emailCopyToSender: Type.Optional(Type.Boolean()),
	},
	{ $id: "MessageReplyRequest" },
);

const AckResponse = Type.Object({ ack: Type.String() }, { $id: "MessageReplyResponse" });

messagesRoute.get(
	"/",
	describeRoute({
		tags: ["Messages"],
		summary: "List inbox messages (Trading GetMyMessages)",
		responses: {
			200: jsonResponse("Inbox slice.", ListResponse),
			401: errorResponse("API key missing or eBay account not connected."),
			502: errorResponse("Trading API call failed."),
		},
	}),
	requireApiKey,
	withTradingAuth(async (c, accessToken) => {
		const messages = await getMyMessages({
			accessToken,
			folderId: c.req.query("folderId") ? Number(c.req.query("folderId")) : undefined,
			pageNumber: c.req.query("page") ? Number(c.req.query("page")) : undefined,
			entriesPerPage: c.req.query("limit") ? Number(c.req.query("limit")) : undefined,
		});
		return c.json({ messages });
	}),
);

messagesRoute.post(
	"/reply",
	describeRoute({
		tags: ["Messages"],
		summary: "Reply to a buyer question on a listing (Trading AddMemberMessageRTQ)",
		responses: {
			200: jsonResponse("Acknowledged.", AckResponse),
			400: errorResponse("Validation failed."),
			401: errorResponse("API key missing or eBay account not connected."),
			502: errorResponse("Trading API call failed."),
		},
	}),
	requireApiKey,
	tbBody(ReplyRequest),
	withTradingAuth(async (c, accessToken) => {
		// `tbBody(ReplyRequest)` validated upstream; read parsed body
		// fresh because Hono's chain doesn't surface validator types
		// through the wrapping middleware.
		const body = (await c.req.json()) as Static<typeof ReplyRequest>;
		const result = await replyToBuyer({ accessToken, ...body });
		return c.json(result);
	}),
);
