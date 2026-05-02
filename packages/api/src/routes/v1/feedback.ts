/**
 * `/v1/feedback/*` — buyer/seller feedback, normalized.
 * Wraps Trading API XML internally.
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
import { withTradingAuth } from "../../middleware/with-trading-auth.js";
import { type FeedbackEntry, getFeedback, leaveFeedback } from "../../services/ebay/trading/feedback.js";
import { scrubMessageBody } from "../../services/ebay/trading/message-hygiene.js";
import { fetchAwaitingFeedback } from "../../services/feedback.js";
import { errorResponse, jsonResponse, paramsFor, tbBody, tbCoerce } from "../../utils/openapi.js";

export const feedbackRoute = new Hono();

const RATING_FROM: Record<string, Feedback["rating"]> = {
	Positive: "positive",
	Neutral: "neutral",
	Negative: "negative",
};
const RATING_TO: Record<string, "Positive" | "Neutral" | "Negative"> = {
	positive: "Positive",
	neutral: "Neutral",
	negative: "Negative",
};

function entryToFeedback(e: FeedbackEntry): Feedback {
	const role: Feedback["role"] = e.role?.toLowerCase() === "buyer" ? "buyer" : "seller";
	return {
		id: e.feedbackId,
		marketplace: "ebay",
		role,
		rating: RATING_FROM[e.commentType ?? "Positive"] ?? "positive",
		comment: e.commentText ?? "",
		fromUser: e.commentingUser ?? "",
		toUser: "",
		...(e.itemId ? { listingId: e.itemId } : {}),
		...(e.transactionId ? { orderId: e.transactionId } : {}),
		createdAt: e.commentTime ?? "",
	};
}

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
	withTradingAuth(async (c, accessToken) => {
		const limit = Number(c.req.query("limit") ?? 50);
		const role = (c.req.query("role") as "buyer" | "seller" | undefined) ?? "seller";
		const feedbackType = role === "seller" ? "FeedbackReceivedAsSeller" : "FeedbackReceivedAsBuyer";
		const raw = await getFeedback({ accessToken, feedbackType, entriesPerPage: limit, pageNumber: 1 });
		const feedback = raw.map(entryToFeedback);
		return c.json({ feedback, limit, offset: 0, source: "trading" as const });
	}),
);

feedbackRoute.get(
	"/awaiting",
	describeRoute({
		tags: ["Feedback"],
		summary: "Orders awaiting feedback (Trading GetItemsAwaitingFeedback)",
		responses: {
			200: jsonResponse("Awaiting.", FeedbackAwaiting),
			401: errorResponse("Auth missing."),
			502: errorResponse("Trading API failed."),
		},
	}),
	requireApiKey,
	withTradingAuth(async (c, accessToken) => {
		const role = (c.req.query("role") as "buyer" | "seller" | undefined) ?? "seller";
		return c.json({ ...(await fetchAwaitingFeedback(accessToken, role)), source: "trading" as const });
	}),
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
	withTradingAuth(async (c, accessToken) => {
		const body = (await c.req.json()) as {
			orderId: string;
			toUser: string;
			rating: keyof typeof RATING_TO;
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
			accessToken,
			itemId: body.orderId,
			transactionId: body.orderId,
			targetUser: body.toUser,
			rating: RATING_TO[body.rating],
			commentText: hygiene.cleanBody,
		});
		return c.json({ ...result, redactions: hygiene.redactions });
	}),
);
