/**
 * Forwarder ops service. Wraps the bridge-job queue
 * (`services/bridge-jobs/queue.ts`) for provider-specific package ops:
 *   - `refreshForwarder`  — pull the inbox listing
 *   - `getPackagePhotos`  — fetch the per-package photo set
 *   - `dispatchPackage`   — instruct the forwarder to ship a package
 *                           outbound (sell-side fulfillment)
 *
 * Distinct from `services/forwarder/{estimate,zones,providers}` which
 * compute shipping rates. This file is the bridge-driven ops surface
 * (the user's flipagent Chrome extension drives the forwarder's web UI
 * inside the buyer's logged-in session).
 *
 * Used in both buy and sell flows: a reseller sources items abroad
 * (forwarder receives), consolidates, and ships outbound to eBay
 * buyers from forwarder stock once the item sells.
 */

import type {
	ForwarderJobResponse,
	ForwarderJobStatus,
	ForwarderPackage,
	ForwarderPackagePhoto,
	ForwarderProvider,
	ForwarderShipment,
	ForwarderShipmentRequest,
} from "@flipagent/types";
import type { BridgeJob } from "../../db/schema.js";
import { createBridgeJob, getJobForApiKey } from "../bridge-jobs/queue.js";
import { BRIDGE_TASKS } from "../ebay/bridge/tasks.js";

export interface RefreshArgs {
	provider: ForwarderProvider;
	apiKeyId: string;
	userId: string | null;
}

export async function refreshForwarder(args: RefreshArgs): Promise<ForwarderJobResponse> {
	const order = await createBridgeJob({
		apiKeyId: args.apiKeyId,
		userId: args.userId,
		// Provider name doubles as bridge source — the extension's
		// content-script registry keys off this.
		source: args.provider,
		// Forwarder reads have no item id; pass a synthetic constant so
		// the `bridge_jobs.item_id` NOT NULL is satisfied. The PE
		// content-script handler ignores it.
		itemId: "inbox",
		quantity: 1,
		maxPriceCents: null,
		idempotencyKey: null,
		// Legacy task — older extensions key off the `pull_packages`
		// task name returned by `bridgeTaskForSource("planetexpress")`.
		// We still emit the same task; metadata.task is omitted so the
		// fallback path stays intact.
		metadata: { kind: "forwarder.refresh" },
	});
	return toForwarderJob(args.provider, order);
}

export interface PackagePhotosArgs {
	provider: ForwarderProvider;
	packageId: string;
	apiKeyId: string;
	userId: string | null;
}

/**
 * Queue a "fetch the photos for this package" job. The bridge
 * extension opens the package detail page, scrapes image URLs, posts
 * back via `POST /v1/bridge/result` with `{ photos: [...] }`. Caller
 * polls `GET /v1/forwarder/{provider}/jobs/{jobId}` until terminal.
 */
export async function getPackagePhotos(args: PackagePhotosArgs): Promise<ForwarderJobResponse> {
	const order = await createBridgeJob({
		apiKeyId: args.apiKeyId,
		userId: args.userId,
		source: args.provider,
		// PE addresses packages by their id (e.g. "PE-12345" or numeric).
		// Stash on `itemId` so the extension can reach it without
		// dredging metadata.
		itemId: args.packageId,
		quantity: 1,
		maxPriceCents: null,
		idempotencyKey: null,
		metadata: {
			kind: "forwarder.photos",
			task: pickPhotosTask(args.provider),
			packageId: args.packageId,
		},
	});
	return toForwarderJob(args.provider, order);
}

export interface DispatchArgs extends PackagePhotosArgs {
	request: ForwarderShipmentRequest;
}

/**
 * Queue a "ship this package out" job. The bridge extension drives the
 * forwarder's outbound-shipment flow with the supplied address, picks
 * the requested service tier, and reports back the shipment id +
 * carrier + tracking once the label is generated.
 *
 * Idempotency: callers should pass an `idempotencyKey` derived from
 * `(packageId, ebayOrderId)` so a retried sold-event webhook doesn't
 * book two shipments for the same parcel. We accept the key via
 * `request.ebayOrderId` when present (sufficient for sell-side
 * fulfillment) and fall back to the package id alone when not.
 */
