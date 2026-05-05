/**
 * esbuild script for the flipagent Chrome extension.
 *
 * Bundles:
 *   src/background.ts → dist/background.js   (MV3 service worker)
 *   src/content.ts    → dist/content.js      (injected into ebay.com tabs)
 *   src/popup.ts      → dist/popup.js        (toolbar action popup UI)
 *   src/sidepanel.ts  → dist/sidepanel.js    (side panel iframe host)
 *   src/presence.ts   → dist/presence.js     (presence beacon on dashboard)
 *
 * Static assets (manifest, html, css, icons) are copied verbatim.
 *
 * Two environments — both deployed, no localhost in either since dev is
 * reached over a tunnel that resolves to *.flipagent.dev:
 *
 *   npm run build          → prod  (api.flipagent.dev / flipagent.dev)
 *                            Manifest reads "flipagent". Chrome Web
 *                            Store builds use this.
 *   npm run build:dev      → dev   (api-dev.flipagent.dev / dev.flipagent.dev)
 *                            Manifest reads "flipagent (dev)" so a
 *                            sideloaded dev install + a Web Store prod
 *                            install can coexist in one Chrome profile.
 *
 * Hostnames are baked in via esbuild `define`. Override per-build with
 *   FLIPAGENT_API_BASE=… FLIPAGENT_DASHBOARD_BASE=… npm run build:dev
 * (rare — used when working against an alternate tunnel host).
 *
 * Usage:
 *   node build.mjs               — prod, one-shot
 *   node build.mjs --dev         — dev, one-shot
 *   node build.mjs --dev --watch — dev, watch mode
 */

import { build, context } from "esbuild";
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname);
const outDir = resolve(root, "dist");
const watch = process.argv.includes("--watch");
const isDev = process.argv.includes("--dev");

const ENVIRONMENTS = {
	prod: {
		apiBase: "https://api.flipagent.dev",
		dashboardBase: "https://flipagent.dev",
		nameSuffix: null,
	},
	dev: {
		apiBase: "https://api-dev.flipagent.dev",
		dashboardBase: "https://dev.flipagent.dev",
		nameSuffix: "dev",
	},
};

const env = isDev ? ENVIRONMENTS.dev : ENVIRONMENTS.prod;
const apiBase = process.env.FLIPAGENT_API_BASE ?? env.apiBase;
const dashboardBase = process.env.FLIPAGENT_DASHBOARD_BASE ?? env.dashboardBase;

rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

const sharedOpts = {
	bundle: true,
	platform: "browser",
	format: "esm",
	target: "chrome120",
	sourcemap: true,
	logLevel: "info",
	define: {
		__FLIPAGENT_API_BASE__: JSON.stringify(apiBase),
		__FLIPAGENT_DASHBOARD_BASE__: JSON.stringify(dashboardBase),
		__FLIPAGENT_BUILD_ENV__: JSON.stringify(isDev ? "dev" : "prod"),
	},
};

const targets = [
	{ entryPoints: [resolve(root, "src/background.ts")], outfile: resolve(outDir, "background.js") },
	{ entryPoints: [resolve(root, "src/content.ts")], outfile: resolve(outDir, "content.js") },
	{ entryPoints: [resolve(root, "src/popup.ts")], outfile: resolve(outDir, "popup.js") },
	{ entryPoints: [resolve(root, "src/sidepanel.ts")], outfile: resolve(outDir, "sidepanel.js") },
	{ entryPoints: [resolve(root, "src/presence.ts")], outfile: resolve(outDir, "presence.js") },
];

function copyStatic() {
	// Append a "(dev)" suffix on the dev install's display name so a
	// sideloaded dev build and a Chrome Web Store prod install can sit
	// side-by-side in the same Chrome profile without their action
	// buttons being indistinguishable. Chrome already keys installs by
	// extension id; the suffix just helps human eyes.
	const manifest = JSON.parse(readFileSync(resolve(root, "manifest.json"), "utf8"));
	if (env.nameSuffix) {
		manifest.name = `${manifest.name} (${env.nameSuffix})`;
	}
	writeFileSync(resolve(outDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
	cpSync(resolve(root, "src/popup.html"), resolve(outDir, "popup.html"));
	cpSync(resolve(root, "src/popup.css"), resolve(outDir, "popup.css"));
	cpSync(resolve(root, "src/sidepanel.html"), resolve(outDir, "sidepanel.html"));
	cpSync(resolve(root, "src/sidepanel.css"), resolve(outDir, "sidepanel.css"));
	cpSync(resolve(root, "src/logo-mark.png"), resolve(outDir, "logo-mark.png"));
	cpSync(resolve(root, "icons"), resolve(outDir, "icons"), { recursive: true });
}

const envLabel = isDev ? "dev" : "prod";
if (watch) {
	const ctxs = await Promise.all(targets.map((t) => context({ ...sharedOpts, ...t })));
	await Promise.all(ctxs.map((c) => c.watch()));
	copyStatic();
	console.log(`[extension] watching… (${envLabel}: api=${apiBase}, dashboard=${dashboardBase})`);
} else {
	await Promise.all(targets.map((t) => build({ ...sharedOpts, ...t })));
	copyStatic();
	console.log(`[extension] built → ${outDir}  (${envLabel}: api=${apiBase}, dashboard=${dashboardBase})`);
}
