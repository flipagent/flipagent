/**
 * Content script — injected into ebay.com tabs. *Stateless observer*: runs
 * on every page load, reads chrome.storage for the current in-flight job,
 * and reacts based on which page we landed on. The user does every click
 * themselves — flipagent only validates, annotates, and records.
 *
 * Why no auto-click: eBay's Akamai layer flags synthetic clicks (no
 * mousemove, instant timing, no realistic event sequence) as bot traffic
 * and forces step-up auth. Real human clicks are indistinguishable from
 * any other normal use, so the buy flow stays in the user's hands. The
 * agent's value is BEFORE the click (find item, evaluate, queue) and
 * AFTER (record, reconcile, P&L) — the click itself is a 1-second human
 * commit moment, not the work.
 *
 * State machine (driven by URL):
 *   /itm/{id}              → show "ready" banner; validate price ≤ cap
 *   /chk/ or /vod/ checkout → show "review" banner; validate total ≤ cap
 *   /vod/ post-purchase     → extract eBay order id; report `completed`
 *
 * Cap violations show a red banner and report `failed` (the user can
 * still proceed manually — we don't block clicks — but the order is
 * marked failed so the agent doesn't double-buy).
 */

import {
	type EbaySearchParams,
	parseEbayDetailHtml,
	parseEbaySearchHtml,
	parseResultCount,
} from "@flipagent/ebay-scraper";
import type { PurchaseOrderStatus } from "@flipagent/types";

interface InFlightSnapshot {
	id: string;
	marketplace: string;
	itemId?: string;
	maxPriceCents?: number | null;
	status: string;
	startedAt: string;
}

interface ReportBody {
	jobId: string;
	outcome: PurchaseOrderStatus;
	totalCents?: number;
	ebayOrderId?: string;
	receiptUrl?: string;
	failureReason?: string;
	result?: Record<string, unknown>;
}

const BANNER_ID = "flipagent-banner";

// Generic browser-primitive handler — synchronous DOM query that the
// background SW dispatches to the active tab. Lets the agent (or
// `/v1/browser/query`) probe arbitrary pages without shipping
// task-specific content-script code per site.
chrome.runtime.onMessage.addListener((msg, _sender, send) => {
	if (msg?.type === "flipagent:browser-op") {
		try {
			const result = runBrowserOpInPage((msg.args ?? {}) as Record<string, unknown>);
			send(result);
		} catch (err) {
			send({ error: (err as Error).message });
		}
		return true;
	}
	// `ebay_query` extraction. The SW has loaded an eBay page (search /
	// detail / sold) into a hidden tab and is asking us to extract the
	// structured payload while we have full DOM access. Parsers are pure
	// — they take a `domFactory` so we hand in `DOMParser` (always
	// available in content-script context) and the page's own document.
	if (msg?.type === "flipagent:ebay-extract") {
		try {
			const result = runEbayExtractInPage(msg as EbayExtractMessage);
			send(result);
		} catch (err) {
			send({ error: (err as Error).message });
		}
		return true;
	}
	return false;
});

interface EbayExtractMessage {
	type: "flipagent:ebay-extract";
	kind: "search" | "detail" | "sold";
	params?: EbaySearchParams;
}

function runEbayExtractInPage(msg: EbayExtractMessage): Record<string, unknown> {
	const html = document.documentElement.outerHTML;
	const domFactory = (h: string) => new DOMParser().parseFromString(h, "text/html");
	if (msg.kind === "search" || msg.kind === "sold") {
		if (!msg.params) return { error: "missing_params" };
		const items = parseEbaySearchHtml(html, msg.params, domFactory);
		const total = parseResultCount(document) ?? items.length;
		return msg.kind === "sold" ? { itemSales: items, total } : { itemSummaries: items, total };
	}
	if (msg.kind === "detail") {
		const detail = parseEbayDetailHtml(html, location.href, domFactory);
		return detail as unknown as Record<string, unknown>;
	}
	return { error: `unknown_kind: ${(msg as { kind?: string }).kind}` };
}

