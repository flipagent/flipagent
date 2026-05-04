/**
 * Agent (preview) — chat with a flipagent-aware agent.
 *
 * Stateful threads ride on OpenAI's Responses API: each turn passes
 * `previous_response_id` so OpenAI keeps history server-side. Rules
 * persist across turns via the system instructions. Attachments
 * (images, PDFs, text) ride inline as data URLs and reach the model
 * as `input_image` / `input_file` content blocks.
 *
 * Layout matches Evaluate's narrow card. Past threads live in a
 * popover (closed by default) anchored on the "Threads" button.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { apiBase, apiFetch } from "../../lib/authClient";
import type { ComposeTab } from "../compose/ComposeCard";
import { MarkdownLite } from "./MarkdownLite";
import "./PlaygroundAgent.css";

/** Mirrors `/v1/me/ebay/status`. eBay account access has two paths —
 * server-side OAuth (REST) and the Chrome extension bridge — that flow
 * to the same eBay account but unlock different operations. The hero
 * chip surfaces both so users see exactly what the agent can reach. */
interface ConnStatus {
	oauth: { connected: boolean; ebayUserName: string | null };
	bridge: { paired: boolean; ebayLoggedIn: boolean; ebayUserName: string | null };
}

interface AgentSession {
	id: string;
	title?: string;
	createdAt: string;
	lastActiveAt: string;
}

interface UiHint {
	resourceUri: string;
	props?: Record<string, unknown>;
	mimeType?: string;
}

interface AgentRun {
	id: string;
	sessionId?: string;
	triggerKind: "chat" | "cron" | "webhook";
	model?: string;
	userMessage?: string;
	reply?: string;
	tokensIn: number;
	tokensOut: number;
	costCents: number;
	errorMessage?: string;
	ui?: UiHint;
	startedAt: string;
	finishedAt?: string;
}

interface ActionSubject {
	/** Optional thumbnail for the subject (item image, payout proof, etc.). */
	image?: string;
	/** Primary line — typically the item title. */
	title?: string;
	/** Secondary line — price, condition, status, anything compact. */
	subtitle?: string;
	/** When set, the inner card is clickable and opens the URL in a new tab. */
	url?: string;
}

interface ChatMessage {
	role: "user" | "assistant" | "error";
	content: string;
	attachments?: Attachment[];
	ui?: UiHint;
	/** When the turn was synthesized from an inline UI button (not typed
	 *  input), `subject` carries the preview the user clicked on so we
	 *  render a compact action card instead of a plain text bubble. */
	subject?: ActionSubject;
	/** True when the turn was triggered by an inline UI action (button
	 *  click) rather than typed input. Used for a small action-icon
	 *  prefix on bubbles that don't carry a `subject` card. */
	fromUi?: boolean;
	/** Marked true while the message is mid-stream. We render plain text
	 *  during streaming so each token append doesn't tear down the
	 *  markdown DOM (which would clear any active text selection). On
	 *  `done` we flip it off and re-render through MarkdownLite. */
	streaming?: boolean;
	/** Live status label shown with a shimmering gradient while a tool
	 *  call is in flight ("Searching listings…", "Evaluating…"). Cleared
	 *  on `tool_call_end` for a non-renderable tool, or on `text_delta`
	 *  / `done`. */
	toolStatus?: string;
	at: number;
}

/**
 * Friendly user-facing label for an in-flight tool. Falls back to a
 * de-snake-cased version of the tool name. Matches the read-only tool
 * surface; rare names just show the bare tool name.
 */
function toolStatusLabel(name: string): string {
	switch (name) {
		case "flipagent_search_items":
			return "Searching listings";
		case "flipagent_search_sold_items":
			return "Searching sold comps";
		case "flipagent_evaluate_item":
		case "flipagent_get_evaluate_job":
			return "Evaluating";
		case "flipagent_get_evaluation_pool":
			return "Loading comps";
		case "flipagent_get_item":
			return "Loading item";
		case "flipagent_list_sales":
			return "Loading sales";
		case "flipagent_list_payouts":
			return "Loading payouts";
		case "flipagent_list_transactions":
			return "Loading transactions";
		case "flipagent_list_locations":
			return "Loading locations";
		case "flipagent_list_policies":
		case "flipagent_list_policies_by_type":
			return "Loading policies";
		case "flipagent_list_categories":
		case "flipagent_suggest_category":
		case "flipagent_list_category_aspects":
			return "Loading categories";
		case "flipagent_get_capabilities":
			return "Checking setup";
		case "flipagent_get_my_key":
			return "Checking account";
		case "flipagent_get_ebay_connection":
			return "Checking eBay connection";
		case "flipagent_quote_shipping":
			return "Quoting shipping";
		default:
			return name.replace(/^flipagent_/, "").replace(/_/g, " ");
	}
}

interface Attachment {
	kind: "image" | "file";
	dataUrl: string;
	mimeType?: string;
	name?: string;
	size?: number;
}

interface UserAction {
	type: "tool" | "prompt";
	name?: string;
	args?: Record<string, unknown>;
	text?: string;
}

interface AgentChatResponse {
	sessionId: string;
	runId: string;
	reply: string;
	model: string;
	tokensIn: number;
	tokensOut: number;
	costCents: number;
	ui?: UiHint;
}

/**
 * Resolve a `ui://flipagent/<kind>` MCP-Apps URI to an iframe src on
 * this docs origin. Same-origin lets the embed page inherit our auth
 * cookies + CSS tokens with no postMessage bridge for those concerns.
 * URIs we don't own pass through unchanged.
 */
function resolveUiUri(uri: string): string {
	const m = uri.match(/^ui:\/\/flipagent\/(.+)$/);
	if (m) return `/embed/${m[1]}`;
	return uri;
}

/**
 * Map a UI button click (`flipagent_evaluate_item`, etc.) to the
 * resourceUri of the panel that *will* land once the agent finishes.
 * Lets us optimistically show the right-shaped skeleton in chat while
 * the agent runs (10–60s for evaluate). Returns null when we can't
 * confidently predict — the caller falls back to typing dots.
 */
function predictUiResource(toolName: string): string | null {
	switch (toolName) {
		case "flipagent_search_items":
		case "flipagent_search_sold_items":
			return "ui://flipagent/search-results";
		case "flipagent_evaluate_item":
		case "flipagent_get_evaluate_job":
		case "flipagent_get_evaluation_pool":
			return "ui://flipagent/evaluate";
		default:
			return null;
	}
}

const MAX_INPUT_LEN = 8000;
const MAX_ATTACHMENT_BYTES = 8 * 1024 * 1024; // 8MB binary; ~10.7MB base64
const MAX_ATTACHMENTS = 8;

