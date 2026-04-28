#!/usr/bin/env tsx
/**
 * Dumps the OpenAPI spec generated from the live Hono app to a file.
 *
 * Used by `apps/docs`'s prebuild / predev hooks so the docs site can
 * serve `/openapi.json` as a static asset (no API server required, no
 * CORS, works offline). The route registry is the source of truth —
 * adding/removing/changing a route's `describeRoute()` metadata
 * propagates to the published spec on the next docs build.
 *
 * Usage: tsx src/scripts/dump-spec.ts <output-path>
 */

import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { generateSpecs } from "hono-openapi";
import { app } from "../app.js";
import { documentation } from "../openapi.js";

async function main() {
	const out = process.argv[2];
	if (!out) {
		console.error("usage: tsx src/scripts/dump-spec.ts <output-path>");
		process.exit(1);
	}

	const spec = await generateSpecs(app, { documentation });
	const absolutePath = resolve(out);
	writeFileSync(absolutePath, `${JSON.stringify(spec, null, 2)}\n`);
	console.log(`wrote ${absolutePath}`);
}

main().catch((err) => {
	console.error("dump-spec failed:", err);
	process.exit(1);
});
