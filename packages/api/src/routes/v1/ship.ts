/**
 * `/v1/ship/*` — forwarder + landed-cost surface. "How much does this
 * actually cost to get to my doorstep, and which forwarder is best?"
 *
 *   POST /v1/ship/quote     — itemized landed cost (item + ship + forwarder + tax)
 *   GET  /v1/ship/providers — list available forwarders + their fee structure
 *
 * Maps to the Operations pillar on the marketing site (#02: forwarder
 * + receipts handled, you don't touch the box).
 */

import { ShipQuoteRequest, ShipQuoteResponse } from "@flipagent/types";
import { Type } from "@sinclair/typebox";
import { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import { requireApiKey } from "../../middleware/auth.js";
import { PROVIDERS } from "../../services/forwarder/index.js";
import { landedCost } from "../../services/scoring/index.js";
import { errorResponse, jsonResponse, tbBody } from "../../utils/openapi.js";

export const shipRoute = new Hono();

shipRoute.post(
	"/quote",
	describeRoute({
		tags: ["Ship"],
		summary: "Compute landed cost via a US-domestic forwarder",
		description:
			"Sums item price + eBay seller's listed shipping + forwarder fees. Tax is currently 0 — destination-state sales tax is the caller's responsibility. Returns the forwarder's ETA window and any caveats verbatim (e.g. dim-weight billed, service doesn't serve AK/HI).",
		responses: {
			200: jsonResponse("Landed-cost breakdown.", ShipQuoteResponse),
			400: errorResponse("Validation failed."),
			401: errorResponse("Missing or invalid API key."),
			429: errorResponse("Rate limit exceeded."),
		},
	}),
	requireApiKey,
	tbBody(ShipQuoteRequest),
	async (c) => {
		const { item, forwarder } = c.req.valid("json");
		const breakdown = landedCost(item, forwarder);
		return c.json(breakdown);
	},
);

const ProviderSummary = Type.Object(
	{
		id: Type.String(),
		name: Type.String(),
		originState: Type.String(),
		handlingCents: Type.Integer(),
		perExtraItemCents: Type.Integer(),
		consolidationCents: Type.Integer(),
		dimDivisor: Type.Integer(),
		defaultService: Type.String(),
		supportedServices: Type.Array(Type.String()),
		notes: Type.Array(Type.String()),
	},
	{ $id: "ForwarderProviderSummary" },
);

const ShipProvidersResponse = Type.Object({ providers: Type.Array(ProviderSummary) }, { $id: "ShipProvidersResponse" });

shipRoute.get(
	"/providers",
	describeRoute({
		tags: ["Ship"],
		summary: "List available forwarder providers",
		description:
			"Returns the forwarders flipagent supports for landed-cost quotes. Each entry exposes per-package handling, consolidation fees, dim-weight divisor, and the carrier services it can route through.",
		responses: {
			200: jsonResponse("Forwarder catalog.", ShipProvidersResponse),
			401: errorResponse("Missing or invalid API key."),
		},
	}),
	requireApiKey,
	(c) => {
		const providers = Object.values(PROVIDERS).map((p) => ({
			id: p.id,
			name: p.name,
			originState: p.originState,
			handlingCents: p.handlingCents,
			perExtraItemCents: p.perExtraItemCents,
			consolidationCents: p.consolidationCents,
			dimDivisor: p.dimDivisor,
			defaultService: p.defaultService,
			supportedServices: Array.from(
				new Set(
					Object.keys(p.rateTables)
						.map((k) => k.split(":")[0])
						.filter((s): s is string => Boolean(s)),
				),
			),
			notes: p.notes,
		}));
		return c.json({ providers });
	},
);
