/**
 * `/v1/forwarder/{provider}/*` — package forwarder ops.
 *
 *   POST /v1/forwarder/{provider}/refresh                         queue inbox refresh
 *   GET  /v1/forwarder/{provider}/jobs/{jobId}                    poll any forwarder job
 *   POST /v1/forwarder/{provider}/packages/{packageId}/photos     queue photo fetch
 *   POST /v1/forwarder/{provider}/packages/{packageId}/dispatch   queue outbound shipment
 *
 * Today only `planetexpress` is wired. Behind the scenes the bridge-job
 * queue (`services/bridge-jobs.ts`) handles dispatch — the
 * extension's content script for the provider claims the job, drives
 * the provider's logged-in web UI, and reports the result back.
 *
 * Sits at top level (not nested under `/purchases` or `/sales`)
 * because forwarders touch both flows: inbound receipts during buy,
 * outbound shipping during sell. The dispatch route closes the loop —
 * once a listed item sells, agents/automation queue a dispatch job
 * with the buyer's address and the forwarder ships it directly.
 */

import {
	ForwarderInventoryListResponse,
	ForwarderInventoryRow,
	ForwarderJobResponse,
	ForwarderLinkRequest,
	ForwarderProvider,
	ForwarderRefreshResponse,
	ForwarderShipmentRequest,
} from "@flipagent/types";
import { Type } from "@sinclair/typebox";
import { type Context, Hono } from "hono";
import { describeRoute } from "hono-openapi";
import { isExtensionPaired } from "../../auth/bridge-tokens.js";
import type { ForwarderInventory } from "../../db/schema.js";
import { requireApiKey } from "../../middleware/auth.js";
import {
	dispatchPackage,
	ExtensionNotPairedError,
	ForwarderSignedOutError,
	getForwarderAddress,
	getForwarderJob,
	getPackagePhotos,
	refreshForwarder,
} from "../../services/forwarder/inbox.js";
import { findByPackageId, linkSku, listInventory } from "../../services/forwarder/inventory.js";
import { nextAction } from "../../services/shared/next-action.js";
import { errorResponse, jsonResponse, paramsFor, tbBody, tbCoerce } from "../../utils/openapi.js";

export const forwarderRoute = new Hono();

const ProviderParam = Type.Object({ provider: ForwarderProvider });
const ProviderJobParam = Type.Object({ provider: ForwarderProvider, jobId: Type.String({ format: "uuid" }) });
const ProviderPackageParam = Type.Object({
	provider: ForwarderProvider,
	packageId: Type.String({ minLength: 1 }),
});

/**
 * Translate the two forwarder precondition errors into 412 + structured
 * `next_action` so MCP / agents render `instructions` verbatim. Falls
 * through (rethrows) for anything else so the global error handler can
 * surface it as 500.
 */
function handleForwarderPrecondition(c: Context, err: unknown) {
	if (err instanceof ExtensionNotPairedError) {
		return c.json(
			{
				error: "extension_not_paired",
				message:
					"The flipagent Chrome extension isn't installed or paired for this api key. Forwarder ops drive the user's browser session, so the extension must be set up first.",
				next_action: nextAction(c, "extension_install"),
			},
			412,
		);
	}
	if (err instanceof ForwarderSignedOutError) {
		return c.json(
			{
				error: "forwarder_signed_out",
				message: `Sign in to ${err.provider} first — last seen as signed out.`,
				next_action: nextAction(c, "forwarder_signin"),
			},
			412,
		);
	}
	return null;
}

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
			412: errorResponse("Forwarder session not active — sign in first."),
		},
	}),
	requireApiKey,
	tbCoerce("param", ProviderParam),
	async (c) => {
		const { provider } = c.req.valid("param");
		try {
			const job = await refreshForwarder({
				provider,
				apiKeyId: c.var.apiKey.id,
				userId: c.var.apiKey.userId ?? null,
			});
			return c.json({ jobId: job.jobId, status: job.status, expiresAt: job.expiresAt });
		} catch (err) {
			const handled = handleForwarderPrecondition(c, err);
			if (handled) return handled;
			throw err;
		}
	},
);