interface BrowserOpArgs {
	metadata?: Record<string, unknown>;
}

interface QueryMatch {
	tag: string;
	id: string | null;
	classes: string[];
	text: string | null;
	html: string | null;
}

function runBrowserOpInPage(args: BrowserOpArgs): Record<string, unknown> {
	const meta = (args.metadata ?? {}) as Record<string, unknown>;
	const op = String(meta.op ?? "");
	if (op === "query") {
		const selector = String(meta.selector ?? "");
		const limit = Number(meta.limit ?? 10);
		const includeHtml = meta.includeHtml !== false;
		const includeText = meta.includeText !== false;
		const truncateAt = Number(meta.truncateAt ?? 2000);
		if (!selector) return { error: "missing_selector" };
		let matched: NodeListOf<Element>;
		try {
			matched = document.querySelectorAll(selector);
		} catch (err) {
			return { error: `selector_invalid: ${(err as Error).message}` };
		}
		const matches: QueryMatch[] = [];
		const cap = (s: string) => (s.length > truncateAt ? `${s.slice(0, truncateAt)}…` : s);
		for (const el of Array.from(matched).slice(0, limit)) {
			matches.push({
				tag: el.tagName.toLowerCase(),
				id: el.id || null,
				classes: Array.from(el.classList),
				text: includeText ? cap((el.textContent ?? "").replace(/\s+/g, " ").trim()) : null,
				html: includeHtml ? cap(el.outerHTML) : null,
			});
		}
		return {
			url: location.href,
			title: document.title,
			matchCount: matched.length,
			matches,
		};
	}
	return { error: `unsupported_op: ${op}` };
}

void main();

async function main(): Promise<void> {
	const stored = await chrome.storage.local.get(["flipagent_in_flight"]);
	const job = stored.flipagent_in_flight as InFlightSnapshot | undefined;

	// Per-service dispatch. Each service has its own observer flow.
	// Buyer-state probe (eBay-specific) only runs on ebay.com.
	if (location.hostname.endsWith("ebay.com")) {
		if (job?.marketplace === "ebay") handleEbayJob(job);
		reportBuyerState();
	} else if (location.hostname.endsWith("planetexpress.com")) {
		if (job?.marketplace === "planetexpress") handlePlanetExpressJob(job);
	}
}

function handleEbayJob(job: InFlightSnapshot): void {
	if (job.itemId && isItemPage(job.itemId)) {
		handleItemPage(job);
	} else if (isCheckoutPage()) {
		handleCheckoutPage(job);
	} else if (isPostPurchasePage()) {
		void handlePostPurchase(job);
	}
}

/**
 * Planet Express handler. Pulls the user's package inbox from
 * `/app/inbox` and reports the list back via the bridge result.
 *
 * Selectors are best-effort and the most likely things to need patching
 * as PE rotates their app. We try multiple candidates per field and
 * fall back to text-based heuristics. If nothing matches the page
 * shape we expect, we report `failed` with a `selectors_unmatched`
 * reason so the agent can surface the breakage cleanly.
 */
function handlePlanetExpressJob(job: InFlightSnapshot): void {
	if (location.pathname.includes("/login") || location.pathname.includes("/signin")) {
		showBanner({
			tone: "error",
			title: "Sign in to Planet Express",
			body: "flipagent can't read your inbox until you complete sign-in. We'll retry on the next page load.",
		});
		void report({
			jobId: job.id,
			outcome: "failed" as PurchaseOrderStatus,
			failureReason: "planetexpress_signed_out",
		});
		return;
	}
	// PE's client app lives under /client/* — dashboard, packages, etc.
	if (!location.pathname.startsWith("/client")) {
		// Wrong page — wait for the next navigation.
		return;
	}
	// Wait a brief tick for SPA hydration, then scrape.
	void scrapeAndReport(job);
}

