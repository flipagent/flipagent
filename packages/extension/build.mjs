/**
 * esbuild script for the flipagent Chrome extension.
 *
 * Bundles:
 *   src/background.ts → dist/background.js   (MV3 service worker)
 *   src/content.ts    → dist/content.js      (injected into ebay.com tabs)
 *   src/sidepanel.ts  → dist/sidepanel.js    (chrome.sidePanel UI; Chrome 114+)
 *
 * Static assets (manifest, html, icons) are copied verbatim.
 *
 * Usage:
 *   node build.mjs            — one-shot build
 *   node build.mjs --watch    — watch mode for dev
 */

import { build, context } from "esbuild";
import { cpSync, mkdirSync, rmSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname);
const outDir = resolve(root, "dist");
const watch = process.argv.includes("--watch");

rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

const sharedOpts = {
	bundle: true,
	platform: "browser",
	format: "esm",
	target: "chrome120",
	sourcemap: true,
	logLevel: "info",
};

const targets = [
	{ entryPoints: [resolve(root, "src/background.ts")], outfile: resolve(outDir, "background.js") },
	{ entryPoints: [resolve(root, "src/content.ts")], outfile: resolve(outDir, "content.js") },
	{ entryPoints: [resolve(root, "src/sidepanel.ts")], outfile: resolve(outDir, "sidepanel.js") },
];

function copyStatic() {
	cpSync(resolve(root, "manifest.json"), resolve(outDir, "manifest.json"));
	cpSync(resolve(root, "src/sidepanel.html"), resolve(outDir, "sidepanel.html"));
	cpSync(resolve(root, "icons"), resolve(outDir, "icons"), { recursive: true });
}

if (watch) {
	const ctxs = await Promise.all(targets.map((t) => context({ ...sharedOpts, ...t })));
	await Promise.all(ctxs.map((c) => c.watch()));
	copyStatic();
	console.log("[extension] watching…");
} else {
	await Promise.all(targets.map((t) => build({ ...sharedOpts, ...t })));
	copyStatic();
	console.log("[extension] built →", outDir);
}