forwarderRoute.post(
	"/:provider/address",
	describeRoute({
		tags: ["Forwarder"],
		summary: "Queue a job to read the user's assigned suite + warehouse address",
		description:
			"Bridge-driven onboarding step: the extension navigates the forwarder's account / address page (logged-in session required) and reports back the assigned suite + warehouse address. Use the result to seed an eBay merchant location (POST /v1/locations) so listings have a valid US ship-from. Returns immediately with `jobId`; poll `GET /v1/forwarder/{provider}/jobs/{jobId}` until terminal, then read `address` off the response.",
		parameters: paramsFor("path", ProviderParam),
		responses: {
			200: jsonResponse("Job queued.", ForwarderRefreshResponse),
			401: errorResponse("Missing or invalid API key."),
			404: errorResponse("Unknown provider."),
			412: errorResponse("Forwarder session not active — sign in first."),
		},
	}),
	requireApiKey,
	tbCoerce("param", ProviderParam),
	async (c) => {
		const { provider } = c.req.valid("param");
		try {
			const job = await getForwarderAddress({
				provider,
				apiKeyId: c.var.apiKey.id,
				userId: c.var.apiKey.userId ?? null,
			});
			return c.json({ jobId: job.jobId, status: job.status, expiresAt: job.expiresAt });
		} catch (err) {
			const handled = handleForwarderPrecondition(c, err);
			if (handled) return handled;
			throw err;
		}
	},
);

