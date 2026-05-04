/**
 * Diff every wrapper path in flipagent against the bundled eBay OpenAPI
 * specs at `references/ebay-mcp/docs/**\/*_oas3.json`. Three buckets:
 *
 *   1. **Spec-only**   — eBay defines an endpoint we don't wrap (MISS rows
 *                       in `notes/ebay-endpoints.md` Section 1; review for
 *                       coverage opportunities).
 *   2. **Wrapper-only** — we call a path that the spec doesn't list. Either
 *                       the wrapper has a path bug, or the spec is stale,
 *                       or we wrap a Limited Release / undocumented endpoint.
 *   3. **Match**       — wrapper + spec agree.
 *
 * Specs missing from the bundle (Buy Browse / Marketplace Insights / Order /
 * Offer / Feed / Deal, Sell Finances / Logistics / Stores v2 / Feed,
 * Commerce Charity / Catalog / Taxonomy / Media, post-order/v2) — eBay's
 * dev portal blocks anonymous downloads. Coverage for those was verified
 * live by `ebay-path-sweep.ts` (every path returned an envelope-bearing
 * response, not the empty-404 wrong-host signature).
 *
 * Run: cd packages/api && node --import tsx scripts/ebay-spec-diff.ts
 */

import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import * as ts from "typescript";

interface OasPath {
	method: string;
	path: string;
	host: string;
	specFile: string;
}

interface WrapperRef {
	method: string;
	path: string;
	source: string;
}

const REPO_ROOT = join(import.meta.dirname, "..", "..", "..");
const SPECS_DIR = join(REPO_ROOT, "references", "ebay-mcp", "docs");
const SERVICES_DIR = join(REPO_ROOT, "packages", "api", "src", "services");

function findSpecs(dir: string): string[] {
	const out: string[] = [];
	for (const name of readdirSync(dir)) {
		const full = join(dir, name);
		const stat = statSync(full);
		if (stat.isDirectory()) out.push(...findSpecs(full));
		else if (name.endsWith("_oas3.json")) out.push(full);
	}
	return out;
}

function extractSpecPaths(specFile: string): OasPath[] {
	const raw = JSON.parse(readFileSync(specFile, "utf8")) as {
		servers?: Array<{ url: string; variables?: { basePath?: { default?: string } } }>;
		paths?: Record<string, Record<string, unknown>>;
	};
	const server = raw.servers?.[0];
	const host = server?.url?.replace(/\{basePath\}.*$/, "") ?? "";
	const basePath = server?.variables?.basePath?.default ?? "";
	const out: OasPath[] = [];
	for (const [pathKey, methods] of Object.entries(raw.paths ?? {})) {
		const fullPath = `${basePath}${pathKey}`.replace(/\/+$/, "");
		for (const method of Object.keys(methods)) {
			if (["get", "post", "put", "delete", "patch"].includes(method.toLowerCase())) {
				out.push({
					method: method.toUpperCase(),
					path: fullPath,
					host,
					specFile: relative(REPO_ROOT, specFile),
				});
			}
		}
	}
	return out;
}

/**
 * Walk every `sellRequest<T>(...)` and `appRequest<T>(...)` call site
 * via the TypeScript compiler API. The earlier regex-based extractor
 * missed paths assembled from template literals (e.g. `${id}`),
 * undercounting matched wrappers by ~3x and inflating the MISS bucket.
 * This is a streamlined copy of `extractWrapperCalls` from
 * `ebay-field-diff.ts` — same AST traversal, just returns method+path.
 */
const REQUEST_FUNCS = new Set(["sellRequest", "sellRequestWithLocation", "appRequest"]);

function findWrapperPaths(dir: string): WrapperRef[] {
	const out: WrapperRef[] = [];
	for (const name of readdirSync(dir)) {
		const full = join(dir, name);
		const stat = statSync(full);
		if (stat.isDirectory()) {
			out.push(...findWrapperPaths(full));
			continue;
		}
		if (!name.endsWith(".ts") || name.endsWith(".d.ts")) continue;
		const text = readFileSync(full, "utf8");
		const sf = ts.createSourceFile(full, text, ts.ScriptTarget.ES2022, true);
		function visit(node: ts.Node) {
			if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && REQUEST_FUNCS.has(node.expression.text)) {
				const opts = node.arguments[0];
				if (opts && ts.isObjectLiteralExpression(opts)) {
					let method = "GET";
					let path = "";
					for (const prop of opts.properties) {
						if (!ts.isPropertyAssignment(prop)) continue;
						const key = prop.name.getText();
						if (key === "method") {
							if (ts.isStringLiteral(prop.initializer) || ts.isNoSubstitutionTemplateLiteral(prop.initializer)) {
								method = prop.initializer.text.toUpperCase();
							}
						} else if (key === "path") {
							if (ts.isStringLiteral(prop.initializer)) path = prop.initializer.text;
							else if (ts.isTemplateExpression(prop.initializer)) {
								path = prop.initializer.head.text;
								for (const span of prop.initializer.templateSpans) {
									path += "{X}" + span.literal.text;
								}
							} else if (ts.isNoSubstitutionTemplateLiteral(prop.initializer)) {
								path = prop.initializer.text;
							}
						}
					}
					path = path.split("?")[0]!;
					if (path.startsWith("/")) {
						const lc = sf.getLineAndCharacterOfPosition(node.pos);
						out.push({ method, path, source: `${relative(REPO_ROOT, full)}:${lc.line + 1}` });
					}
				}
			}
			ts.forEachChild(node, visit);
		}
		visit(sf);
	}
	return out;
}

