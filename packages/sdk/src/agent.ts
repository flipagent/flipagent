/**
 * `client.agent.*` — chat with the flipagent reseller agent (preview).
 *
 * Stateful threads ride on OpenAI's Responses API server-side; flipagent
 * persists only the most recent `response.id` per session, so the SDK
 * caller's job is to thread `sessionId` through follow-up turns.
 */

import type {
	AgentChatRequest,
	AgentChatResponse,
	AgentRule,
	AgentRuleCreate,
	AgentRuleListResponse,
	AgentRunListQuery,
	AgentRunListResponse,
	AgentSessionListResponse,
} from "@flipagent/types";
import type { FlipagentHttp } from "./http.js";

export interface AgentClient {
	chat(body: AgentChatRequest): Promise<AgentChatResponse>;
	listSessions(): Promise<AgentSessionListResponse>;
	listRules(): Promise<AgentRuleListResponse>;
	createRule(body: AgentRuleCreate): Promise<AgentRule>;
	deleteRule(id: string): Promise<{ ok: true }>;
	listRuns(params?: AgentRunListQuery): Promise<AgentRunListResponse>;
}

export function createAgentClient(http: FlipagentHttp): AgentClient {
	return {
		chat: (body) => http.post("/v1/agent/chat", body),
		listSessions: () => http.get("/v1/agent/sessions"),
		listRules: () => http.get("/v1/agent/rules"),
		createRule: (body) => http.post("/v1/agent/rules", body),
		deleteRule: (id) => http.delete(`/v1/agent/rules/${encodeURIComponent(id)}`),
		listRuns: (params) =>
			http.get("/v1/agent/runs", params as Record<string, string | number | undefined> | undefined),
	};
}
