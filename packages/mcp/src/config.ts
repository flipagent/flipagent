/**
 * Environment-driven config. Two layers:
 *
 * 1. eBay-compatible base URL — where Browse + Marketplace Insights calls go.
 *    Defaults to api.flipagent.dev (our hosted service); set to api.ebay.com
 *    when the user has their own OAuth and wants to talk to eBay directly.
 *
 * 2. Auth token — sent as `Authorization: Bearer ${token}` to whatever the
 *    base URL points at. Either a flipagent API key (when base URL is ours)
 *    or an eBay OAuth access token (when base URL is api.ebay.com).
 */

const DEFAULT_BASE_URL = "https://api.flipagent.dev";

export interface Config {
	ebayBaseUrl: string;
	flipagentBaseUrl: string;
	authToken: string | undefined;
	mock: boolean;
	userAgent: string;
}

export function loadConfig(): Config {
	const ebayBaseUrl = process.env.EBAY_BASE_URL?.replace(/\/+$/, "") || DEFAULT_BASE_URL;
	const flipagentBaseUrl = process.env.FLIPAGENT_BASE_URL?.replace(/\/+$/, "") || DEFAULT_BASE_URL;
	const authToken = process.env.FLIPAGENT_API_KEY || process.env.EBAY_TOKEN;
	const mock = process.env.FLIPAGENT_MCP_MOCK === "1";
	return {
		ebayBaseUrl,
		flipagentBaseUrl,
		authToken,
		mock,
		userAgent: `flipagent-mcp/${process.env.npm_package_version ?? "0.0.0"}`,
	};
}
