/**
 * REST client for `commerce/message/v1` — eBay's conversation-threaded
 * messaging API. Replaces the Trading `GetMyMessages` /
 * `AddMemberMessageRTQ` pair (verified live 2026-05-02; see
 * notes/ebay-coverage.md G.1).
 *
 * Conversation list returns summaries with `latestMessage` previews;
 * thread fetch returns full message bodies. eBay routes thread
 * fetches by `conversation_type` so the caller passes it back from
 * the list response.
 */

import type { Conversation, ConversationType, ThreadMessage } from "@flipagent/types";
import { sellRequest } from "./user-client.js";

interface UpstreamMessageDetail {
	messageId?: string;
	messageBody?: string;
	subject?: string;
	senderUsername?: string;
	recipientUsername?: string;
	createdDate?: string;
	readStatus?: boolean;
	// SendMessageResponse uses `senderUserName` / `recipientUserName` (mixed-case N).
	senderUserName?: string;
	recipientUserName?: string;
}

interface UpstreamConversationDetail {
	conversationId?: string;
	conversationStatus?: string;
	conversationTitle?: string;
	conversationType?: string;
	createdDate?: string;
	latestMessage?: UpstreamMessageDetail;
	referenceId?: string;
	referenceType?: string;
	unreadCount?: number;
}

interface UpstreamConversationsResponse {
	conversations?: UpstreamConversationDetail[];
	limit?: number;
	offset?: number;
	total?: number;
	next?: string;
}

interface UpstreamThreadResponse {
	conversationId?: string;
	conversationStatus?: string;
	conversationTitle?: string;
	conversationType?: string;
	createdDate?: string;
	referenceId?: string;
	referenceType?: string;
	unreadCount?: number;
	messages?: UpstreamMessageDetail[];
	limit?: number;
	offset?: number;
	total?: number;
	next?: string;
}

function normalizeType(raw: string | undefined): ConversationType {
	return raw === "FROM_MEMBERS" ? "from_members" : "from_ebay";
}

function denormalizeType(t: ConversationType): "FROM_EBAY" | "FROM_MEMBERS" {
	return t === "from_members" ? "FROM_MEMBERS" : "FROM_EBAY";
}

function toMessage(m: UpstreamMessageDetail): ThreadMessage {
	return {
		id: m.messageId ?? "",
		body: m.messageBody ?? "",
		...(m.senderUsername || m.senderUserName ? { senderUsername: m.senderUsername ?? m.senderUserName } : {}),
		...(m.recipientUsername || m.recipientUserName
			? { recipientUsername: m.recipientUsername ?? m.recipientUserName }
			: {}),
		...(m.subject ? { subject: m.subject } : {}),
		...(m.readStatus != null ? { readStatus: m.readStatus } : {}),
		createdAt: m.createdDate ?? "",
	};
}

function toConversation(c: UpstreamConversationDetail): Conversation {
	const status: Conversation["status"] = c.conversationStatus === "ARCHIVE" ? "archived" : "active";
	return {
		id: c.conversationId ?? "",
		marketplace: "ebay",
		type: normalizeType(c.conversationType),
		status,
		...(c.conversationTitle ? { title: c.conversationTitle } : {}),
		...(c.referenceId ? { referenceId: c.referenceId } : {}),
		...(c.referenceType ? { referenceType: c.referenceType.toLowerCase() } : {}),
		unreadCount: c.unreadCount ?? 0,
		...(c.latestMessage ? { latestMessage: toMessage(c.latestMessage) } : {}),
		createdAt: c.createdDate ?? "",
	};
}

export interface ListConversationsArgs {
	apiKeyId: string;
	limit?: number;
	offset?: number;
	type?: ConversationType;
}

export interface ListConversationsResult {
	conversations: Conversation[];
	limit: number;
	offset: number;
	total?: number;
}

