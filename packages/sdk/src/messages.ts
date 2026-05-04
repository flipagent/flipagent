/**
 * `client.messages.*` — eBay messaging in conversation-threaded form,
 * backed by REST `commerce/message/v1`.
 *
 *   list()                       → conversation summaries
 *   thread(id, type)             → messages in one thread
 *   send({conversationId, ...})  → reply into thread or open new
 */

import type {
	ConversationsBulkUpdateRequest,
	ConversationsListQuery,
	ConversationsListResponse,
	ConversationThreadQuery,
	ConversationThreadResponse,
	ConversationUpdateRequest,
	ConversationUpdateResponse,
	MessageSendRequest,
	MessageSendResponse,
} from "@flipagent/types";
import type { FlipagentHttp } from "./http.js";

export interface MessagesClient {
	list(params?: ConversationsListQuery): Promise<ConversationsListResponse>;
	thread(conversationId: string, query: ConversationThreadQuery): Promise<ConversationThreadResponse>;
	send(body: MessageSendRequest): Promise<MessageSendResponse>;
	updateConversation(id: string, body: ConversationUpdateRequest): Promise<ConversationUpdateResponse>;
	bulkUpdateConversations(body: ConversationsBulkUpdateRequest): Promise<ConversationUpdateResponse>;
}

export function createMessagesClient(http: FlipagentHttp): MessagesClient {
	return {
		list: (params) => http.get("/v1/messages", params as Record<string, string | number | undefined> | undefined),
		thread: (conversationId, query) =>
			http.get(
				`/v1/messages/${encodeURIComponent(conversationId)}`,
				query as unknown as Record<string, string | number | undefined>,
			),
		send: (body) => http.post("/v1/messages", body),
		updateConversation: (id, body) => http.patch(`/v1/messages/conversations/${encodeURIComponent(id)}`, body),
		bulkUpdateConversations: (body) => http.patch("/v1/messages/conversations/bulk", body),
	};
}
