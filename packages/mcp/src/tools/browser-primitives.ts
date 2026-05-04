/**
 * `flipagent_browser_query` — generic DOM querySelectorAll on the user's active
 * tab via the bridge protocol. Sync, returns inline.
 *
 * Use cases:
 *   1. Fallback when high-level scrapers (eBay buy, PE inbox) fail —
 *      LLM directly inspects DOM and adapts.
 *   2. Interactive selector tuning during dev — query a page live
 *      without shipping new content-script code per iteration.
 *
 * Caller must have:
 *   - flipagent extension installed + paired
 *   - the target page open + active in their Chrome
 *
 * Response includes `url`, `title`, `matchCount`, and up to `limit`
 * matches with `tag`, `id`, `classes`, `text`, `html`. Each text/html
 * is truncated to `truncateAt` chars.
 */

import { BrowserQueryRequest } from "@flipagent/types";
import { getClient, toolErrorEnvelope } from "../client.js";
import type { Config } from "../config.js";

export const browserQueryInput = BrowserQueryRequest;

export const browserQueryDescription =
	"Run document.querySelectorAll on the user's active Chrome tab and return matched elements (tag, id, classes, text, outerHTML — truncated). Synchronous (returns inline; no separate poll). Calls POST /v1/browser/query, which routes through the flipagent extension's content script. Use this when high-level scrapers fail or when you need to inspect a page's DOM live (e.g. tuning selectors). Args: { selector, limit?, includeHtml?, includeText?, truncateAt?, tabUrlPattern? }. Returns 504 if the extension didn't respond within 25 s — usually means the user isn't on the target page or the extension isn't paired.";

export async function browserQueryExecute(config: Config, args: Record<string, unknown>): Promise<unknown> {
	try {
		const client = getClient(config);
		return await client.browser.query(args as unknown as Parameters<typeof client.browser.query>[0]);
	} catch (err) {
		return toolErrorEnvelope(
			err,
			"query_browser_failed",
			"/v1/browser/query",
			"If 504, make sure the target page is open and active in the Chrome profile your flipagent extension is paired with.",
		);
	}
}
