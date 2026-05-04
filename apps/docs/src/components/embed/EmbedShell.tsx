/**
 * Generic iframe shell for `/embed/<kind>` MCP-Apps surfaces.
 *
 * The MCP-Apps protocol (host iframe ↔ guest page) is the same for every
 * panel we render: announce `embed-ready`, receive `embed-init` with the
 * tool's `structuredContent`, observe size for the host's auto-resize,
 * and forward any inline-action button clicks via postMessage. None of
 * that is panel-specific — pulling it into one shell means a new panel
 * is just `<EmbedShell kind="x" Panel={XPanel} />` and a sibling Astro
 * page that mounts it.
 */

import { useEffect, useRef, useState } from "react";
import type { EmbedAction } from "../playground/MessageUiPanel";
import "./Embed.css";

function postToHost(msg: Record<string, unknown>) {
	window.parent.postMessage({ ...msg, source: "flipagent-embed" }, "*");
}

function reportSize() {
	const h = Math.max(document.documentElement.scrollHeight, document.body?.scrollHeight ?? 0);
	postToHost({ type: "embed-resize", height: h });
}

interface PanelComponent<P> {
	(props: { props: P; onAction?: (a: EmbedAction) => void }): React.ReactElement | null;
}

export function EmbedShell<P>({
	kind,
	Panel,
}: {
	/** URI suffix — `"search-results"`, `"evaluate"`, `"offers"`, … —
	 *  matches `ui://flipagent/<kind>` on the tool side and the Astro page
	 *  filename `pages/embed/<kind>.astro`. The host uses this to register
	 *  the iframe → resourceUri mapping. */
	kind: string;
	/** Inline panel component shared with the chat surface. Receives
	 *  whatever shape the MCP tool put in `structuredContent` (post-decoded
	 *  by the host) plus an `onAction` sink that the shell wires up to
	 *  postMessage so button clicks reach the parent agent. */
	Panel: PanelComponent<P>;
}) {
	const [data, setData] = useState<P | null>(null);
	const rootRef = useRef<HTMLDivElement | null>(null);

	useEffect(() => {
		function onMessage(e: MessageEvent) {
			const m = e.data as { type?: string; data?: P } | null;
			if (!m || typeof m !== "object") return;
			if (m.type === "embed-init" && m.data) setData(m.data);
		}
		window.addEventListener("message", onMessage);
		postToHost({ type: "embed-ready", kind });
		return () => window.removeEventListener("message", onMessage);
	}, [kind]);

	useEffect(() => {
		const el = rootRef.current;
		if (!el) return;
		const obs = new ResizeObserver(() => reportSize());
		obs.observe(el);
		reportSize();
		return () => obs.disconnect();
	}, []);

	const onAction = (a: EmbedAction) => postToHost(a);

	return (
		<div ref={rootRef}>
			<Panel props={data ?? ({} as P)} onAction={onAction} />
		</div>
	);
}
