/**
 * Iframe-mounted MCP-Apps surface for tool errors carrying `next_action`.
 * The MCP server attaches `_meta["ui.resourceUri"] = "ui://flipagent/
 * next-action"` to those errors so external hosts can render the same
 * onboarding card our chat surface does.
 */

import { NextActionPanel, type NextActionPanelProps } from "../playground/MessageUiPanel";
import { EmbedShell } from "./EmbedShell";

export function EmbedNextAction() {
	return <EmbedShell<NextActionPanelProps> kind="next-action" Panel={NextActionPanel} />;
}
