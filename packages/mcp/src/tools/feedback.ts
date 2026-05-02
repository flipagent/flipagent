/**
 * Feedback tools — backed by `/v1/feedback` (REST
 * `commerce/feedback/v1` internally).
 */

import { FeedbackCreate, FeedbackListQuery } from "@flipagent/types";
import { Type } from "@sinclair/typebox";
import { getClient, toolErrorEnvelope } from "../client.js";
import type { Config } from "../config.js";

/* -------------------------- flipagent_feedback_list ------------------------ */

export { FeedbackListQuery as feedbackListInput };

export const feedbackListDescription =
	'List feedback already given or received on the connected account. Calls GET /v1/feedback. **When to use** — surface negative feedback for follow-up (`rating: "negative"`); audit historical sentiment; track buyer-side feedback when running mixed buy + sell. **Inputs** — optional `role` (`buyer | seller`), optional `rating` (`positive | neutral | negative`), pagination `limit` + `offset`. **Output** — `{ feedback: Feedback[], limit, offset }`. Each `Feedback`: `id`, `transactionId`, `counterparty`, `role`, `rating`, `comment`, ISO `leftAt`. **Prereqs** — eBay seller account connected. On 401 the response carries `next_action`. **Example** — `{ rating: "negative", limit: 10 }`.';

export async function feedbackListExecute(config: Config, args: Record<string, unknown>): Promise<unknown> {
	try {
		const client = getClient(config);
		return await client.feedback.list(args as Parameters<typeof client.feedback.list>[0]);
	} catch (err) {
		return toolErrorEnvelope(err, "feedback_list_failed", "/v1/feedback");
	}
}

/* ------------------------ flipagent_feedback_awaiting ---------------------- */

export const feedbackAwaitingInput = Type.Object({});

export const feedbackAwaitingDescription =
	"List transactions where feedback is still owed (by either side). Calls GET /v1/feedback/awaiting. **When to use** — daily worklist for `flipagent_leave_feedback`. eBay's feedback window closes at 60 days, so leaving feedback promptly buys reciprocity. **Inputs** — none. **Output** — `{ awaiting: [{ transactionId, listingId, counterparty, role, windowEndsAt? }] }`. `role` indicates whose turn it is. **Prereqs** — eBay seller account connected. **Example** — call with `{}`.";

export async function feedbackAwaitingExecute(config: Config, _args: Record<string, unknown>): Promise<unknown> {
	try {
		const client = getClient(config);
		return await client.feedback.awaiting();
	} catch (err) {
		return toolErrorEnvelope(err, "feedback_awaiting_failed", "/v1/feedback/awaiting");
	}
}

/* ------------------------- flipagent_feedback_leave ------------------------ */

export { FeedbackCreate as feedbackLeaveInput };

export const feedbackLeaveDescription =
	'Leave feedback on one transaction. Calls POST /v1/feedback. **When to use** — clear items from `flipagent_list_awaiting_feedback`. **Inputs** — `transactionId`, `rating` (`positive | neutral | negative`), `comment` (≤80 characters). **Output** — `{ id, leftAt }`. **Prereqs** — eBay seller account connected. **Example** — `{ transactionId: "T-12345", rating: "positive", comment: "Smooth transaction, fast payment. Thanks!" }`.';

export async function feedbackLeaveExecute(config: Config, args: Record<string, unknown>): Promise<unknown> {
	try {
		const client = getClient(config);
		return await client.feedback.leave(args as Parameters<typeof client.feedback.leave>[0]);
	} catch (err) {
		return toolErrorEnvelope(err, "feedback_leave_failed", "/v1/feedback");
	}
}