async function scrapeAndReport(job: InFlightSnapshot): Promise<void> {
	// Give SPA frameworks a moment to render.
	await new Promise((r) => setTimeout(r, 1500));
	const packages = scrapePlanetExpressPackages();
	const diagnostics = collectDiagnostics();

	// Distinguish empty inbox from broken selectors: presence of the
	// expected table header is the signal we found the right page.
	// Table exists + zero rows = user has 0 packages (not a parse failure).
	const tableFound = !!document.querySelector("table.table > thead.grid-row-columns");

	if (packages.length === 0 && !tableFound) {
		showBanner({
			tone: "error",
			title: "flipagent couldn't read your inbox",
			body: "DOM selectors didn't match. Diagnostic dump posted — agent can tune selectors from it.",
		});
		await report({
			jobId: job.id,
			outcome: "completed" as PurchaseOrderStatus,
			result: {
				packages: [],
				diagnostic: { reason: "selectors_unmatched", ...diagnostics },
			},
		});
		return;
	}
	showBanner({
		tone: "success",
		title:
			packages.length === 0
				? "flipagent · inbox is empty"
				: `flipagent read ${packages.length} package${packages.length === 1 ? "" : "s"}`,
		body: packages.length === 0 ? "0 packages on hand." : "Posted to your flipagent inbox cache.",
	});
	await report({
		jobId: job.id,
		outcome: "completed" as PurchaseOrderStatus,
		result: { packages, diagnostic: diagnostics },
	});
}

/**
 * Diagnostic dump — captures the page shape so the agent can tune
 * selectors offline. Cap each text field so the bridge result POST
 * stays under reasonable size limits.
 */