/**
 * Empty-state suggestion cards. Click → fills the input with the prompt
 * and lands focus there so the user can edit before sending. Picked to
 * cover the three biggest reseller-cycle entry points: comping, evaluating,
 * and reviewing your own activity.
 */
const HERO_EXAMPLES: { title: string; prompt: string }[] = [
	{
		title: "Find Jordan 1 listings under $200 with sold comps",
		prompt:
			"Search active eBay listings for Jordan 1 under $200, then pull sold comps for the top 3 so I can see which are flippable.",
	},
	{
		title: "Evaluate an eBay item for resale margin",
		prompt:
			"Evaluate this eBay item for me: <paste eBay URL or itemId>. I want sold comps, fee estimate, and expected margin.",
	},
	{
		title: "Show my active listings, recent sales, and last payout",
		prompt: "List my active eBay listings, recent sales this month, and the last payout amount.",
	},
];

function readAsDataUrl(file: File): Promise<string> {
	return new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.onerror = () => reject(reader.error ?? new Error("read failed"));
		reader.onload = () => {
			const r = reader.result;
			if (typeof r === "string") resolve(r);
			else reject(new Error("unexpected reader result"));
		};
		reader.readAsDataURL(file);
	});
}

async function fileToAttachment(file: File): Promise<Attachment | { error: string }> {
	if (file.size > MAX_ATTACHMENT_BYTES) {
		return { error: `${file.name}: too large (max 8MB)` };
	}
	try {
		const dataUrl = await readAsDataUrl(file);
		const kind: "image" | "file" = file.type.startsWith("image/") ? "image" : "file";
		return {
			kind,
			dataUrl,
			mimeType: file.type || undefined,
			name: file.name,
			size: file.size,
		};
	} catch (err) {
		return { error: `${file.name}: ${(err as Error).message}` };
	}
}

type AgentStreamEvent =
	| { type: "tool_call_start"; name: string; args: Record<string, unknown> }
	| { type: "tool_call_end"; name: string; ui?: UiHint; error?: string }
	| { type: "text_delta"; delta: string }
	| {
			type: "done";
			sessionId: string;
			runId: string;
			reply: string;
			model: string;
			tokensIn: number;
			tokensOut: number;
			costCents: number;
			ui?: UiHint;
		}
	| { type: "error"; code: string; message: string };

/**
 * POST /v1/agent/chat with `Accept: text/event-stream` and parse the
 * SSE stream. Yields events as they arrive. Throws on transport
 * failure (network, 4xx/5xx before stream starts).
 */
async function* streamChat(opts: {
	message: string;
	sessionId: string | null;
	attachments?: Attachment[];
	userAction?: UserAction;
	signal?: AbortSignal;
}): AsyncGenerator<AgentStreamEvent, void, void> {
	const payload: Record<string, unknown> = { message: opts.message };
	if (opts.sessionId) payload.sessionId = opts.sessionId;
	if (opts.attachments && opts.attachments.length > 0) {
		payload.attachments = opts.attachments.map(({ kind, dataUrl, mimeType, name }) => ({
			kind,
			dataUrl,
			...(mimeType ? { mimeType } : {}),
			...(name ? { name } : {}),
		}));
	}
	if (opts.userAction) payload.userAction = opts.userAction;
	const res = await fetch(`${apiBase}/v1/agent/chat`, {
		method: "POST",
		credentials: "include",
		headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
		body: JSON.stringify(payload),
		signal: opts.signal,
	});
	if (!res.ok) {
		const text = await res.text();
		let body: { error?: string; message?: string } = {};
		try {
			body = JSON.parse(text) as { error?: string; message?: string };
		} catch {
			/* swallow */
		}
		yield {
			type: "error",
			code: body.error ?? `http_${res.status}`,
			message: body.message ?? text ?? `HTTP ${res.status}`,
		};
		return;
	}
	const reader = res.body?.getReader();
	if (!reader) {
		yield { type: "error", code: "no_body", message: "Response has no body stream." };
		return;
	}
	const decoder = new TextDecoder();
	let buf = "";
	while (true) {
		const { done, value } = await reader.read();
		if (done) break;
		buf += decoder.decode(value, { stream: true });
		while (true) {
			const idx = buf.indexOf("\n\n");
			if (idx === -1) break;
			const frame = buf.slice(0, idx);
			buf = buf.slice(idx + 2);
			// SSE frame: one or more `field: value` lines. We only consume `data:`.
			let dataLines: string[] = [];
			for (const line of frame.split("\n")) {
				if (line.startsWith("data: ")) dataLines.push(line.slice(6));
				else if (line.startsWith("data:")) dataLines.push(line.slice(5));
			}
			if (dataLines.length === 0) continue;
			const json = dataLines.join("\n");
			try {
				yield JSON.parse(json) as AgentStreamEvent;
			} catch {
				/* swallow malformed frame */
			}
		}
	}
}

async function fetchConn(): Promise<ConnStatus> {
	return apiFetch<ConnStatus>("/v1/me/ebay/status");
}

/** Cheap browser+OS label for the pair flow's device name field —
 * mirrors the heuristic in the extension popup. Server-side display
 * only; never used for trust decisions. */
function guessDeviceName(): string {
	const ua = navigator.userAgent;
	const browser = /Edg\//.test(ua)
		? "Edge"
		: /OPR\//.test(ua)
			? "Opera"
			: /Chrome\//.test(ua)
				? "Chrome"
				: "Browser";
	const os = /Mac OS X/.test(ua)
		? "Mac"
		: /Windows/.test(ua)
			? "Windows"
			: /Linux/.test(ua)
				? "Linux"
				: "Device";
	return `${browser} on ${os}`;
}

async function fetchSessions(): Promise<AgentSession[]> {
	const res = await fetch(`${apiBase}/v1/agent/sessions`, { credentials: "include" });
	if (!res.ok) return [];
	const body = (await res.json().catch(() => null)) as { sessions?: AgentSession[] } | null;
	return body?.sessions ?? [];
}

async function fetchSessionRuns(sessionId: string): Promise<AgentRun[]> {
	const res = await fetch(
		`${apiBase}/v1/agent/runs?sessionId=${encodeURIComponent(sessionId)}&limit=200`,
		{ credentials: "include" },
	);
	if (!res.ok) return [];
	const body = (await res.json().catch(() => null)) as { runs?: AgentRun[] } | null;
	return body?.runs ?? [];
}

/**
 * Pull `[image: name]` / `[file: name]` markers out of a stored
 * userMessage and turn them into placeholder attachment chips. We
 * don't have the actual binary on thread restore (no Files API yet),
 * so the chip shows a glyph + filename only.
 */
