#!/usr/bin/env node
/**
 * flipagent-mcp — MCP server exposing eBay's REST surface as MCP tools.
 *
 * Speaks the Model Context Protocol over stdio. Drop into Claude Desktop,
 * Cursor, Cline, Zed, Continue, Windsurf, etc. via the standard MCP config
 * (see README). All tools mirror eBay path/method/body verbatim through
 * flipagent's unified `/v1/*` surface — point `FLIPAGENT_BASE_URL` at a
 * non-default host for self-host / staging.
 *
 * Tools split into three groups:
 *   - **Read** (anonymous app token): ebay_search, ebay_item_detail,
 *     ebay_sold_search, ebay_taxonomy_default_id, ebay_taxonomy_suggest,
 *     ebay_taxonomy_aspects.
 *   - **Sell** (user OAuth, requires /v1/connect/ebay binding):
 *     ebay_create_inventory_item, ebay_create_offer, ebay_publish_offer,
 *     ebay_list_orders, ebay_mark_shipped, ebay_list_payouts.
 *   - **Mgmt**: flipagent_connect_status — check if the api key is bound.
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
