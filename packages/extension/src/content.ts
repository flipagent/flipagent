/**
 * Content script — injected into ebay.com tabs. *Stateless observer*: runs
 * on every page load, reads chrome.storage for the current in-flight job,
 * and reacts based on which page we landed on. The user does every click
 * themselves — flipagent only validates, annotates, and records.
 *
 * Why no auto-click: eBay's policy treats checkout as human-only.
 * The bridge transport is built around that requirement. The agent's
 * value is BEFORE the click (find item, evaluate, queue) and AFTER
 * (record, reconcile, P&L); the click itself is a 1-second human
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
import type { BridgeJobStatus } from "@flipagent/types";
import { mountEvaluateChip } from "./evaluate-chip.js";
import { mountEvaluateSrp } from "./evaluate-srp.js";
import { MESSAGES } from "./messages.js";
import { loadConfig, pushCapture } from "./shared.js";
import { STORAGE_KEYS } from "./storage.js";

interface InFlightSnapshot {
	id: string;
	marketplace: string;
	itemId?: string;
	maxPriceCents?: number | null;
	status: string;
	startedAt: string;
	/** Forwarded from the bridge job's metadata so per-task content
	 * handlers can branch (e.g. address vs inbox scrape on PE). */
	metadata?: Record<string, unknown> | null;
}