function collectDiagnostics(): Record<string, unknown> {
	const cap = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}…` : s);
	const tables = Array.from(document.querySelectorAll("table"))
		.slice(0, 3)
		.map((t, i) => ({
			idx: i,
			classes: t.className,
			rowCount: t.querySelectorAll("tbody tr").length,
			firstRowText: cap((t.querySelector("tbody tr")?.textContent ?? "").replace(/\s+/g, " ").trim(), 300),
			headerText: cap((t.querySelector("thead")?.textContent ?? "").replace(/\s+/g, " ").trim(), 200),
		}));
	const candidateRows = Array.from(document.querySelectorAll("tbody tr"))
		.slice(0, 5)
		.map((r) => cap((r.textContent ?? "").replace(/\s+/g, " ").trim(), 240));
	const dataTestIds = Array.from(
		new Set(
			Array.from(document.querySelectorAll("[data-testid]"))
				.map((el) => el.getAttribute("data-testid"))
				.filter((v): v is string => !!v && /package|tracking|inbox|item|row/i.test(v)),
		),
	).slice(0, 20);
	return {
		url: location.href,
		title: cap(document.title, 200),
		tables,
		candidateRows,
		dataTestIds,
	};
}

interface PlanetExpressPackage {
	tracking?: string;
	sender?: string;
	receivedAt?: string;
	weightG?: number;
	status?: string;
	dimensions?: string;
	photoUrl?: string;
	requests?: string;
	actions?: string[];
	dom: string;
}

/**
 * Planet Express "Packages in Account" page (`/client/packet/`):
 *   <table class="table">
 *     <thead class="grid-row-columns"><tr class="grid-columns">…</tr></thead>
 *     <tbody>
 *       <tr> <td class="grid-col-photo">…</td>
 *            <td class="grid-col-packet_label">…</td>
 *            <td class="grid-col-requests">…</td>
 *            <td class="grid-col-actions">…</td> </tr>
 *       …
 *     </tbody>
 *   </table>
 * Empty state: a single <tr> with <td colspan="42"> "We look forward to
 * receiving your packages." We detect by absence of `td.grid-col-packet_label`.
 */
function scrapePlanetExpressPackages(): PlanetExpressPackage[] {
	const rows = Array.from(document.querySelectorAll<HTMLTableRowElement>("table.table > tbody > tr"));
	const real = rows.filter((tr) => tr.querySelector("td.grid-col-packet_label"));
	return real.map((tr) => extractPackage(tr));
}

function extractPackage(row: Element): PlanetExpressPackage {
	const txt = (row.textContent ?? "").replace(/\s+/g, " ").trim();
	const photoEl = row.querySelector<HTMLImageElement>("td.grid-col-photo img");
	const labelCell = row.querySelector<HTMLElement>("td.grid-col-packet_label");
	const requestsCell = row.querySelector<HTMLElement>("td.grid-col-requests");
	const actionsCell = row.querySelector<HTMLElement>("td.grid-col-actions");
	const labelText = (labelCell?.textContent ?? "").replace(/\s+/g, " ").trim();
	const requestsText = (requestsCell?.textContent ?? "").replace(/\s+/g, " ").trim();
	const tracking = labelText.match(/\b([A-Z0-9]{10,30})\b/)?.[1];
	const weightMatch = labelText.match(/(\d+(?:\.\d+)?)\s*(g|kg|lb|oz)\b/i);
	const weightG = weightMatch ? toGrams(Number.parseFloat(weightMatch[1] ?? ""), weightMatch[2] ?? "") : undefined;
	const dateMatch = labelText.match(/\b(\d{4}-\d{2}-\d{2}|\w{3}\s+\d{1,2},?\s+\d{4})\b/);
	const senderMatch = labelText.match(/(?:from|sender|by)[:\s]+([^,\n]{2,80})/i);
	const dimMatch = labelText.match(/\d+\s*[x×]\s*\d+\s*[x×]\s*\d+\s*(cm|in)?/i);
	const actions = actionsCell
		? Array.from(actionsCell.querySelectorAll<HTMLElement>("a, button"))
				.map((el) => (el.textContent ?? "").replace(/\s+/g, " ").trim())
				.filter((s) => s.length > 0)
		: [];
	return {
		tracking,
		sender: senderMatch?.[1]?.trim(),
		receivedAt: dateMatch?.[1],
		weightG,
		status: txt.match(/(received|processing|ready|shipped|in transit|on hand)/i)?.[1]?.toLowerCase(),
		dimensions: dimMatch?.[0],
		photoUrl: photoEl?.src,
		requests: requestsText || undefined,
		actions: actions.length > 0 ? actions : undefined,
		dom: labelText.slice(0, 240),
	};
}

function toGrams(value: number, unit: string): number | undefined {
	if (!Number.isFinite(value)) return undefined;
	switch (unit.toLowerCase()) {
		case "g":
			return Math.round(value);
		case "kg":
			return Math.round(value * 1000);
		case "lb":
			return Math.round(value * 453.592);
		case "oz":
			return Math.round(value * 28.3495);
		default:
			return undefined;
	}
}

/* -------------------------------- pages -------------------------------- */

function isItemPage(itemId: string): boolean {
	return location.pathname.includes(`/itm/${itemId}`);
}

function isCheckoutPage(): boolean {
	return /\/(chk|gxo)\//.test(location.pathname);
}

function isPostPurchasePage(): boolean {
	// `/vod/finishingTouches` or `/vod/orderConfirmation` are common; eBay
	// rotates exact paths so we match any /vod/ URL containing 'order' or
	// 'thank' or 'confirm'.
	if (!/\/vod\//.test(location.pathname)) return false;
	return /thank|confirm|complete|finishing|order/i.test(location.pathname + location.search);
}

function handleItemPage(job: InFlightSnapshot): void {
	const priceCents = readPriceCents();
	if (job.maxPriceCents != null && priceCents != null && priceCents > job.maxPriceCents) {
		showBanner({
			tone: "error",
			title: "Price exceeds your cap",
			body: `Listing is ${formatCents(priceCents)}; cap was ${formatCents(job.maxPriceCents)}. Don't proceed.`,
		});
		void report({
			jobId: job.id,
			outcome: "failed" as PurchaseOrderStatus,
			totalCents: priceCents,
			failureReason: `price_above_cap: page=${priceCents}c cap=${job.maxPriceCents}c`,
		});
		return;
	}
	showBanner({
		tone: "info",
		title: "flipagent is monitoring this listing",
		body:
			priceCents != null
				? `Price ${formatCents(priceCents)}${job.maxPriceCents != null ? ` (cap ${formatCents(job.maxPriceCents)})` : ""}. Click Buy It Now when you're ready.`
				: `Click Buy It Now when you're ready.`,
	});
}

