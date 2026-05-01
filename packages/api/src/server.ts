#!/usr/bin/env node
import { serve } from "@hono/node-server";
import { app } from "./app.js";
import { config } from "./config.js";
import { closeDb } from "./db/client.js";

const server = serve({ fetch: app.fetch, port: config.PORT }, (info) => {
	console.log(`[api] listening on http://0.0.0.0:${info.port} (env=${config.NODE_ENV})`);
});

async function shutdown(signal: string) {
	console.log(`[api] received ${signal}, shutting down`);
	server.close();
	await closeDb();
	process.exit(0);
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

// Surface stray async failures with context. Default Node behavior on
// unhandledRejection (Node 15+) is to terminate; we let that happen
// after logging so Container Apps restarts a fresh replica with a
// clean state rather than silently absorbing a corrupt one.
process.on("unhandledRejection", (reason) => {
	console.error("[api] unhandledRejection:", reason);
});
process.on("uncaughtException", (err) => {
	console.error("[api] uncaughtException:", err);
	process.exit(1);
});
