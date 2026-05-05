/**
 * Forwarder ops service. Wraps the bridge-job queue
 * (`services/bridge-jobs.ts`) for provider-specific package ops:
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
	ForwarderAddress,
	ForwarderJobResponse,
	ForwarderJobStatus,
	ForwarderPackage,
	ForwarderPackagePhoto,
	ForwarderProvider,
	ForwarderShipment,
	ForwarderShipmentRequest,
} from "@flipagent/types";
import { and, desc, eq, isNull } from "drizzle-orm";
import { db } from "../../db/client.js";
import type { BridgeJob } from "../../db/schema.js";
import { bridgeTokens } from "../../db/schema.js";
import { createBridgeJob, getJobForApiKey } from "../bridge-jobs.js";
import { BRIDGE_TASKS } from "../ebay/bridge/tasks.js";

export interface RefreshArgs {
	provider: ForwarderProvider;
	apiKeyId: string;
	userId: string | null;
}

export async function refreshForwarder(args: RefreshArgs): Promise<ForwarderJobResponse> {
	await assertForwarderSignedIn(args.apiKeyId, args.provider);
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
	await assertForwarderSignedIn(args.apiKeyId, args.provider);
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
	await assertForwarderSignedIn(args.apiKeyId, args.provider);
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

export interface GetAddressArgs {
	provider: ForwarderProvider;
	apiKeyId: string;
	userId: string | null;
}

/**
 * Queue a "read my warehouse address + suite" job. The bridge extension
 * navigates the forwarder's account / address page (logged-in session
 * required), scrapes the assigned suite + warehouse address, posts back
 * `{ address: { name, line1, line2 (suite), city, region, postalCode,
 * country, phone } }`. Caller polls
 * `GET /v1/forwarder/{provider}/jobs/{jobId}` until terminal.
 *
 * Used during onboarding: agent calls this once → uses the returned
 * address to create an eBay merchant location → listing-create
 * unblocked.
 */
export async function getForwarderAddress(args: GetAddressArgs): Promise<ForwarderJobResponse> {
	await assertForwarderSignedIn(args.apiKeyId, args.provider);
	const order = await createBridgeJob({
		apiKeyId: args.apiKeyId,
		userId: args.userId,
		source: args.provider,
		itemId: "address",
		quantity: 1,
		maxPriceCents: null,
		idempotencyKey: null,
		metadata: {
			kind: "forwarder.address",
			task: pickAddressTask(args.provider),
		},
	});
	return toForwarderJob(args.provider, order);
}

/**
 * Thrown when the bridge extension isn't paired for this api key.
 * Distinct from `ForwarderSignedOutError` so the route can hand the
 * agent the *right* remediation: install + pair the Chrome extension
 * (one-time setup), not "sign in to forwarder" (a session refresh).
 */
export class ExtensionNotPairedError extends Error {
	constructor() {
		super("Chrome extension not paired for this api key");
		this.name = "ExtensionNotPairedError";
	}
}

/**
 * Thrown by forwarder ops when the bridge's last-seen state for the
 * provider is signed-out. Lets the route return 412 + next_action
 * *before* opening a tab — agent sees a clean precondition error and
 * can prompt the user to sign in instead of waiting on a job that's
 * destined to fail.
 *
 * Sticky-by-design: even if the user IS still signed in but their
 * session expired and we missed the probe, the bridge dispatch path
 * will catch it as a backstop (`planetexpress_signed_out` failure).
 */
export class ForwarderSignedOutError extends Error {
	readonly provider: ForwarderProvider;
	constructor(provider: ForwarderProvider) {
		super(`${provider} session is not active`);
		this.provider = provider;
		this.name = "ForwarderSignedOutError";
	}
}

async function assertForwarderSignedIn(apiKeyId: string, provider: ForwarderProvider): Promise<void> {
	if (provider !== "planetexpress") return; // others not yet wired
	const rows = await db
		.select({ peLoggedIn: bridgeTokens.peLoggedIn, peVerifiedAt: bridgeTokens.peVerifiedAt })
		.from(bridgeTokens)
		.where(and(eq(bridgeTokens.apiKeyId, apiKeyId), isNull(bridgeTokens.revokedAt)))
		.orderBy(desc(bridgeTokens.lastSeenAt))
		.limit(1);
	// Three failure modes:
	//   - no row at all → extension never paired (one-time setup needed)
	//   - row exists, pe_verified_at IS NULL → never visited PE yet,
	//     can't tell signed-in vs signed-out from the bridge state alone.
	//     Let the job through; the content script's URL probe on the
	//     actual tab open is the source of truth and will fail cleanly
	//     with `planetexpress_signed_out` if the user lands on /login.
	//     Pre-emptive 412 here would block the very first refresh after
	//     pairing — the call that's typically used to check whether PE
	//     even works.
	//   - row exists, pe_verified_at NOT NULL, pe_logged_in=false →
	//     we've affirmatively seen them signed out. 412 with a clear
	//     forwarder_signin next_action.
	// Each gets a different next_action so the agent gives the right nudge.
	if (rows.length === 0) throw new ExtensionNotPairedError();
	const row = rows[0];
	if (row?.peVerifiedAt && !row.peLoggedIn) throw new ForwarderSignedOutError(provider);
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

function pickAddressTask(provider: ForwarderProvider): string {
	switch (provider) {
		case "planetexpress":
			return BRIDGE_TASKS.PLANETEXPRESS_GET_ADDRESS;
		default:
			throw new Error(`No address-fetch task wired for forwarder provider: ${provider satisfies never}`);
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
	} else if (kind === "forwarder.address") {
		const addresses = extractAddresses(result);
		if (addresses && addresses.length > 0) job.addresses = addresses;
	}
	return job;
}

function extractAddresses(result: Record<string, unknown> | null): ForwarderAddress[] | null {
	if (!result) return null;
	// Accept both shapes from the bridge: `addresses: [...]` (modern,
	// multi-warehouse) and `address: { ... }` (legacy single). Coerce
	// to a single array path so callers don't branch.
	const raw = Array.isArray(result.addresses)
		? (result.addresses as Record<string, unknown>[])
		: result.address
			? [result.address as Record<string, unknown>]
			: null;
	if (!raw) return null;
	const out: ForwarderAddress[] = [];
	for (const a of raw) {
		const addr = coerceAddress(a);
		if (addr) out.push(addr);
	}
	if (out.length === 0) return null;
	// If no entry self-marked primary (legacy clients), promote the first.
	if (!out.some((a) => a.isPrimary)) out[0]!.isPrimary = true;
	return out;
}

function coerceAddress(a: Record<string, unknown>): ForwarderAddress | null {
	const str = (k: string): string | undefined => (typeof a[k] === "string" ? (a[k] as string) : undefined);
	const bool = (k: string): boolean => a[k] === true;
	const line1 = str("line1");
	const city = str("city");
	const postalCode = str("postalCode") ?? str("zip");
	const country = str("country");
	if (!line1 || !city || !postalCode || !country) return null;
	const addr: ForwarderAddress = {
		label: str("label") ?? `${city}, ${str("region") ?? str("state") ?? country}`,
		isPrimary: bool("isPrimary"),
		name: str("name") ?? "",
		line1,
		city,
		postalCode,
		country,
	};
	const region = str("region") ?? str("state");
	if (region) addr.region = region;
	const line2 = str("line2") ?? str("suite");
	if (line2) addr.line2 = line2;
	const phone = str("phone");
	if (phone) addr.phone = phone;
	return addr;
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