function handleCheckoutPage(job: InFlightSnapshot): void {
	const totalCents = readPriceCents();
	if (job.maxPriceCents != null && totalCents != null && totalCents > job.maxPriceCents) {
		showBanner({
			tone: "error",
			title: "Total exceeds your cap",
			body: `eBay shows ${formatCents(totalCents)} (incl. shipping/tax); cap was ${formatCents(job.maxPriceCents)}. Don't confirm.`,
		});
		void report({
			jobId: job.id,
			outcome: "failed" as PurchaseOrderStatus,
			totalCents,
			failureReason: `total_above_cap: review=${totalCents}c cap=${job.maxPriceCents}c`,
		});
		return;
	}
	showBanner({
		tone: "info",
		title: "flipagent is recording this order",
		body:
			totalCents != null
				? `Total ${formatCents(totalCents)}. Click "Confirm and pay" when ready — we'll capture the order id once eBay confirms.`
				: `Click "Confirm and pay" when ready.`,
	});
	// Move backend status to "placing" — user is on the review page,
	// almost certain to click confirm (or cancel).
	void report({
		jobId: job.id,
		outcome: "placing" as PurchaseOrderStatus,
		totalCents: totalCents ?? undefined,
	});
}

async function handlePostPurchase(job: InFlightSnapshot): Promise<void> {
	const orderId = extractEbayOrderId();
	const totalCents = readPriceCents();
	showBanner({
		tone: "success",
		title: "Order recorded",
		body: orderId ? `eBay order ${orderId}.` : `Captured by flipagent.`,
	});
	await report({
		jobId: job.id,
		outcome: "completed" as PurchaseOrderStatus,
		totalCents: totalCents ?? undefined,
		ebayOrderId: orderId ?? undefined,
		receiptUrl: location.href,
	});
}

async function report(body: ReportBody): Promise<void> {
	await chrome.runtime.sendMessage({ type: "flipagent:order-progress", body }).catch(() => {});
}

/* ------------------------------ DOM helpers ------------------------------ */

const PRICE_SELECTORS = [
	'[data-testid="x-price-primary"] span',
	".x-price-primary > span",
	'[itemprop="price"]',
	"#prcIsum",
	"#mm-saleDscPrc",
	".display-price",
];

function readPriceCents(): number | null {
	for (const sel of PRICE_SELECTORS) {
		const el = document.querySelector(sel);
		const txt = el?.textContent?.trim();
		if (!txt) continue;
		const cents = parsePriceText(txt);
		if (cents != null) return cents;
	}
	return null;
}

function parsePriceText(text: string): number | null {
	const cleaned = text.replace(/[^\d.,]/g, "").replace(/(\d),(\d{3})/g, "$1$2");
	const n = Number.parseFloat(cleaned.replace(",", "."));
	return Number.isFinite(n) ? Math.round(n * 100) : null;
}

function extractEbayOrderId(): string | undefined {
	const params = new URLSearchParams(location.search);
	for (const k of ["orderId", "orderIds", "purchaseOrderId"]) {
		const v = params.get(k);
		if (v) return v;
	}
	const m = location.pathname.match(/\/(?:vod|ord|orderconfirmation)\/([A-Za-z0-9-]+)/);
	return m?.[1];
}

