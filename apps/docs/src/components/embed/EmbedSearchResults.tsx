/**
 * Iframe-mounted MCP-Apps surface for `flipagent_search_items`.
 * Single source of truth lives in the playground module: this thin
 * wrapper picks the right panel + URI kind, the shell handles every
 * iframe transport detail (handshake / resize / action forwarding).
 */

import { SearchResultsPanel, type SearchPanelProps } from "../playground/MessageUiPanel";
import { EmbedShell } from "./EmbedShell";

export function EmbedSearchResults() {
	return <EmbedShell<SearchPanelProps> kind="search-results" Panel={SearchResultsPanel} />;
}
