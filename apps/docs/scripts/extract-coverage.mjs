#!/usr/bin/env node
/**
 * One-shot extractor: reads the legacy hand-maintained
 * `src/pages/docs/coverage.astro` and emits structured data to
 * `src/data/coverage.ts`. After running once, the .astro page is
 * rewritten as a renderer; this script can be re-run to refresh the
 * data when new eBay surfaces land.
 *
 * Usage:
 *   node apps/docs/scripts/extract-coverage.mjs [path/to/coverage.astro]
 */
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const src = process.argv[2] ?? path.join(here, "..", "src", "pages", "docs", "coverage.astro");
const dst = path.join(here, "..", "src", "data", "coverage.ts");

const html = await fs.readFile(src, "utf8");

// Decode the HTML entities Astro uses for `{` / `}` so the emitted
// strings match the on-page rendering.
function decode(s) {
	return s
		.replace(/&#123;/g, "{")
		.replace(/&#125;/g, "}")
		.replace(/&amp;/g, "&")
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">");
}

// Cells often look like `<code>A</code> / <code>B</code>` or just `<code>X</code>`.
// Drop the wrapping markup but preserve the slashes / commas / parentheticals.
function stripCellMarkup(cell) {
	return decode(cell.replace(/<\/?code>/g, "").replace(/<[^>]+>/g, "").trim());
}

// One pass per `<h2 id="...">...</h2><p>...</p><table class="api">...</table>` block.
const sectionRe =
	/<h2 id="([^"]+)">([^<]+)<\/h2>\s*<p>([\s\S]*?)<\/p>\s*<table class="api">([\s\S]*?)<\/table>/g;

const sections = [];
const tradingRows = [];
const nativeRows = [];
let m;
while ((m = sectionRe.exec(html)) !== null) {
	const [, id, title, descRaw, tableInner] = m;
	const description = stripCellMarkup(descRaw);

	// Pick out the column headers so we know which shape this table is.
	const theadMatch = tableInner.match(/<thead>([\s\S]*?)<\/thead>/);
	const headers = theadMatch
		? [...theadMatch[1].matchAll(/<th>([^<]*)<\/th>/g)].map((h) => h[1].trim())
		: [];

	// `[\s\S]` so multi-line <tr>...</tr> blocks match. Skip the header row;
	// the thead block is already separated above.
	const tbodyMatch = tableInner.match(/<tbody>([\s\S]*?)<\/tbody>/);
	const tbody = tbodyMatch ? tbodyMatch[1] : "";
	const rowMatches = [...tbody.matchAll(/<tr>([\s\S]*?)<\/tr>/g)];
	const rows = rowMatches.map((rm) => {
		const cells = [...rm[1].matchAll(/<td>([\s\S]*?)<\/td>/g)].map((c) => c[1]);
		return cells.map(stripCellMarkup);
	});

	// Three table shapes:
	//   eBay endpoint | flipagent | Setup | Tier  (the 4-column default)
	//   flipagent     | What it composes | Tier   (flipagent-native)
	//   Trading call  | flipagent | Tier          (trading XML)
	if (headers[0] === "Trading call") {
		for (const r of rows) {
			tradingRows.push({ trading: r[0], flipagent: r[1], tier: r[2] || "—" });
		}
		continue;
	}
	if (headers[0] === "flipagent") {
		for (const r of rows) {
			nativeRows.push({ flipagent: r[0], composes: r[1], tier: r[2] || "—" });
		}
		continue;
	}

	if (headers[0] !== "eBay endpoint" && headers[0] !== "Setup") {
		// "Setup" / "Tier" / "Phase" intro tables — skip; they stay inline.
		continue;
	}
	if (headers[0] === "Setup" || headers[0] === "Tier" || headers[0] === "Phase") {
		continue;
	}

	const sectionRows = rows.map((r) => ({
		ebay: r[0],
		flipagent: r[1] === "—" || r[1] === "" ? null : r[1],
		setup: r[2],
		tier: r[3],
	}));
	sections.push({ id, title: title.trim(), description, rows: sectionRows });
}

