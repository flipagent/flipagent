/**
 * Trading API: feedback. eBay's REST surface doesn't include
 * post-transaction feedback yet — Trading remains the way to leave
 * feedback for buyers and read your own seller feedback profile.
 *
 *   GetFeedback                  — read inbound feedback
 *   LeaveFeedback                — leave feedback for a transaction
 *   GetItemsAwaitingFeedback     — orders pending feedback action
 */

import { arrayify, escapeXml, parseTrading, stringFrom, tradingCall } from "./client.js";

export interface FeedbackEntry {
	feedbackId: string;
	commentingUser: string | null;
	commentingUserScore: number | null;
	commentText: string | null;
	commentTime: string | null;
	commentType: string | null; // Positive | Negative | Neutral
	itemId: string | null;
	transactionId: string | null;
	role: string | null; // Buyer | Seller
}

export async function getFeedback(args: {
	accessToken: string;
	userId?: string; // default: authenticated user
	feedbackType?: "FeedbackReceivedAsSeller" | "FeedbackReceivedAsBuyer" | "FeedbackLeftByMe";
	pageNumber?: number;
	entriesPerPage?: number;
}): Promise<FeedbackEntry[]> {
	const body = `<?xml version="1.0" encoding="utf-8"?>
<GetFeedbackRequest xmlns="urn:ebay:apis:eBLBaseComponents">
	${args.userId ? `<UserID>${escapeXml(args.userId)}</UserID>` : ""}
	<FeedbackType>${args.feedbackType ?? "FeedbackReceivedAsSeller"}</FeedbackType>
	<DetailLevel>ReturnAll</DetailLevel>
	<Pagination>
		<EntriesPerPage>${args.entriesPerPage ?? 25}</EntriesPerPage>
		<PageNumber>${args.pageNumber ?? 1}</PageNumber>
	</Pagination>
</GetFeedbackRequest>`;
	const xml = await tradingCall({ callName: "GetFeedback", accessToken: args.accessToken, body });
	const parsed = parseTrading(xml, "GetFeedback");
	const rows = arrayify(parsed.FeedbackDetailArray as Record<string, unknown>);
	const inner: unknown =
		rows.length === 1 && rows[0]?.FeedbackDetail !== undefined ? rows[0].FeedbackDetail : parsed.FeedbackDetailArray;
	return arrayify(inner).map((f) => {
		const score = stringFrom(f.CommentingUserScore);
		return {
			feedbackId: stringFrom(f.FeedbackID) ?? "",
			commentingUser: stringFrom(f.CommentingUser),
			commentingUserScore: score != null ? Number(score) : null,
			commentText: stringFrom(f.CommentText),
			commentTime: stringFrom(f.CommentTime),
			commentType: stringFrom(f.CommentType),
			itemId: stringFrom(f.ItemID),
			transactionId: stringFrom(f.TransactionID),
			role: stringFrom(f.Role),
		};
	});
}

export type FeedbackRating = "Positive" | "Negative" | "Neutral";

export async function leaveFeedback(args: {
	accessToken: string;
	itemId: string;
	transactionId: string;
	targetUser: string;
	rating: FeedbackRating;
	commentText: string;
	commentType?: "Praise" | "Complaint" | "Neutral";
}): Promise<{ ack: string; feedbackId: string | null }> {
	const body = `<?xml version="1.0" encoding="utf-8"?>
<LeaveFeedbackRequest xmlns="urn:ebay:apis:eBLBaseComponents">
	<ItemID>${escapeXml(args.itemId)}</ItemID>
	<TransactionID>${escapeXml(args.transactionId)}</TransactionID>
	<TargetUser>${escapeXml(args.targetUser)}</TargetUser>
	<CommentType>${args.commentType ?? (args.rating === "Positive" ? "Praise" : args.rating === "Negative" ? "Complaint" : "Neutral")}</CommentType>
	<CommentText>${escapeXml(args.commentText)}</CommentText>
</LeaveFeedbackRequest>`;
	const xml = await tradingCall({ callName: "LeaveFeedback", accessToken: args.accessToken, body });
	const parsed = parseTrading(xml, "LeaveFeedback");
	return {
		ack: stringFrom(parsed.Ack) ?? "Unknown",
		feedbackId: stringFrom(parsed.FeedbackID),
	};
}

export interface AwaitingFeedbackRow {
	orderId: string;
	listingId: string;
	counterparty: string;
	title: string;
	priceValue: string;
	priceCurrency: string;
	transactionDate: string;
}

export async function getItemsAwaitingFeedback(
	accessToken: string,
	role: "Buyer" | "Seller" = "Seller",
): Promise<AwaitingFeedbackRow[]> {
	const body = `<?xml version="1.0" encoding="utf-8"?>
<GetItemsAwaitingFeedbackRequest xmlns="urn:ebay:apis:eBLBaseComponents">
	<Role>${role}</Role>
	<DetailLevel>ReturnAll</DetailLevel>
</GetItemsAwaitingFeedbackRequest>`;
	const xml = await tradingCall({ callName: "GetItemsAwaitingFeedback", accessToken, body });
	const parsed = parseTrading(xml, "GetItemsAwaitingFeedback");
	const rows = arrayify(
		(parsed.ItemsAwaitingFeedback as Record<string, unknown>)?.TransactionArray as Record<string, unknown>,
	);
	const inner = rows.length === 1 && rows[0]?.Transaction !== undefined ? arrayify(rows[0].Transaction) : rows;
	return inner.map((tx) => {
		const item = (tx.Item ?? {}) as Record<string, unknown>;
		const buyer = (tx.Buyer ?? tx.Seller ?? {}) as Record<string, unknown>;
		const price = (tx.TransactionPrice ?? {}) as { _: string; "@_currencyID": string };
		return {
			orderId: stringFrom(tx.TransactionID) ?? "",
			listingId: stringFrom(item.ItemID) ?? "",
			counterparty: stringFrom(buyer.UserID) ?? "",
			title: stringFrom(item.Title) ?? "",
			priceValue: price._ ?? "0",
			priceCurrency: price["@_currencyID"] ?? "USD",
			transactionDate: stringFrom(tx.CreatedDate) ?? "",
		};
	});
}
