/**
 * Forwarder tools — bridge-driven ops on the user's logged-in forwarder
 * (Planet Express today; the names are provider-agnostic so future
 * forwarders reuse the same surface via a `provider` param). All three
 * action tools queue a job and return a `jobId`; the agent polls
 * `flipagent_forwarder_jobs_get` until terminal, then reads the
 * task-specific payload (packages / photos / shipment) off the
 * response.
 *
 * Names mirror the SDK path (`client.forwarder.packages.photos` ↔
 * `flipagent_forwarder_packages_photos`):
 *
 *   flipagent_forwarder_refresh             refresh inbox
 *   flipagent_forwarder_packages_photos     fetch intake photos for one parcel
 *   flipagent_forwarder_packages_dispatch   ship a parcel to a buyer (sell-side)
 *   flipagent_forwarder_packages_link       link a package to a marketplace sku
 *   flipagent_forwarder_inventory_list      list reconciled inventory
 *   flipagent_forwarder_jobs_get            poll any queued job
 *
 * All require the user to be signed into the forwarder (planetexpress.com)
 * in the Chrome profile their flipagent extension is paired with.
 */

import { Type } from "@sinclair/typebox";
import { getClient, toApiCallError } from "../client.js";
import type { Config } from "../config.js";

/* --------------------------- packages refresh --------------------------- */

export const planetExpressPackagesInput = Type.Object({});

export const planetExpressPackagesDescription =
	"Read the user's Planet Express forwarder inbox (packages awaiting consolidation, on-hand, or shipped). Calls POST /v1/forwarder/planetexpress/refresh — the bridge queues a `pull_packages` job and the user's flipagent Chrome extension reads the inbox from their logged-in PE session, then reports the package list back. Returns a `jobId` immediately; poll `flipagent_forwarder_jobs_get` until terminal. Requires the user to be signed into planetexpress.com in the same Chrome profile the extension is paired with.";

export async function planetExpressPackagesExecute(config: Config, _args: Record<string, unknown>): Promise<unknown> {
	try {
		const client = getClient(config);
		return await client.forwarder.refresh({ provider: "planetexpress" });
	} catch (err) {
		const e = toApiCallError(err, "/v1/forwarder/planetexpress/refresh");
		return {
			error: "forwarder_refresh_failed",
			status: e.status,
			url: e.url,
			message: e.message,
			hint: "Sign into planetexpress.com in the Chrome profile your flipagent extension is paired with.",
		};
	}
}

/* ------------------------------ package photos ------------------------------ */

export const planetExpressPackagePhotosInput = Type.Object(
	{ packageId: Type.String({ minLength: 1, description: "PE package id (e.g., 'PE-12345' or numeric)." }) },
	{ $id: "PlanetExpressPackagePhotosInput" },
);

export const planetExpressPackagePhotosDescription =
	"Fetch the intake photos PE captured for one inbound package. Calls POST /v1/forwarder/planetexpress/packages/{packageId}/photos. The extension opens the package detail page in the user's logged-in PE session, scrapes image URLs (front / back / condition / contents), and reports them back. Returns a `jobId`; poll `flipagent_forwarder_jobs_get` until terminal, then read `photos` off the response. Use these images directly in `flipagent_listings_create` (`product.imageUrls`).";

export async function planetExpressPackagePhotosExecute(
	config: Config,
	args: Record<string, unknown>,
): Promise<unknown> {
	const packageId = String(args.packageId);
	try {
		const client = getClient(config);
		return await client.forwarder.packages.photos({ provider: "planetexpress", packageId });
	} catch (err) {
		const e = toApiCallError(err, `/v1/forwarder/planetexpress/packages/${packageId}/photos`);
		return {
			error: "forwarder_packages_photos_failed",
			status: e.status,
			url: e.url,
			message: e.message,
			hint: "Sign into planetexpress.com in the Chrome profile your flipagent extension is paired with.",
		};
	}
}

/* ----------------------------- package dispatch ---------------------------- */

export const planetExpressPackageDispatchInput = Type.Object(
	{
		packageId: Type.String({ minLength: 1, description: "PE package id to ship." }),
		toAddress: Type.Object({
			name: Type.String(),
			line1: Type.String(),
			line2: Type.Optional(Type.String()),
			city: Type.String(),
			state: Type.String({ description: "ISO 3166-2 region; for US use 2-letter (e.g. NY)." }),
			postalCode: Type.String(),
			country: Type.String({ description: "ISO 3166-1 alpha-2 (e.g. US, KR)." }),
			phone: Type.Optional(Type.String()),
			email: Type.Optional(Type.String({ format: "email" })),
		}),
		service: Type.Optional(
			Type.Union([
				Type.Literal("usps_priority"),
				Type.Literal("usps_ground_advantage"),
				Type.Literal("ups_ground"),
				Type.Literal("fedex_home"),
			]),
		),
		declaredValueCents: Type.Optional(Type.Integer({ minimum: 0 })),
		ebayOrderId: Type.Optional(
			Type.String({ description: "Origin marketplace order id, for traceability + idempotency." }),
		),
		notes: Type.Optional(Type.String()),
	},
	{ $id: "PlanetExpressPackageDispatchInput" },
);

