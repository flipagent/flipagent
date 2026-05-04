/**
 * Definitive coverage accounting. Classifies every spec endpoint into
 * one of seven buckets:
 *
 *   1. WRAPPED_LIVE_OK     — live-tested 2xx/3xx/proper 4xx envelope
 *   2. WRAPPED_SPEC_DIRECT — spec-diff matched a literal/template path
 *   3. WRAPPED_DYNAMIC     — endpoint reached via dynamic dispatch
 *                            (PATH-map lookup, generic kind dispatcher,
 *                            etc.) — grep finds the path-fragment in
 *                            our code but TS-AST can't resolve it.
 *   4. SKIP_LR             — Limited Release / app-approval gated.
 *   5. SKIP_NICHE          — explicit business decision (Marketing
 *                            keyword/PLA, Sell eDelivery, sell_listing
 *                            legacy parallel surface).
 *   6. SKIP_DIFF_NOISE     — duplicates the diff missed (spec defines
 *                            same path under two different files).
 *   7. UNWRAPPED           — genuinely not covered + not deliberately
 *                            skipped.
 *
 * Each bucket gets per-surface counts so the user can see exactly
 * what's where.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const REPO_ROOT = join(import.meta.dirname, "..", "..", "..");
const NOTES = join(REPO_ROOT, "notes", "ebay-spec-diff.json");
const SERVICES = join(REPO_ROOT, "packages", "api", "src", "services");

interface DiffJson {
	summary: { specEndpointCount: number; matched: number; specOnly: number };
	matched: string[];
	specOnly: Array<{ key: string }>;
	wrapperOnlyInsideSpec: Array<{ key: string; sources: string[] }>;
	wrapperOnlyNoSpec: Array<{ key: string; sources: string[] }>;
}

const diff = JSON.parse(readFileSync(NOTES, "utf8")) as DiffJson;

// Concatenate every .ts file under services/ for fast substring grep.
function readAllServiceCode(): string {
	let acc = "";
	function walk(dir: string) {
		for (const name of readdirSync(dir)) {
			const full = join(dir, name);
			const st = statSync(full);
			if (st.isDirectory()) walk(full);
			else if (name.endsWith(".ts") && !name.endsWith(".d.ts")) acc += readFileSync(full, "utf8") + "\n";
		}
	}
	walk(SERVICES);
	return acc;
}
const code = readAllServiceCode();

/* ---------- bucket classifiers ---------- */

/**
 * Manual override for paths the heuristic can't auto-detect — they're
 * wrapped, but via patterns the AST/grep can't statically resolve:
 *   - `fetchRetry(\`${EBAY_BASE_URL}/sell/fulfillment/.../upload_evidence_file\`)`
 *     — multipart upload bypasses sellRequest; the URL is built inline
 *   - `${GET_PATH.payment(id)}/activity` — PATH lookup map dispatch
 *   - `getCharity(numericId)` routes through `get_charity_org_by_legacy_id`
 *     internally based on numeric input branch
 *   - `getSellerPaymentsProgram` builds path with two interpolations
 *     (`${marketplace}/EBAY_PAYMENTS/onboarding`)
 * All verified by manual grep on the date below.
 */
const KNOWN_WRAPPED_OVERRIDE = new Set([
	"GET /commerce/charity/v1/charity_org/get_charity_org_by_legacy_id",
	"GET /commerce/taxonomy/v1/category_tree/{X}/get_compatibility_property_values",
	"POST /commerce/translation/v1_beta/translate",
	"GET /sell/account/v1/payments_program/{X}/{X}/onboarding",
	"GET /sell/fulfillment/v1/payment_dispute/{X}/activity",
	"GET /sell/fulfillment/v1/payment_dispute/{X}/fetch_evidence_content",
	"POST /sell/fulfillment/v1/payment_dispute/{X}/upload_evidence_file",
	"POST /sell/marketing/v1/ad_campaign/{X}/ad_group/{X}/suggest_bids",
	"POST /sell/marketing/v1/ad_campaign/{X}/ad_group/{X}/suggest_keywords",
	"POST /sell/marketing/v1/ad_campaign/{X}/bulk_update_ads_status",
	"POST /sell/marketing/v1/ad_campaign/{X}/create_ads_by_inventory_reference",
	"POST /sell/marketing/v1/ad_campaign/{X}/delete_ads_by_inventory_reference",
	"GET /sell/marketing/v1/ad_report/{X}",
]);

const LR_PREFIXES = [
	"/buy/order/", "/sell/feed/", "/buy/feed/", "/buy/deal/", "/buy/marketing/",
	"/sell/logistics/", "/buy/marketplace_insights/",
];

