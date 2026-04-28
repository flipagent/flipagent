import { Health } from "@flipagent/types";
import { sql } from "drizzle-orm";
import { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import { isScraperApiConfigured } from "../config.js";
import { db } from "../db/client.js";
import { jsonResponse } from "../utils/openapi.js";

export const healthRoute = new Hono();

healthRoute.get(
	"/",
	describeRoute({
		tags: ["System"],
		summary: "Liveness + Postgres ping",
		security: [],
		responses: {
			200: jsonResponse("Service healthy.", Health),
			503: jsonResponse("Degraded — DB unreachable.", Health),
		},
	}),
	async (c) => {
		const started = Date.now();
		let dbOk = false;
		let dbErr: string | undefined;
		try {
			await db.execute(sql`select 1`);
			dbOk = true;
		} catch (err) {
			dbErr = err instanceof Error ? err.message : String(err);
		}
		return c.json(
			{
				status: dbOk ? "ok" : "degraded",
				db: { ok: dbOk, error: dbErr },
				proxy: isScraperApiConfigured() ? "configured" : "missing",
				latencyMs: Date.now() - started,
				version: process.env.npm_package_version ?? "0.0.0",
				ts: new Date().toISOString(),
			},
			dbOk ? 200 : 503,
		);
	},
);
