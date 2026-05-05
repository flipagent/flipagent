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
		version: "0.0.1",
		description:
			"The API to resell on eBay for AI agents. Every resource lives under `/v1/<resource>`, returns cents-int Money, ISO timestamps, lowercase status enums, and a `marketplace` discriminator. Auth is `X-API-Key` or `Authorization: Bearer`.",
		contact: { name: "flipagent", url: "https://flipagent.dev", email: "hello@flipagent.dev" },
		license: { name: "FSL-1.1-ALv2", url: "https://fsl.software/FSL-1.1-ALv2.template.md" },
	},
	servers: [{ url: "https://api.flipagent.dev", description: "Production" }],
	tags: [
		{ name: "Items", description: "Marketplace listings — search active or sold, get one." },
		{ name: "Listings", description: "Sell-side listing lifecycle (create / update / end / relist)." },
		{
			name: "Evaluate",
			description: "Composite same-product score: fetch → search sold + active → LLM filter → score.",
		},
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
