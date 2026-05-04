/**
 * HTTP transport for flipagent-mcp.
 *
 * Wires the same tool catalog as the stdio binary into MCP's
 * `WebStandardStreamableHTTPServerTransport`. Stateless mode — each
 * request gets a fresh server + transport, so per-request auth
 * (`Authorization: Bearer fa_xxx`) flows cleanly into the per-request
 * `Config.authToken`.
 *
 * Mounts cleanly on Hono via `c.req.raw → handleMcpRequest(req, opts)`
 * → `Response`.
 */

import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import type { Config } from "./config.js";
import { createFlipagentMcpServer } from "./server-factory.js";
import type { Toolset } from "./tools/index.js";

export interface HandleMcpRequestOptions {
	config: Config;
	toolsets?: readonly Toolset[] | readonly ["*"];
	/** Server identity reported on `initialize`. */
	name?: string;
	version?: string;
}

/**
 * One-shot handler: builds a fresh MCP server + transport, lets the
 * transport process the incoming Request, returns the Response. Caller
 * (Hono route, Cloudflare Worker, Bun handler, …) just forwards.
 *
 * Stateless on purpose: OpenAI's Responses API native MCP integration
 * issues independent requests, and our per-request auth lives in the
 * `Authorization` header anyway. No need for sticky sessions.
 */
export async function handleMcpRequest(req: Request, opts: HandleMcpRequestOptions): Promise<Response> {
	const { server } = createFlipagentMcpServer({
		config: opts.config,
		...(opts.toolsets ? { toolsets: opts.toolsets } : {}),
		...(opts.name ? { name: opts.name } : {}),
		...(opts.version ? { version: opts.version } : {}),
	});
	const transport = new WebStandardStreamableHTTPServerTransport({
		// Stateless mode — caller is OpenAI's MCP integration; auth per-request via header.
		sessionIdGenerator: undefined,
		// JSON responses keep the wire simple for non-SSE callers; the
		// transport still upgrades to SSE when the client asks for it.
		enableJsonResponse: true,
	});
	await server.connect(transport);
	try {
		return await transport.handleRequest(req);
	} finally {
		// Close detaches the in-memory state; safe in stateless mode.
		await transport.close().catch(() => {
			/* swallow — transport already finished */
		});
		await server.close().catch(() => {
			/* swallow — server already finished */
		});
	}
}
