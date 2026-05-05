/**
 * Shared MCP server factory — same wiring for stdio (Claude Code and
 * other MCP hosts) and HTTP (OpenAI Responses API native MCP integration).
 *
 * Both transports build the same `Server` with the same tool catalog;
 * only the transport class differs.
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import type { Config } from "./config.js";
import { selectTools, type Tool, type Toolset } from "./tools/index.js";

interface NextActionShape {
	kind?: string;
	url?: string;
	instructions?: string;
}

interface ApiErrorShape {
	error?: string;
	message?: string;
	next_action?: NextActionShape;
	hint?: string;
}

/**
 * Best-effort detection of an api error envelope inside a tool's return
 * value. Tool wrappers return `{ error, status, message, url, hint? }`
 * for upstream failures; we surface that on the MCP error channel
 * verbatim so the LLM can quote `next_action` back to the user.
 */
export function asApiError(result: unknown): ApiErrorShape | null {
	if (!result || typeof result !== "object") return null;
	const r = result as Record<string, unknown>;
	if (typeof r.error !== "string") return null;
	const out: ApiErrorShape = { error: r.error };
	if (typeof r.message === "string") out.message = r.message;
	if (typeof r.hint === "string") out.hint = r.hint;
	if (r.next_action && typeof r.next_action === "object") {
		const na = r.next_action as Record<string, unknown>;
		out.next_action = {
			kind: typeof na.kind === "string" ? na.kind : undefined,
			url: typeof na.url === "string" ? na.url : undefined,
			instructions: typeof na.instructions === "string" ? na.instructions : undefined,
		};
	}
	return out;
}

export function formatError(toolName: string, err: ApiErrorShape): string {
	const parts: string[] = [];
	parts.push(`${toolName} failed: ${err.error}${err.message ? ` — ${err.message}` : ""}`);
	if (err.next_action?.instructions) {
		parts.push("");
		parts.push(`Next action: ${err.next_action.instructions}`);
		if (err.next_action.url) parts.push(`Link: ${err.next_action.url}`);
	}
	if (err.hint) {
		parts.push("");
		parts.push(`Hint: ${err.hint}`);
	}
	return parts.join("\n");
}

export interface CreateServerOptions {
	config: Config;
	toolsets?: readonly Toolset[] | readonly ["*"];
	/** Pre-resolved tool list (overrides `toolsets`). Useful for tests. */
	tools?: Tool[];
	/** Server identity reported on `initialize`. */
	name?: string;
	version?: string;
}

/**
 * Build an MCP `Server` instance with the flipagent tool catalog wired
 * into ListTools / CallTool handlers. Caller decides which transport
 * to attach (stdio for the binary, streamable HTTP for the api mount).
 */
export function createFlipagentMcpServer(opts: CreateServerOptions): { server: Server; tools: Tool[] } {
	const tools = opts.tools ?? selectTools(opts.toolsets ?? opts.config.enabledToolsets);
	const server = new Server(
		{ name: opts.name ?? "flipagent-mcp", version: opts.version ?? "0.0.1" },
		{ capabilities: { tools: {} } },
	);

	server.setRequestHandler(ListToolsRequestSchema, async () => ({
		tools: tools.map((t) => ({
			name: t.name,
			description: t.description,
			inputSchema: t.inputSchema as unknown as { type: "object"; properties?: Record<string, unknown> },
		})),
	}));

	server.setRequestHandler(CallToolRequestSchema, async (req) => {
		const tool = tools.find((t) => t.name === req.params.name);
		if (!tool) {
			return {
				content: [{ type: "text", text: `Unknown tool: ${req.params.name}` }],
				isError: true,
			};
		}
		try {
			const result = await tool.execute(opts.config, req.params.arguments ?? {});
			const apiErr = asApiError(result);
			if (apiErr) {
				// Errors with `next_action` get a UI hint so MCP-Apps hosts
				// can render an actionable panel (Connect eBay, Install
				// extension, …) instead of asking the user to read raw
				// instructions out of the tool reply. Hosts that don't
				// render UI fall through to the same text content.
				if (apiErr.next_action?.kind) {
					return {
						content: [{ type: "text", text: formatError(tool.name, apiErr) }],
						structuredContent: { error: apiErr.error, message: apiErr.message, next_action: apiErr.next_action },
						_meta: { "ui.resourceUri": "ui://flipagent/next-action" },
						isError: true,
					};
				}
				return {
					content: [{ type: "text", text: formatError(tool.name, apiErr) }],
					isError: true,
				};
			}
			// Pass-through when the tool already produced the MCP CallTool
			// shape (e.g., a UI-rendering tool returning `uiResource(...)`):
			// it carries `content` + optional `structuredContent` + `_meta`
			// for inline-UI rendering on hosts that support MCP Apps.
			if (result && typeof result === "object" && Array.isArray((result as Record<string, unknown>).content)) {
				return result as { content: unknown[] };
			}
			return {
				content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
			};
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			return {
				content: [{ type: "text", text: `tool ${tool.name} threw: ${message}` }],
				isError: true,
			};
		}
	});

	return { server, tools };
}

// `uiResource` lives in `./ui-resource.js` to avoid a circular import
// (tool modules import `uiResource`, this factory imports the registry,
// the registry imports the tool modules). Re-exported here for any
// caller that already imports it from server-factory.
export { type UiResourceOptions, uiResource } from "./ui-resource.js";
