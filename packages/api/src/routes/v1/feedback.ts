/**
 * `/v1/feedback/*` — buyer/seller feedback. Backed by REST
 * `commerce/feedback/v1` (verified live 2026-05-02; see
 * notes/ebay-coverage.md G.1).
 */

import {
	type Feedback,
	FeedbackAwaiting,
	FeedbackCreate,
	FeedbackListQuery,
	FeedbackListResponse,
} from "@flipagent/types";
import { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import { requireApiKey } from "../../middleware/auth.js";
import { awaitingFeedback, leaveFeedback, listFeedback, respondToFeedback } from "../../services/ebay/rest/feedback.js";
import { scrubMessageBody } from "../../services/ebay/trading/message-hygiene.js";
import { errorResponse, jsonResponse, paramsFor, tbBody, tbCoerce } from "../../utils/openapi.js";

export const feedbackRoute = new Hono();

feedbackRoute.get(
	"/",
	describeRoute({
		tags: ["Feedback"],
		summary: "List feedback (sent or received)",
		parameters: paramsFor("query", FeedbackListQuery),
		responses: {
			200: jsonResponse("Feedback page.", FeedbackListResponse),
			401: errorResponse("Auth missing."),
		},
	}),
	requireApiKey,
	tbCoerce("query", FeedbackListQuery),
	async (c) => {
		const apiKeyId = c.var.apiKey.id;
		const limit = Number(c.req.query("limit") ?? 25);
		const offset = Number(c.req.query("offset") ?? 0);
		const role = (c.req.query("role") as "buyer" | "seller" | undefined) ?? "seller";
		const result = await listFeedback({ apiKeyId, role, limit, offset });
		return c.json({
			feedback: result.feedback satisfies Feedback[],
			limit: result.limit,
			offset: result.offset,
			...(result.total != null ? { total: result.total } : {}),
		});
	},
);

feedbackRoute.get(
	"/awaiting",
	describeRoute({
		tags: ["Feedback"],
		summary: "Orders awaiting feedback",
		responses: {
			200: jsonResponse("Awaiting.", FeedbackAwaiting),
			401: errorResponse("Auth missing."),
		},
	}),
	requireApiKey,
	async (c) => {
		const apiKeyId = c.var.apiKey.id;
		const role = (c.req.query("role") as "buyer" | "seller" | undefined) ?? "seller";
		const result = await awaitingFeedback({ apiKeyId, role });
		return c.json({ ...result });
	},
);

feedbackRoute.post(
	"/",
	describeRoute({
		tags: ["Feedback"],
		summary: "Leave feedback",
		responses: { 200: jsonResponse("Acknowledged.", FeedbackListResponse), 400: errorResponse("Validation failed.") },
	}),
	requireApiKey,
	tbBody(FeedbackCreate),
	async (c) => {
		const apiKeyId = c.var.apiKey.id;
		const body = (await c.req.json()) as {
			orderId: string;
			toUser: string;
			rating: "positive" | "neutral" | "negative";
			comment: string;
		};
		// Off-eBay contact strip — same hygiene as messages. Feedback comments
		// are public on the seller's profile so the policy stakes are higher.
		const hygiene = scrubMessageBody(body.comment);
		const forceSend = c.req.query("force_send") === "1";
		if (hygiene.redactions.length > 0 && !forceSend) {
			return c.json(
				{
					error: "off_ebay_contact_info" as const,
					message:
						"Feedback comment contains contact info eBay's User Agreement prohibits: " +
						hygiene.redactions.map((r) => `${r.kind} (${r.original})`).join(", ") +
						". Edit and retry, or pass `?force_send=1` to ship the redacted version.",
					redactions: hygiene.redactions,
					redactedComment: hygiene.cleanBody,
				},
				422,
			);
		}
		const result = await leaveFeedback({
			apiKeyId,
			orderLineItemId: body.orderId,
			rating: body.rating,
			comment: hygiene.cleanBody,
		});
		return c.json({ id: result.id, redactions: hygiene.redactions });
	},
);

feedbackRoute.post(
	"/:id/respond",
	describeRoute({
		tags: ["Feedback"],
		summary: "Respond to feedback the order partner left",
		description:
			"REST `commerce/feedback/v1/respond_to_feedback`. The connected user must be the recipient of the original feedback. Same off-eBay-contact hygiene as `/v1/feedback` POST.",
		responses: {
			200: { description: "Acknowledged." },
			400: errorResponse("Validation failed."),
			422: errorResponse("Off-eBay contact info detected."),
		},
	}),
	requireApiKey,
	async (c) => {
		const apiKeyId = c.var.apiKey.id;
		const feedbackId = c.req.param("id");
		const body = (await c.req.json()) as {
			recipientUserId: string;
			responseText: string;
			responseType?: "REPLY" | "FOLLOW_UP";
		};
		const hygiene = scrubMessageBody(body.responseText);
		const forceSend = c.req.query("force_send") === "1";
		if (hygiene.redactions.length > 0 && !forceSend) {
			return c.json(
				{
					error: "off_ebay_contact_info" as const,
					message:
						"Feedback response contains contact info eBay's User Agreement prohibits: " +
						hygiene.redactions.map((r) => `${r.kind} (${r.original})`).join(", ") +
						". Edit and retry, or pass `?force_send=1` to ship the redacted version.",
					redactions: hygiene.redactions,
					redactedResponseText: hygiene.cleanBody,
				},
				422,
			);
		}
		await respondToFeedback({
			apiKeyId,
			feedbackId,
			recipientUserId: body.recipientUserId,
			responseText: hygiene.cleanBody,
			...(body.responseType ? { responseType: body.responseType } : {}),
		});
		return c.json({ ok: true, redactions: hygiene.redactions });
	},
);
