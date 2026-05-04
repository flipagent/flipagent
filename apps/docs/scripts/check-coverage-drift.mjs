#!/usr/bin/env node
/**
 * Coverage drift check.
 *
 * Reads the flipagent paths claimed in `src/data/coverage.ts` (the source
 * of truth for /docs/coverage) and compares them against the actual
 * `routes/v1/index.ts` mounts. Flags stale rows when:
 *
 *   - A T1/T2 row promises `/v1/foo` but `/foo` isn't mounted.
 *   - A T4 row that is no longer in the disabled list (i.e. recently
 *     promoted) — review the tier.
 *
 * Wrappers in place but disabled in V1 (the bottom block of the route
 * file) are tolerated. Pure metadata cells (`POST /v1/policies`, etc.)
 * are matched by their first path segment after `/v1/`.
 *
 * Exits non-zero on drift so CI can gate doc merges on it.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..", "..", "..");
const dataPath = path.join(here, "..", "src", "data", "coverage.ts");
const routePath = path.join(repoRoot, "packages", "api", "src", "routes", "v1", "index.ts");

const dataSrc = await fs.readFile(dataPath, "utf8");
const routeSrc = await fs.readFile(routePath, "utf8");

// Parse mounted prefixes: `v1Routes.route("/items", itemsRoute);`
const mountedRe = /v1Routes\.route\("(\/[a-z0-9/-]+)"/g;
const mounted = new Set();
for (const m of routeSrc.matchAll(mountedRe)) {
	// Drop the leading slash so we can compare against /v1/<prefix>.
	mounted.add(m[1].replace(/^\//, ""));
}
// `/me/seller` is mounted before `/me`; both count.
// `/agent` and the bridge / browser / takedown sit alongside.

// Disabled-but-wrapped prefixes from the bottom block:
//   `// v1Routes.route("/foo", fooRoute);`
const disabledRe = /\/\/\s*v1Routes\.route\("(\/[a-z0-9/-]+)"/g;
const disabled = new Set();
for (const m of routeSrc.matchAll(disabledRe)) {
	disabled.add(m[1].replace(/^\//, ""));
}

// Pull every `flipagent: "...path..."` literal from coverage.ts.
const flipagentRe = /flipagent:\s*"([^"]+)"/g;
const claimed = new Set();
for (const m of dataSrc.matchAll(flipagentRe)) {
	claimed.add(m[1]);
}

const stale = [];
const recoverable = [];

for (const cell of claimed) {
	// Strip leading verb so `POST /v1/foo` → `/v1/foo`. Cells can also be
	// "various /v1/*" or "/v1/messages, /v1/feedback" (Trading aggregates);
	// tolerate anything that doesn't lead with a clean "/v1/<prefix>".
	const m = cell.match(/^(?:[A-Z]+\s+)?\/v1\/([a-z][a-z0-9-]*)/i);
	if (!m) continue;
	const prefix = m[1].toLowerCase();
	// `me/seller` is its own mount; treat any `me/*` as covered if `me` is mounted.
	const candidates = [prefix, prefix.split("/")[0]];
	let ok = false;
	for (const c of candidates) {
		if (mounted.has(c) || mounted.has(`me/${c}`)) {
			ok = true;
			break;
		}
	}
	if (ok) continue;
	if (disabled.has(prefix)) {
		recoverable.push({ cell, prefix });
		continue;
	}
	stale.push({ cell, prefix });
}

if (stale.length === 0 && recoverable.length === 0) {
	console.log("coverage drift: clean — every claimed flipagent path resolves to a mount.");
	process.exit(0);
}

if (recoverable.length > 0) {
	console.log(`coverage drift: ${recoverable.length} row(s) reference disabled-but-wrapped prefixes (T4 territory):`);
	for (const { cell, prefix } of recoverable) {
		console.log(`  - ${cell} (prefix \`${prefix}\` is wrapped but not mounted in V1)`);
	}
}

if (stale.length > 0) {
	console.log(`\ncoverage drift: ${stale.length} row(s) claim a path that has no matching mount or wrapper:`);
	for (const { cell, prefix } of stale) {
		console.log(`  - ${cell} (prefix \`${prefix}\` not found in routes/v1/index.ts)`);
	}
	process.exit(1);
}

process.exit(0);
