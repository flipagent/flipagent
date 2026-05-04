/**
 * Iframe-mounted MCP-Apps surface for `flipagent_get_evaluate_job` /
 * `flipagent_evaluate_item`. Same `<EvaluatePanel>` the chat surface
 * mounts — including the variation-picker and rate-limited retry
 * recovery surfaces; the panel switches on `errorCode` itself, so the
 * iframe is just transport.
 */

import { EvaluatePanel, type EvaluatePanelProps } from "../playground/MessageUiPanel";
import { EmbedShell } from "./EmbedShell";

export function EmbedEvaluateResult() {
	return <EmbedShell<EvaluatePanelProps> kind="evaluate" Panel={EvaluatePanel} />;
}
