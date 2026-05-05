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
import { apiBase } from "../../lib/authClient";
import type { ComposeTab } from "../compose/ComposeCard";
import { ConnChip } from "../connections/ConnChip";
import { useConnections } from "../connections/ConnectionsContext";
import { findMockScript, type MockScript } from "./agentMockScripts";
import { MarkdownLite } from "./MarkdownLite";
import { hasInlinePanel, MessageUiPanel } from "./MessageUiPanel";
import "./PlaygroundAgent.css";

/**
 * Agent model selectable per chat turn. Free unlocks the cheap pair
 * (mini OpenAI + Flash Gemini); paid tiers add the stronger reasoning
 * models (gpt-5.5, claude-sonnet-4-7). Costs mirror raw provider
 * pricing (~$0.001/credit calibration). Keep in sync with the
 * `AgentModel` union in `@flipagent/types` and `AGENT_TURN_CREDITS`
 * in `packages/api/src/auth/limits.ts`.
 */
type AgentModel = "gpt-5.4-mini" | "gpt-5.5" | "claude-sonnet-4-7" | "gemini-2.5-flash";

const AGENT_MODEL_LABELS: Record<AgentModel, { label: string; cost: string; tagline: string }> = {
	"gpt-5.4-mini": { label: "gpt-5.4-mini", cost: "5 credits / turn", tagline: "Fast and frugal. Fits most flows." },
	"gemini-2.5-flash": {
		label: "gemini-2.5-flash",
		cost: "3 credits / turn",
		tagline: "Cheapest option, very fast.",
	},
	"claude-sonnet-4-7": {
		label: "claude-sonnet-4-7",
		cost: "15 credits / turn",
		tagline: "Strong reasoning, careful tool use.",
	},
	"gpt-5.5": { label: "gpt-5.5", cost: "25 credits / turn", tagline: "Top OpenAI for tricky threads." },
};

/**
 * Inline model picker — ghost chip + upward popover. Used in both the
 * pre-chat hero composer and the active-chat composer's action row so
 * the user can pick a model before the first turn AND mid-thread. Self
 * manages open state + outside-click / Escape close (mirrors the
 * connection-chip pattern).
 */
