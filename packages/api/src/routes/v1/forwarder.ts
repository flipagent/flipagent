/**
 * `/v1/forwarder/{provider}/*` — package forwarder ops.
 *
 *   POST /v1/forwarder/{provider}/refresh        queue an inbox-pull job
 *   GET  /v1/forwarder/{provider}/jobs/{jobId}   poll job status + packages
 *
 * Today only `planetexpress` is wired. Behind the scenes the bridge
 * queue (`services/orders/queue.ts`) handles dispatch — the
 * extension's content script for the provider claims the job, drives
 * the provider's logged-in web UI, and reports packages back.
 *
 * Sits at `/v1/forwarder/*` (not `/v1/buy/...` or `/v1/sell/...`)
 * because forwarders touch both flows: inbound receipts during buy,
 * outbound consolidation/shipping during sell.
 */

import { ForwarderJobResponse, ForwarderProvider, ForwarderRefreshResponse } from "@flipagent/types";
import { Type } from "@sinclair/typebox";
import { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import { requireApiKey } from "../../middleware/auth.js";
import { getForwarderJob, refreshForwarder } from "../../services/forwarder/inbox.js";
import { errorResponse, jsonResponse, paramsFor, tbCoerce } from "../../utils/openapi.js";

export const forwarderRoute = new Hono();

const ProviderParam = Type.Object({ provider: ForwarderProvider });
const ProviderJobParam = Type.Object({ provider: ForwarderProvider, jobId: Type.String({ format: "uuid" }) });

forwarderRoute.post(
	"/:provider/refresh",
	describeRoute({
		tags: ["Forwarder"],
		summary: "Queue an inbox-refresh job for the named forwarder",
		description:
			"Bridge-driven: the user's flipagent Chrome extension reads their logged-in forwarder inbox and reports packages back. Returns immediately with `jobId`; poll `GET /v1/forwarder/{provider}/jobs/{jobId}` until terminal.",
		parameters: paramsFor("path", ProviderParam),
		responses: {
			200: jsonResponse("Job queued.", ForwarderRefreshResponse),
			401: errorResponse("Missing or invalid API key."),
			404: errorResponse("Unknown provider."),
		},
	}),
	requireApiKey,
	tbCoerce("param", ProviderParam),
	async (c) => {
		const { provider } = c.req.valid("param");
		const job = await refreshForwarder({
			provider,
			apiKeyId: c.var.apiKey.id,
			userId: c.var.apiKey.userId ?? null,
		});
		return c.json({ jobId: job.jobId, status: job.status, expiresAt: job.expiresAt });
	},
);

forwarderRoute.get(
	"/:provider/jobs/:jobId",
	describeRoute({
		tags: ["Forwarder"],
		summary: "Read a forwarder job (status + packages)",
		parameters: paramsFor("path", ProviderJobParam),
		responses: {
			200: jsonResponse("Job state.", ForwarderJobResponse),
			401: errorResponse("Missing or invalid API key."),
			404: errorResponse("Job not found for this api key + provider."),
		},
	}),
	requireApiKey,
	tbCoerce("param", ProviderJobParam),
	async (c) => {
		const { provider, jobId } = c.req.valid("param");
		const job = await getForwarderJob(provider, jobId, c.var.apiKey.id);
		if (!job) return c.json({ error: "not_found", message: `No ${provider} job ${jobId}.` }, 404);
		return c.json(job);
	},
);
