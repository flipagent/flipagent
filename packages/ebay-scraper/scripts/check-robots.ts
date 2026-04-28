#!/usr/bin/env tsx
/**
 * Drift monitor for eBay's robots.txt against our baked-in baseline.
 *
 * Run from CI on a daily schedule. Exits non-zero on any of:
 *   - Live fetch fails (transport / status / soft-block heuristic)
 *   - Version tag in the live file no longer matches `EXPECTED_VERSION`
 *   - The User-agent: * Disallow ruleset has structural drift vs. baseline
 *     (rules added, removed, or changed Allow ↔ Disallow)
 *   - A live `User-agent: <X>` block matching one of `ENFORCED_AI_BOTS`
 *     no longer carries `Disallow: /` (i.e., eBay loosened the AI-bot ban —
 *     informative, not breaking, but flagged)
 *
 * On non-zero exit: the GitHub Actions workflow opens an issue on the repo
 * describing the diff so a human can refresh `robots-guard.ts`.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
async function fetchText(url: string, timeoutMs: number): Promise<string> {
	const ctrl = new AbortController();
	const timer = setTimeout(() => ctrl.abort(), timeoutMs);
	try {
		const res = await fetch(url, { signal: ctrl.signal });
		if (!res.ok) throw new Error(`status ${res.status}`);
		return await res.text();
	} finally {
		clearTimeout(timer);
	}
}

const EXPECTED_VERSION = "v24.5_COM_December_2025";
const ROBOTS_URL = "https://www.ebay.com/robots.txt";
const ENFORCED_AI_BOTS = [
	"Bytespider",
	"CCBot",
	"ChatGLM-Spider",
	"ClaudeBot",
	"PerplexityBot",
	"anthropic-ai",
	"AmazonBot",
];

const here = dirname(fileURLToPath(import.meta.url));
const BASELINE_PATH = join(here, "..", "data", "ebay-robots-baseline.txt");

interface AgentBlock {
	userAgents: string[];
	rules: { directive: "allow" | "disallow"; pattern: string }[];
}

function parseRobots(text: string): { version: string | null; blocks: AgentBlock[] } {
	const lines = text.split(/\r?\n/);
	const versionMatch = text.match(/v\d+\.\d+_[A-Z]+_[A-Za-z]+_\d{4}/);
	const version = versionMatch ? versionMatch[0] : null;

	const blocks: AgentBlock[] = [];
	let pendingUAs: string[] = [];
	let inUASequence = false;
	let current: AgentBlock | null = null;

	for (const raw of lines) {
		const line = raw.replace(/#.*$/, "").trim();
		if (!line) continue;
		const colon = line.indexOf(":");
		if (colon === -1) continue;
		const field = line.slice(0, colon).trim().toLowerCase();
		const value = line.slice(colon + 1).trim();
		if (field === "user-agent") {
			if (!inUASequence) {
				pendingUAs = [];
				inUASequence = true;
				current = null;
			}
			pendingUAs.push(value);
			continue;
		}
		if (field === "allow" || field === "disallow") {
			if (inUASequence) {
				current = { userAgents: pendingUAs, rules: [] };
				blocks.push(current);
				pendingUAs = [];
				inUASequence = false;
			}
			if (current) current.rules.push({ directive: field, pattern: value });
		}
	}
	return { version, blocks };
}

function findBlock(blocks: AgentBlock[], userAgent: string): AgentBlock | null {
	const ua = userAgent.toLowerCase();
	for (const block of blocks) {
		for (const groupUA of block.userAgents) {
			if (groupUA.toLowerCase() === ua) return block;
		}
	}
	return null;
}

function ruleKey(r: { directive: string; pattern: string }): string {
	return `${r.directive.toUpperCase()} ${r.pattern}`;
}

function diffSets(baseline: Set<string>, live: Set<string>): { added: string[]; removed: string[] } {
	const added: string[] = [];
	const removed: string[] = [];
	for (const v of live) if (!baseline.has(v)) added.push(v);
	for (const v of baseline) if (!live.has(v)) removed.push(v);
	added.sort();
	removed.sort();
	return { added, removed };
}

async function main(): Promise<void> {
	const failures: string[] = [];
	const offline = process.env.OFFLINE === "1";
	let liveText: string;
	if (offline) {
		console.log("OFFLINE=1 set — treating baseline file as live (parser smoke test only).");
		liveText = readFileSync(BASELINE_PATH, "utf8");
	} else {
		try {
			liveText = await fetchText(ROBOTS_URL, 20_000);
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			console.error(`✗ Failed to fetch ${ROBOTS_URL}: ${msg}`);
			console.error("  (Run with OFFLINE=1 to smoke-test the parser against the baseline only.)");
			process.exit(1);
		}
	}

	if (liveText.length < 1000) {
		failures.push(`Live response suspiciously small (${liveText.length} bytes) — possible soft-block.`);
	}

	const live = parseRobots(liveText);

	let baselineText: string;
	try {
		baselineText = readFileSync(BASELINE_PATH, "utf8");
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		console.error(`✗ Cannot read baseline at ${BASELINE_PATH}: ${msg}`);
		process.exit(1);
	}
	const baseline = parseRobots(baselineText);

	console.log(`Expected version: ${EXPECTED_VERSION}`);
	console.log(`Baseline version: ${baseline.version ?? "(not found)"}`);
	console.log(`Live version:     ${live.version ?? "(not found)"}`);

	if (live.version !== EXPECTED_VERSION) {
		failures.push(
			`Version tag drift: expected "${EXPECTED_VERSION}", got "${live.version ?? "(none)"}". ` +
				`Refresh packages/ebay-scraper/data/ebay-robots-baseline.txt and update EBAY_RULES + EXPECTED_VERSION.`,
		);
	}

	const baselineStar = findBlock(baseline.blocks, "*");
	const liveStar = findBlock(live.blocks, "*");
	if (!liveStar) {
		failures.push(`Live robots.txt has no "User-agent: *" block. Structural change — manual review.`);
	} else if (baselineStar) {
		const baseSet = new Set(baselineStar.rules.map(ruleKey));
		const liveSet = new Set(liveStar.rules.map(ruleKey));
		const { added, removed } = diffSets(baseSet, liveSet);
		if (added.length || removed.length) {
			failures.push(
				`User-agent: * drift — ${added.length} added, ${removed.length} removed:\n` +
					[...added.map((r) => `  + ${r}`), ...removed.map((r) => `  - ${r}`)].join("\n"),
			);
		}
	}

	for (const ua of ENFORCED_AI_BOTS) {
		const block = findBlock(live.blocks, ua);
		if (!block) {
			failures.push(`AI-bot UA "${ua}" no longer has its own block in live robots.txt.`);
			continue;
		}
		const stillBlocked = block.rules.some((r) => r.directive === "disallow" && r.pattern === "/");
		if (!stillBlocked) {
			failures.push(`AI-bot UA "${ua}" no longer carries Disallow: /. Was eBay's AI-bot ban relaxed?`);
		}
	}

	if (failures.length === 0) {
		console.log("\n✓ No drift detected — baseline still matches live robots.txt.");
		process.exit(0);
	}

	console.error("\n✗ Drift detected:");
	for (const f of failures) console.error(`  - ${f}`);
	console.error(
		"\nNext steps:\n" +
			"  1. Refresh packages/ebay-scraper/data/ebay-robots-baseline.txt with the live file.\n" +
			"  2. Update EXPECTED_VERSION in this script.\n" +
			"  3. Reconcile EBAY_RULES in packages/ebay-scraper/src/robots-guard.ts (and any related tests).\n" +
			"  4. If User-agent: * gained a Disallow that overlaps a path we currently scrape,\n" +
			"     decide whether to (a) drop the scrape or (b) document the new exception in\n" +
			"     apps/docs/src/pages/legal/compliance.astro.\n",
	);
	process.exit(1);
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
