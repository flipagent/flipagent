/**
 * `/v1/feedback/*` — read seller feedback profile + leave feedback
 * for buyers. Trading API only — REST surface doesn't cover feedback.
 *
 *   GET  /v1/feedback        — list inbound feedback (paginated)
 *   POST /v1/feedback/leave  — leave feedback for a transaction
 */

import { type Static, Type } from "@sinclair/typebox";
import { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import { requireApiKey } from "../../middleware/auth.js";
import { withTradingAuth } from "../../middleware/with-trading-auth.js";
import { getFeedback, leaveFeedback } from "../../services/ebay/trading/feedback.js";
import { errorResponse, jsonResponse, tbBody } from "../../utils/openapi.js";

export const feedbackRoute = new Hono();

const FeedbackEntry = Type.Object(
	{
		feedbackId: Type.String(),
		commentingUser: Type.Union([Type.String(), Type.Null()]),
		commentingUserScore: Type.Union([Type.Integer(), Type.Null()]),
		commentText: Type.Union([Type.String(), Type.Null()]),
		commentTime: Type.Union([Type.String(), Type.Null()]),
		commentType: Type.Union([Type.String(), Type.Null()]),
		itemId: Type.Union([Type.String(), Type.Null()]),
		transactionId: Type.Union([Type.String(), Type.Null()]),
		role: Type.Union([Type.String(), Type.Null()]),
	},
	{ $id: "FeedbackEntry" },
);

const ListResponse = Type.Object({ feedback: Type.Array(FeedbackEntry) }, { $id: "FeedbackListResponse" });

const LeaveRequest = Type.Object(
	{
		itemId: Type.String(),
		transactionId: Type.String(),
		targetUser: Type.String(),
		rating: Type.Union([Type.Literal("Positive"), Type.Literal("Negative"), Type.Literal("Neutral")]),
		commentText: Type.String({ minLength: 1, maxLength: 500 }),
		commentType: Type.Optional(
			Type.Union([Type.Literal("Praise"), Type.Literal("Complaint"), Type.Literal("Neutral")]),
		),
	},
	{ $id: "FeedbackLeaveRequest" },
);

const LeaveResponse = Type.Object(
	{ ack: Type.String(), feedbackId: Type.Union([Type.String(), Type.Null()]) },
	{ $id: "FeedbackLeaveResponse" },
);

feedbackRoute.get(
	"/",
	describeRoute({
		tags: ["Feedback"],
		summary: "Read feedback (Trading GetFeedback)",
		responses: {
			200: jsonResponse("Feedback slice.", ListResponse),
			401: errorResponse("API key missing or eBay account not connected."),
			502: errorResponse("Trading API call failed."),
		},
	}),
	requireApiKey,
	withTradingAuth(async (c, accessToken) => {
		const feedbackType = c.req.query("type") as Parameters<typeof getFeedback>[0]["feedbackType"];
		const feedback = await getFeedback({
			accessToken,
			userId: c.req.query("userId") ?? undefined,
			feedbackType: feedbackType ?? undefined,
			pageNumber: c.req.query("page") ? Number(c.req.query("page")) : undefined,
			entriesPerPage: c.req.query("limit") ? Number(c.req.query("limit")) : undefined,
		});
		return c.json({ feedback });
	}),
);

feedbackRoute.post(
	"/leave",
	describeRoute({
		tags: ["Feedback"],
		summary: "Leave feedback for a transaction (Trading LeaveFeedback)",
		responses: {
			200: jsonResponse("Acknowledged.", LeaveResponse),
			400: errorResponse("Validation failed."),
			401: errorResponse("API key missing or eBay account not connected."),
			502: errorResponse("Trading API call failed."),
		},
	}),
	requireApiKey,
	tbBody(LeaveRequest),
	withTradingAuth(async (c, accessToken) => {
		const body = (await c.req.json()) as Static<typeof LeaveRequest>;
		const result = await leaveFeedback({ accessToken, ...body });
		return c.json(result);
	}),
);