// Emit. Default Setup + Tier per-section so the per-row fields only carry overrides.
function inferDefaults(rows) {
	const setupCounts = new Map();
	const tierCounts = new Map();
	for (const r of rows) {
		setupCounts.set(r.setup, (setupCounts.get(r.setup) ?? 0) + 1);
		tierCounts.set(r.tier, (tierCounts.get(r.tier) ?? 0) + 1);
	}
	const top = (m) => [...m.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
	// Fall back to sane defaults when a section is empty so the data file
	// still type-checks (no `undefined` literals in the emitted output).
	return {
		defaultSetup: top(setupCounts) ?? "flipagent API key",
		defaultTier: top(tierCounts) ?? "T4",
	};
}

const out = [];
out.push("/**");
out.push(" * eBay → flipagent endpoint coverage map.");
out.push(" *");
out.push(" * Source of truth for the /docs/coverage page. Hand-maintained TS so");
out.push(" * adding a new eBay surface is one diff in one file. Re-extract from a");
out.push(" * legacy .astro version with `node scripts/extract-coverage.mjs`.");
out.push(" *");
out.push(" * Schema:");
out.push(" *   - sections: 4-column eBay → flipagent mappings, grouped by API family.");
out.push(" *     Each section sets defaultSetup + defaultTier; rows override per-cell.");
out.push(" *   - tradingRows: legacy XML/SOAP calls.");
out.push(" *   - nativeRows: flipagent-native composite endpoints.");
out.push(" *");
out.push(" * `flipagent: null` means the route is intentionally not surfaced (T4).");
out.push(" */");
out.push("");
out.push("export type Setup = string;");
out.push("export type Tier = \"T1\" | \"T2\" | \"T3\" | \"T4\" | \"—\";");
out.push("");
out.push("export interface CoverageRow {");
out.push("\tebay: string;");
out.push("\tflipagent: string | null;");
out.push("\tsetup?: Setup;");
out.push("\ttier?: Tier;");
out.push("}");
out.push("");
out.push("export interface CoverageSection {");
out.push("\tid: string;");
out.push("\ttitle: string;");
out.push("\tdescription: string;");
out.push("\tdefaultSetup: Setup;");
out.push("\tdefaultTier: Tier;");
out.push("\trows: CoverageRow[];");
out.push("}");
out.push("");
out.push("export interface TradingRow {");
out.push("\ttrading: string;");
out.push("\tflipagent: string;");
out.push("\ttier: Tier;");
out.push("}");
out.push("");
out.push("export interface NativeRow {");
out.push("\tflipagent: string;");
out.push("\tcomposes: string;");
out.push("\ttier: Tier;");
out.push("}");
out.push("");
out.push("export const COVERAGE_SECTIONS: CoverageSection[] = [");
for (const s of sections) {
	const { defaultSetup, defaultTier } = inferDefaults(s.rows);
	out.push("\t{");
	out.push(`\t\tid: ${JSON.stringify(s.id)},`);
	out.push(`\t\ttitle: ${JSON.stringify(s.title)},`);
	out.push(`\t\tdescription: ${JSON.stringify(s.description)},`);
	out.push(`\t\tdefaultSetup: ${JSON.stringify(defaultSetup)},`);
	out.push(`\t\tdefaultTier: ${JSON.stringify(defaultTier)},`);
	out.push("\t\trows: [");
	for (const r of s.rows) {
		const parts = [`ebay: ${JSON.stringify(r.ebay)}`];
		parts.push(`flipagent: ${r.flipagent === null ? "null" : JSON.stringify(r.flipagent)}`);
		if (r.setup !== defaultSetup) parts.push(`setup: ${JSON.stringify(r.setup)}`);
		if (r.tier !== defaultTier) parts.push(`tier: ${JSON.stringify(r.tier)}`);
		out.push(`\t\t\t{ ${parts.join(", ")} },`);
	}
	out.push("\t\t],");
	out.push("\t},");
}
out.push("];");
out.push("");
out.push("export const TRADING_ROWS: TradingRow[] = [");
for (const r of tradingRows) {
	out.push(
		`\t{ trading: ${JSON.stringify(r.trading)}, flipagent: ${JSON.stringify(r.flipagent)}, tier: ${JSON.stringify(r.tier)} },`,
	);
}
out.push("];");
out.push("");
out.push("export const NATIVE_ROWS: NativeRow[] = [");
for (const r of nativeRows) {
	out.push(
		`\t{ flipagent: ${JSON.stringify(r.flipagent)}, composes: ${JSON.stringify(r.composes)}, tier: ${JSON.stringify(r.tier)} },`,
	);
}
out.push("];");
out.push("");

await fs.writeFile(dst, out.join("\n"), "utf8");
console.log(
	`wrote ${dst}: ${sections.length} sections, ${tradingRows.length} trading rows, ${nativeRows.length} native rows`,
);