interface ReportBody {
	jobId: string;
	outcome: BridgeJobStatus;
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
	if (msg?.type === MESSAGES.BROWSER_OP) {
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
	if (msg?.type === MESSAGES.EBAY_EXTRACT) {
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
	type: typeof MESSAGES.EBAY_EXTRACT;
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
	const stored = await chrome.storage.local.get([STORAGE_KEYS.IN_FLIGHT_BUY]);
	const job = stored[STORAGE_KEYS.IN_FLIGHT_BUY] as InFlightSnapshot | undefined;

	// Per-service dispatch. Each service has its own observer flow.
	// Buyer-state probe (eBay-specific) only runs on ebay.com.
	if (location.hostname.endsWith("ebay.com")) {
		if (job?.marketplace === "ebay") handleEbayJob(job);
		reportBuyerState();
		// Per-page evaluate UX. Both surfaces share the per-itemId store
		// in `evaluate-store.ts`, so a row evaluated on /sch/ shows up
		// pre-resolved on /itm/{id} (and vice versa). Suppressed while a
		// buy is in flight — the banner owns the screen then.
		if (!job) {
			const browseItemId = parseItemIdFromItemPath(location.pathname);
			if (browseItemId) {
				void mountEvaluateChip(browseItemId);
			} else if (!isCheckoutOrAccountPath(location.pathname)) {
				// SRP per-card pill on every non-item, non-checkout eBay
				// page — homepage, search, browse, watchlist, recommendations.
				// The reconciler in evaluate-srp.ts is anchor-driven so it
				// auto-detects whichever card markup the page is using.
				void mountEvaluateSrp();
			}
		}
	} else if (location.hostname.endsWith("planetexpress.com")) {
		if (job?.marketplace === "planetexpress") handlePlanetExpressJob(job);
		reportPlanetExpressState();
	}

	// Passive capture (opt-in). Runs OUTSIDE the eBay-only branch above
	// because the host-permissions list also covers planetexpress.com but
	// we never want to push planetexpress pages — the URL allowlist below
	// is the real gate. Fire-and-forget; failures swallowed in pushCapture.
	void autoCaptureIfEnabled();
}

/**
 * Opt-in passive capture. When the user has flipped the popup toggle,
 * every public eBay PDP / search page they visit gets parsed via the
 * same `parseEbayDetailHtml` / `parseEbaySearchHtml` we use for scrape,
 * and pushed to /v1/bridge/capture. The hosted API normalises and writes
 * to the response cache so future searches hit it instead of issuing a
 * fresh scrape.
 *
 * Per-tab session debounce: same itemId in the same tab won't push twice
 * (re-renders, soft navigations, hash changes). Across tabs / sessions
 * the server-side rate limit (60/min/api key) catches spam.
 *
 * The `denylist` mirrors the server check — defence-in-depth so the
 * extension itself never serializes a personal page even if a network
 * upgrade somehow bypasses the server validation.
 */
const CAPTURE_DENYLIST = [
	/\/mye\//i,
	/\/myb\//i,
	/\/myb_summary/i,
	/\/signin/i,
	/\/vod\//i,
	/\/chk\//i,
	/\/sl\//i,
	/\/bsh\//i,
];

async function autoCaptureIfEnabled(): Promise<void> {
	if (!location.hostname.endsWith("ebay.com")) return;
	const cfg = await loadConfig();
	if (!cfg.captureEnabled || !cfg.bridgeToken) return;

	const url = location.href;
	const path = location.pathname;
	if (CAPTURE_DENYLIST.some((re) => re.test(path))) return;
	const isItm = /^\/itm\/(?:[^/]+\/)?\d{6,}/.test(path);
	const isProductCatalog = /^\/p\/\d{6,}/.test(path);
	const isSearch = /^\/sch\//.test(path);
	if (!isItm && !isProductCatalog && !isSearch) return;

	// Per-tab debounce. sessionStorage is per-document so a single tab
	// won't push the same URL twice during one session — common when the
	// user reloads or eBay re-renders the page state.
	const key = `flipagent_captured_${path}`;
	if (sessionStorage.getItem(key)) return;
	sessionStorage.setItem(key, "1");

	const html = document.documentElement.outerHTML;
	const domFactory = (h: string) => new DOMParser().parseFromString(h, "text/html");

	if (isItm) {
		const detail = parseEbayDetailHtml(html, url, domFactory);
		await pushCapture(cfg, { url, rawDetail: detail });
		return;
	}
	// /p/{epid} catalog pages and /sch/ search results don't have a
	// `parseEbayCatalogHtml` / `parseEbaySearchHtml`-compatible flow on
	// the server's capture endpoint yet — skip until that lands. The
	// allowlist still admits them so a single config flip server-side
	// turns them on without an extension rebuild.
}

/**
 * Extract the legacy numeric eBay item id from an item-page pathname.
 * Handles both the canonical `/itm/123456789012` and the slugged
 * `/itm/some-product-title/123456789012` forms. Returns null on any
 * non-item path so the chip stays mounted only where it makes sense.
 */
function parseItemIdFromItemPath(pathname: string): string | null {
	const m = pathname.match(/^\/itm\/(?:[^/]+\/)?(\d{6,})/);
	return m?.[1] ?? null;
}

/** Paths where the SRP pill UI doesn't make sense — checkout flow,
 * sign-in, account / settings pages. Everywhere else (homepage, search,
 * browse, watchlist, recommendations, my eBay) shows item cards and
 * gets pills. */
function isCheckoutOrAccountPath(pathname: string): boolean {
	return (
		pathname.startsWith("/chk/") ||
		pathname.startsWith("/vod/") ||
		pathname.startsWith("/signin") ||
		pathname.startsWith("/sl/") ||
		pathname.startsWith("/help/")
	);
}

function handleEbayJob(job: InFlightSnapshot): void {
	const task = job.metadata && typeof job.metadata === "object" ? (job.metadata as { task?: string }).task : undefined;
	// Auction proxy-bid: different state machine. No checkout / post-
	// purchase pages; the place-bid panel + bid-result indicator both
	// live on the item page (eBay shows them inline or in a modal that
	// stays on /itm/). User clicks Place Bid manually — flipagent only
	// observes the result and reports it to the bridge.
	if (task === "ebay_place_bid") {
		if (job.itemId && isItemPage(job.itemId)) handleBidItemPage(job);
		return;
	}
	if (job.itemId && isItemPage(job.itemId)) {
		handleItemPage(job);
	} else if (isCheckoutPage()) {
		handleCheckoutPage(job);
	} else if (isPostPurchasePage()) {
		void handlePostPurchase(job);
	}
}

/* ------------------------------- bid flow ------------------------------- */

/**
 * Auction proxy-bid handler. Stays observational: shows a banner with
 * the user's max-bid cap, then watches the page for a *structural*
 * change (price tick, bid-count increment) and updates the banner
 * accordingly. The user clicks Place Bid themselves — eBay UA Feb-2026
 * prohibits automated bidding, and the api-side `humanReviewedAt` gate
 * is the agent-facing half of that commitment.
 *
 * Critically, this handler does NOT report the bridge job terminal.
 * The completion oracle is the server-side reconciler in
 * `services/bid-reconciler.ts`, which diffs the user's actual eBay
 * `BidList` against a snapshot captured at job creation. Decoupling
 * the banner UX from the terminal transition kills two old failure
 * modes:
 *   - false negative: eBay rotates layouts, the regex stops matching,
 *     the observer times out and the job fails even though the bid
 *     landed (we hit this empirically: `bid_observer_timeout` on a
 *     bid that Trading API confirmed was placed).
 *   - false positive: a third-party bidder's tick makes the page
 *     change and the observer claims success — but the user never
 *     actually bid.
 *
 * The reconciler can't see DOM mutations and the observer can't see
 * the user's account state. Letting each do what it's good at and
 * picking the reconciler as the oracle is the only stable design.
 */
function handleBidItemPage(job: InFlightSnapshot): void {
	const meta = (job.metadata ?? {}) as Record<string, unknown>;
	const maxAmountCents = typeof meta.maxAmountCents === "number" ? meta.maxAmountCents : (job.maxPriceCents ?? null);
	showBanner({
		tone: "info",
		title: "flipagent · ready to record your bid",
		body: `${maxAmountCents != null ? `Max bid ${formatCents(maxAmountCents)}. ` : ""}Click "Place bid", enter your max, and confirm. flipagent confirms the result via your bid list — no time pressure.`,
	});
	void report({ jobId: job.id, outcome: "placing" as BridgeJobStatus });
	watchForBidOutcome();
}

/**
 * Best-effort visual feedback: when price OR bid count changes on
 * /itm/, swap the banner to a "change detected — verifying with eBay"
 * tone so the user sees something happen. The actual completion
 * transition lands when the server-side reconciler matches the diff;
 * the agent's next `GET /v1/bids/{listingId}` call surfaces it.
 *
 * Stable selectors (verified against ebay.com 2026-05-04):
 *   - `[data-testid="x-price-primary"]` — current high price text
 *   - `a[href*="bidhistory"]` — "N bids" link in the bid panel
 * We watch only those subtrees (cheap) instead of the whole body.
 */
function watchForBidOutcome(): void {
	const initial = readBidPanelState();
	if (!initial) return; // page shape unrecognised — reconciler still works

	const HARD_CAP_MS = 10 * 60_000; // 10 min — observer is best-effort UX
	const deadline = Date.now() + HARD_CAP_MS;
	let acknowledged = false;

	const targets = [
		document.querySelector('[data-testid="x-price-primary"]'),
		document.querySelector<HTMLAnchorElement>('a[href*="bidhistory"]'),
	].filter((el): el is Element => el !== null);

	const tryAcknowledge = (): void => {
		if (acknowledged) return;
		if (Date.now() > deadline) {
			observer.disconnect();
			window.clearInterval(poll);
			return;
		}
		const current = readBidPanelState();
		if (!current) return;
		const priceUp =
			current.priceCents != null && initial.priceCents != null && current.priceCents > initial.priceCents;
		const countUp = current.bidCount != null && initial.bidCount != null && current.bidCount > initial.bidCount;
		if (!priceUp && !countUp) return;
		acknowledged = true;
		observer.disconnect();
		window.clearInterval(poll);
		showBanner({
			tone: "success",
			title: "flipagent · bid recorded",
			body: `eBay shows ${current.bidCount ?? "?"} bids @ ${formatCents(current.priceCents ?? 0)}. Confirming via your bid list…`,
		});
		// Don't report terminal — let the reconciler do that. We just
		// nudged the price/count, which the reconciler will see on its
		// next tick (or on the agent's next polling read).
	};

	const observer = new MutationObserver(tryAcknowledge);
	for (const t of targets) {
		observer.observe(t, { subtree: true, characterData: true, childList: true });
	}
	// 1 Hz poll backstop in case eBay swaps the targets out (their
	// subtree gets replaced rather than mutated, our observer doesn't
	// re-attach automatically).
	const poll = window.setInterval(tryAcknowledge, 1000);
	tryAcknowledge();
}

/** Read the structural bid state off the item page. Stable selectors,
 * no text regex. Returns null if neither field is parseable (page
 * shape changed) — the reconciler then handles confirmation alone. */
function readBidPanelState(): { priceCents: number | null; bidCount: number | null } | null {
	const priceEl = document.querySelector('[data-testid="x-price-primary"]');
	const priceText = priceEl?.textContent?.trim() ?? "";
	const priceCents = priceText ? parsePriceText(priceText) : null;
	const bidCountEl = document.querySelector<HTMLAnchorElement>('a[href*="bidhistory"]');
	const bidCountText = bidCountEl?.textContent?.trim() ?? "";
	const bidCountMatch = bidCountText.match(/(\d+)/);
	const bidCount = bidCountMatch ? Number.parseInt(bidCountMatch[1] ?? "0", 10) : null;
	if (priceCents == null && bidCount == null) return null;
	return { priceCents, bidCount };
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
			outcome: "failed" as BridgeJobStatus,
			failureReason: "planetexpress_signed_out",
		});
		return;
	}
	// PE's client app lives under /client/* — dashboard, packages, etc.
	if (!location.pathname.startsWith("/client")) {
		// Wrong page — wait for the next navigation.
		return;
	}
	// Branch on the bridge task. Address scrape can run anywhere under
	// /client/* because the warehouse cards live on the dashboard root;
	// inbox scrape needs the packages page.
	const task = job.metadata && typeof job.metadata === "object" ? (job.metadata as { task?: string }).task : undefined;
	if (task === "planetexpress_get_address") {
		void scrapeAddressesAndReport(job);
		return;
	}
	// Default: refresh / packages inbox.
	void scrapeAndReport(job);
}