function ModelPicker({ value, onChange }: { value: AgentModel; onChange: (m: AgentModel) => void }) {
	const [open, setOpen] = useState(false);
	const wrapRef = useRef<HTMLDivElement | null>(null);

	useEffect(() => {
		if (!open) return;
		function onDocMouseDown(e: MouseEvent) {
			const wrap = wrapRef.current;
			if (!wrap) return;
			if (wrap.contains(e.target as Node)) return;
			setOpen(false);
		}
		function onKey(e: KeyboardEvent) {
			if (e.key === "Escape") setOpen(false);
		}
		document.addEventListener("mousedown", onDocMouseDown);
		document.addEventListener("keydown", onKey);
		return () => {
			document.removeEventListener("mousedown", onDocMouseDown);
			document.removeEventListener("keydown", onKey);
		};
	}, [open]);

	return (
		<div className="agent-model-picker" ref={wrapRef}>
			<button
				type="button"
				className="agent-model-chip"
				onClick={() => setOpen((v) => !v)}
				aria-haspopup="menu"
				aria-expanded={open}
				title={`Model: ${value} (${AGENT_MODEL_LABELS[value].cost})`}
			>
				<span className="agent-model-chip-label">{AGENT_MODEL_LABELS[value].label}</span>
				<svg
					width="9"
					height="9"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					strokeWidth="2"
					strokeLinecap="round"
					strokeLinejoin="round"
					aria-hidden="true"
				>
					<path d="m6 9 6 6 6-6" />
				</svg>
			</button>
			{open && (
				<div className="agent-model-menu" role="menu">
					{(Object.keys(AGENT_MODEL_LABELS) as AgentModel[]).map((m) => (
						<button
							key={m}
							type="button"
							role="menuitem"
							className={`agent-model-item${value === m ? " is-selected" : ""}`}
							onClick={() => {
								onChange(m);
								setOpen(false);
							}}
						>
							<div className="agent-model-item-row">
								<span className="agent-model-item-name">{AGENT_MODEL_LABELS[m].label}</span>
								<span className="agent-model-item-cost">{AGENT_MODEL_LABELS[m].cost}</span>
							</div>
							<div className="agent-model-item-tagline">{AGENT_MODEL_LABELS[m].tagline}</div>
						</button>
					))}
				</div>
			)}
		</div>
	);
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

/**
 * Args captured at send time so an error bubble's Retry button can
 * re-dispatch the same turn (text + attachments + tool action). Mirror
 * the public `send()` opts; we hold a snapshot of attachments-at-the-
 * moment because the live `pendingAttachments` array is wiped right
 * after a successful queue (so Retry would otherwise lose them).
 */
interface RetryOpts {
	text?: string;
	attachments?: Attachment[];
	userAction?: UserAction;
	uiPlaceholderText?: string;
	subject?: ActionSubject;
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
	/** Set on error rows — the original send opts so the Retry button can
	 *  dispatch the same turn again. Undefined for unrecoverable errors
	 *  (e.g. `agent_not_configured`) where Retry would only reproduce
	 *  the same error. */
	retryOpts?: RetryOpts;
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
		case "flipagent_list_listings":
			return "Loading listings";
		case "flipagent_list_sales":
			return "Loading sales";
		case "flipagent_list_offers":
			return "Loading offers";
		case "flipagent_list_payouts":
			return "Loading payouts";
		case "flipagent_list_transactions":
			return "Loading transactions";
		case "flipagent_list_locations":
			return "Loading locations";
		case "flipagent_list_policies":
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
		case "flipagent_list_offers":
			return "ui://flipagent/offers";
		case "flipagent_list_listings":
			return "ui://flipagent/listings";
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
/**
 * Animated placeholder rotation for the empty-hero textarea — types each
 * line out, holds, deletes, types the next. Keeps the empty surface feel
 * alive without overspecifying the agent's surface area. Skipped on the
 * active-chat compose (the static "Reply…" / "Ask the agent…" reads
 * better against an in-flight conversation).
 */
const HERO_PLACEHOLDERS: ReadonlyArray<string> = [
	"Ask agent to find sealed LEGO retired sets under $50 worth flipping",
	"Ask agent to evaluate https://www.ebay.com/itm/377151909505 for resale",
	"Ask agent to list my open Best Offers and recommend responses",
	"Ask agent to find AirPods Pro 2nd-gen under $80 with $40+ margin",
	"Ask agent to compare this month's payouts vs last month",
];

function useTypewriterPlaceholder(
	messages: ReadonlyArray<string>,
	opts: { typeMs?: number; deleteMs?: number; holdMs?: number; pauseMs?: number } = {},
): string {
	const { typeMs = 38, deleteMs = 22, holdMs = 1800, pauseMs = 380 } = opts;
	const [idx, setIdx] = useState(0);
	const [chars, setChars] = useState(0);
	const [phase, setPhase] = useState<"type" | "hold" | "del" | "pause">("type");
	const message = messages[idx % messages.length] ?? "";
	useEffect(() => {
		let t: number;
		if (phase === "type") {
			if (chars < message.length) {
				t = window.setTimeout(() => setChars((c) => c + 1), typeMs);
			} else {
				t = window.setTimeout(() => setPhase("hold"), 0);
			}
		} else if (phase === "hold") {
			t = window.setTimeout(() => setPhase("del"), holdMs);
		} else if (phase === "del") {
			if (chars > 0) {
				t = window.setTimeout(() => setChars((c) => c - 1), deleteMs);
			} else {
				t = window.setTimeout(() => setPhase("pause"), 0);
			}
		} else {
			t = window.setTimeout(() => {
				setIdx((i) => i + 1);
				setPhase("type");
			}, pauseMs);
		}
		return () => window.clearTimeout(t);
	}, [phase, chars, idx, message, typeMs, deleteMs, holdMs, pauseMs]);
	return message.slice(0, chars);
}

const HERO_EXAMPLES: { title: string; prompt: string }[] = [
	{
		title: "Find LEGO retired sets under $50 worth flipping",
		prompt: "Find sealed LEGO retired sets under $50 worth flipping.",
	},
	{
		title: "Is this Canon EF 50mm worth flipping?",
		prompt: "Is https://www.ebay.com/itm/377151909505 worth flipping?",
	},
	{
		title: "Any open Best Offers I should respond to?",
		prompt: "Any pending Best Offers I should accept?",
	},
];

/**
 * Replay a canned `MockScript` through the same `updateAssistant` patch
 * helper the live stream uses. Tool-start events drive the shimmer
 * label; text events append to the bubble; the `done` event freezes
 * the final reply and clears `streaming`. Each event waits its
 * `delayMs` before applying — that's what gives the surface its real
 * pacing instead of a 0ms snap-to-final.
 */
async function playMockScript(
	script: MockScript,
	updateAssistant: (patch: (m: ChatMessage) => ChatMessage) => void,
): Promise<void> {
	let buf = "";
	for (const ev of script.events) {
		if (ev.delayMs) await new Promise<void>((r) => setTimeout(r, ev.delayMs));
		if (ev.kind === "tool_start") {
			const label = toolStatusLabel(ev.name);
			// Tool-start only updates the shimmer label. The iframe
			// (`m.ui`) is intentionally NOT pre-mounted with empty
			// props — that path made the surface race the iframe load,
			// fight an empty-vs-real data ambiguity, and surface a
			// skeleton that sometimes never resolved. Mounting only
			// once tool_end provides real data is simpler and removes
			// the whole class of bug.
			updateAssistant((m) => ({ ...m, toolStatus: label }));
		} else if (ev.kind === "tool_end") {
			// Drop in the real UI hint when the script provides one.
			// Otherwise keep the status label visible until the next
			// event so progress reads as continuous, not flickery —
			// matches live behavior.
			if (ev.ui) {
				const ui = ev.ui;
				updateAssistant((m) => ({ ...m, ui, toolStatus: undefined }));
			}
		} else if (ev.kind === "text") {
			buf += ev.delta;
			updateAssistant((m) => ({ ...m, content: buf, toolStatus: undefined }));
		} else if (ev.kind === "done") {
			updateAssistant((m) => ({
				...m,
				content: ev.reply,
				streaming: false,
				toolStatus: undefined,
			}));
		}
	}
}

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
	model?: AgentModel;
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
	if (opts.model) payload.model = opts.model;
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

/**
 * Stored userMessage for inline-UI clicks is the raw prompt the model
 * sees: `[ui-action] User clicked an inline UI control. Call the
 * \`<name>\` tool with arguments <json>, then summarize…`. On reload
 * we reconstruct the friendly label the live send produced (matches
 * the `uiPlaceholderText` fallback in `onEmbedAction`) so the chat
 * shows "evaluate item · 137283921976" with the arrow prefix instead
 * of the raw sentence. Format must stay in sync with
 * `userActionAsPrompt` in `packages/api/src/services/agent/operations.ts`.
 */
const UI_ACTION_RE =
	/^\[ui-action\] User clicked an inline UI control\. Call the `([^`]+)` tool with arguments (.+), then summarize/;

function parseUiActionPrompt(text: string): { content: string } | null {
	const m = text.match(UI_ACTION_RE);
	if (!m) return null;
	const label = m[1].replace(/^flipagent_/, "").replace(/_/g, " ");
	let suffix = "";
	try {
		const args = JSON.parse(m[2]) as Record<string, unknown>;
		const firstVal = Object.values(args).find((v) => typeof v === "string" || typeof v === "number");
		if (firstVal !== undefined) suffix = ` · ${firstVal}`;
	} catch {
		/* malformed args — fall back to label-only */
	}
	return { content: `${label}${suffix}` };
}

function runsToMessages(runs: AgentRun[]): ChatMessage[] {
	// Server returns newest-first; replay oldest → newest so the chat reads top-down.
	const out: ChatMessage[] = [];
	for (const r of [...runs].reverse()) {
		const t = new Date(r.startedAt).getTime();
		if (r.userMessage) {
			const uiAction = parseUiActionPrompt(r.userMessage);
			if (uiAction) {
				out.push({ role: "user", content: uiAction.content, fromUi: true, at: t });
			} else {
				const { text, attachments } = extractAttachmentMarkers(r.userMessage);
				out.push({
					role: "user",
					content: text,
					...(attachments.length > 0 ? { attachments } : {}),
					at: t,
				});
			}
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
	<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
		<path d="M12 5v14M5 12h14" />
	</svg>
);
const IconMic = (
	<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
		<rect x="9" y="2" width="6" height="12" rx="3" />
		<path d="M5 11a7 7 0 0 0 14 0" />
		<line x1="12" y1="18" x2="12" y2="22" />
	</svg>
);
const IconFile = (
	<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
		<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
		<polyline points="14 2 14 8 20 8" />
	</svg>
);
const IconImage = (
	<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
		<rect x="3" y="3" width="18" height="18" rx="2" />
		<circle cx="9" cy="9" r="1.5" />
		<path d="m21 15-5-5-9 9" />
	</svg>
);
const IconCamera = (
	<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
		<path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3z" />
		<circle cx="12" cy="13" r="3.5" />
	</svg>
);

// Web Speech API isn't part of our lib.dom typings (and the constructor
// is vendor-prefixed: `webkitSpeechRecognition` on Safari). Detect at
// module load so the mic button can be hidden in unsupported browsers.
const SPEECH_SUPPORTED =
	typeof window !== "undefined" &&
	(("SpeechRecognition" in window) || ("webkitSpeechRecognition" in window));

export function PlaygroundAgent<TabId extends string = string>({
	tabsProps: _tabsProps,
	seedPrompt,
	onExamplePrompt,
	mockMode = false,
}: {
	// Accepted for API compatibility with sibling playground panels but
	// unused — the agent surface lives directly on the dash background
	// without an in-card tab switcher (sidebar handles navigation).
	// Optional because the landing-hero mount drops the tab strip and
	// renders the agent surface as the only thing on the page-frame.
	// Generic over TabId so callers using a narrow union (e.g. PgTabId)
	// stay type-safe without the function-parameter contravariance trap.
	tabsProps?: { tabs: ReadonlyArray<ComposeTab<TabId>>; active: TabId; onChange: (next: TabId) => void };
	/**
	 * One-shot prompt fired automatically on mount as if the user typed
	 * it and pressed send. Used by the landing-hero deep-link: a logged-in
	 * visitor clicks an example chip → lands on `/dashboard/?view=agent&seed=…`
	 * → the prompt streams as the first turn so they pick up where the
	 * landing pitched. Empty / undefined keeps the surface idle.
	 */
	seedPrompt?: string;
	/**
	 * Override for the example-chip click. Default behavior (used in the
	 * dashboard surface) is to drop the prompt into the composer and
	 * focus it so the user can edit before sending. The landing hero
	 * supplies its own callback that either navigates a logged-in
	 * visitor straight to the dashboard with a `?seed=` param, or kicks
	 * off the in-place mock simulation for a logged-out one.
	 */
	onExamplePrompt?: (prompt: string) => void;
	/**
	 * Marketing-mode flag. When true the surface short-circuits the live
	 * `/v1/agent/messages` stream — anything the visitor sends is met
	 * with a friendly "Sign in to chat" assistant bubble instead of a
	 * real 401 from the api gate. Phase 2 will replace the stub with a
	 * canned simulation script driven by the same component primitives.
	 */
	mockMode?: boolean;
}) {
	const [messages, setMessages] = useState<ChatMessage[]>([]);
	const [input, setInput] = useState("");
	const [sessionId, setSessionId] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);
	const [model, setModel] = useState<string | null>(null);
	// Per-request model override. Defaults to mini (which Free can use too);
	// switching to gpt-5.5 surfaces a 403 from the api for Free callers,
	// which we map back to a tier-upgrade nudge in the chat error renderer.
	const [selectedModel, setSelectedModel] = useState<AgentModel>("gpt-5.4-mini");
	const [totalCostCents, setTotalCostCents] = useState(0);
	const [pendingAttachments, setPendingAttachments] = useState<Attachment[]>([]);
	const [attachError, setAttachError] = useState<string | null>(null);
	const [unavailable, setUnavailable] = useState<string | null>(null);
	const [sessions, setSessions] = useState<AgentSession[]>([]);
	const [dragOver, setDragOver] = useState(false);
	// Connection status (eBay OAuth + extension bridge) lives in
	// `<ConnectionsProvider>` — shared with Settings + future surfaces.
	const connections = useConnections();

	// Typewriter rotation for the empty-hero textarea placeholder. Runs
	// continuously even when input is non-empty (placeholder is hidden
	// then anyway) — cheap React state churn, no DOM thrash.
	const heroPlaceholder = useTypewriterPlaceholder(HERO_PLACEHOLDERS);

	const fileInputRef = useRef<HTMLInputElement | null>(null);
	const photoInputRef = useRef<HTMLInputElement | null>(null);
	const cameraInputRef = useRef<HTMLInputElement | null>(null);
	const messagesRef = useRef<HTMLDivElement | null>(null);
	const textareaRef = useRef<HTMLTextAreaElement | null>(null);
	const attachWrapRef = useRef<HTMLDivElement | null>(null);
	// any: Web Speech API isn't typed in our lib.dom (and is vendor-prefixed
	// `webkitSpeechRecognition` on Safari).
	const recognitionRef = useRef<any>(null);
	const [attachOpen, setAttachOpen] = useState(false);
	const [voiceListening, setVoiceListening] = useState(false);
	// dragenter / dragleave fire across child element boundaries — using a
	// counter is the standard fix for the resulting flicker.
	const dragDepthRef = useRef(0);


	// Load thread list on mount; refresh on window focus so changes from
	// other tabs / devices propagate. Connection status is owned by the
	// shared `useConnections()` provider — no fetch wiring here.
	useEffect(() => {
		fetchSessions().then(setSessions);
		function onFocus() {
			fetchSessions().then(setSessions);
		}
		window.addEventListener("focus", onFocus);
		return () => window.removeEventListener("focus", onFocus);
	}, []);

	useEffect(() => {
		if (!attachOpen) return;
		function onDocMouseDown(e: MouseEvent) {
			const wrap = attachWrapRef.current;
			if (!wrap) return;
			if (wrap.contains(e.target as Node)) return;
			setAttachOpen(false);
		}
		document.addEventListener("mousedown", onDocMouseDown);
		return () => document.removeEventListener("mousedown", onDocMouseDown);
	}, [attachOpen]);

	useEffect(() => {
		return () => {
			const rec = recognitionRef.current;
			if (rec) {
				try {
					rec.stop();
				} catch {
					/* swallow */
				}
			}
		};
	}, []);

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

	function toggleVoice() {
		if (voiceListening) {
			try {
				recognitionRef.current?.stop();
			} catch {
				/* swallow */
			}
			return;
		}
		if (!SPEECH_SUPPORTED) {
			setAttachError("Voice input isn't supported in this browser.");
			return;
		}
		// any: vendor-prefixed Web Speech constructor not in our lib.dom.
		const SR: any =
			(window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
		if (!SR) {
			setAttachError("Voice input isn't supported in this browser.");
			return;
		}
		const rec = new SR();
		rec.continuous = true;
		rec.interimResults = false;
		rec.lang = navigator.language || "en-US";
		rec.onstart = () => setVoiceListening(true);
		rec.onresult = (e: any) => {
			let final = "";
			for (let i = e.resultIndex; i < e.results.length; i++) {
				const r = e.results[i];
				if (r.isFinal) final += r[0].transcript;
			}
			if (final) {
				setInput((prev) => {
					const sep = prev && !/\s$/.test(prev) ? " " : "";
					return (prev + sep + final.trim()).slice(0, MAX_INPUT_LEN);
				});
			}
		};
		rec.onerror = () => setVoiceListening(false);
		rec.onend = () => {
			setVoiceListening(false);
			recognitionRef.current = null;
		};
		recognitionRef.current = rec;
		try {
			rec.start();
		} catch {
			setVoiceListening(false);
		}
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
		opts: {
			userAction?: UserAction;
			uiPlaceholderText?: string;
			subject?: ActionSubject;
			text?: string;
			/** Override the live `pendingAttachments` array — used by Retry,
			 *  which holds a snapshot from the original turn (the live
			 *  array was wiped right after the first send). */
			attachments?: Attachment[];
		} = {},
	) {
		const trimmed = (opts.text ?? input).trim();
		const effectiveAttachments = opts.attachments ?? pendingAttachments;
		const hasMessage = trimmed.length > 0;
		const hasAttachments = effectiveAttachments.length > 0;
		const hasAction = !!opts.userAction;
		if ((!hasMessage && !hasAttachments && !hasAction) || busy) return;

		const attachmentsForTurn = hasAttachments ? effectiveAttachments : [];
		// Snapshot of what we're sending — attached to error messages so
		// the Retry button can re-dispatch the same turn even after the
		// composer state (input / pendingAttachments) was cleared.
		const retryOpts: RetryOpts = {
			text: trimmed,
			...(attachmentsForTurn.length > 0 ? { attachments: attachmentsForTurn } : {}),
			...(opts.userAction ? { userAction: opts.userAction } : {}),
			...(opts.uiPlaceholderText ? { uiPlaceholderText: opts.uiPlaceholderText } : {}),
			...(opts.subject ? { subject: opts.subject } : {}),
		};
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

		// Marketing-mode (logged-out landing hero) replays a canned script
		// through the same updateAssistant pipeline the live stream uses,
		// so the surface looks indistinguishable from production. Falls
		// back to a sign-in CTA when the input doesn't match any chip.
		if (mockMode) {
			try {
				const script = findMockScript(trimmed);
				if (script) {
					await playMockScript(script, updateAssistant);
				} else {
					updateAssistant((m) => ({
						...m,
						content:
							"Sign in or [grab a free key](/signup/) to send your own request.",
						streaming: false,
						toolStatus: undefined,
					}));
				}
			} finally {
				setBusy(false);
			}
			return;
		}

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
				model: selectedModel,
				...(opts.userAction ? { userAction: opts.userAction } : {}),
			})) {
				if (event.type === "tool_call_start") {
					const label = toolStatusLabel(event.name);
					const uri = predictUiResource(event.name);
					updateAssistant((m) => {
						// Mount the empty-props skeleton ONLY when there isn't
						// already a hydrated panel of the same kind sitting in
						// the bubble. Without this guard, an agent that fires
						// back-to-back tool calls in one turn (search → refine
						// → search again) makes the previous results blink
						// out into a skeleton between each call, which reads
						// as "results keep shuffling". Keeping the prior
						// rendered panel visible until the next `tool_call_end`
						// drops the new props in is far calmer.
						const sameUri = m.ui?.resourceUri === uri;
						const hasHydrated =
							sameUri && !!m.ui?.props && Object.keys(m.ui.props as object).length > 0;
						const shouldMountSkeleton = !!uri && !hasHydrated;
						return {
							...m,
							toolStatus: label,
							...(shouldMountSkeleton ? { ui: { resourceUri: uri, props: {} } } : {}),
						};
					});
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
					// `agent_not_configured` is a config error — retrying
					// won't help. Everything else (upstream_error,
					// stream_error, http_*) is worth a retry.
					const recoverable = event.code !== "agent_not_configured";
					setMessages((prev) => {
						const without = prev.filter((m) => m.at !== assistantAt);
						return [
							...without,
							{
								role: "error",
								content: event.message,
								at: Date.now(),
								...(recoverable ? { retryOpts } : {}),
							},
						];
					});
				}
			}
			if (!sawDone) {
				setMessages((prev) => {
					const without = prev.filter((m) => m.at !== assistantAt);
					return [
						...without,
						{
							role: "error",
							content: "Stream ended unexpectedly.",
							at: Date.now(),
							retryOpts,
						},
					];
				});
			}
		} catch (err) {
			// Network failure (fetch threw before any stream event). Most
			// commonly: server briefly down, tunnel hiccup, captive portal.
			// Surface a friendlier message than the raw `Failed to fetch`
			// and keep the retry path open.
			const raw = err instanceof Error ? err.message : String(err);
			const friendly = /failed to fetch|networkerror|err_failed|err_internet/i.test(raw)
				? "Network error — couldn't reach the api. Check your connection and retry."
				: raw;
			setMessages((prev) => {
				const without = prev.filter((m) => m.at !== assistantAt);
				return [...without, { role: "error", content: friendly, at: Date.now(), retryOpts }];
			});
		} finally {
			setBusy(false);
		}
	}

	const sendRef = useRef(send);
	sendRef.current = send;

	// One-shot seed prompt: fire after first paint so the surface mounts
	// idle (composer renders, ConnectionsProvider settles), then auto-send
	// the prompt as if the user had typed it. The ref guard makes this
	// strictly mount-once even under React 18 strict-mode double-invoke
	// or seedPrompt churning.
	const didSeedRef = useRef(false);
	useEffect(() => {
		const seed = seedPrompt?.trim();
		if (!seed || didSeedRef.current) return;
		didSeedRef.current = true;
		// Defer one frame so any in-flight session-list fetch has a chance
		// to settle before the user turn pushes onto the messages array.
		requestAnimationFrame(() => {
			void sendRef.current({ text: seed });
		});
	}, [seedPrompt]);

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
					<input
						ref={photoInputRef}
						type="file"
						multiple
						accept="image/*"
						className="agent-file-hidden"
						onChange={onPickFiles}
					/>
					<input
						ref={cameraInputRef}
						type="file"
						accept="image/*"
						capture="environment"
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
									placeholder={heroPlaceholder}
									rows={1}
									disabled={busy}
									className="agent-hero-textarea"
								/>
								<div className="agent-hero-actions">
									<div className="agent-hero-actions-left">
										<AttachMenu
											btnClassName="agent-hero-attach"
											open={attachOpen}
											onToggle={() => setAttachOpen((v) => !v)}
											onClose={() => setAttachOpen(false)}
											onUploadFile={() => fileInputRef.current?.click()}
											onUploadPhoto={() => photoInputRef.current?.click()}
											onTakePhoto={() => cameraInputRef.current?.click()}
											wrapRef={attachWrapRef}
										/>
										<ConnChip />
									</div>
									<div className="agent-hero-actions-right">
										<ModelPicker value={selectedModel} onChange={setSelectedModel} />
										{SPEECH_SUPPORTED && (
											<button
												type="button"
												className={`agent-voice-hero${voiceListening ? " agent-voice-active" : ""}`}
												onClick={toggleVoice}
												aria-label={voiceListening ? "Stop voice input" : "Start voice input"}
												aria-pressed={voiceListening}
												title={voiceListening ? "Stop voice input" : "Voice input"}
											>
												{IconMic}
											</button>
										)}
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
											if (onExamplePrompt) {
												onExamplePrompt(ex.prompt);
												return;
											}
											// Marketing mode (logged-out hero): fire send
											// directly so the canned simulation plays
											// immediately on click instead of leaving
											// the user staring at a filled input wondering
											// what to do next. Dashboard mount has neither
											// `mockMode` nor `onExamplePrompt`, so it keeps
											// the original "fill + focus" behavior so the
											// user can edit the prompt before sending.
											if (mockMode) {
												void send({ text: ex.prompt });
												return;
											}
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
								if (m.role === "error") {
									return (
										<div key={`${m.at}-${i}`} className="agent-msg agent-msg-error">
											<svg
												className="agent-msg-error-icon"
												width="13"
												height="13"
												viewBox="0 0 24 24"
												fill="none"
												stroke="currentColor"
												strokeWidth="2"
												strokeLinecap="round"
												strokeLinejoin="round"
												aria-hidden="true"
											>
												<circle cx="12" cy="12" r="10" />
												<path d="M12 8v4M12 16h.01" />
											</svg>
											<div className="agent-msg-error-body">
												<div className="agent-msg-error-text">{m.content}</div>
												{m.retryOpts && (
													<button
														type="button"
														className="agent-msg-error-retry"
														onClick={() => {
															// Drop the error bubble + the stranded user
															// message that triggered it so the retry
															// re-creates them cleanly.
															setMessages((prev) => prev.filter((x) => x.at !== m.at && x.at !== m.at - 1));
															void send(m.retryOpts ?? {});
														}}
														disabled={busy}
													>
														Retry
													</button>
												)}
											</div>
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
									{m.role === "assistant" && m.ui &&
									(hasInlinePanel(m.ui.resourceUri) ? (
										<MessageUiPanel ui={m.ui} />
									) : (
										<ChatIframe ui={m.ui} />
									))}
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
									{m.role !== "assistant" && m.ui &&
									(hasInlinePanel(m.ui.resourceUri) ? (
										<MessageUiPanel ui={m.ui} />
									) : (
										<ChatIframe ui={m.ui} />
									))}
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
							<textarea
								ref={textareaRef}
								className="agent-input-textarea"
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
								rows={2}
								disabled={busy}
							/>
							<div className="agent-input-actions">
								<AttachMenu
									btnClassName="agent-input-attach"
									open={attachOpen}
									onToggle={() => setAttachOpen((v) => !v)}
									onClose={() => setAttachOpen(false)}
									onUploadFile={() => fileInputRef.current?.click()}
									onUploadPhoto={() => photoInputRef.current?.click()}
									onTakePhoto={() => cameraInputRef.current?.click()}
									wrapRef={attachWrapRef}
								/>
								<div className="agent-input-actions-right">
									<ModelPicker value={selectedModel} onChange={setSelectedModel} />
									{SPEECH_SUPPORTED && (
										<button
											type="button"
											className={`agent-input-voice${voiceListening ? " agent-voice-active" : ""}`}
											onClick={toggleVoice}
											aria-label={voiceListening ? "Stop voice input" : "Start voice input"}
											aria-pressed={voiceListening}
											title={voiceListening ? "Stop voice input" : "Voice input"}
										>
											{IconMic}
										</button>
									)}
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
						</div>
						{/* Mock mode (logged-out landing hero): keep the example
						    chips visible below the composer so the visitor can
						    cycle through every canned simulation without
						    refreshing or hunting for them. Dashboard mount
						    (mockMode=false) renders them only on the empty
						    hero state — once a real conversation starts they'd
						    just be noise. */}
						{mockMode && (
							<div className="agent-compose-examples">
								{HERO_EXAMPLES.map((ex) => (
									<button
										key={ex.title}
										type="button"
										className="agent-hero-example"
										disabled={busy}
										onClick={() => {
											if (onExamplePrompt) {
												onExamplePrompt(ex.prompt);
												return;
											}
											void send({ text: ex.prompt });
										}}
									>
										{ex.title}
									</button>
								))}
							</div>
						)}
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

	// Latest props in a ref so the message-listener closure can read them
	// without re-attaching on every change. The ref-write happens during
	// render so the listener (running on the next microtask) always sees
	// the freshest props — no `[ui.props]` dependency on the listener
	// effect, no cleanup-then-reattach gap where an `embed-ready` could
	// land on no listener and silently drop.
	const propsRef = useRef(ui.props);
	propsRef.current = ui.props;

	useEffect(() => {
		function onMessage(e: MessageEvent) {
			const m = e.data as { type?: string; source?: string; [k: string]: unknown } | null;
			if (!m || typeof m !== "object" || typeof m.type !== "string") return;
			// Filter by the embed's own source field instead of comparing
			// `e.source` to `ref.current?.contentWindow`. The latter is
			// brittle: in dev with HMR the iframe occasionally posts
			// before React's ref settles, and the message gets rejected
			// silently — no init, no resize, stuck skeleton + scrollbar.
			if (m.source !== "flipagent-embed") return;
			if (m.type === "embed-ready") {
				readyRef.current = true;
				ref.current?.contentWindow?.postMessage(
					{ type: "embed-init", data: propsRef.current ?? {}, source: "flipagent-host" },
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
	}, []);

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
 * "+" button + dropdown menu (Upload file / Upload photo / Take photo)
 * that replaces the old single-shot "Attach" button. Each menu item
 * triggers a hidden `<input type="file">` configured for that source —
 * `Upload file` is unrestricted, `Upload photo` is `accept="image/*"`,
 * `Take photo` adds `capture="environment"` so mobile browsers open
 * the camera. The menu pops upward (`bottom: 100%`) since it sits at
 * the bottom of the composer card.
 */
function AttachMenu({
	btnClassName,
	open,
	onToggle,
	onClose,
	onUploadFile,
	onUploadPhoto,
	onTakePhoto,
	wrapRef,
}: {
	btnClassName: string;
	open: boolean;
	onToggle: () => void;
	onClose: () => void;
	onUploadFile: () => void;
	onUploadPhoto: () => void;
	onTakePhoto: () => void;
	wrapRef: React.RefObject<HTMLDivElement | null>;
}) {
	return (
		<div className="agent-attach-wrap" ref={wrapRef}>
			<button
				type="button"
				className={btnClassName}
				onClick={onToggle}
				aria-expanded={open}
				aria-haspopup="menu"
				aria-label="Add attachment"
				title="Add attachment"
			>
				{IconPlus}
			</button>
			{open && (
				<div className="agent-attach-menu" role="menu">
					<button
						type="button"
						role="menuitem"
						className="agent-attach-menu-item"
						onClick={() => {
							onUploadFile();
							onClose();
						}}
					>
						<span className="agent-attach-menu-icon" aria-hidden="true">
							{IconFile}
						</span>
						Upload file
					</button>
					<button
						type="button"
						role="menuitem"
						className="agent-attach-menu-item"
						onClick={() => {
							onUploadPhoto();
							onClose();
						}}
					>
						<span className="agent-attach-menu-icon" aria-hidden="true">
							{IconImage}
						</span>
						Upload photo
					</button>
					<button
						type="button"
						role="menuitem"
						className="agent-attach-menu-item"
						onClick={() => {
							onTakePhoto();
							onClose();
						}}
					>
						<span className="agent-attach-menu-icon" aria-hidden="true">
							{IconCamera}
						</span>
						Take photo
					</button>
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
