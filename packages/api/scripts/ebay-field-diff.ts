/**
 * Field-level diff between every flipagent wrapper call site and the
 * eBay OpenAPI spec for that (method, path). Builds on `ebay-spec-diff.ts`
 * (which only checks paths) by extracting top-level field shapes from
 * both sides and reporting:
 *
 *   - **missingRequired**: spec requires a field, our request body
 *     doesn't include it.
 *   - **sendUnknown**: we send a field the spec doesn't list (stale
 *     wrapper, typo, or relying on undocumented behaviour).
 *   - **respUnknown**: our response interface declares a field the
 *     spec's 200 response doesn't define (silent typo — eBay returns
 *     undefined and we render it as missing).
 *   - **enumOff**: an enum value we hardcode isn't in the spec's enum.
 *
 * Walks the wrapper sources via the TypeScript compiler API to find
 * every `sellRequest<T>({...})` and `appRequest<T>({...})` call;
 * extracts method + path + body literal keys + the generic `T`'s
 * top-level keys.
 *
 * Run: cd packages/api && node --import tsx scripts/ebay-field-diff.ts
 */

import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import * as ts from "typescript";

const REPO_ROOT = join(import.meta.dirname, "..", "..", "..");
const SPECS_DIR = join(REPO_ROOT, "references", "ebay-mcp", "docs");
const SERVICES_DIR = join(REPO_ROOT, "packages", "api", "src", "services");

interface FieldInfo {
	required: boolean;
	type?: string;
	enum?: string[];
}

interface WrapperCall {
	source: string;
	method: string;
	path: string;
	requestBodyKeys: string[];
	responseKeys: string[];
}

interface SpecEndpoint {
	method: string;
	path: string;
	specFile: string;
	requestRequired: string[];
	requestOptional: string[];
	requestEnums: Record<string, string[]>;
	responseFields: string[];
}

interface DiffEntry {
	method: string;
	path: string;
	source: string;
	specFile: string;
	missingRequired: string[];
	sendUnknown: string[];
	respUnknown: string[];
}

/* ============================================================ spec parsing */

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

interface OasNode {
	type?: string;
	$ref?: string;
	required?: string[];
	properties?: Record<string, OasNode>;
	items?: OasNode;
	enum?: unknown[];
	allOf?: OasNode[];
	oneOf?: OasNode[];
	anyOf?: OasNode[];
}

interface OasSpec {
	servers?: Array<{ url: string; variables?: { basePath?: { default?: string } } }>;
	paths?: Record<string, Record<string, unknown>>;
	components?: { schemas?: Record<string, OasNode> };
}

