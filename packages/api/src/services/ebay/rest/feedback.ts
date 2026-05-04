/**
 * REST client for `commerce/feedback/v1` — eBay's feedback API
 * (verified live 2026-05-02; see notes/ebay-coverage.md G.1).
 * Replaces Trading `GetFeedback` / `LeaveFeedback` /
 * `GetItemsAwaitingFeedback`.
 *
 * `list` requires a `user_id`; for self-feedback we look up the
 * connected seller's username from `user_ebay_oauth`. Awaiting +
 * leave are implicitly bound to the OAuth-token holder.
 */

import type { Feedback, FeedbackAwaiting, FeedbackRating, FeedbackRole } from "@flipagent/types";
import { toCents } from "../../shared/money.js";
import { getEbayUsernameForApiKey } from "../oauth.js";
import { EbayApiError, sellRequest } from "./user-client.js";

interface UpstreamComment {
	commentText?: string;
	commentTextRemovedPerPolicy?: boolean;
	state?: string;
}

interface UpstreamProviderUser {
	username?: string;
	userId?: string;
}

interface UpstreamOrderLineItemSummary {
	listingId?: string;
	listingTitle?: string;
	orderLineItemId?: string;
}

interface UpstreamFeedbackDetail {
	feedbackId?: string;
	commentType?: "POSITIVE" | "NEUTRAL" | "NEGATIVE";
	feedbackComment?: UpstreamComment;
	feedbackEnteredDate?: string;
	feedbackState?: string;
	providerUserDetail?: UpstreamProviderUser;
	orderLineItemSummary?: UpstreamOrderLineItemSummary;
}

interface UpstreamGetFeedbackResponse {
	feedbackEntries?: UpstreamFeedbackDetail[];
	feedback?: UpstreamFeedbackDetail[];
	// Per OAS3 spec + verified live 2026-05-03: pagination is wrapped
	// inside `pagination`, NOT flattened to the top level. The previous
	// shape destructured top-level `limit/offset/total/next` — all
	// always undefined; `total` was therefore never returned to callers.
	pagination?: { limit?: number; offset?: number; total?: number; next?: string };
}

const RATING_FROM: Record<string, FeedbackRating> = {
	POSITIVE: "positive",
	NEUTRAL: "neutral",
	NEGATIVE: "negative",
	Positive: "positive",
	Neutral: "neutral",
	Negative: "negative",
};

const RATING_TO_REST: Record<FeedbackRating, "POSITIVE" | "NEUTRAL" | "NEGATIVE"> = {
	positive: "POSITIVE",
	neutral: "NEUTRAL",
	negative: "NEGATIVE",
};

function toFeedback(f: UpstreamFeedbackDetail, viewerUsername: string): Feedback {
	const role: FeedbackRole = "seller"; // viewer's role; refined below if needed
	return {
		id: f.feedbackId ?? "",
		marketplace: "ebay",
		role,
		rating: RATING_FROM[f.commentType ?? "POSITIVE"] ?? "positive",
		comment: f.feedbackComment?.commentText ?? "",
		fromUser: f.providerUserDetail?.username ?? "",
		toUser: viewerUsername,
		...(f.orderLineItemSummary?.listingId ? { listingId: f.orderLineItemSummary.listingId } : {}),
		...(f.orderLineItemSummary?.orderLineItemId ? { orderId: f.orderLineItemSummary.orderLineItemId } : {}),
		createdAt: f.feedbackEnteredDate ?? "",
	};
}

export interface ListFeedbackArgs {
	apiKeyId: string;
	role?: FeedbackRole;
	rating?: FeedbackRating;
	limit?: number;
	offset?: number;
	listingId?: string;
	transactionId?: string;
}

export interface ListFeedbackResult {
	feedback: Feedback[];
	limit: number;
	offset: number;
	total?: number;
}

export async function listFeedback(args: ListFeedbackArgs): Promise<ListFeedbackResult> {
	const username = await getEbayUsernameForApiKey(args.apiKeyId);
	if (!username) {
		throw new EbayApiError(
			409,
			"ebay_username_unknown",
			"Connected eBay account has no recorded username; reconnect to populate it.",
		);
	}
	const params = new URLSearchParams();
	params.set("user_id", username);
	params.set("feedback_type", "FEEDBACK_RECEIVED");
	params.set("limit", String(args.limit ?? 25));
	params.set("offset", String(args.offset ?? 0));
	const filterParts: string[] = [];
	const role = args.role ?? "seller";
	filterParts.push(`role:${role.toUpperCase()}`);
	if (args.rating) filterParts.push(`commentType:${RATING_TO_REST[args.rating]}`);
	params.set("filter", filterParts.join(","));
	if (args.listingId) params.set("listing_id", args.listingId);
	if (args.transactionId) params.set("transaction_id", args.transactionId);
	const res = await sellRequest<UpstreamGetFeedbackResponse>({
		apiKeyId: args.apiKeyId,
		method: "GET",
		path: `/commerce/feedback/v1/feedback?${params}`,
		marketplace: "EBAY_US",
	});
	const entries = res.feedbackEntries ?? res.feedback ?? [];
	const p = res.pagination ?? {};
	return {
		feedback: entries.map((e) => ({ ...toFeedback(e, username), role })),
		limit: p.limit ?? args.limit ?? 25,
		offset: p.offset ?? args.offset ?? 0,
		...(p.total != null ? { total: p.total } : {}),
	};
}