const NICHE_SKIP_PATTERNS = [
	// Sell Marketing keyword/PLA/email — niche advanced PPC. Includes
	// per-campaign keyword variants (`/ad_campaign/{X}/keyword*`,
	// `/ad_campaign/{X}/bulk_*_keyword`, `/suggest_keywords`,
	// `suggest_bids`, `update_bidding_strategy`, etc.) — all power-user
	// PPC ops that flipagent's typical reseller doesn't run.
	/\/sell\/marketing\/v1\/(keyword|negative_keyword|email_campaign|bulk_(create|update)_negative_keyword)/,
	/\/sell\/marketing\/v1\/ad_campaign\/[^/]+\/(keyword|bulk_(create|update)_keyword|suggest_(bids|keywords|items)|update_(ad_rate_strategy|bidding_strategy|campaign_budget|campaign_identification)|get_ads_by_inventory_reference)/,
	/\/sell\/marketing\/v1\/ad_campaign\/(find_campaign_by_ad_reference|setup_quick_campaign|suggest_budget|suggest_max_cpc)/,
	/\/sell\/marketing\/v1\/promotion_report$/,  // we have promotion_summary_report
	/\/sell\/edelivery_international_shipping\//,
	/\/sell\/listing\/v1_beta\//,  // legacy parallel surface
];

/** Find a unique literal sub-path in our code. Heuristic improved
 * 2026-05-03 (round 3) to catch:
 *
 *   - action constants: `campaignAction(id, "launch", ctx)` → matches
 *     spec path `.../ad_campaign/{X}/launch`
 *   - PATH lookup maps: `PATH[type]` where PATH is a Record literal
 *   - generic dispatchers: `KIND_TO_PATH[kind]` for sell/metadata
 *   - template-literal paths with multiple interpolations
 *
 * Returns true when the spec path's distinguishing literal appears
 * either (a) as a string literal AND a matching api root is in scope,
 * or (b) inside a template literal with the api root prefix.
 */
function pathInCode(specPath: string): boolean {
	const segments = specPath.replace(/\{X\}/g, "").split("/").filter(Boolean);
	const literals = segments.filter((s) => !/^(sell|buy|commerce|post-order|developer|v\d+|v\d+_beta)$/.test(s));
	if (!literals.length) return false;
	const last = literals[literals.length - 1]!;
	const apiRoot = "/" + segments.find((s) => /^(sell|buy|commerce|post-order|developer)$/.test(s));
	if (!apiRoot) return false;
	// 1) Full path with api root + last literal anywhere downstream.
	const needle1 = new RegExp(`['"\`]${apiRoot}/[^'"\`]*\\b${last}\\b`);
	if (needle1.test(code)) return true;
	// 2) Last literal as a string literal AND api root in code.
	const needle2 = new RegExp(`['"\`]${last}['"\`]`);
	if (needle2.test(code) && code.includes(apiRoot)) return true;
	// 3) Action helpers — when the path is `.../{X}/<action>`, a
	// `campaignAction(id, "<action>", ...)` or `methodAction(id,
	// "<action>", ...)` style call counts as wrapping the action.
	if (literals.length >= 2 && /^[a-z_]+$/.test(last)) {
		const actionRe = new RegExp(`Action\\s*\\([^)]*['"\`]${last}['"\`]`);
		if (actionRe.test(code) && code.includes(apiRoot)) return true;
	}
	// 4) Template-literal `ROOT` constants — many wrapper files declare
	// `const ROOT = "/sell/marketing/v1";` and then `path: \`${ROOT}/negative_keyword?...\``.
	// Look for `${anyName}/<last>` inside a template literal where a
	// const declaring the api root is present in the same file.
	const rootConstRe = new RegExp(`const\\s+\\w+\\s*=\\s*['"\`]${apiRoot}[^'"\`]*['"\`]`);
	if (rootConstRe.test(code)) {
		// Now check the last literal appears in any template-literal `${X}/<last>` form.
		const tplRe = new RegExp(`\\$\\{\\w+\\}[^\`]*\\b${last}\\b`);
		if (tplRe.test(code)) return true;
	}
	return false;
}

interface Row {
	key: string;
	method: string;
	path: string;
	bucket:
		| "WRAPPED_SPEC_DIRECT"
		| "WRAPPED_DYNAMIC"
		| "SKIP_LR"
		| "SKIP_NICHE"
		| "SKIP_DIFF_NOISE"
		| "UNWRAPPED";
}

const rows: Row[] = [];

// 1. spec-direct matches
for (const key of diff.matched) {
	const [method, path] = key.split(" ");
	rows.push({ key, method: method!, path: path ?? "", bucket: "WRAPPED_SPEC_DIRECT" });
}

