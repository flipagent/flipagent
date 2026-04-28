/**
 * OpenAPI spec generation. The spec is built at request time from the live
 * Hono route registry, so adding/removing/changing a route's `describeRoute()`
 * metadata is the only place the documentation source lives.
 *
 * Served at:
 *   GET /openapi.json   — application/json (Scalar / SDK gen consume this)
 *   GET /openapi.yaml   — application/yaml (human-readable mirror)
 */

import type { Hono } from "hono";
import { generateSpecs, openAPISpecs } from "hono-openapi";
import type { OpenAPIV3 } from "openapi-types";
import { stringify as yamlStringify } from "yaml";

export const documentation: Partial<OpenAPIV3.Document> = {
	openapi: "3.1.0",
	info: {
		title: "flipagent API",
		version: "0.1.0",
		description:
			"eBay-compatible API for AI agents. The `/buy/*` paths mirror eBay's Browse + " +
			"Marketplace Insights APIs exactly so any eBay SDK works against " +
			"`https://api.flipagent.dev` without modification. The `/v1/*` paths are " +
			"flipagent-specific (key issuance, billing, ToS opt-out).",
		contact: { name: "flipagent", url: "https://flipagent.dev", email: "hello@flipagent.dev" },
		license: { name: "Proprietary" },
	},
	servers: [{ url: "https://api.flipagent.dev", description: "Production" }],
	tags: [
		{ name: "eBay-compat", description: "Drop-in replacements for the official eBay APIs." },
		{ name: "Keys", description: "Issue, inspect, and revoke flipagent API keys." },
		{ name: "Billing", description: "Stripe-backed paid tier upgrades." },
		{ name: "Compliance", description: "Seller opt-out and ToS hygiene." },
		{ name: "System", description: "Service health." },
	],
	components: {
		securitySchemes: {
			apiKey: { type: "apiKey", in: "header", name: "X-API-Key" },
			bearerToken: { type: "http", scheme: "bearer", bearerFormat: "flipagent API key (fa_*)" },
		},
	},
	security: [{ apiKey: [] }, { bearerToken: [] }],
};

export function registerOpenApi(app: Hono): void {
	app.get("/openapi.json", openAPISpecs(app, { documentation }));
	app.get("/openapi.yaml", async (c) => {
		const specs = await generateSpecs(app, { documentation });
		// JSON round-trip drops the async-function builders that resolver() leaves
		// embedded; yaml.stringify can't serialise them otherwise.
		const plain = JSON.parse(JSON.stringify(specs));
		return c.body(yamlStringify(plain), 200, { "Content-Type": "application/yaml; charset=utf-8" });
	});
}