function formatCents(c: number | null | undefined): string {
	if (c == null) return "—";
	return `$${(c / 100).toFixed(2)}`;
}

/* ------------------------------ banner UI ------------------------------ */

interface BannerInput {
	tone: "info" | "error" | "success";
	title: string;
	body: string;
}

function showBanner(input: BannerInput): void {
	// Idempotent: replace if banner already present (we re-fire on every load).
	document.getElementById(BANNER_ID)?.remove();

	const colors = {
		info: { bg: "#0064d2", fg: "#fff" },
		error: { bg: "#cf222e", fg: "#fff" },
		success: { bg: "#2ea44f", fg: "#fff" },
	}[input.tone];

	const banner = document.createElement("div");
	banner.id = BANNER_ID;
	banner.style.cssText = [
		"position:fixed",
		"top:12px",
		"right:12px",
		"z-index:2147483647",
		"max-width:340px",
		`background:${colors.bg}`,
		`color:${colors.fg}`,
		"padding:12px 14px",
		"border-radius:10px",
		"box-shadow:0 8px 24px rgba(0,0,0,0.25)",
		"font-family:system-ui,-apple-system,Segoe UI,sans-serif",
		"font-size:13px",
		"line-height:1.45",
	].join(";");

	const titleEl = document.createElement("div");
	titleEl.textContent = input.title;
	titleEl.style.cssText = "font-weight:600;font-size:13px;letter-spacing:0.02em;margin-bottom:4px";

	const bodyEl = document.createElement("div");
	bodyEl.textContent = input.body;
	bodyEl.style.cssText = "font-size:12px;opacity:0.9";

	const close = document.createElement("button");
	close.textContent = "×";
	close.setAttribute("aria-label", "dismiss");
	close.style.cssText = [
		"position:absolute",
		"top:6px",
		"right:8px",
		"background:transparent",
		"border:0",
		`color:${colors.fg}`,
		"font-size:16px",
		"cursor:pointer",
		"opacity:0.7",
		"line-height:1",
	].join(";");
	close.addEventListener("click", () => banner.remove());

	banner.appendChild(close);
	banner.appendChild(titleEl);
	banner.appendChild(bodyEl);
	document.body.appendChild(banner);
}

/* ----------------------- buyer-state reporter ----------------------- */
/* Same DOM-based detection as before — fires on every ebay.com page load.
 * Reports to background, which forwards to /v1/bridge/login-status. */

function reportBuyerState(): void {
	const probe = detectBuyerStateFromDom();
	chrome.runtime
		.sendMessage({
			type: "flipagent:buyer-state",
			loggedIn: probe.loggedIn,
			ebayUserName: probe.ebayUserName,
		})
		.catch(() => {});
}

interface DomBuyerState {
	loggedIn: boolean;
	ebayUserName?: string;
}

function detectBuyerStateFromDom(): DomBuyerState {
	const loggedInIndicators = [
		'a[href*="/myb/"]',
		'a[href*="/mys/"]',
		'[data-testid="header-user-greeting"]',
		".gh-eb-Li-a",
	];
	for (const sel of loggedInIndicators) {
		const el = document.querySelector(sel);
		if (el) return { loggedIn: true, ebayUserName: scrapeUsername(el) };
	}
	const signinLink = document.querySelector('a[href*="signin.ebay.com"], a[href*="/signin"]');
	if (signinLink) return { loggedIn: false };
	return { loggedIn: false };
}

function scrapeUsername(anchor: Element): string | undefined {
	const txt = (anchor.textContent ?? "").trim();
	const greet = txt.match(/Hi[,!\s]+([A-Za-z0-9._-]{2,40})/i);
	if (greet?.[1]) return greet[1];
	if (txt && txt.length < 40 && !/^(my )?ebay$/i.test(txt) && !/^sign/i.test(txt)) return txt;
	return undefined;
}