forwarderRoute.get(
	"/:provider/jobs/:jobId",
	describeRoute({
		tags: ["Forwarder"],
		summary: "Read a forwarder job (status + payload)",
		description:
			"Polled by callers after queueing any forwarder action (refresh / photos / dispatch). The response carries one of `packages`, `photos`, or `shipment` depending on which task this job was created for. Non-terminal jobs return only status + timestamps.",
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
		// Attach a structured remediation hint when the bridge reported the
		// forwarder session as expired — MCP / agents render `instructions`
		// verbatim instead of guessing the recovery URL.
		if (job.status === "failed" && job.failureReason === "planetexpress_signed_out") {
			return c.json({ ...job, next_action: nextAction(c, "forwarder_signin") });
		}
		return c.json(job);
	},
);

forwarderRoute.post(
	"/:provider/packages/:packageId/photos",
	describeRoute({
		tags: ["Forwarder"],
		summary: "Queue a photo-fetch job for a forwarder package",
		description:
			"Bridge-driven: the extension opens the package detail page in the user's logged-in forwarder session, scrapes intake photos, and posts them back. Returns a `jobId` immediately; poll `GET /v1/forwarder/{provider}/jobs/{jobId}` until terminal, then read `photos` off the response.",
		parameters: paramsFor("path", ProviderPackageParam),
		responses: {
			200: jsonResponse("Job queued.", ForwarderRefreshResponse),
			401: errorResponse("Missing or invalid API key."),
			404: errorResponse("Unknown provider."),
		},
	}),
	requireApiKey,
	tbCoerce("param", ProviderPackageParam),
	async (c) => {
		const { provider, packageId } = c.req.valid("param");
		try {
			const job = await getPackagePhotos({
				provider,
				packageId,
				apiKeyId: c.var.apiKey.id,
				userId: c.var.apiKey.userId ?? null,
			});
			return c.json({ jobId: job.jobId, status: job.status, expiresAt: job.expiresAt });
		} catch (err) {
			const handled = handleForwarderPrecondition(c, err);
			if (handled) return handled;
			throw err;
		}
	},
);

forwarderRoute.get(
	"/:provider/inventory",
	describeRoute({
		tags: ["Forwarder"],
		summary: "List forwarder inventory rows for this api key",
		description:
			"Returns every package the bridge has reconciled into the inventory table for this provider, newest first. Each row carries the per-package lifecycle state (received → photographed → listed → sold → dispatched → shipped) plus inbound + outbound shipment fields. The agent uses this to find a package's id by sku before queueing a dispatch.",
		parameters: paramsFor("path", ProviderParam),
		responses: {
			200: jsonResponse("Inventory rows.", ForwarderInventoryListResponse),
			401: errorResponse("Missing or invalid API key."),
			404: errorResponse("Unknown provider."),
		},
	}),
	requireApiKey,
	tbCoerce("param", ProviderParam),
	async (c) => {
		const { provider } = c.req.valid("param");
		const rows = await listInventory(c.var.apiKey.id, provider);
		return c.json({ rows: rows.map(toInventoryRow) });
	},
);

forwarderRoute.get(
	"/:provider/inventory/:packageId",
	describeRoute({
		tags: ["Forwarder"],
		summary: "Read a single forwarder inventory row",
		parameters: paramsFor("path", ProviderPackageParam),
		responses: {
			200: jsonResponse("Inventory row.", ForwarderInventoryRow),
			401: errorResponse("Missing or invalid API key."),
			404: errorResponse("Package not found in this api key's inventory."),
		},
	}),
	requireApiKey,
	tbCoerce("param", ProviderPackageParam),
	async (c) => {
		const { provider, packageId } = c.req.valid("param");
		const row = await findByPackageId(c.var.apiKey.id, provider, packageId);
		if (!row) return c.json({ error: "not_found", message: `No ${provider} package ${packageId}.` }, 404);
		return c.json(toInventoryRow(row));
	},
);

forwarderRoute.post(
	"/:provider/packages/:packageId/link",
	describeRoute({
		tags: ["Forwarder"],
		summary: "Link a forwarder package to a marketplace sku + offer",
		description:
			"Called after `flipagent_relist_listing` succeeds. Stores `sku` (and optional `ebayOfferId`) on the inventory row so the sold-event handler can find the package without the agent threading the mapping by hand. Idempotent — re-linking the same sku is a no-op; re-linking a different sku overwrites.",
		parameters: paramsFor("path", ProviderPackageParam),
		responses: {
			200: jsonResponse("Linked.", ForwarderInventoryRow),
			401: errorResponse("Missing or invalid API key."),
			404: errorResponse("Unknown provider."),
		},
	}),
	requireApiKey,
	tbCoerce("param", ProviderPackageParam),
	tbBody(ForwarderLinkRequest),
	async (c) => {
		const { provider, packageId } = c.req.valid("param");
		const { sku, ebayOfferId } = c.req.valid("json");
		const row = await linkSku({
			apiKeyId: c.var.apiKey.id,
			provider,
			packageId,
			sku,
			ebayOfferId: ebayOfferId ?? null,
		});
		if (!row) return c.json({ error: "link_failed", message: "Could not link package." }, 500);
		return c.json(toInventoryRow(row));
	},
);

forwarderRoute.post(
	"/:provider/packages/:packageId/dispatch",
	describeRoute({
		tags: ["Forwarder"],
		summary: "Queue an outbound-shipment job for a forwarder package",
		description:
			"Sell-side ship-out. When the Chrome extension is paired, the bridge drives the forwarder's outbound flow with the supplied buyer address, picks the requested service tier, and reports back `shipment` (provider id + carrier + tracking + label url) once the label generates. When the extension isn't paired, the response carries `nextAction.url` pointing at the forwarder's outbound page so the user completes the dispatch manually; the tracking row is reconciled on the next inbox refresh. Idempotent on `(packageId, ebayOrderId)` so retried sold-event webhooks don't book two shipments.",
		parameters: paramsFor("path", ProviderPackageParam),
		responses: {
			200: jsonResponse("Job queued.", ForwarderJobResponse),
			401: errorResponse("Missing or invalid API key."),
			404: errorResponse("Unknown provider."),
		},
	}),
	requireApiKey,
	tbCoerce("param", ProviderPackageParam),
	tbBody(ForwarderShipmentRequest),
	async (c) => {
		const { provider, packageId } = c.req.valid("param");
		const request = c.req.valid("json");
		try {
			const bridgePaired = await isExtensionPaired(c.var.apiKey.id);
			const job = await dispatchPackage({
				provider,
				packageId,
				apiKeyId: c.var.apiKey.id,
				userId: c.var.apiKey.userId ?? null,
				request,
				bridgePaired,
			});
			return c.json(job);
		} catch (err) {
			const handled = handleForwarderPrecondition(c, err);
			if (handled) return handled;
			throw err;
		}
	},
);

function toInventoryRow(row: ForwarderInventory) {
	return {
		id: row.id,
		provider: row.provider as "planetexpress",
		packageId: row.packageId,
		sku: row.sku,
		ebayOfferId: row.ebayOfferId,
		ebayInboundOrderId: row.ebayInboundOrderId,
		status: row.status,
		photos: row.photos as Array<{ url: string; caption?: string; capturedAt?: string }> | null,
		weightG: row.weightG,
		dimsCm: row.dimsCm as { l?: number; w?: number; h?: number } | null,
		inboundTracking: row.inboundTracking,
		outboundShipmentId: row.outboundShipmentId,
		outboundCarrier: row.outboundCarrier,
		outboundTracking: row.outboundTracking,
		outboundCostCents: row.outboundCostCents,
		outboundLabelUrl: row.outboundLabelUrl,
		shippedAt: row.shippedAt?.toISOString() ?? null,
		createdAt: row.createdAt.toISOString(),
		updatedAt: row.updatedAt.toISOString(),
	};
}