/**
 * Normalize a path for comparison: collapse path params (`{x}`, `${x}`,
 * `:x`) to a placeholder, drop query strings, drop trailing slashes.
 */
function normalize(path: string): string {
	return path
		.replace(/\?.*$/, "")
		.replace(/\$\{[^}]+\}/g, "{X}")
		.replace(/\{[^}]+\}/g, "{X}")
		.replace(/\/+$/, "");
}

function main(): void {
	const specs = findSpecs(SPECS_DIR);
	console.error(`[diff] specs: ${specs.length}`);
	const specPaths: OasPath[] = [];
	for (const f of specs) specPaths.push(...extractSpecPaths(f));
	console.error(`[diff] spec endpoints: ${specPaths.length}`);

	const wrapperPaths = findWrapperPaths(SERVICES_DIR);
	console.error(`[diff] wrapper paths: ${wrapperPaths.length}`);

	const specSet = new Map<string, OasPath[]>();
	for (const s of specPaths) {
		const key = `${s.method} ${normalize(s.path)}`;
		(specSet.get(key) ?? specSet.set(key, []).get(key)!).push(s);
	}
	const wrapperSet = new Map<string, WrapperRef[]>();
	for (const w of wrapperPaths) {
		const key = `${w.method} ${normalize(w.path)}`;
		(wrapperSet.get(key) ?? wrapperSet.set(key, []).get(key)!).push(w);
	}

	const matched: string[] = [];
	const wrapperOnly: string[] = [];
	const specOnly: string[] = [];
	for (const key of wrapperSet.keys()) {
		if (specSet.has(key)) matched.push(key);
		else wrapperOnly.push(key);
	}
	for (const key of specSet.keys()) {
		if (!wrapperSet.has(key)) specOnly.push(key);
	}

	// "wrapper-only" filter: skip paths that are clearly out of any spec we have
	// (Buy *, Sell Finances/Logistics/Stores v2/Feed, Commerce Charity/Catalog/
	// Taxonomy/Media, post-order/*, sell/recommendation v1 — spec exists for v1
	// but path style is `find` which we already use). The interesting subset is
	// wrapper-only paths that LIE INSIDE A SPEC WE HAVE — those are real bugs.
	const haveSpecPrefixes = new Set<string>();
	for (const s of specPaths) {
		const m = s.path.match(/^\/(sell|buy|commerce|post-order)\/[^/]+\/v[0-9_a-z]+/);
		if (m) haveSpecPrefixes.add(m[0]);
	}
	const wrapperOnlyInsideSpec = wrapperOnly.filter((key) => {
		const path = key.split(" ")[1]!;
		return [...haveSpecPrefixes].some((p) => path.startsWith(p));
	});

	console.error(`\n[diff] matched: ${matched.length}`);
	console.error(`[diff] wrapper-only (spec exists, wrapper path not found): ${wrapperOnlyInsideSpec.length}`);
	console.error(`[diff] wrapper-only (no spec available): ${wrapperOnly.length - wrapperOnlyInsideSpec.length}`);
	console.error(`[diff] spec-only (we don't wrap): ${specOnly.length}`);

	const report = {
		matched: matched.sort(),
		wrapperOnlyInsideSpec: wrapperOnlyInsideSpec.sort().map((key) => ({
			key,
			sources: wrapperSet.get(key)?.map((w) => w.source) ?? [],
		})),
		wrapperOnlyNoSpec: wrapperOnly
			.filter((k) => !wrapperOnlyInsideSpec.includes(k))
			.sort()
			.map((key) => ({
				key,
				sources: wrapperSet.get(key)?.map((w) => w.source) ?? [],
			})),
		specOnly: specOnly.sort().map((key) => ({
			key,
			specs: specSet.get(key)?.map((s) => s.specFile) ?? [],
		})),
		havingSpec: [...haveSpecPrefixes].sort(),
		summary: {
			specCount: specs.length,
			specEndpointCount: specPaths.length,
			wrapperPathCount: wrapperPaths.length,
			matched: matched.length,
			wrapperOnlyInsideSpec: wrapperOnlyInsideSpec.length,
			wrapperOnlyNoSpec: wrapperOnly.length - wrapperOnlyInsideSpec.length,
			specOnly: specOnly.length,
		},
	};
	const out = join(REPO_ROOT, "notes", "ebay-spec-diff.json");
	writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`);
	console.error(`[diff] wrote ${out}`);
}

main();
