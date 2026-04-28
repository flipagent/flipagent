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
