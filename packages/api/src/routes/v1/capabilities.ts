/**
 * `/v1/capabilities` — agent capability discovery surface.
 *
 *   GET /v1/capabilities — auth: api key. Returns the per-marketplace
 *   capability map plus the bridge-client (Chrome extension) state.
 *
 * Agents call this once at session start, decide which tools are even
 * worth attempting (e.g. don't fire `flipagent_purchases_create`
 * when `marketplaces.ebay.buy === "needs_signin"`), and surface clear
 * remediation to the user when something is missing.
 */

import { CapabilitiesResponse } from "@flipagent/types";
import { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import { requireApiKey } from "../../middleware/auth.js";
import { computeCapabilities } from "../../services/capabilities.js";
import { errorResponse, jsonResponse } from "../../utils/openapi.js";

export const capabilitiesRoute = new Hono();

capabilitiesRoute.get(
	"/",
	describeRoute({
		tags: ["Capabilities"],
		summary: "Per-marketplace capability map for this api key",
		description:
			"Returns which calls work (`ok`), which need user action (`needs_signin`, `needs_oauth`), which are gated by upstream approval (`approval_pending`), which are served by the scrape transport (`scrape`), and which are unconfigured on this host (`unavailable`). The agent's first-call discovery surface.",
		responses: {
			200: jsonResponse("Capability map.", CapabilitiesResponse),
			401: errorResponse("Missing or invalid API key."),
		},
	}),
	requireApiKey,
	async (c) => {
		const cap = await computeCapabilities(c.var.apiKey.id);
		return c.json(cap);
	},
);
