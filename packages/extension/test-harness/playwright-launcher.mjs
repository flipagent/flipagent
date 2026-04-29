#!/usr/bin/env node
/**
 * Spawn a real Chrome instance with `packages/extension/dist` loaded as
 * an unpacked extension. Useful for watching the extension drive the
 * eBay buy-flow with your own eyes — chrome.alarms tick, content
 * script injection, in-page confirm modal, the lot.
 *
 * Requires a desktop session (won't work on a headless server). Run
 * from your local machine, not over SSH.
 *
 * What it does:
 *   1. Builds the extension if `dist/` is missing.
 *   2. Launches Chromium via Playwright with the extension loaded.
 *   3. Opens an "options" tab so you can paste your fa_… key + pair.
 *   4. Opens an ebay.com tab so the content script attaches.
 *   5. Tails service-worker + content-script console logs into your terminal.
 *
 * Pair to a LOCAL flipagent (4000 / 4001) — NOT prod — so the orders
 * you queue from the fake-ext harness end up here. Manifest already
 * allows localhost host permissions.
 *
 *   node playwright-launcher.mjs
 *   FLIPAGENT_BASE_URL=http://localhost:4001 node playwright-launcher.mjs
 *
 * Usage tip: keep this terminal open AND a second one running
 *   node fake-ext.mjs queue <itemId>
 * to poke jobs at the running extension. The extension polls every
 * 30s, so a queued job lands within one tick.
 */

import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const EXT_DIR = resolve(__dirname, "..");
const DIST = join(EXT_DIR, "dist");
const BASE = (process.env.FLIPAGENT_BASE_URL || "http://localhost:4001").replace(/\/+$/, "");

function ensureBuilt() {
	if (existsSync(join(DIST, "background.js"))) return;
	console.log("[launcher] dist/ missing — running `npm run build` in", EXT_DIR);
	const r = spawnSync("npm", ["run", "build"], { cwd: EXT_DIR, stdio: "inherit" });
	if (r.status !== 0) {
		console.error("[launcher] build failed.");
		process.exit(1);
	}
}

async function ensurePlaywright() {
	try {
		return await import("playwright");
	} catch {
		console.error(
			[
				"[launcher] Playwright not installed.",
				"Install once with:",
				"  npm i -D playwright && npx playwright install chromium",
				"(Anywhere — Playwright is dev-only; we don't ship it with the extension.)",
			].join("\n"),
		);
		process.exit(1);
	}
}

async function main() {
	ensureBuilt();
	const { chromium } = await ensurePlaywright();

	console.log(`[launcher] FLIPAGENT_BASE_URL = ${BASE}`);
	console.log(`[launcher] loading extension from: ${DIST}`);

	// Persistent context with extension loaded — MV3 service workers
	// only run in a non-headless context with --load-extension.
	const userDataDir = join(EXT_DIR, ".playwright-profile");
	const context = await chromium.launchPersistentContext(userDataDir, {
		headless: false,
		args: [
			`--disable-extensions-except=${DIST}`,
			`--load-extension=${DIST}`,
			"--no-default-browser-check",
		],
	});

	// Tail page console messages.
	context.on("console", (msg) => {
		console.log(`[chrome:console:${msg.type()}] ${msg.text()}`);
	});
	context.on("pageerror", (err) => {
		console.error(`[chrome:error] ${err.message}`);
	});

	// Wait for the service worker to register so we can read its id.
	let sw = context.serviceWorkers()[0];
	if (!sw) {
		sw = await context.waitForEvent("serviceworker", { timeout: 15000 }).catch(() => null);
	}
	if (sw) {
		console.log(`[launcher] service worker active: ${sw.url()}`);
		sw.on("console", (msg) => {
			console.log(`[ext:bg:${msg.type()}] ${msg.text()}`);
		});
	} else {
		console.warn("[launcher] service worker did not register within 15s");
	}

	// Open options + ebay so you can sign in / paste your key, and so
	// the content script attaches.
	const optionsUrl = `chrome-extension://${sw?.url().split("/")[2] ?? "<id>"}/sidepanel.html`;
	if (sw) {
		const opts = await context.newPage();
		await opts.goto(optionsUrl).catch(() => {});
		console.log(`[launcher] opened: ${optionsUrl}`);
	}
	const ebay = await context.newPage();
	await ebay.goto("https://www.ebay.com/").catch(() => {});
	console.log(`[launcher] opened: https://www.ebay.com/  (sign in here, then paste fa_… into the side panel)`);

	console.log("");
	console.log("[launcher] Chrome is up. Queue jobs from another terminal:");
	console.log(`  FLIPAGENT_BASE_URL=${BASE} FLIPAGENT_API_KEY=fa_… node fake-ext.mjs queue <itemId>`);
	console.log("");
	console.log("[launcher] Ctrl-C to quit.");

	process.on("SIGINT", async () => {
		console.log("\n[launcher] shutting down…");
		await context.close().catch(() => {});
		process.exit(0);
	});

	// Hold the process open.
	await new Promise(() => {});
}

main().catch((err) => {
	console.error("[launcher] fatal:", err);
	process.exit(1);
});
