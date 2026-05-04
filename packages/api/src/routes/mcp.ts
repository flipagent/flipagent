/**
 * `/mcp` — flipagent's tool catalog over MCP, served via the streamable
 * HTTP transport. Mounted at the root (NOT under `/v1/`) so the path
 * matches the Model Context Protocol spec.
 *
 * The same tool catalog ships in `flipagent-mcp` for stdio (Claude Desktop
 * / Cursor / Cline) — this route is the HTTP edge for OpenAI's Responses
 * API native MCP integration and any other web-standard MCP client.
 *
 * Auth: each request carries `Authorization: Bearer <flipagent api key>`.
 * We validate against `api_keys` (sha256 lookup, same surface every other
 * /v1/* route uses), then build a per-request MCP config keyed to the
 * caller's api key. The MCP tool wrappers turn around and call our own
 * /v1/* surface via the SDK with that token — same auth path the agent
 * surface uses, just routed through OpenAI's MCP infra.
 */

import { handleMcpRequest } from "flipagent-mcp/http";
import { Hono } from "hono";
import { findActiveKey } from "../auth/keys.js";
import { config } from "../config.js";

export const mcpRoute = new Hono();

/**
 * Internal MCP base URL — what the tool wrappers use to reach our own
 * /v1/* surface. Stays inside localhost so we don't bounce a packet
 * through the cloudflared tunnel for self-loop traffic.
 */
function internalApiBaseUrl(): string {
	return `http://127.0.0.1:${config.PORT}`;
}

mcpRoute.all("/*", async (c) => {
	const auth = c.req.header("authorization") ?? c.req.header("Authorization");
	const xKey = c.req.header("x-api-key") ?? c.req.header("X-API-Key");
	const token = auth?.startsWith("Bearer ") ? auth.slice(7).trim() : (xKey?.trim() ?? null);
	if (!token) {
		return c.json({ error: "auth_missing", message: "Bearer token required for /mcp" }, 401);
	}
	// Validate the token before paying the MCP server-instantiation cost.
	const key = await findActiveKey(token);
	if (!key) {
		return c.json({ error: "auth_invalid", message: "API key not recognized or revoked." }, 401);
	}
	return handleMcpRequest(c.req.raw, {
		config: {
			flipagentBaseUrl: internalApiBaseUrl(),
			authToken: token,
			mock: false,
			userAgent: "flipagent-mcp-http/0.0.1",
			// Expose every tool over HTTP — the agent caller filters via
			// `allowed_tools` in the OpenAI Responses API call.
			enabledToolsets: ["*"],
		},
	});
});