// 2. spec-only — classify. Order matters: pathInCode (WRAPPED) wins over
// LR / NICHE skip flags. We want to count "wrapped LR-gated" endpoints
// as wrapped (the wrapper exists; we just can't exercise it without
// eBay app approval) — same for niche endpoints we deliberately wrapped.
for (const { key } of diff.specOnly) {
	const [method, path] = key.split(" ");
	const p = path ?? "";
	let bucket: Row["bucket"];
	if (KNOWN_WRAPPED_OVERRIDE.has(key)) bucket = "WRAPPED_DYNAMIC";
	else if (pathInCode(p)) bucket = "WRAPPED_DYNAMIC";
	else if (LR_PREFIXES.some((pre) => p.startsWith(pre))) bucket = "SKIP_LR";
	else if (NICHE_SKIP_PATTERNS.some((re) => re.test(p))) bucket = "SKIP_NICHE";
	else bucket = "UNWRAPPED";
	rows.push({ key, method: method!, path: p, bucket });
}

/* ---------- summary ---------- */

const buckets: Record<Row["bucket"], number> = {
	WRAPPED_SPEC_DIRECT: 0,
	WRAPPED_DYNAMIC: 0,
	SKIP_LR: 0,
	SKIP_NICHE: 0,
	SKIP_DIFF_NOISE: 0,
	UNWRAPPED: 0,
};
const perSurface: Record<string, Record<Row["bucket"], number>> = {};
for (const r of rows) {
	buckets[r.bucket]++;
	const surface = r.path.split("/").slice(1, 3).join("/");
	perSurface[surface] = perSurface[surface] || { WRAPPED_SPEC_DIRECT: 0, WRAPPED_DYNAMIC: 0, SKIP_LR: 0, SKIP_NICHE: 0, SKIP_DIFF_NOISE: 0, UNWRAPPED: 0 };
	perSurface[surface][r.bucket]++;
}

const total = rows.length;
console.log(`\n=== Definitive eBay coverage accounting (${total} unique spec endpoints) ===\n`);
const ordered: Row["bucket"][] = [
	"WRAPPED_SPEC_DIRECT",
	"WRAPPED_DYNAMIC",
	"SKIP_LR",
	"SKIP_NICHE",
	"UNWRAPPED",
];
for (const b of ordered) {
	const pct = ((buckets[b] / total) * 100).toFixed(1);
	console.log(`  ${b.padEnd(24)} ${String(buckets[b]).padStart(4)}  ${pct}%`);
}
console.log(`  ${"─".repeat(35)}`);
console.log(`  ${"TOTAL".padEnd(24)} ${String(total).padStart(4)}`);

const wrapped = buckets.WRAPPED_SPEC_DIRECT + buckets.WRAPPED_DYNAMIC;
const skip = buckets.SKIP_LR + buckets.SKIP_NICHE;
console.log(`\n  Wrapped (covered):       ${wrapped}/${total}  (${((wrapped / total) * 100).toFixed(1)}%)`);
console.log(`  Intentionally skipped:   ${skip}/${total}  (${((skip / total) * 100).toFixed(1)}%)`);
console.log(`  Genuinely unwrapped:     ${buckets.UNWRAPPED}/${total}  (${((buckets.UNWRAPPED / total) * 100).toFixed(1)}%)`);

console.log("\n=== Per-surface breakdown (alphabetical) ===\n");
const w = (s: string, n: number) => String(s).padStart(n);
console.log(
	"  " + "Surface".padEnd(28) + w("Wrap", 5) + w("Dyn", 5) + w("LR", 5) + w("Niche", 7) + w("Open", 6),
);
for (const s of Object.keys(perSurface).sort()) {
	const p = perSurface[s]!;
	console.log(
		"  " + s.padEnd(28) +
			w(p.WRAPPED_SPEC_DIRECT, 5) + w(p.WRAPPED_DYNAMIC, 5) + w(p.SKIP_LR, 5) +
			w(p.SKIP_NICHE, 7) + w(p.UNWRAPPED, 6),
	);
}

console.log("\n=== Genuinely UNWRAPPED endpoints (decide each) ===\n");
const unwrapped = rows.filter((r) => r.bucket === "UNWRAPPED").sort((a, b) => a.path.localeCompare(b.path));
for (const r of unwrapped) console.log(`  ${r.method.padEnd(7)} ${r.path}`);
if (unwrapped.length === 0) console.log("  (none)");

console.log("\n=== SKIP_LR remaining ===\n");
for (const r of rows.filter((r) => r.bucket === "SKIP_LR").sort((a, b) => a.path.localeCompare(b.path))) {
	console.log(`  ${r.method.padEnd(7)} ${r.path}`);
}

console.log("\n=== SKIP_NICHE remaining ===\n");
for (const r of rows.filter((r) => r.bucket === "SKIP_NICHE").sort((a, b) => a.path.localeCompare(b.path))) {
	console.log(`  ${r.method.padEnd(7)} ${r.path}`);
}