async function scrapeAddressesAndReport(job: InFlightSnapshot): Promise<void> {
	// Dashboard panel is server-rendered (not SPA), so the warehouse
	// tab content is in the DOM on first load — short tick is plenty.
	await new Promise((r) => setTimeout(r, 600));
	const addresses = scrapePlanetExpressAddresses();
	if (addresses.length === 0) {
		showBanner({
			tone: "error",
			title: "flipagent couldn't read your forwarder address",
			body: "DOM selectors didn't match the warehouse panel. The agent will retry from scratch.",
		});
		await report({
			jobId: job.id,
			outcome: "failed" as BridgeJobStatus,
			failureReason: "planetexpress_address_selectors_unmatched",
		});
		return;
	}
	const primary = addresses.find((a) => a.isPrimary) ?? addresses[0]!;
	showBanner({
		tone: "success",
		title: `flipagent · ${addresses.length} warehouse${addresses.length === 1 ? "" : "s"} read`,
		body: `Primary: ${primary.label}.`,
	});
	await report({
		jobId: job.id,
		outcome: "completed" as BridgeJobStatus,
		result: { addresses },
	});
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
			outcome: "completed" as BridgeJobStatus,
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
		outcome: "completed" as BridgeJobStatus,
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

/**
 * PE dashboard panel: a "FREE MAILBOX" panel with a tab nav of warehouses
 * (`<ul class="nav nav-tabs">`) and a sibling tab pane per warehouse
 * (`<div id="warehouse{N}" class="tab-pane">`). Each pane has a
 * `<table class="no-styles">` of two-column rows: label cell ("Name:",
 * "Address line 1:", "City:", …) + value cell. UK pane uses different
 * labels ("Street:", no State).
 *
 * The active tab pane carries `class="active show"` — that's the
 * primary warehouse for the user.
 */
interface ScrapedAddress {
	label: string;
	isPrimary: boolean;
	name: string;
	line1: string;
	line2?: string;
	city: string;
	region?: string;
	postalCode: string;
	country: string;
}

function scrapePlanetExpressAddresses(): ScrapedAddress[] {
	const navAnchors = Array.from(document.querySelectorAll<HTMLAnchorElement>('.nav-tabs a[href^="#warehouse"]'));
	const out: ScrapedAddress[] = [];
	for (const nav of navAnchors) {
		const href = nav.getAttribute("href") ?? "";
		const id = href.replace(/^#/, "");
		if (!id) continue;
		const pane = document.getElementById(id);
		if (!pane) continue;
		const label = (nav.textContent ?? "").replace(/\s+/g, " ").trim();
		const isPrimary = pane.classList.contains("active");
		const fields = readPaneFields(pane);
		const country = inferCountry(label, fields.region);
		const line1 = fields.line1 ?? fields.street ?? "";
		const city = fields.city ?? "";
		const postalCode = fields.zip ?? "";
		if (!line1 || !city || !postalCode) continue; // pane present but malformed
		const addr: ScrapedAddress = {
			label,
			isPrimary,
			name: fields.name ?? "",
			line1,
			city,
			postalCode,
			country,
		};
		if (fields.line2) addr.line2 = fields.line2;
		if (fields.region) addr.region = fields.region;
		out.push(addr);
	}
	return out;
}

/**
 * Walk the pane's `<table.no-styles>` rows and bucket them by label.
 * Labels seen in the wild: "Name:", "Address line 1:", "Address line 2
 * or Apt. # :", "City:", "State:", "Zip Code:", and for UK "Street:".
 */
function readPaneFields(pane: Element): {
	name?: string;
	line1?: string;
	line2?: string;
	street?: string;
	city?: string;
	region?: string;
	zip?: string;
} {
	const out: ReturnType<typeof readPaneFields> = {};
	const rows = pane.querySelectorAll<HTMLTableRowElement>("table.no-styles tr");
	for (const tr of Array.from(rows)) {
		const cells = tr.querySelectorAll<HTMLTableCellElement>("td");
		if (cells.length < 2) continue;
		const label = (cells[0]!.textContent ?? "").trim().toLowerCase().replace(/\s+/g, " ");
		const value = (cells[1]!.textContent ?? "").trim().replace(/\s+/g, " ");
		if (!value) continue;
		if (label.startsWith("name")) out.name = value;
		else if (label.startsWith("address line 1")) out.line1 = value;
		else if (label.startsWith("address line 2") || label.startsWith("apt")) out.line2 = value;
		else if (label.startsWith("street")) out.street = value;
		else if (label.startsWith("city")) out.city = value;
		else if (label.startsWith("state")) out.region = parseRegion(value);
		else if (label.startsWith("zip") || label.startsWith("postal")) out.zip = value;
	}
	return out;
}

/** "California (CA)" → "CA"; bare "Oregon" → "Oregon"; "" → undefined. */
function parseRegion(value: string): string | undefined {
	const m = value.match(/\(([A-Z]{2})\)/);
	if (m) return m[1];
	return value || undefined;
}

/** Best-effort 2-letter country code from the warehouse tab label. */
function inferCountry(label: string, region: string | undefined): string {
	const l = label.toLowerCase();
	if (l.includes("united kingdom") || l.includes("uk")) return "GB";
	if (l.includes("germany")) return "DE";
	if (l.includes("japan")) return "JP";
	// Default to US: PE's other labels are US city/state pairs (Torrance CA,
	// Tualatin OR, Fort Pierce FL).
	return region ? "US" : "US";
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
			outcome: "failed" as BridgeJobStatus,
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
			outcome: "failed" as BridgeJobStatus,
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
		outcome: "placing" as BridgeJobStatus,
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
		outcome: "completed" as BridgeJobStatus,
		totalCents: totalCents ?? undefined,
		ebayOrderId: orderId ?? undefined,
		receiptUrl: location.href,
	});
}