export async function dispatchPackage(args: DispatchArgs): Promise<ForwarderJobResponse> {
	const idem = args.request.ebayOrderId
		? `dispatch:${args.provider}:${args.packageId}:${args.request.ebayOrderId}`
		: `dispatch:${args.provider}:${args.packageId}`;
	const order = await createBridgeJob({
		apiKeyId: args.apiKeyId,
		userId: args.userId,
		source: args.provider,
		itemId: args.packageId,
		quantity: 1,
		maxPriceCents: null,
		idempotencyKey: idem,
		metadata: {
			kind: "forwarder.dispatch",
			task: pickDispatchTask(args.provider),
			packageId: args.packageId,
			request: args.request,
		},
	});
	return toForwarderJob(args.provider, order);
}

export async function getForwarderJob(
	provider: ForwarderProvider,
	jobId: string,
	apiKeyId: string,
): Promise<ForwarderJobResponse | null> {
	const order = await getJobForApiKey(jobId, apiKeyId);
	if (!order) return null;
	if (order.source !== provider) return null;
	return toForwarderJob(provider, order);
}

/* ------------------------------ helpers ------------------------------ */

function pickPhotosTask(provider: ForwarderProvider): string {
	switch (provider) {
		case "planetexpress":
			return BRIDGE_TASKS.PLANETEXPRESS_PACKAGE_PHOTOS;
		default:
			throw new Error(`No photo-fetch task wired for forwarder provider: ${provider satisfies never}`);
	}
}

function pickDispatchTask(provider: ForwarderProvider): string {
	switch (provider) {
		case "planetexpress":
			return BRIDGE_TASKS.PLANETEXPRESS_PACKAGE_DISPATCH;
		default:
			throw new Error(`No dispatch task wired for forwarder provider: ${provider satisfies never}`);
	}
}

function toForwarderJob(provider: ForwarderProvider, order: BridgeJob): ForwarderJobResponse {
	const meta = (order.metadata as Record<string, unknown> | null) ?? null;
	const kind = typeof meta?.kind === "string" ? (meta.kind as string) : "forwarder.refresh";
	const result = order.result as Record<string, unknown> | null;
	const job: ForwarderJobResponse = {
		jobId: order.id,
		provider,
		status: mapInternalStatus(order.status),
		failureReason: order.failureReason ?? null,
		createdAt: order.createdAt.toISOString(),
		updatedAt: order.updatedAt.toISOString(),
		expiresAt: order.expiresAt.toISOString(),
	};
	// Surface the result payload by task kind. Missing payloads are
	// expected for non-terminal jobs; the field stays absent rather
	// than null so the response shape matches the type schema's
	// `Type.Optional` semantics.
	if (kind === "forwarder.refresh") {
		const packages = extractPackages(result);
		if (packages) job.packages = packages;
	} else if (kind === "forwarder.photos") {
		const photos = extractPhotos(result);
		if (photos) job.photos = photos;
	} else if (kind === "forwarder.dispatch") {
		const shipment = extractShipment(result);
		if (shipment) job.shipment = shipment;
	}
	return job;
}

function mapInternalStatus(s: BridgeJob["status"]): ForwarderJobStatus {
	switch (s) {
		case "queued":
			return "queued";
		case "claimed":
		case "awaiting_user_confirm":
		case "placing":
			return "running";
		case "completed":
			return "completed";
		case "failed":
			return "failed";
		case "cancelled":
			return "cancelled";
		case "expired":
			return "expired";
		default:
			return "running";
	}
}

function extractPackages(result: unknown): ForwarderPackage[] | undefined {
	if (!result || typeof result !== "object") return undefined;
	const r = result as Record<string, unknown>;
	const arr = r.packages;
	if (!Array.isArray(arr)) return undefined;
	return arr as ForwarderPackage[];
}

function extractPhotos(result: unknown): ForwarderPackagePhoto[] | undefined {
	if (!result || typeof result !== "object") return undefined;
	const r = result as Record<string, unknown>;
	const arr = r.photos;
	if (!Array.isArray(arr)) return undefined;
	return arr as ForwarderPackagePhoto[];
}

function extractShipment(result: unknown): ForwarderShipment | undefined {
	if (!result || typeof result !== "object") return undefined;
	const r = result as Record<string, unknown>;
	const s = r.shipment;
	if (!s || typeof s !== "object") return undefined;
	return s as ForwarderShipment;
}
