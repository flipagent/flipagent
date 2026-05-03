#!/usr/bin/env node
/**
 * flipagent-mcp — MCP server exposing flipagent's `/v1/*` surface as MCP tools.
 *
 * Speaks the Model Context Protocol over stdio. Hooks into Claude Code
 * via the standard MCP config; works with any MCP-compatible host.
 * All tools wrap flipagent's marketplace-agnostic `/v1/*` surface — point
 * `FLIPAGENT_BASE_URL` at a non-default host for self-host / staging.
 *
 * Tool naming: `flipagent_<verb>_<resource>` (verb-leading, snake_case).
 * Marketplace stays a parameter, never part of the tool name.
 *
 * Toolsets: tools group by domain so hosts can load just the slice the
 * user needs. The default slice fits well under common host tool caps;
 * opt in to others via `FLIPAGENT_MCP_TOOLSETS`. See `tools/index.ts`.
 *
 * Errors: every flipagent route returns a `next_action` block when the
 * caller can fix the failure (OAuth not done, extension not paired,
 * server-side env not configured). We render that verbatim into the
 * MCP error content so the LLM can quote it back to its user.
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { loadConfig } from "./config.js";
import { selectTools } from "./tools/index.js";

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
 * value. Tool wrappers historically returned `{ error, status, message,
 * url, hint? }` — when the underlying api response includes
 * `next_action`, we want that to flow through to the MCP `isError`
 * channel verbatim.
 */
function asApiError(result: unknown): ApiErrorShape | null {
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

function formatError(toolName: string, err: ApiErrorShape): string {
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

async function main() {
	const config = loadConfig();
	const tools = selectTools(config.enabledToolsets);
	const server = new Server({ name: "flipagent-mcp", version: "0.0.1" }, { capabilities: { tools: {} } });

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
			const result = await tool.execute(config, req.params.arguments ?? {});
			// Tool wrappers return `{ error, ... }` envelopes for upstream
			// failures. Flag them to the MCP host as `isError: true` and
			// surface any `next_action` from the api so the LLM can guide
			// the user toward OAuth / extension install / config without
			// guessing.
			const apiErr = asApiError(result);
			if (apiErr) {
				return {
					content: [{ type: "text", text: formatError(tool.name, apiErr) }],
					isError: true,
				};
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

	const transport = new StdioServerTransport();
	await server.connect(transport);
	const toolsetSummary = config.enabledToolsets.includes("*" as never) ? "*" : config.enabledToolsets.join(",");
	process.stderr.write(
		`[flipagent-mcp] connected. base=${config.flipagentBaseUrl} mock=${config.mock} auth=${config.authToken ? "set" : "unset"} toolsets=${toolsetSummary} (${tools.length} tools)\n`,
	);
}

main().catch((err) => {
	process.stderr.write(`[flipagent-mcp] fatal: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`);
	process.exit(1);
});
