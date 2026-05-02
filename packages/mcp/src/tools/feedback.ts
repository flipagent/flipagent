/**
 * Feedback tools — backed by `/v1/feedback`. Unified buyer ↔ seller
 * feedback (Trading API internally).
 */

import { FeedbackCreate, FeedbackListQuery } from "@flipagent/types";
import { Type } from "@sinclair/typebox";
import { getClient, toApiCallError } from "../client.js";
import type { Config } from "../config.js";

/* -------------------------- flipagent_feedback_list ------------------------ */

export { FeedbackListQuery as feedbackListInput };

export const feedbackListDescription =
	"List feedback already given / received. GET /v1/feedback. Filter by `role` (buyer|seller), `rating` (positive|neutral|negative), `limit`, `offset`. Use to surface negative feedback that may need a follow-up message.";

export async function feedbackListExecute(config: Config, args: Record<string, unknown>): Promise<unknown> {
	try {
		const client = getClient(config);
		return await client.feedback.list(args as Parameters<typeof client.feedback.list>[0]);
	} catch (err) {
		const e = toApiCallError(err, "/v1/feedback");
		return { error: "feedback_list_failed", status: e.status, url: e.url, message: e.message };
	}
}

/* ------------------------ flipagent_feedback_awaiting ---------------------- */

export const feedbackAwaitingInput = Type.Object({});

export const feedbackAwaitingDescription =
	"List transactions still owed feedback by either side. GET /v1/feedback/awaiting. Each row has `transactionId`, `listingId`, `counterparty`, `role` (whose turn), `windowEndsAt?`. Use as a worklist for `flipagent_feedback_leave`.";

export async function feedbackAwaitingExecute(config: Config, _args: Record<string, unknown>): Promise<unknown> {
	try {
		const client = getClient(config);
		return await client.feedback.awaiting();
	} catch (err) {
		const e = toApiCallError(err, "/v1/feedback/awaiting");
		return { error: "feedback_awaiting_failed", status: e.status, url: e.url, message: e.message };
	}
}

/* ------------------------- flipagent_feedback_leave ------------------------ */

export { FeedbackCreate as feedbackLeaveInput };

export const feedbackLeaveDescription =
	"Leave feedback for a counterparty on one transaction. POST /v1/feedback. Required: `transactionId`, `rating` (positive|neutral|negative), `comment` (≤80 chars). Use after `flipagent_feedback_awaiting` to clear the worklist.";

export async function feedbackLeaveExecute(config: Config, args: Record<string, unknown>): Promise<unknown> {
	try {
		const client = getClient(config);
		return await client.feedback.leave(args as Parameters<typeof client.feedback.leave>[0]);
	} catch (err) {
		const e = toApiCallError(err, "/v1/feedback");
		return { error: "feedback_leave_failed", status: e.status, url: e.url, message: e.message };
	}
}
