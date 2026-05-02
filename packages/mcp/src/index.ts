#!/usr/bin/env node
/**
 * flipagent-mcp — MCP server exposing flipagent's `/v1/*` surface as MCP tools.
 *
 * Speaks the Model Context Protocol over stdio. Drop into Claude Desktop,
 * Cursor, Cline, Zed, Continue, Windsurf, etc. via the standard MCP config
 * (see README). All tools wrap flipagent's marketplace-agnostic `/v1/*`
 * surface — point `FLIPAGENT_BASE_URL` at a non-default host for self-host
 * / staging.
 *
 * Tool naming: `flipagent_<resource>_<verb>`, mirroring `/v1/<resource>/<verb>`.
 * Marketplace stays a parameter, never part of the tool name. Groups:
 *   - **Read** (anonymous app token): flipagent_items_search,
 *     flipagent_items_get, flipagent_items_search_sold,
 *     flipagent_categories_list / _suggest / _aspects.
 *   - **Sell** (user OAuth, requires /v1/connect/ebay binding):
 *     flipagent_listings_create / _update / _relist,
 *     flipagent_sales_list / _ship, flipagent_payouts_list.
 *   - **Mgmt**: flipagent_capabilities (preferred) / flipagent_connect_ebay_status.
 *   - **Decisions**: flipagent_evaluate.
 *   - **Operations**: flipagent_ship_quote / _providers, flipagent_expenses_*,
 *     flipagent_forwarder_*, flipagent_purchases_*, flipagent_browser_query.
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { loadConfig } from "./config.js";
import { tools } from "./tools/index.js";

async function main() {
	const config = loadConfig();
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
	process.stderr.write(
		`[flipagent-mcp] connected. base=${config.flipagentBaseUrl} mock=${config.mock} auth=${config.authToken ? "set" : "unset"}\n`,
	);
}

main().catch((err) => {
	process.stderr.write(`[flipagent-mcp] fatal: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`);
	process.exit(1);
});