function extractAttachmentMarkers(text: string): { text: string; attachments: Attachment[] } {
	const atts: Attachment[] = [];
	const stripped = text
		.replace(/\[(image|file)(?::\s*([^\]]+))?\]/g, (_m, kind, name) => {
			atts.push({ kind: kind as "image" | "file", dataUrl: "", name: name ? String(name).trim() : undefined });
			return "";
		})
		.replace(/[ \t]+\n/g, "\n")
		.trim();
	return { text: stripped, attachments: atts };
}

function runsToMessages(runs: AgentRun[]): ChatMessage[] {
	// Server returns newest-first; replay oldest → newest so the chat reads top-down.
	const out: ChatMessage[] = [];
	for (const r of [...runs].reverse()) {
		const t = new Date(r.startedAt).getTime();
		if (r.userMessage) {
			const { text, attachments } = extractAttachmentMarkers(r.userMessage);
			out.push({
				role: "user",
				content: text,
				...(attachments.length > 0 ? { attachments } : {}),
				at: t,
			});
		}
		if (r.errorMessage) out.push({ role: "error", content: r.errorMessage, at: t + 1 });
		else if (r.reply || r.ui)
			out.push({
				role: "assistant",
				content: r.reply ?? "",
				...(r.ui ? { ui: r.ui } : {}),
				at: t + 1,
			});
	}
	return out;
}

function formatRelative(iso: string): string {
	const d = new Date(iso).getTime();
	const delta = Date.now() - d;
	if (delta < 60_000) return "now";
	if (delta < 3_600_000) return `${Math.floor(delta / 60_000)}m`;
	if (delta < 86_400_000) return `${Math.floor(delta / 3_600_000)}h`;
	return `${Math.floor(delta / 86_400_000)}d`;
}

function formatCost(cents: number): string {
	if (cents <= 0) return "<$0.01";
	return `$${(cents / 100).toFixed(2)}`;
}

function summariseError(body: { error?: string; message?: string } | AgentChatResponse, status: number): string {
	if ("error" in body && body.error) {
		return body.message ? `${body.error}: ${body.message}` : body.error;
	}
	return `HTTP ${status}`;
}

const IconAttach = (
	<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
		<path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.19 9.19a2 2 0 0 1-2.83-2.83l8.49-8.49" />
	</svg>
);
const IconArrowUp = (
	<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
		<path d="M12 19V5M5 12l7-7 7 7" />
	</svg>
);
const IconClose = (
	<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
		<path d="M6 6l12 12M18 6l-12 12" />
	</svg>
);
const IconChevron = (
	<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
		<path d="m6 9 6 6 6-6" />
	</svg>
);
const IconPlus = (
	<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
		<path d="M12 5v14M5 12h14" />
	</svg>
);

