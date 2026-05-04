/**
 * Shared helper for tools that render an inline UI panel.
 *
 * Lives in its own file (not server-factory.ts) so tools can import
 * `uiResource` without pulling server-factory's dependency on the
 * tool registry — which would create a circular import:
 *   tools/sets/* → tools/<x>.ts → server-factory.ts → tools/index.ts → tools/sets/*
 *
 * Returns a content + structuredContent + _meta envelope that:
 *   - MCP Apps hosts read via `_meta["ui.resourceUri"]` to mount the
 *     embed iframe registered against that URI.
 *   - ChatGPT-style hosts read via `_meta["openai/outputTemplate"]`
 *     so the same server runs as a ChatGPT App with no extra wiring.
 */

export interface UiResourceOptions {
	uri: string;
	structuredContent: Record<string, unknown>;
	summary: string;
	mimeType?: string;
	openaiOutputTemplate?: string;
}

export function uiResource(opts: UiResourceOptions): {
	content: Array<{ type: "text"; text: string }>;
	structuredContent: Record<string, unknown>;
	_meta: Record<string, string>;
} {
	const meta: Record<string, string> = {
		"ui.resourceUri": opts.uri,
	};
	if (opts.mimeType) meta["ui.mimeType"] = opts.mimeType;
	if (opts.openaiOutputTemplate) meta["openai/outputTemplate"] = opts.openaiOutputTemplate;
	return {
		content: [{ type: "text", text: opts.summary }],
		structuredContent: opts.structuredContent,
		_meta: meta,
	};
}
