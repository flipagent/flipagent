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
 *
 * For an HTTP-mounted variant of the same tool catalog (e.g. behind
 * OpenAI's Responses API native MCP integration), see `./http.ts`.
 */

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfig } from "./config.js";
import { createFlipagentMcpServer } from "./server-factory.js";

async function main() {
	const config = loadConfig();
	const { server, tools } = createFlipagentMcpServer({ config });

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
