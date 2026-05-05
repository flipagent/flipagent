/**
 * esbuild script for the flipagent Chrome extension.
 *
 * Bundles:
 *   src/background.ts → dist/background.js   (MV3 service worker)
 *   src/content.ts    → dist/content.js      (injected into ebay.com tabs)
 *   src/popup.ts      → dist/popup.js        (toolbar action popup UI)
 *
 * Static assets (manifest, html, css, icons) are copied verbatim.
 *
 * Usage:
 *   node build.mjs            — one-shot build
 *   node build.mjs --watch    — watch mode for dev
 */

import { build, context } from "esbuild";
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname);
const outDir = resolve(root, "dist");
const watch = process.argv.includes("--watch");

/* `--dev` swaps the production hostnames for localhost so an unpacked
 * dev build talks to the api/docs servers running on the developer's
 * own machine. The published Chrome Web Store build (default — no
 * flag) bakes in the production hosts. Hosts are injected as
 * compile-time string constants via esbuild `define`; runtime config
 * overrides are still honoured (loadConfig.baseUrl wins).
 *
 *   npm run build                       → prod (api.flipagent.dev / flipagent.dev)
 *   npm run build:dev                   → dev  (localhost:4000   / localhost:4321)
 *   FLIPAGENT_API_BASE=http://localhost:4001 npm run build:dev
 *                                       → dev w/ custom api port (e.g. when
 *                                         your dev server isn't on the default 4000)
 */
const isDev = process.argv.includes("--dev");
const apiBase = process.env.FLIPAGENT_API_BASE ?? (isDev ? "http://localhost:4000" : "https://api.flipagent.dev");
const dashboardBase = process.env.FLIPAGENT_DASHBOARD_BASE ?? (isDev ? "http://localhost:4321" : "https://flipagent.dev");

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
	// Dev builds get a "(dev)" suffix on the extension name so both
	// the Chrome Web Store install (prod) and an unpacked dev install
	// can coexist in the same Chrome profile without colliding. Chrome
	// keys each install by extension id, but a same-named action button
	// is confusing to operate.
	const manifest = JSON.parse(readFileSync(resolve(root, "manifest.json"), "utf8"));
	if (isDev) {
		manifest.name = `${manifest.name} (dev)`;
	} else {
		// Prod build (Chrome Web Store): strip localhost host_permissions and
		// content_scripts / externally_connectable matches. Reviewers reject
		// extensions that request hosts they don't actually use in production.
		const isProdHost = (m) => !m.startsWith("http://localhost");
		manifest.host_permissions = (manifest.host_permissions ?? []).filter(isProdHost);
		manifest.content_scripts = (manifest.content_scripts ?? []).map((cs) => ({
			...cs,
			matches: (cs.matches ?? []).filter(isProdHost),
		}));
		if (manifest.externally_connectable?.matches) {
			manifest.externally_connectable.matches = manifest.externally_connectable.matches.filter(isProdHost);
		}
	}
	writeFileSync(resolve(outDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
	cpSync(resolve(root, "src/popup.html"), resolve(outDir, "popup.html"));
	cpSync(resolve(root, "src/popup.css"), resolve(outDir, "popup.css"));
	cpSync(resolve(root, "src/sidepanel.html"), resolve(outDir, "sidepanel.html"));
	cpSync(resolve(root, "src/sidepanel.css"), resolve(outDir, "sidepanel.css"));
	cpSync(resolve(root, "src/logo-mark.png"), resolve(outDir, "logo-mark.png"));
	cpSync(resolve(root, "icons"), resolve(outDir, "icons"), { recursive: true });
}

if (watch) {
	const ctxs = await Promise.all(targets.map((t) => context({ ...sharedOpts, ...t })));
	await Promise.all(ctxs.map((c) => c.watch()));
	copyStatic();
	console.log(`[extension] watching… (${isDev ? "dev" : "prod"} hosts: api=${apiBase}, dashboard=${dashboardBase})`);
} else {
	await Promise.all(targets.map((t) => build({ ...sharedOpts, ...t })));
	copyStatic();
	console.log(`[extension] built → ${outDir}  (${isDev ? "dev" : "prod"} hosts: api=${apiBase}, dashboard=${dashboardBase})`);
}
