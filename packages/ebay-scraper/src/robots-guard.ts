/**
 * Belt-and-suspenders guard against fetching URLs that eBay's robots.txt
 * explicitly Disallows under `User-agent: *` for paths we have no business
 * touching anyway. Source: eBay robots.txt v26.2_COM_April_2026
 * (`User-agent: *` block, lines covering /itm/* and the operational subpaths
 * under /sl/, /act/, /atc/, /signin/, /pe/, /rtm, /gum/ etc.).
 *
 * Scope and honesty: this guard does NOT block `/sch/i.html?_nkw=...`, eBay's
 * keyword search results page. That path IS formally Disallowed under
 * `User-agent: *`, and it is also our primary scraping path — there is no
 * legitimate equivalent for sold-listing aggregation outside the gated
 * Marketplace Insights API. We document this knowingly in /docs/legal/compliance
 * and accept the residual posture; we do not pretend the guard hides it.
 *
 * What this guard catches: callers (or upstream code) that accidentally
 * construct URLs touching subpaths we have no product reason to ever hit
 * (/itm/addToCart, /itm/watch/, image-bytes URLs under /itm/, the
 * BESTOFFER action, /sl/ seller-tools, /signin/, etc.). Those are unforced
 * errors, and a tripped guard is the cheapest possible way to catch them.
 */

export class DisallowedUrlError extends Error {
	readonly url: string;
	readonly pattern: string;
	constructor(url: string, pattern: string) {
		super(
			`URL ${url} matches eBay robots.txt Disallow pattern "${pattern}" ` +
				`under User-agent: *. @flipagent/ebay-scraper refuses to fetch it.`,
		);
		this.name = "DisallowedUrlError";
		this.url = url;
		this.pattern = pattern;
	}
}

interface DisallowRule {
	pattern: string;
	test: (path: string) => boolean;
}

// Subset of eBay's User-agent: * Disallow patterns we never want to hit
// regardless of what the caller passed. Limited to subpaths that are
// (a) not part of any legitimate flipagent scrape flow, and (b) clearly
// signal anti-bot/seller-actions/operational paths we shouldn't be near.
const DISALLOW_RULES: DisallowRule[] = [
	// /itm/* operational + image subpaths
	{ pattern: "/itm/*action=BESTOFFER", test: (p) => p.startsWith("/itm/") && p.includes("action=BESTOFFER") },
	{ pattern: "/itm/*?fits", test: (p) => p.startsWith("/itm/") && /[?&]fits/.test(p) },
	{ pattern: "/itm/*&fits", test: (p) => p.startsWith("/itm/") && /[?&]fits/.test(p) },
	{ pattern: "/itm/*.jpg", test: (p) => p.startsWith("/itm/") && p.endsWith(".jpg") },
	{ pattern: "/itm/*_pgn=", test: (p) => p.startsWith("/itm/") && /[?&]_pgn=/.test(p) },
	{ pattern: "/itm/addToCart", test: (p) => p.startsWith("/itm/addToCart") },
	{ pattern: "/itm/fetchmodules", test: (p) => p.startsWith("/itm/fetchmodules") },
	{ pattern: "/itm/sellerInfoV2", test: (p) => p.startsWith("/itm/sellerInfoV2") },
	{ pattern: "/itm/soi", test: (p) => p.startsWith("/itm/soi") },
	{ pattern: "/itm/variationlogistics", test: (p) => p.startsWith("/itm/variationlogistics") },
	{ pattern: "/itm/watch/", test: (p) => p.startsWith("/itm/watch/") },
	{ pattern: "/itmhero/", test: (p) => p.startsWith("/itmhero/") },
	// Cart / seller tools / auth — never legitimate for read-only scrape
	{ pattern: "/atc/", test: (p) => p.startsWith("/atc/") },
	{ pattern: "/act/", test: (p) => p.startsWith("/act/") },
	{ pattern: "/cart", test: (p) => p.startsWith("/cart") },
	{ pattern: "/signin/", test: (p) => p.startsWith("/signin/") && p !== "/signin/" },
	{ pattern: "/sl/", test: (p) => p.startsWith("/sl/") },
	{ pattern: "/myb", test: (p) => p.startsWith("/myb") },
	{ pattern: "/myebay", test: (p) => p.startsWith("/myebay") },
	{ pattern: "/feed/", test: (p) => p.startsWith("/feed/") },
	{ pattern: "/fdbk/", test: (p) => p.startsWith("/fdbk/") },
	{ pattern: "/ecaptcha/", test: (p) => p.startsWith("/ecaptcha/") },
	// Added in v26.2_COM_April_2026.
	{ pattern: "/pe/*", test: (p) => p.startsWith("/pe/") },
	{ pattern: "/gum/", test: (p) => p.startsWith("/gum/") },
	{ pattern: "/rtm*", test: (p) => p.startsWith("/rtm") },
	{ pattern: "/gh/user_profile", test: (p) => p.startsWith("/gh/user_profile") },
];

const EBAY_HOST_RE = /(^|\.)ebay\.[a-z.]+$/i;

export function assertUrlAllowed(rawUrl: string): void {
	let parsed: URL;
	try {
		parsed = new URL(rawUrl);
	} catch {
		// Non-URL input — let the caller's fetch fail with its own error.
		return;
	}
	if (!EBAY_HOST_RE.test(parsed.hostname)) return;
	const path = parsed.pathname + parsed.search;
	for (const rule of DISALLOW_RULES) {
		if (rule.test(path)) {
			throw new DisallowedUrlError(rawUrl, rule.pattern);
		}
	}
}
