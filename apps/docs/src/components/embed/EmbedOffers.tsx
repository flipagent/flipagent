/**
 * Iframe-mounted MCP-Apps surface for `flipagent_list_offers`. Same
 * `<OffersPanel>` the chat surface mounts — see `EmbedShell` for the
 * postMessage protocol it shares with every other `/embed/*` page.
 */

import { OffersPanel, type OffersPanelProps } from "../playground/MessageUiPanel";
import { EmbedShell } from "./EmbedShell";

export function EmbedOffers() {
	return <EmbedShell<OffersPanelProps> kind="offers" Panel={OffersPanel} />;
}
