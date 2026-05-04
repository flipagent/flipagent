/**
 * Iframe-mounted MCP-Apps surface for `flipagent_list_listings`. The
 * panel is shared with the chat surface — see `EmbedShell` for the
 * postMessage transport.
 */

import { ListingsPanel, type ListingsPanelProps } from "../playground/MessageUiPanel";
import { EmbedShell } from "./EmbedShell";

export function EmbedListings() {
	return <EmbedShell<ListingsPanelProps> kind="listings" Panel={ListingsPanel} />;
}