export function PlaygroundAgent({
	tabsProps: _tabsProps,
}: {
	// Accepted for API compatibility with sibling playground panels but
	// unused — the agent surface lives directly on the dash background
	// without an in-card tab switcher (sidebar handles navigation).
	tabsProps: { tabs: ReadonlyArray<ComposeTab<string>>; active: string; onChange: (next: string) => void };
}) {
	const [messages, setMessages] = useState<ChatMessage[]>([]);
	const [input, setInput] = useState("");
	const [sessionId, setSessionId] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);
	const [model, setModel] = useState<string | null>(null);
	const [totalCostCents, setTotalCostCents] = useState(0);
	const [pendingAttachments, setPendingAttachments] = useState<Attachment[]>([]);
	const [attachError, setAttachError] = useState<string | null>(null);
	const [unavailable, setUnavailable] = useState<string | null>(null);
	const [sessions, setSessions] = useState<AgentSession[]>([]);
	const [dragOver, setDragOver] = useState(false);
	const [conn, setConn] = useState<ConnStatus | null>(null);
	const [connOpen, setConnOpen] = useState(false);
	// Tri-state: null = haven't decided yet, true = presence beacon
	// arrived from the extension content script, false = ~600ms passed
	// with no beacon → treat as not installed.
	const [extInstalled, setExtInstalled] = useState<boolean | null>(null);
	// Extension's chrome runtime id, harvested from the presence beacon
	// so we can launch the pair flow without hardcoding the published
	// Web Store id (and matching whatever unpacked id is loaded in dev).
	const [extensionId, setExtensionId] = useState<string | null>(null);

	const fileInputRef = useRef<HTMLInputElement | null>(null);
	const messagesRef = useRef<HTMLDivElement | null>(null);
	const textareaRef = useRef<HTMLTextAreaElement | null>(null);
	const connWrapRef = useRef<HTMLDivElement | null>(null);
	// dragenter / dragleave fire across child element boundaries — using a
	// counter is the standard fix for the resulting flicker.
	const dragDepthRef = useRef(0);


	// Load thread list on mount; refresh on window focus so changes from
	// other tabs / devices propagate.
	useEffect(() => {
		fetchSessions().then(setSessions);
		function onFocus() {
			fetchSessions().then(setSessions);
			fetchConn().then(setConn).catch(() => {});
		}
		window.addEventListener("focus", onFocus);
		return () => window.removeEventListener("focus", onFocus);
	}, []);

	// Fetch the connection snapshot once for the hero chip. Failure leaves
	// it null → chip falls back to the "Connect" CTA state, which is the
	// right thing to do if /v1/me/* isn't reachable for any reason.
	useEffect(() => {
		fetchConn().then(setConn).catch(() => {});
	}, []);

	// Extension presence detection. The extension's content script (only
	// injected on flipagent.dev / localhost) posts a presence message on
	// load and re-posts on demand. We send a ping in case the page mounted
	// after the initial post, then time out after 600ms — long enough for
	// document_start injection to round-trip, short enough to feel snappy.
	useEffect(() => {
		let mounted = true;
		function onMessage(e: MessageEvent) {
			if (e.source !== window) return;
			const data = e.data as { type?: unknown; source?: unknown; extensionId?: unknown } | null;
			if (!data || data.type !== "flipagent-extension-present") return;
			if (data.source !== "flipagent-extension") return;
			if (!mounted) return;
			setExtInstalled(true);
			if (typeof data.extensionId === "string" && data.extensionId.length > 0) {
				setExtensionId(data.extensionId);
			}
		}
		window.addEventListener("message", onMessage);
		// Ping the extension in case its initial post fired before this
		// listener attached (SPA tab switch, etc).
		window.postMessage({ type: "flipagent-extension-ping" }, window.location.origin);
		const timer = window.setTimeout(() => {
			if (!mounted) return;
			setExtInstalled((cur) => (cur === null ? false : cur));
		}, 600);
		return () => {
			mounted = false;
			window.removeEventListener("message", onMessage);
			window.clearTimeout(timer);
		};
	}, []);

	// Close the conn popover on outside click. Anchored to the chip wrap
	// rather than the popover itself so clicking links inside the dropdown
	// fires before close.
	useEffect(() => {
		if (!connOpen) return;
		function onDocMouseDown(e: MouseEvent) {
			const wrap = connWrapRef.current;
			if (!wrap) return;
			if (wrap.contains(e.target as Node)) return;
			setConnOpen(false);
		}
		document.addEventListener("mousedown", onDocMouseDown);
		return () => document.removeEventListener("mousedown", onDocMouseDown);
	}, [connOpen]);

	// Auto-scroll on new messages.
	useEffect(() => {
		const el = messagesRef.current;
		if (el) el.scrollTop = el.scrollHeight;
	}, [messages.length, busy]);

	// Auto-grow textarea up to a cap.
	useEffect(() => {
		const ta = textareaRef.current;
		if (!ta) return;
		ta.style.height = "auto";
		ta.style.height = `${Math.min(ta.scrollHeight, 180)}px`;
	}, [input]);

	// Sidebar drives thread navigation now (Dashboard sidebar lists every
	// thread under the Agent nav item). Listen for the load-thread custom
	// event the sidebar fires; pass `null` for "new thread".
	useEffect(() => {
		function onLoadThread(e: Event) {
			const detail = (e as CustomEvent<{ sessionId: string | null }>).detail;
			if (!detail) return;
			if (detail.sessionId == null) {
				newThread();
			} else {
				loadThread(detail.sessionId);
			}
		}
		window.addEventListener("flipagent-load-thread", onLoadThread);
		return () => window.removeEventListener("flipagent-load-thread", onLoadThread);
		// loadThread / newThread close over current state via the latest
		// closure each render — but since they rely on the outer setters,
		// they're safe to bind once.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	// Tell the sidebar which thread is active so it can highlight the row.
	useEffect(() => {
		window.dispatchEvent(
			new CustomEvent("flipagent-active-thread", { detail: { sessionId } }),
		);
	}, [sessionId]);

	async function loadThread(id: string) {
		if (id === sessionId) {
			textareaRef.current?.focus();
			return;
		}
		setSessionId(id);
		setMessages([]);
		setTotalCostCents(0);
		setPendingAttachments([]);
		setAttachError(null);
		const runs = await fetchSessionRuns(id);
		setMessages(runsToMessages(runs));
		const cost = runs.reduce((sum, r) => sum + (r.costCents ?? 0), 0);
		setTotalCostCents(cost);
		const lastModel = runs.find((r) => r.model)?.model ?? null;
		setModel(lastModel);
		// Land focus on the input so the user can continue the thread immediately.
		setTimeout(() => textareaRef.current?.focus(), 0);
	}

	function newThread() {
		setSessionId(null);
		setMessages([]);
		setTotalCostCents(0);
		setModel(null);
		setPendingAttachments([]);
		setAttachError(null);
		textareaRef.current?.focus();
	}

	async function ingestFiles(files: File[]) {
		if (files.length === 0) return;
		setAttachError(null);
		const room = MAX_ATTACHMENTS - pendingAttachments.length;
		if (room <= 0) {
			setAttachError(`Up to ${MAX_ATTACHMENTS} attachments per turn.`);
			return;
		}
		const next: Attachment[] = [];
		const errors: string[] = [];
		for (const f of files.slice(0, room)) {
			const result = await fileToAttachment(f);
			if ("error" in result) errors.push(result.error);
			else next.push(result);
		}
		if (next.length > 0) setPendingAttachments((prev) => [...prev, ...next]);
		if (errors.length > 0) setAttachError(errors.join("; "));
		if (files.length > room) {
			setAttachError((prev) =>
				[prev, `Only the first ${room} attached.`].filter(Boolean).join(" "),
			);
		}
	}

	function onPickFiles(e: React.ChangeEvent<HTMLInputElement>) {
		const list = e.target.files ? Array.from(e.target.files) : [];
		ingestFiles(list);
		e.target.value = "";
	}

	function onPaste(e: React.ClipboardEvent<HTMLTextAreaElement>) {
		const items = e.clipboardData?.items;
		if (!items) return;
		const pasted: File[] = [];
		for (let i = 0; i < items.length; i++) {
			const it = items[i];
			if (!it) continue;
			if (it.kind === "file") {
				const f = it.getAsFile();
				if (f) pasted.push(f);
			}
		}
		if (pasted.length > 0) {
			e.preventDefault();
			ingestFiles(pasted);
		}
	}

	function onDrop(e: React.DragEvent<HTMLDivElement>) {
		e.preventDefault();
		dragDepthRef.current = 0;
		setDragOver(false);
		const files = e.dataTransfer?.files ? Array.from(e.dataTransfer.files) : [];
		ingestFiles(files);
	}

	function onDragEnter(e: React.DragEvent<HTMLDivElement>) {
		// Only treat events that carry files (not text drags / interactive selection).
		const types = e.dataTransfer?.types;
		if (!types || !Array.from(types).includes("Files")) return;
		e.preventDefault();
		dragDepthRef.current += 1;
		if (dragDepthRef.current === 1) setDragOver(true);
	}

	function onDragLeave(e: React.DragEvent<HTMLDivElement>) {
		const types = e.dataTransfer?.types;
		if (!types || !Array.from(types).includes("Files")) return;
		dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
		if (dragDepthRef.current === 0) setDragOver(false);
	}

	function onDragOver(e: React.DragEvent<HTMLDivElement>) {
		// preventDefault makes this a valid drop target (otherwise drop is ignored).
		const types = e.dataTransfer?.types;
		if (types && Array.from(types).includes("Files")) e.preventDefault();
	}

	function removeAttachment(idx: number) {
		setPendingAttachments((prev) => prev.filter((_, i) => i !== idx));
	}

	async function send(
		opts: { userAction?: UserAction; uiPlaceholderText?: string; subject?: ActionSubject } = {},
	) {
		const trimmed = input.trim();
		const hasMessage = trimmed.length > 0;
		const hasAttachments = pendingAttachments.length > 0;
		const hasAction = !!opts.userAction;
		if ((!hasMessage && !hasAttachments && !hasAction) || busy) return;
		const attachmentsForTurn = hasAttachments ? pendingAttachments : [];
		const userMsg: ChatMessage = hasAction
			? {
					role: "user",
					content: opts.uiPlaceholderText ?? "ui action",
					fromUi: true,
					...(opts.subject ? { subject: opts.subject } : {}),
					at: Date.now(),
				}
			: {
					role: "user",
					content: trimmed,
					...(attachmentsForTurn.length > 0 ? { attachments: attachmentsForTurn } : {}),
					at: Date.now(),
				};
		// Pre-mount a placeholder assistant bubble. Stream events
		// (tool_call_start → ui skeleton; text_delta → typed-out text;
		// tool_call_end → real ui props) update it in place.
		const assistantAt = userMsg.at + 1;
		setMessages((prev) => [
			...prev,
			userMsg,
			{ role: "assistant", content: "", streaming: true, at: assistantAt },
		]);
		if (!hasAction) {
			setInput("");
			setPendingAttachments([]);
			setAttachError(null);
		}
		setBusy(true);

		// Helpers that always target the in-flight assistant message by `at`.
		const updateAssistant = (patch: (m: ChatMessage) => ChatMessage) => {
			setMessages((prev) => {
				const idx = prev.findIndex((m) => m.at === assistantAt);
				if (idx === -1) return prev;
				const next = prev.slice();
				const cur = prev[idx];
				if (!cur) return prev;
				next[idx] = patch(cur);
				return next;
			});
		};

		let sawDone = false;
		let textBuf = "";
		// Throttle text_delta state updates so React doesn't re-render the
		// markdown DOM 30+ times/sec — each rerender clears any active
		// user text selection. ~120ms feels live but lets selection stick.
		let lastTextFlush = 0;
		const TEXT_FLUSH_MS = 120;
		try {
			for await (const event of streamChat({
				message: hasAction ? "" : trimmed,
				sessionId,
				attachments: attachmentsForTurn,
				...(opts.userAction ? { userAction: opts.userAction } : {}),
			})) {
				if (event.type === "tool_call_start") {
					const label = toolStatusLabel(event.name);
					const uri = predictUiResource(event.name);
					updateAssistant((m) => ({
						...m,
						toolStatus: label,
						...(uri ? { ui: { resourceUri: uri, props: {} } } : {}),
					}));
				} else if (event.type === "tool_call_end") {
					if (event.ui) {
						updateAssistant((m) => ({ ...m, ui: event.ui, toolStatus: undefined }));
					} else {
						// Tool finished without a renderable UI; keep the status
						// label until the next tool starts or text begins so the
						// user sees continuous progress instead of a flicker.
					}
				} else if (event.type === "text_delta") {
					textBuf += event.delta;
					const now = Date.now();
					if (now - lastTextFlush >= TEXT_FLUSH_MS) {
						lastTextFlush = now;
						updateAssistant((m) => ({ ...m, content: textBuf, toolStatus: undefined }));
					}
				} else if (event.type === "done") {
					sawDone = true;
					setSessionId((cur) => cur ?? event.sessionId);
					setModel(event.model);
					setTotalCostCents((c) => c + event.costCents);
					updateAssistant((m) => {
						const placeholder = !!m.ui && (!m.ui.props || Object.keys(m.ui.props).length === 0);
						return {
							...m,
							content: event.reply,
							streaming: false,
							toolStatus: undefined,
							// If the message still carries a placeholder skeleton
							// (tool failed without a renderable UI), prefer the
							// done event's `ui` if present, else drop the
							// skeleton so the bubble doesn't render an empty
							// loading panel forever.
							ui: event.ui ?? (placeholder ? undefined : m.ui),
						};
					});
					if (sessionId === null) {
						fetchSessions().then(setSessions);
					} else {
						setSessions((prev) =>
							prev.map((s) =>
								s.id === event.sessionId ? { ...s, lastActiveAt: new Date().toISOString() } : s,
							),
						);
					}
					// Tell the sidebar so its thread list reflects the new
					// session (or new lastActiveAt) without waiting for focus.
					window.dispatchEvent(new CustomEvent("flipagent-sessions-changed"));
				} else if (event.type === "error") {
					sawDone = true;
					if (event.code === "agent_not_configured") {
						setUnavailable(event.message ?? "Agent not configured on this instance.");
					}
					setMessages((prev) => {
						const without = prev.filter((m) => m.at !== assistantAt);
						return [...without, { role: "error", content: event.message, at: Date.now() }];
					});
				}
			}
			if (!sawDone) {
				setMessages((prev) => {
					const without = prev.filter((m) => m.at !== assistantAt);
					return [...without, { role: "error", content: "Stream ended unexpectedly.", at: Date.now() }];
				});
			}
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			setMessages((prev) => {
				const without = prev.filter((m) => m.at !== assistantAt);
				return [...without, { role: "error", content: msg, at: Date.now() }];
			});
		} finally {
			setBusy(false);
		}
	}

	const sendRef = useRef(send);
	sendRef.current = send;

	// Receive postMessage actions from any inline UI iframe (`<ChatIframe>`)
	// rendered inside this chat. Tool intents → next agent turn with
	// userAction; prompt intents → autofill input; link intents → open in
	// new tab. Resize is handled inside ChatIframe directly.
	useEffect(() => {
		function onEmbedAction(e: Event) {
			const detail = (e as CustomEvent<{ type: string; [k: string]: unknown }>).detail;
			if (!detail) return;
			if (detail.type === "embed-tool" && typeof detail.name === "string") {
				const args = (detail.args as Record<string, unknown> | undefined) ?? {};
				// Prefer iframe-supplied human label ("Evaluate", "Buy", …)
				// + a structured subject (item preview) so the chat can
				// render a card instead of a bare sentence.
				const labelStr =
					typeof detail.label === "string" && detail.label.trim().length > 0
						? detail.label.trim()
						: detail.name.replace(/^flipagent_/, "").replace(/_/g, " ");
				const subjectRaw = detail.subject as Record<string, unknown> | undefined;
				const subject: ActionSubject | undefined =
					subjectRaw && typeof subjectRaw === "object"
						? {
								...(typeof subjectRaw.image === "string" ? { image: subjectRaw.image } : {}),
								...(typeof subjectRaw.title === "string" ? { title: subjectRaw.title } : {}),
								...(typeof subjectRaw.subtitle === "string" ? { subtitle: subjectRaw.subtitle } : {}),
								...(typeof subjectRaw.url === "string" ? { url: subjectRaw.url } : {}),
							}
						: undefined;
				sendRef.current({
					userAction: { type: "tool", name: detail.name, args },
					uiPlaceholderText: labelStr,
					subject,
				});
			} else if (detail.type === "embed-prompt" && typeof detail.text === "string") {
				setInput(detail.text);
				textareaRef.current?.focus();
			} else if (detail.type === "embed-link" && typeof detail.url === "string") {
				window.open(detail.url, "_blank", "noopener,noreferrer");
			}
		}
		window.addEventListener("flipagent-embed-action", onEmbedAction);
		return () => window.removeEventListener("flipagent-embed-action", onEmbedAction);
	}, []);

	const canSend = !busy && (input.trim().length > 0 || pendingAttachments.length > 0);
	// Pre-chat hero: only when this is a fresh tab (no session, no messages,
	// not mid-stream). Once the user sends or loads a thread, we switch to
	// the wide chat layout and never come back unless they hit "new thread".
	const isHero = messages.length === 0 && !busy && !sessionId;

	return (
		<div className="agent-page">
			{unavailable ? (
				<div className="agent-unavailable">
					<strong>Agent preview unavailable.</strong>
					<p>{unavailable}</p>
				</div>
			) : (
				<div
					className={`agent-shell${dragOver ? " agent-shell-drop" : ""}${
						isHero ? " agent-shell-hero" : " agent-shell-active"
					}`}
					onDragEnter={onDragEnter}
					onDragOver={onDragOver}
					onDragLeave={onDragLeave}
					onDrop={onDrop}
				>
					<input
						ref={fileInputRef}
						type="file"
						multiple
						className="agent-file-hidden"
						onChange={onPickFiles}
					/>
					{isHero ? (
						<div className="agent-hero">
							<h2 className="agent-hero-title">What do you want to flip today?</h2>
							<div className="agent-hero-card">
								<textarea
									ref={textareaRef}
									value={input}
									onChange={(e) => setInput(e.target.value.slice(0, MAX_INPUT_LEN))}
									onPaste={onPaste}
									onKeyDown={(e) => {
										if (e.key === "Enter" && !e.shiftKey) {
											e.preventDefault();
											if (canSend) send();
										}
									}}
									placeholder="Ask the agent — search, evaluate, list, fulfill"
									rows={2}
									disabled={busy}
									className="agent-hero-textarea"
								/>
								<div className="agent-hero-actions">
									<div className="agent-hero-actions-left">
										<button
											type="button"
											className="agent-hero-attach"
											onClick={() => fileInputRef.current?.click()}
										>
											{IconAttach}
											Attach
										</button>
										<ConnChip
											conn={conn}
											setConn={setConn}
											extInstalled={extInstalled}
											extensionId={extensionId}
											open={connOpen}
											onToggle={() => setConnOpen((v) => !v)}
											onClose={() => setConnOpen(false)}
											wrapRef={connWrapRef}
										/>
									</div>
									<button
										type="button"
										className="agent-hero-send"
										onClick={() => send()}
										disabled={!canSend}
										aria-label="Send"
										title="Send (Enter)"
									>
										{IconArrowUp}
									</button>
								</div>
							</div>
							{pendingAttachments.length > 0 && (
								<div className="agent-pending-atts agent-hero-atts">
									{pendingAttachments.map((a, i) => (
										<AttachmentChip key={i} att={a} onRemove={() => removeAttachment(i)} />
									))}
								</div>
							)}
							{attachError && <div className="agent-attach-error agent-hero-error">{attachError}</div>}
							<div className="agent-hero-examples">
								{HERO_EXAMPLES.map((ex) => (
									<button
										key={ex.title}
										type="button"
										className="agent-hero-example"
										onClick={() => {
											setInput(ex.prompt);
											textareaRef.current?.focus();
										}}
									>
										{ex.title}
									</button>
								))}
							</div>
						</div>
					) : (
					<>
					<div ref={messagesRef} className="agent-messages">
						{messages.length === 0 && !busy ? (
							<div className="agent-empty">Type a message. Drop or paste files to attach.</div>
						) : (
							messages.map((m, i) => {
								if (m.role === "assistant" && !m.content && !m.ui) {
									return (
										<div
											key={`${m.at}-${i}`}
											className="agent-msg agent-msg-assistant agent-msg-pending"
										>
											{m.toolStatus ? (
												<span className="agent-status">
													<span className="agent-status-shimmer">{m.toolStatus}</span>
													<span className="agent-status-ellipsis">…</span>
												</span>
											) : (
												<div className="agent-typing">
													<span />
													<span />
													<span />
												</div>
											)}
										</div>
									);
								}
								return (
								<div key={`${m.at}-${i}`} className={`agent-msg agent-msg-${m.role}`}>
									{m.attachments && m.attachments.length > 0 && (
										<div className="agent-msg-atts">
											{m.attachments.map((a, j) => (
												<AttachmentChip key={j} att={a} />
											))}
										</div>
									)}
									{m.role === "assistant" && m.streaming && m.toolStatus && (
										<span className="agent-status">
											<span className="agent-status-shimmer">{m.toolStatus}</span>
											<span className="agent-status-ellipsis">…</span>
										</span>
									)}
									{m.role === "assistant" && m.ui && <ChatIframe ui={m.ui} />}
									{(m.content || m.subject) &&
										(m.role === "assistant" ? (
											<div className="agent-msg-text">
												{m.streaming ? (
													<div className="agent-msg-streaming">{m.content}</div>
												) : (
													<MarkdownLite text={m.content} />
												)}
											</div>
										) : (
											<div className="agent-msg-text">
												{m.content && (
													<div className="agent-msg-line">
														{m.fromUi && !m.subject && (
															<span className="agent-msg-ui-prefix" aria-hidden="true">
																<svg
																	width="11"
																	height="11"
																	viewBox="0 0 24 24"
																	fill="none"
																	stroke="currentColor"
																	strokeWidth="2.4"
																	strokeLinecap="round"
																	strokeLinejoin="round"
																>
																	<path d="M5 12h14M13 5l7 7-7 7" />
																</svg>
															</span>
														)}
														{m.content}
													</div>
												)}
												{m.subject && (
													<a
														href={m.subject.url ?? "#"}
														target={m.subject.url ? "_blank" : undefined}
														rel={m.subject.url ? "noopener noreferrer" : undefined}
														className="agent-action-subject"
														onClick={(e) => {
															if (!m.subject?.url) e.preventDefault();
														}}
													>
														{m.subject.image ? (
															<img
																src={m.subject.image}
																alt=""
																className="agent-action-subject-thumb"
															/>
														) : (
															<span className="agent-action-subject-thumb agent-action-subject-thumb-placeholder" />
														)}
														<span className="agent-action-subject-meta">
															{m.subject.title && (
																<span className="agent-action-subject-title">{m.subject.title}</span>
															)}
															{m.subject.subtitle && (
																<span className="agent-action-subject-subtitle">
																	{m.subject.subtitle}
																</span>
															)}
														</span>
													</a>
												)}
											</div>
										))}
									{m.role !== "assistant" && m.ui && <ChatIframe ui={m.ui} />}
								</div>
								);
							})
						)}
						{/* Typing dots live inside the in-flight assistant message itself */}
					</div>

					<div className="agent-compose">
						{pendingAttachments.length > 0 && (
							<div className="agent-pending-atts">
								{pendingAttachments.map((a, i) => (
									<AttachmentChip
										key={i}
										att={a}
										onRemove={() => removeAttachment(i)}
									/>
								))}
							</div>
						)}
						{attachError && <div className="agent-attach-error">{attachError}</div>}
						<div className="agent-input">
							<button
								type="button"
								className="agent-input-attach"
								onClick={() => fileInputRef.current?.click()}
								title="Attach file"
								aria-label="Attach file"
							>
								{IconAttach}
							</button>
							<textarea
								ref={textareaRef}
								value={input}
								onChange={(e) => setInput(e.target.value.slice(0, MAX_INPUT_LEN))}
								onPaste={onPaste}
								onKeyDown={(e) => {
									if (e.key === "Enter" && !e.shiftKey) {
										e.preventDefault();
										if (canSend) send();
									}
								}}
								placeholder={sessionId ? "Reply…" : "Ask the agent…"}
								rows={1}
								disabled={busy}
							/>
							<button
								type="button"
								className="agent-input-send"
								onClick={() => send()}
								disabled={!canSend}
								aria-label="Send"
								title="Send (Enter)"
							>
								{IconArrowUp}
							</button>
						</div>
					</div>
					</>
					)}

					{dragOver && <div className="agent-drop-overlay">Drop to attach</div>}
				</div>
			)}
		</div>
	);
}

/**
 * Inline UI iframe — mounted when an assistant message carries an MCP
 * Apps `ui.resourceUri`. Same-origin (we serve `/embed/*` from the docs
 * site), so no token bridge is needed.
 *
 * Protocol with the embed page:
 *   - iframe → host: `embed-ready`  (announce loaded)
 *   - host   → iframe: `embed-init` `{ data: props }`
 *   - iframe → host: `embed-tool` / `embed-prompt` / `embed-link`
 *   - iframe → host: `embed-resize` `{ height }`
 *
 * `embed-tool|prompt|link` bubble up via a `flipagent-embed-action`
 * CustomEvent so PlaygroundAgent's single global handler converts them
 * into the next agent turn / input prefill / new tab.
 */
function ChatIframe({ ui }: { ui: UiHint }) {
	const ref = useRef<HTMLIFrameElement | null>(null);
	const readyRef = useRef(false);
	const [height, setHeight] = useState(140);
	const src = useMemo(() => resolveUiUri(ui.resourceUri), [ui.resourceUri]);

	useEffect(() => {
		function onMessage(e: MessageEvent) {
			if (e.source !== ref.current?.contentWindow) return;
			const m = e.data as { type?: string; [k: string]: unknown } | null;
			if (!m || typeof m !== "object" || typeof m.type !== "string") return;
			if (m.type === "embed-ready") {
				readyRef.current = true;
				ref.current?.contentWindow?.postMessage(
					{ type: "embed-init", data: ui.props ?? {}, source: "flipagent-host" },
					"*",
				);
			} else if (m.type === "embed-resize" && typeof m.height === "number") {
				// No max cap — iframe should be exactly content height so the
				// only scroll is the chat container itself.
				const next = Math.max(80, Math.round(m.height as number));
				setHeight(next);
			} else if (m.type === "embed-tool" || m.type === "embed-prompt" || m.type === "embed-link") {
				window.dispatchEvent(new CustomEvent("flipagent-embed-action", { detail: m }));
			}
		}
		window.addEventListener("message", onMessage);
		return () => window.removeEventListener("message", onMessage);
	}, [ui.props]);

	// Push a fresh init whenever props change (skeleton → real data).
	// Iframe stays mounted; embed page re-renders on the new init.
	useEffect(() => {
		if (!readyRef.current) return;
		ref.current?.contentWindow?.postMessage(
			{ type: "embed-init", data: ui.props ?? {}, source: "flipagent-host" },
			"*",
		);
	}, [ui.props]);

	return (
		<iframe
			ref={ref}
			src={src}
			title={ui.resourceUri}
			sandbox="allow-scripts allow-same-origin allow-popups"
			className="agent-embed"
			style={{ height: `${height}px` }}
		/>
	);
}

/**
 * Connections chip — sits next to Attach in the hero. Status dot tells
 * the user at a glance whether the agent has the surfaces it needs;
 * clicking opens a small dropdown listing eBay account + browser
 * extension with a Connect / Install link for whichever is missing.
 *
 * The "connect eBay" action goes through a window-level CustomEvent so
 * the Dashboard root can flip its view + open the consent modal without
 * a full page reload (matches the extension popup deep-link flow).
 */
function ConnChip({
	conn,
	setConn,
	extInstalled,
	extensionId,
	open,
	onToggle,
	onClose,
	wrapRef,
}: {
	conn: ConnStatus | null;
	setConn: (next: ConnStatus | null) => void;
	/** Tri-state from window-postMessage detection: true (presence beacon
	 * received), false (timeout, treat as not installed), null (still
	 * waiting in the first 600ms). */
	extInstalled: boolean | null;
	/** Extension's chrome runtime id — needed to build a working
	 * `/extension/connect/?ext=…` pair URL. Harvested from the same
	 * presence beacon. Null until the beacon arrives. */
	extensionId: string | null;
	open: boolean;
	onToggle: () => void;
	onClose: () => void;
	wrapRef: React.RefObject<HTMLDivElement | null>;
}) {
	// Two-click confirm — first click flips a row into "Click again to
	// disconnect" state. Local to the chip, resets when popover closes.
	const [confirming, setConfirming] = useState<"oauth" | null>(null);
	const [busy, setBusy] = useState<"oauth" | null>(null);
	useEffect(() => {
		if (!open) {
			setConfirming(null);
			setBusy(null);
		}
	}, [open]);
	async function disconnectEbay() {
		setBusy("oauth");
		try {
			await apiFetch("/v1/me/ebay/connect", { method: "DELETE" });
			const next = await fetchConn().catch(() => null);
			setConn(next);
			setConfirming(null);
		} catch {
			// Leave the row in confirming state so the user sees nothing
			// happened; click anywhere else to dismiss.
		} finally {
			setBusy(null);
		}
	}
	const oauthOk = !!conn?.oauth.connected;
	const bridgeOk = !!conn?.bridge.paired && !!conn?.bridge.ebayLoggedIn;
	const bridgeInstalled = !!conn?.bridge.paired;
	const anyOk = oauthOk || bridgeOk;
	// `loading` is conn === null (status not yet fetched). Render a neutral
	// dot so we don't flash "Connect" before the real state arrives.
	const loading = conn === null;
	const dotClass = loading
		? "agent-hero-conn-dot-loading"
		: anyOk
			? "agent-hero-conn-dot-ok"
			: "agent-hero-conn-dot-off";
	const handle = conn?.oauth.ebayUserName || conn?.bridge.ebayUserName || null;
	const label = loading
		? "Checking…"
		: anyOk
			? handle
				? `@${handle}`
				: "Connected"
			: "Connect";

	function gotoEbayConnect() {
		// Dashboard listens for this and flips to settings + opens the eBay
		// consent modal. Same end state as the extension's `?connect=ebay`
		// deep-link, but no page reload — agent state stays alive.
		window.dispatchEvent(
			new CustomEvent("flipagent-goto", {
				detail: { to: "settings", flag: "flipagent_open_ebay_connect" },
			}),
		);
		onClose();
	}
	function gotoExtension() {
		window.open("/docs/extension/", "_blank", "noopener,noreferrer");
		onClose();
	}

	return (
		<div className="agent-hero-conn-wrap" ref={wrapRef}>
			<button
				type="button"
				className={`agent-hero-conn${anyOk ? " agent-hero-conn-on" : ""}`}
				onClick={onToggle}
				aria-expanded={open}
				aria-haspopup="menu"
			>
				<span className={`agent-hero-conn-dot ${dotClass}`} />
				<span className="agent-hero-conn-label">{label}</span>
				<svg
					className="agent-hero-conn-chev"
					width="9"
					height="9"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					strokeWidth="2"
					strokeLinecap="round"
					strokeLinejoin="round"
				>
					<path d="m6 9 6 6 6-6" />
				</svg>
			</button>
			{open && (
				<div className="agent-hero-conn-pop" role="menu">
					<div className="agent-hero-conn-row">
						<span
							className={`agent-hero-conn-row-dot ${
								oauthOk ? "agent-hero-conn-dot-ok" : "agent-hero-conn-dot-off"
							}`}
						/>
						<div className="agent-hero-conn-row-meta">
							<span className="agent-hero-conn-row-title">eBay account</span>
							<span className="agent-hero-conn-row-sub">
								{oauthOk ? `@${conn?.oauth.ebayUserName ?? "signed in"}` : "Not connected"}
							</span>
						</div>
						{oauthOk ? (
							<button
								type="button"
								className={`agent-hero-conn-row-action${
									confirming === "oauth" ? " agent-hero-conn-row-action-danger" : " agent-hero-conn-row-action-muted"
								}`}
								onClick={() => {
									if (busy) return;
									if (confirming === "oauth") void disconnectEbay();
									else setConfirming("oauth");
								}}
								disabled={busy === "oauth"}
							>
								{busy === "oauth"
									? "Disconnecting…"
									: confirming === "oauth"
										? "Click to confirm"
										: "Disconnect"}
							</button>
						) : (
							<button
								type="button"
								className="agent-hero-conn-row-action"
								onClick={gotoEbayConnect}
							>
								Connect
							</button>
						)}
					</div>
					<div className="agent-hero-conn-row">
						<span
							className={`agent-hero-conn-row-dot ${
								bridgeOk
									? "agent-hero-conn-dot-ok"
									: bridgeInstalled || extInstalled
										? "agent-hero-conn-dot-warn"
										: "agent-hero-conn-dot-off"
							}`}
						/>
						<div className="agent-hero-conn-row-meta">
							<span className="agent-hero-conn-row-title">Browser extension</span>
							<span className="agent-hero-conn-row-sub">
								{bridgeOk
									? `@${conn?.bridge.ebayUserName ?? "signed in"}`
									: bridgeInstalled
										? "Not signed in to eBay"
										: extInstalled === false
											? "Not installed"
											: extInstalled === true
												? "Not paired"
												: "Checking…"}
							</span>
						</div>
						{bridgeOk ? (
							<button
								type="button"
								className="agent-hero-conn-row-action agent-hero-conn-row-action-muted"
								onClick={() => {
									// Per-device unpair lives on the Devices panel — multiple
									// browsers can pair, so the chip can't pick one to revoke.
									window.dispatchEvent(
										new CustomEvent("flipagent-goto", { detail: { to: "settings" } }),
									);
									onClose();
								}}
							>
								Manage
							</button>
						) : bridgeInstalled ? (
							<button
								type="button"
								className="agent-hero-conn-row-action"
								onClick={() => {
									window.open("https://www.ebay.com/signin", "_blank", "noopener,noreferrer");
									onClose();
								}}
							>
								Open eBay
							</button>
						) : extInstalled === true ? (
							<button
								type="button"
								className="agent-hero-conn-row-action"
								onClick={() => {
									if (extensionId) {
										// Same URL the popup builds — `?ext=<id>` is what
										// authorises the connect flow to message back.
										const device = encodeURIComponent(guessDeviceName());
										window.open(
											`/extension/connect/?ext=${encodeURIComponent(extensionId)}&device=${device}`,
											"_blank",
											"noopener,noreferrer",
										);
									} else {
										// We saw the presence beacon but it carried no id —
										// fall back to the docs page that explains the
										// popup-driven flow.
										window.open("/docs/extension/", "_blank", "noopener,noreferrer");
									}
									onClose();
								}}
							>
								Pair
							</button>
						) : extInstalled === null ? null : (
							<button
								type="button"
								className="agent-hero-conn-row-action"
								onClick={gotoExtension}
							>
								Install
							</button>
						)}
					</div>
				</div>
			)}
		</div>
	);
}

function AttachmentChip({ att, onRemove }: { att: Attachment; onRemove?: () => void }) {
	const isImage = att.kind === "image";
	const hasPreview = isImage && att.dataUrl.length > 0;
	return (
		<span className={`agent-att${hasPreview ? " agent-att-image" : ""}`}>
			{hasPreview ? (
				<img src={att.dataUrl} alt={att.name ?? "image"} />
			) : (
				<span className="agent-att-glyph" aria-hidden="true">
					{isImage ? "🖼" : "📄"}
				</span>
			)}
			<span className="agent-att-name" title={att.name}>
				{att.name ?? (isImage ? "image" : "file")}
			</span>
			{onRemove && (
				<button type="button" className="agent-att-remove" onClick={onRemove} aria-label="Remove attachment">
					{IconClose}
				</button>
			)}
		</span>
	);
}