export const planetExpressPackageDispatchDescription =
	"Instruct Planet Express to ship a held package to the supplied address (sell-side ship-out). Calls POST /v1/forwarder/planetexpress/packages/{packageId}/dispatch. The extension drives PE's outbound flow inside the user's logged-in session: enters the recipient address, picks the requested service tier, generates the label, returns shipment id + carrier + tracking. Idempotent on `(packageId, ebayOrderId)` so a retried sold-event webhook can't book two shipments. Returns a `jobId`; poll `flipagent_forwarder_jobs_get` until terminal, then read `shipment` off the response.";

export async function planetExpressPackageDispatchExecute(
	config: Config,
	args: Record<string, unknown>,
): Promise<unknown> {
	const packageId = String(args.packageId);
	const a = args as {
		packageId: string;
		toAddress: {
			name: string;
			line1: string;
			line2?: string;
			city: string;
			state: string;
			postalCode: string;
			country: string;
			phone?: string;
			email?: string;
		};
		service?: "usps_priority" | "usps_ground_advantage" | "ups_ground" | "fedex_home";
		declaredValueCents?: number;
		ebayOrderId?: string;
		notes?: string;
	};
	try {
		const client = getClient(config);
		return await client.forwarder.packages.dispatch({
			provider: "planetexpress",
			packageId,
			request: {
				toAddress: a.toAddress,
				service: a.service,
				declaredValueCents: a.declaredValueCents,
				ebayOrderId: a.ebayOrderId,
				notes: a.notes,
			},
		});
	} catch (err) {
		const e = toApiCallError(err, `/v1/forwarder/planetexpress/packages/${packageId}/dispatch`);
		return {
			error: "forwarder_packages_dispatch_failed",
			status: e.status,
			url: e.url,
			message: e.message,
			hint: "Sign into planetexpress.com in the Chrome profile your flipagent extension is paired with.",
		};
	}
}

/* ------------------------------ inventory list ----------------------------- */

export const planetExpressInventoryInput = Type.Object({});

export const planetExpressInventoryDescription =
	"List Planet Express inventory rows for the current api key (every package the bridge has reconciled). Calls GET /v1/forwarder/planetexpress/inventory. Each row carries the lifecycle state — `received`, `photographed`, `listed`, `sold`, `dispatched`, `shipped` — plus any inbound + outbound shipment fields that have been reported. Use this to find a package's id from its sku before queueing a dispatch. Newest first.";

export async function planetExpressInventoryExecute(config: Config, _args: Record<string, unknown>): Promise<unknown> {
	try {
		const client = getClient(config);
		return await client.forwarder.inventory.list({ provider: "planetexpress" });
	} catch (err) {
		const e = toApiCallError(err, "/v1/forwarder/planetexpress/inventory");
		return { error: "forwarder_inventory_list_failed", status: e.status, url: e.url, message: e.message };
	}
}

/* -------------------------------- link sku --------------------------------- */

export const planetExpressLinkInput = Type.Object(
	{
		packageId: Type.String({ minLength: 1, description: "PE package id." }),
		sku: Type.String({ minLength: 1, description: "Marketplace sku — match this to the eBay listing." }),
		ebayOfferId: Type.Optional(
			Type.String({ description: "eBay Sell Inventory offerId returned by `flipagent_listings_update`." }),
		),
	},
	{ $id: "PlanetExpressLinkInput" },
);

export const planetExpressLinkDescription =
	"Link a PE package to a marketplace sku (and optional ebay offer id). Calls POST /v1/forwarder/planetexpress/packages/{packageId}/link. Run this after `flipagent_listings_relist` succeeds — the sold-event handler uses the sku to find the package automatically and queue a dispatch when the item sells, so the agent never has to re-thread the linkage. Idempotent on (packageId, sku); re-linking a different sku overwrites.";

export async function planetExpressLinkExecute(config: Config, args: Record<string, unknown>): Promise<unknown> {
	const packageId = String(args.packageId);
	const sku = String(args.sku);
	const ebayOfferId = typeof args.ebayOfferId === "string" ? args.ebayOfferId : undefined;
	try {
		const client = getClient(config);
		return await client.forwarder.packages.link({
			provider: "planetexpress",
			packageId,
			request: { sku, ebayOfferId },
		});
	} catch (err) {
		const e = toApiCallError(err, `/v1/forwarder/planetexpress/packages/${packageId}/link`);
		return { error: "forwarder_packages_link_failed", status: e.status, url: e.url, message: e.message };
	}
}

/* -------------------------------- job status ------------------------------- */

export const planetExpressJobStatusInput = Type.Object(
	{ jobId: Type.String({ format: "uuid" }) },
	{ $id: "PlanetExpressJobStatusInput" },
);

export const planetExpressJobStatusDescription =
	"Poll a previously-queued Planet Express job. Calls GET /v1/forwarder/planetexpress/jobs/{jobId}. Returns `status` plus exactly one task-specific payload depending on which tool queued the job: `packages` (refresh), `photos` (package_photos), or `shipment` (package_dispatch). Non-terminal statuses (`queued`, `running`) return only timestamps + status — keep polling.";

export async function planetExpressJobStatusExecute(config: Config, args: Record<string, unknown>): Promise<unknown> {
	const jobId = String(args.jobId);
	try {
		const client = getClient(config);
		return await client.forwarder.jobs.get({ provider: "planetexpress", jobId });
	} catch (err) {
		const e = toApiCallError(err, `/v1/forwarder/planetexpress/jobs/${jobId}`);
		return { error: "forwarder_jobs_get_failed", status: e.status, url: e.url, message: e.message };
	}
}