export async function listConversations(args: ListConversationsArgs): Promise<ListConversationsResult> {
	const params = new URLSearchParams();
	params.set("limit", String(args.limit ?? 50));
	params.set("offset", String(args.offset ?? 0));
	if (args.type) params.set("conversation_type", denormalizeType(args.type));
	const res = await sellRequest<UpstreamConversationsResponse>({
		apiKeyId: args.apiKeyId,
		method: "GET",
		path: `/commerce/message/v1/conversation?${params}`,
		marketplace: "EBAY_US",
	});
	return {
		conversations: (res.conversations ?? []).map(toConversation),
		limit: res.limit ?? args.limit ?? 50,
		offset: res.offset ?? args.offset ?? 0,
		...(res.total != null ? { total: res.total } : {}),
	};
}

export interface GetConversationThreadArgs {
	apiKeyId: string;
	conversationId: string;
	type: ConversationType;
	limit?: number;
	offset?: number;
}

export interface ConversationThreadResult {
	conversation: Conversation;
	messages: ThreadMessage[];
	limit: number;
	offset: number;
	total?: number;
}

export async function getConversationThread(args: GetConversationThreadArgs): Promise<ConversationThreadResult> {
	const params = new URLSearchParams();
	params.set("conversation_type", denormalizeType(args.type));
	params.set("limit", String(args.limit ?? 25));
	params.set("offset", String(args.offset ?? 0));
	const res = await sellRequest<UpstreamThreadResponse>({
		apiKeyId: args.apiKeyId,
		method: "GET",
		path: `/commerce/message/v1/conversation/${encodeURIComponent(args.conversationId)}?${params}`,
		marketplace: "EBAY_US",
	});
	const summary: UpstreamConversationDetail = {
		...(res.conversationId ? { conversationId: res.conversationId } : { conversationId: args.conversationId }),
		...(res.conversationStatus ? { conversationStatus: res.conversationStatus } : {}),
		...(res.conversationTitle ? { conversationTitle: res.conversationTitle } : {}),
		conversationType: res.conversationType ?? denormalizeType(args.type),
		...(res.createdDate ? { createdDate: res.createdDate } : {}),
		...(res.referenceId ? { referenceId: res.referenceId } : {}),
		...(res.referenceType ? { referenceType: res.referenceType } : {}),
		...(res.unreadCount != null ? { unreadCount: res.unreadCount } : {}),
	};
	return {
		conversation: toConversation(summary),
		messages: (res.messages ?? []).map(toMessage),
		limit: res.limit ?? args.limit ?? 25,
		offset: res.offset ?? args.offset ?? 0,
		...(res.total != null ? { total: res.total } : {}),
	};
}

export interface SendMessageArgs {
	apiKeyId: string;
	conversationId?: string;
	otherPartyUsername?: string;
	reference?: { referenceType: string; referenceId: string };
	messageText: string;
	emailCopyToSender?: boolean;
}

export interface SendMessageResult {
	id: string;
	conversationId: string | undefined;
	senderUsername: string | undefined;
	recipientUsername: string | undefined;
	subject: string | undefined;
	body: string;
	createdAt: string;
}

interface UpstreamSendResponse extends UpstreamMessageDetail {
	conversationId?: string;
}

export async function sendMessage(args: SendMessageArgs): Promise<SendMessageResult> {
	const body: Record<string, unknown> = { messageText: args.messageText };
	if (args.conversationId) body.conversationId = args.conversationId;
	if (args.otherPartyUsername) body.otherPartyUsername = args.otherPartyUsername;
	if (args.reference) {
		body.reference = {
			referenceType: args.reference.referenceType.toUpperCase(),
			referenceId: args.reference.referenceId,
		};
	}
	if (args.emailCopyToSender != null) body.emailCopyToSender = args.emailCopyToSender;
	const res = await sellRequest<UpstreamSendResponse>({
		apiKeyId: args.apiKeyId,
		method: "POST",
		path: "/commerce/message/v1/send_message",
		body,
		marketplace: "EBAY_US",
	});
	return {
		id: res.messageId ?? "",
		conversationId: res.conversationId,
		senderUsername: res.senderUsername ?? res.senderUserName,
		recipientUsername: res.recipientUsername ?? res.recipientUserName,
		subject: res.subject,
		body: res.messageBody ?? args.messageText,
		createdAt: res.createdDate ?? "",
	};
}
