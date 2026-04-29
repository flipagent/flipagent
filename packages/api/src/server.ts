#!/usr/bin/env node
import { serve } from "@hono/node-server";
import { app } from "./app.js";
import { config } from "./config.js";
import { closeDb } from "./db/client.js";
import { startWatchlistScheduler, stopWatchlistScheduler } from "./services/watchlists/scheduler.js";

const server = serve({ fetch: app.fetch, port: config.PORT }, (info) => {
	console.log(`[api] listening on http://0.0.0.0:${info.port} (env=${config.NODE_ENV})`);
});

// In-process watchlist scheduler — picks due watchlists every minute
// and runs scans, plus an hourly digest sweep. Gated behind env so a
// multi-replica deploy can pin the worker to a single instance.
startWatchlistScheduler();

async function shutdown(signal: string) {
	console.log(`[api] received ${signal}, shutting down`);
	stopWatchlistScheduler();
	server.close();
	await closeDb();
	process.exit(0);
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
