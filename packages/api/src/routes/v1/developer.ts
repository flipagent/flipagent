/**
 * `/v1/developer/register` — eBay developer self-service.
 *
 * Programmatic registration of a new eBay app (sub-app, white-label
 * tenant, etc.). flipagent's primary app is registered manually via the
 * dev portal; this is opt-in for hosting customers.
 */

import { DeveloperAppRegisterRequest, DeveloperAppRegisterResponse } from "@flipagent/types";
import { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import { requireApiKey } from "../../middleware/auth.js";
import { registerDeveloperApp } from "../../services/developer.js";
import { errorResponse, jsonResponse, tbBody } from "../../utils/openapi.js";

export const developerRoute = new Hono();

developerRoute.post(
	"/register",
	describeRoute({
		tags: ["Developer"],
		summary: "Register a new eBay app",
		responses: {
			200: jsonResponse("Registered.", DeveloperAppRegisterResponse),
			401: errorResponse("API key missing."),
			502: errorResponse("Upstream eBay request failed."),
		},
	}),
	requireApiKey,
	tbBody(DeveloperAppRegisterRequest),
	async (c) =>
		c.json({
			...(await registerDeveloperApp(c.req.valid("json"))),
			source: "rest" as const,
		}),
);