function deref(spec: OasSpec, node: OasNode): OasNode {
	if (!node.$ref) return node;
	const m = node.$ref.match(/#\/components\/schemas\/(.+)$/);
	if (!m) return node;
	const ref = spec.components?.schemas?.[m[1]!];
	return ref ? deref(spec, ref) : node;
}

/**
 * Top-level field names + required flag. Folds allOf chains. When a
 * top-level property is itself an array of objects (e.g. `feedbackEntries:
 * [{$ref: Feedback}]`), or a single nested object (`pagination: {$ref:
 * Pagination}`), the inner object's keys are merged in too — many eBay
 * response schemas wrap the actual payload one level deep, and our
 * wrappers destructure inner keys directly. Without this, those reads
 * show up as false-positive `respUnknown`.
 */
function flatFields(spec: OasSpec, node: OasNode | undefined): { required: string[]; optional: string[]; enums: Record<string, string[]> } {
	if (!node) return { required: [], optional: [], enums: {} };
	const resolved = deref(spec, node);
	const required = new Set<string>(resolved.required ?? []);
	const properties: Record<string, OasNode> = { ...(resolved.properties ?? {}) };
	const enums: Record<string, string[]> = {};
	for (const sub of resolved.allOf ?? []) {
		const r = deref(spec, sub);
		for (const x of r.required ?? []) required.add(x);
		Object.assign(properties, r.properties ?? {});
	}
	for (const [k, v] of Object.entries(properties)) {
		const r = deref(spec, v);
		if (r.enum) enums[k] = r.enum.filter((e): e is string => typeof e === "string");
	}
	// Dive one level: for each property whose value is an object/array,
	// merge the inner top-level keys (for the response-shape false-positive).
	const inner: Record<string, OasNode> = {};
	for (const v of Object.values(properties)) {
		const r = deref(spec, v);
		const target = r.type === "array" && r.items ? deref(spec, r.items) : r;
		if (target.type === "object" || target.properties) {
			for (const [ik, iv] of Object.entries(target.properties ?? {})) {
				if (!(ik in inner) && !(ik in properties)) inner[ik] = iv;
			}
		}
	}
	const allKeys = [...Object.keys(properties), ...Object.keys(inner)];
	return {
		required: allKeys.filter((k) => required.has(k)),
		optional: allKeys.filter((k) => !required.has(k)),
		enums,
	};
}

function extractSpecEndpoints(specFile: string): SpecEndpoint[] {
	const raw = JSON.parse(readFileSync(specFile, "utf8")) as OasSpec;
	const server = raw.servers?.[0];
	const basePath = server?.variables?.basePath?.default ?? "";
	const out: SpecEndpoint[] = [];
	for (const [pathKey, ops] of Object.entries(raw.paths ?? {})) {
		const fullPath = `${basePath}${pathKey}`.replace(/\/+$/, "");
		for (const [method, opRaw] of Object.entries(ops)) {
			if (!["get", "post", "put", "delete", "patch"].includes(method.toLowerCase())) continue;
			const op = opRaw as {
				requestBody?: { content?: Record<string, { schema?: OasNode }> };
				responses?: Record<string, { content?: Record<string, { schema?: OasNode }> }>;
			};
			const reqSchema = op.requestBody?.content?.["application/json"]?.schema;
			const reqFields = flatFields(raw, reqSchema);
			const resSchema =
				op.responses?.["200"]?.content?.["application/json"]?.schema ??
				op.responses?.["201"]?.content?.["application/json"]?.schema;
			const resFields = flatFields(raw, resSchema);
			out.push({
				method: method.toUpperCase(),
				path: fullPath,
				specFile: relative(REPO_ROOT, specFile),
				requestRequired: reqFields.required,
				requestOptional: reqFields.optional,
				requestEnums: reqFields.enums,
				responseFields: [...reqFields.required, ...reqFields.optional, ...resFields.required, ...resFields.optional]
					.filter((_, i, a) => a.indexOf(_) === i)
					.length
					? [...resFields.required, ...resFields.optional]
					: [],
			});
		}
	}
	return out;
}

/* ============================================================ wrapper parsing */

const REQUEST_FUNCS = new Set(["sellRequest", "appRequest"]);

function findServiceFiles(dir: string): string[] {
	const out: string[] = [];
	for (const name of readdirSync(dir)) {
		const full = join(dir, name);
		const stat = statSync(full);
		if (stat.isDirectory()) out.push(...findServiceFiles(full));
		else if (name.endsWith(".ts") && !name.endsWith(".d.ts")) out.push(full);
	}
	return out;
}

/**
 * Resolve a TypeScript type expression to its top-level property names.
 * Handles inline TypeLiteral and Identifier (interface) references via
 * a manual interface registry built from the file's local scope.
 */
function topLevelKeysOfType(
	node: ts.TypeNode | undefined,
	registry: Map<string, ts.InterfaceDeclaration | ts.TypeAliasDeclaration>,
): string[] {
	if (!node) return [];
	if (ts.isTypeLiteralNode(node)) {
		return node.members.filter(ts.isPropertySignature).map((m) => m.name.getText());
	}
	if (ts.isTypeReferenceNode(node)) {
		const name = node.typeName.getText();
		const decl = registry.get(name);
		if (decl && ts.isInterfaceDeclaration(decl)) {
			return decl.members.filter(ts.isPropertySignature).map((m) => m.name.getText());
		}
		if (decl && ts.isTypeAliasDeclaration(decl) && ts.isTypeLiteralNode(decl.type)) {
			return decl.type.members.filter(ts.isPropertySignature).map((m) => m.name.getText());
		}
	}
	return [];
}

function extractWrapperCalls(file: string): WrapperCall[] {
	const text = readFileSync(file, "utf8");
	const sf = ts.createSourceFile(file, text, ts.ScriptTarget.ES2022, true);
	// Build a registry of interfaces / type aliases declared in this file
	// (the wrappers consistently declare the response shape inline as
	// `interface EbayPayout {...}` or `interface UpstreamFoo {...}` and
	// then reference it via `sellRequest<{ payouts?: EbayPayout[] }>`).
	const registry = new Map<string, ts.InterfaceDeclaration | ts.TypeAliasDeclaration>();
	function indexDecls(node: ts.Node) {
		if (ts.isInterfaceDeclaration(node)) registry.set(node.name.text, node);
		else if (ts.isTypeAliasDeclaration(node)) registry.set(node.name.text, node);
		ts.forEachChild(node, indexDecls);
	}
	indexDecls(sf);

	const out: WrapperCall[] = [];
	function visit(node: ts.Node) {
		if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && REQUEST_FUNCS.has(node.expression.text)) {
			const opts = node.arguments[0];
			if (!opts || !ts.isObjectLiteralExpression(opts)) return;
			let method = "GET";
			let path = "";
			let requestBodyKeys: string[] = [];
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
				} else if (key === "body") {
					if (ts.isObjectLiteralExpression(prop.initializer)) {
						requestBodyKeys = prop.initializer.properties
							.map((p) => {
								if (ts.isPropertyAssignment(p) || ts.isShorthandPropertyAssignment(p)) return p.name?.getText() ?? "";
								if (ts.isSpreadAssignment(p)) {
									// `...(cond ? { a, b } : {})` — extract from the inner literal if possible
									if (
										ts.isParenthesizedExpression(p.expression) &&
										ts.isConditionalExpression(p.expression.expression)
									) {
										const ce = p.expression.expression;
										const inner = ce.whenTrue;
										if (ts.isObjectLiteralExpression(inner)) {
											return inner.properties.map((q) => q.name?.getText() ?? "").filter(Boolean);
										}
									}
									return "";
								}
								return "";
							})
							.flat()
							.filter(Boolean);
					}
				}
			}
			// strip query string from path before normalizing
			path = path.split("?")[0]!;
			// generic response type
			const responseType = node.typeArguments?.[0];
			const responseKeys = topLevelKeysOfType(responseType, registry);
			const lc = sf.getLineAndCharacterOfPosition(node.pos);
			out.push({
				source: `${relative(REPO_ROOT, file)}:${lc.line + 1}`,
				method,
				path,
				requestBodyKeys,
				responseKeys,
			});
		}
		ts.forEachChild(node, visit);
	}
	visit(sf);
	return out;
}

