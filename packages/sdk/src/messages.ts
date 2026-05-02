/**
 * `client.messages.*` — buyer ↔ seller messages, normalized.
 * Wraps Trading API XML internally; caller sees the flipagent `Message` shape.
 */

import type { MessageCreate, MessagesListQuery, MessagesListResponse } from "@flipagent/types";
import type { FlipagentHttp } from "./http.js";

export interface MessagesClient {
	list(params?: MessagesListQuery): Promise<MessagesListResponse>;
	send(body: MessageCreate): Promise<{ ack: string }>;
}

export function createMessagesClient(http: FlipagentHttp): MessagesClient {
	return {
		list: (params) => http.get("/v1/messages", params as Record<string, string | number | undefined> | undefined),
		send: (body) => http.post("/v1/messages", body),
	};
}
