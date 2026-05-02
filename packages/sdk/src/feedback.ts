/**
 * `client.feedback.*` — buyer ↔ seller feedback (Trading API).
 * `awaiting()` returns transactions still owed feedback by either side.
 */

import type { Feedback, FeedbackCreate, FeedbackListQuery, FeedbackListResponse } from "@flipagent/types";
import type { FlipagentHttp } from "./http.js";

export interface FeedbackAwaiting {
	awaiting: Array<{
		transactionId: string;
		listingId: string;
		counterparty: string;
		role: "buyer" | "seller";
		windowEndsAt?: string;
	}>;
	source: string;
}

export interface FeedbackClient {
	list(params?: FeedbackListQuery): Promise<FeedbackListResponse>;
	awaiting(): Promise<FeedbackAwaiting>;
	leave(body: FeedbackCreate): Promise<Feedback>;
}

export function createFeedbackClient(http: FlipagentHttp): FeedbackClient {
	return {
		list: (params) => http.get("/v1/feedback", params as Record<string, string | number | undefined> | undefined),
		awaiting: () => http.get("/v1/feedback/awaiting"),
		leave: (body) => http.post("/v1/feedback", body),
	};
}