async function report(body: ReportBody): Promise<void> {
	await chrome.runtime.sendMessage({ type: MESSAGES.ORDER_PROGRESS, body }).catch(() => {});
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
			type: MESSAGES.BUYER_STATE,
			loggedIn: probe.loggedIn,
			ebayUserName: probe.ebayUserName,
		})
		.catch(() => {});
}

/* PE login is URL-routed: app.planetexpress.com/login (or /signin) is the
 * gate; any /client/* path is post-login. Mirror locally only — no API
 * column on the bridge_tokens table for PE state today, popup reads
 * straight from chrome.storage. */
function reportPlanetExpressState(): void {
	const path = location.pathname;
	const onLoginPage = /\/(login|signin)/i.test(path);
	const inAppShell = /^\/client(\/|$)/.test(path);
	if (!onLoginPage && !inAppShell) return;
	chrome.runtime
		.sendMessage({
			type: MESSAGES.PE_STATE,
			loggedIn: inAppShell,
		})
		.catch(() => {});
}

interface DomBuyerState {
	loggedIn: boolean;
	ebayUserName?: string;
}

function detectBuyerStateFromDom(): DomBuyerState {
	// Modern eBay (2024+) header carries the username in
	// `.gh-identity__greeting` with the structure
	// `Hi <span>Username!</span>`. Read the inner span directly so we
	// don't have to regex around the "Hi " prefix or the trailing
	// punctuation.
	const greetingEl = document.querySelector(".gh-identity__greeting");
	if (greetingEl) {
		const inner = greetingEl.querySelector("span");
		const name = (inner?.textContent ?? greetingEl.textContent ?? "")
			.trim()
			.replace(/^Hi[\s,!]+/i, "")
			.replace(/[!,.\s]+$/, "");
		return { loggedIn: true, ebayUserName: name || undefined };
	}

	// Fallback positive signals — header variants where the greeting span
	// isn't present (some experiments / regions). Username unknown but
	// the row still shows "Signed in to eBay" without a name.
	const loggedInIndicators = [
		'a[href*="/myb/"]',
		'a[href*="/mys/"]',
		'[data-testid="header-user-greeting"]',
		".gh-eb-Li-a",
	];
	for (const sel of loggedInIndicators) {
		if (document.querySelector(sel)) return { loggedIn: true };
	}
	return { loggedIn: false };
}
