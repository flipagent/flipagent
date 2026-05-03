/**
 * Environment-driven config for the MCP server.
 *
 * Every tool routes through flipagent's unified `/v1/*` surface (eBay
 * base URL — sandbox vs prod — is decided server-side by the API
 * instance). The MCP only needs to know which flipagent backend to talk
 * to, which API key to send, and which toolsets to expose.
 */

import { ALL_TOOLSETS, DEFAULT_TOOLSETS, type Toolset } from "./tools/index.js";

const DEFAULT_BASE_URL = "https://api.flipagent.dev";

export interface Config {
	flipagentBaseUrl: string;
	authToken: string | undefined;
	mock: boolean;
	userAgent: string;
	/**
	 * Toolsets to expose. `["*"]` = every registered tool. Defaults to
	 * `DEFAULT_TOOLSETS` so a fresh install stays under common host tool
	 * caps and within selection-accuracy guidance. Override via
	 * `FLIPAGENT_MCP_TOOLSETS=core,comms,…` or `*` for everything.
	 */
	enabledToolsets: readonly Toolset[] | readonly ["*"];
}

export function loadConfig(): Config {
	const flipagentBaseUrl = process.env.FLIPAGENT_BASE_URL?.replace(/\/+$/, "") || DEFAULT_BASE_URL;
	const authToken = process.env.FLIPAGENT_API_KEY;
	const mock = process.env.FLIPAGENT_MCP_MOCK === "1";
	return {
		flipagentBaseUrl,
		authToken,
		mock,
		userAgent: `flipagent-mcp/${process.env.npm_package_version ?? "0.0.0"}`,
		enabledToolsets: parseToolsets(process.env.FLIPAGENT_MCP_TOOLSETS),
	};
}

function parseToolsets(raw: string | undefined): readonly Toolset[] | readonly ["*"] {
	if (!raw) return DEFAULT_TOOLSETS;
	const parts = raw
		.split(",")
		.map((s) => s.trim())
		.filter(Boolean);
	if (parts.length === 0) return DEFAULT_TOOLSETS;
	if (parts.includes("*")) return ["*"] as const;

	const valid = new Set<string>(ALL_TOOLSETS as readonly string[]);
	const enabled: Toolset[] = [];
	const unknown: string[] = [];
	for (const p of parts) {
		if (valid.has(p)) enabled.push(p as Toolset);
		else unknown.push(p);
	}
	if (unknown.length) {
		process.stderr.write(
			`[flipagent-mcp] unknown toolsets ignored: ${unknown.join(", ")}. Valid: ${ALL_TOOLSETS.join(", ")}, or "*".\n`,
		);
	}
	return enabled.length ? enabled : DEFAULT_TOOLSETS;
}