interface UpstreamListingPrice {
	value?: number | string;
	currency?: string;
}

interface UpstreamAwaitingItem {
	listingId?: string;
	listingTitle?: string;
	listingPrice?: UpstreamListingPrice;
	orderLineItemId?: string;
	transactionId?: string;
}

interface UpstreamAwaitingResponse {
	itemsAwaitingFeedbackCount?: { asBuyer?: number; asSeller?: number };
	lineItems?: UpstreamAwaitingItem[];
	pagination?: { total?: number; count?: number; offset?: number; limit?: number };
}

export async function awaitingFeedback(args: { apiKeyId: string; role?: FeedbackRole }): Promise<FeedbackAwaiting> {
	const role = args.role ?? "seller";
	const params = new URLSearchParams();
	params.set("limit", "200");
	const res = await sellRequest<UpstreamAwaitingResponse>({
		apiKeyId: args.apiKeyId,
		method: "GET",
		path: `/commerce/feedback/v1/awaiting_feedback?${params}`,
		marketplace: "EBAY_US",
	});
	return {
		role,
		items: (res.lineItems ?? []).map((row) => ({
			orderId: row.orderLineItemId ?? row.transactionId ?? "",
			listingId: row.listingId ?? "",
			counterparty: "",
			title: row.listingTitle ?? "",
			price: {
				value: toCents(row.listingPrice?.value != null ? String(row.listingPrice.value) : "0"),
				currency: row.listingPrice?.currency ?? "USD",
			},
			transactionDate: "",
		})),
	};
}

interface UpstreamLeaveFeedbackResponse {
	feedbackId?: string;
}

export interface LeaveFeedbackArgs {
	apiKeyId: string;
	orderLineItemId: string;
	rating: FeedbackRating;
	comment: string;
}

export interface LeaveFeedbackResult {
	id: string;
}

export async function leaveFeedback(args: LeaveFeedbackArgs): Promise<LeaveFeedbackResult> {
	const body = {
		orderLineItemId: args.orderLineItemId,
		rating: RATING_TO_REST[args.rating],
		comment: { commentText: args.comment },
	};
	const res = await sellRequest<UpstreamLeaveFeedbackResponse>({
		apiKeyId: args.apiKeyId,
		method: "POST",
		path: "/commerce/feedback/v1/feedback",
		body,
		marketplace: "EBAY_US",
	});
	return { id: res.feedbackId ?? "" };
}

/**
 * Public feedback-rating summary for a user (positive/neutral/negative
 * counts over time windows). No auth scope required beyond basic.
 * Useful for evaluating a buyer's pre-purchase reputation before
 * accepting a Best Offer or trusting a high-value sale.
 */
export interface FeedbackRatingSummary {
	userId: string;
	feedbackScore?: number;
	positiveFeedbackPercent?: string;
	feedbackSummary?: { positive?: number; neutral?: number; negative?: number };
}

export async function getFeedbackRatingSummary(
	apiKeyId: string,
	username: string,
	ratingType: "ALL" | "BUYER" | "SELLER" = "ALL",
): Promise<FeedbackRatingSummary | null> {
	const params = new URLSearchParams({ user_id: username, filter: `ratingType:{${ratingType}}` });
	return await sellRequest<FeedbackRatingSummary>({
		apiKeyId,
		method: "GET",
		path: `/commerce/feedback/v1/feedback_rating_summary?${params}`,
		marketplace: "EBAY_US",
	}).catch(() => null);
}

export interface RespondToFeedbackArgs {
	apiKeyId: string;
	feedbackId: string;
	recipientUserId: string;
	responseText: string;
	/** REPLY (default) | FOLLOW_UP per RespondToFeedbackRequest spec. */
	responseType?: "REPLY" | "FOLLOW_UP";
}

/**
 * Reply to feedback the order partner left for the connected user.
 * Body shape per OAS3 `RespondToFeedbackRequest`:
 *   `{ feedbackId, recipientUserId, responseText, responseType }`.
 * `feedbackId` + `recipientUserId.userId` come from a prior `getFeedback`
 * call (`feedbackEntries[].feedbackId` and `.providerUserDetail.userId`
 * respectively). 200 OK; no echo of the response body.
 */
export async function respondToFeedback(args: RespondToFeedbackArgs): Promise<void> {
	await sellRequest<void>({
		apiKeyId: args.apiKeyId,
		method: "POST",
		path: "/commerce/feedback/v1/respond_to_feedback",
		body: {
			feedbackId: args.feedbackId,
			recipientUserId: args.recipientUserId,
			responseText: args.responseText,
			responseType: args.responseType ?? "REPLY",
		},
		marketplace: "EBAY_US",
	});
}
