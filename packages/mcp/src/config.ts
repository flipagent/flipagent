/**
 * Environment-driven config for the MCP server.
 *
 * Every tool routes through flipagent's unified `/v1/*` surface (eBay
 * base URL — sandbox vs prod — is decided server-side by the API
 * instance). The MCP only needs to know which flipagent backend to talk
 * to and which API key to send.
 */

const DEFAULT_BASE_URL = "https://api.flipagent.dev";

export interface Config {
	flipagentBaseUrl: string;
	authToken: string | undefined;
	mock: boolean;
	userAgent: string;
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
	};
}