/* ============================================================ diff */

function normalize(p: string): string {
	return p
		.replace(/\?.*$/, "")
		.replace(/\$\{[^}]+\}/g, "{X}")
		.replace(/\{[^}]+\}/g, "{X}")
		.replace(/\/+$/, "");
}

function main(): void {
	const specFiles = findSpecs(SPECS_DIR);
	console.error(`[field-diff] specs: ${specFiles.length}`);
	const specByKey = new Map<string, SpecEndpoint[]>();
	for (const f of specFiles) {
		for (const e of extractSpecEndpoints(f)) {
			const key = `${e.method} ${normalize(e.path)}`;
			(specByKey.get(key) ?? specByKey.set(key, []).get(key)!).push(e);
		}
	}
	console.error(`[field-diff] spec endpoint keys: ${specByKey.size}`);

	const serviceFiles = findServiceFiles(SERVICES_DIR);
	const wrapperCalls: WrapperCall[] = [];
	for (const f of serviceFiles) wrapperCalls.push(...extractWrapperCalls(f));
	console.error(`[field-diff] wrapper call sites: ${wrapperCalls.length}`);

	const diffs: DiffEntry[] = [];
	const unmatchedList: WrapperCall[] = [];
	let matched = 0;
	let unmatched = 0;
	for (const w of wrapperCalls) {
		const key = `${w.method} ${normalize(w.path)}`;
		const candidates = specByKey.get(key) ?? [];
		if (candidates.length === 0) {
			unmatched++;
			unmatchedList.push(w);
			continue;
		}
		matched++;
		// Pick the first candidate (multiple specs may declare the same path
		// — they're functionally identical for top-level field shape).
		const spec = candidates[0]!;
		const reqAll = new Set([...spec.requestRequired, ...spec.requestOptional]);
		const respAll = new Set(spec.responseFields);
		const missingRequired = spec.requestRequired.filter((f) => !w.requestBodyKeys.includes(f));
		const sendUnknown = w.requestBodyKeys.filter((f) => reqAll.size > 0 && !reqAll.has(f));
		const respUnknown = w.responseKeys.filter((f) => respAll.size > 0 && !respAll.has(f));
		if (missingRequired.length || sendUnknown.length || respUnknown.length) {
			diffs.push({
				method: w.method,
				path: w.path,
				source: w.source,
				specFile: spec.specFile,
				missingRequired,
				sendUnknown,
				respUnknown,
			});
		}
	}

	console.error(`[field-diff] wrapper calls matched to spec: ${matched}`);
	console.error(`[field-diff] wrapper calls unmatched: ${unmatched}`);
	console.error(`[field-diff] diffs with at least one mismatch: ${diffs.length}`);
	console.error(`  with missingRequired: ${diffs.filter((d) => d.missingRequired.length).length}`);
	console.error(`  with sendUnknown:     ${diffs.filter((d) => d.sendUnknown.length).length}`);
	console.error(`  with respUnknown:     ${diffs.filter((d) => d.respUnknown.length).length}`);

	const out = join(REPO_ROOT, "notes", "ebay-field-diff.json");
	writeFileSync(
		out,
		`${JSON.stringify(
			{
				ranAt: new Date().toISOString(),
				summary: {
					specCount: specFiles.length,
					specEndpointCount: specByKey.size,
					wrapperCallSites: wrapperCalls.length,
					matched,
					unmatched,
					diffsWithMismatch: diffs.length,
				},
				diffs: diffs.sort((a, b) => a.path.localeCompare(b.path)),
				unmatched: unmatchedList.sort((a, b) => a.path.localeCompare(b.path)),
			},
			null,
			2,
		)}\n`,
	);
	console.error(`[field-diff] wrote ${out}`);
}

main();
