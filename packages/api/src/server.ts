#!/usr/bin/env node
import { serve } from "@hono/node-server";
import { app } from "./app.js";
import { config } from "./config.js";
import { closeDb } from "./db/client.js";
import { failOrphans } from "./services/compute-jobs/queue.js";

// Single-replica deploy: any compute_jobs left in `running` state predate
// this process and their worker is gone. Fail them so the user sees a
// clear outcome instead of a row stuck on "Running" forever.
void failOrphans()
	.then((n) => {
		if (n > 0) console.log(`[api] failed ${n} orphaned compute job${n === 1 ? "" : "s"}`);
	})
	.catch((err) => console.error("[api] compute-job orphan sweep failed:", err));

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
