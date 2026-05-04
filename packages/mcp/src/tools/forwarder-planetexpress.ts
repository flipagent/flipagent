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
import { getClient, toolErrorEnvelope } from "../client.js";

const PE_LOGIN_HINT =
	"Make sure the user is signed into planetexpress.com in the Chrome profile their flipagent extension is paired with — the bridge job runs in that session.";

import type { Config } from "../config.js";

/* --------------------------- packages refresh --------------------------- */

export const planetExpressPackagesInput = Type.Object({});

export const planetExpressPackagesDescription =
	'Refresh the user\'s Planet Express forwarder inbox via the Chrome extension. Calls POST /v1/forwarder/planetexpress/refresh. **When to use** — pull the latest list of packages on hand (newly arrived, awaiting consolidation, shipped) so subsequent steps (`flipagent_request_package_photos`, `flipagent_dispatch_package`) have fresh ids. **Inputs** — none. **Output** — `{ jobId, status: "queued", poll_with: "flipagent_get_forwarder_job", terminal_states: ["completed", "failed"] }`. Once terminal, the job\'s result carries `packages`. **Prereqs** — flipagent Chrome extension installed + paired; user signed into planetexpress.com in that profile. On bridge timeouts the response carries a hint pointing at the install/pair docs. **Example** — call with `{}`.';

export async function planetExpressPackagesExecute(config: Config, _args: Record<string, unknown>): Promise<unknown> {
	try {
		const client = getClient(config);
		return await client.forwarder.refresh({ provider: "planetexpress" });
	} catch (err) {
		return toolErrorEnvelope(err, "refresh_forwarder_failed", "/v1/forwarder/planetexpress/refresh", PE_LOGIN_HINT);
	}
}

/* ------------------------------ package photos ------------------------------ */

export const planetExpressPackagePhotosInput = Type.Object(
	{ packageId: Type.String({ minLength: 1, description: "PE package id (e.g., 'PE-12345' or numeric)." }) },
	{ $id: "PlanetExpressPackagePhotosInput" },
);

export const planetExpressPackagePhotosDescription =
	'Fetch the intake photos Planet Express captured for one inbound package. Calls POST /v1/forwarder/planetexpress/packages/{packageId}/photos. **When to use** — when listing an item shipped to a forwarder, you typically don\'t have your own photos — use PE\'s intake shots (front / back / condition / contents). **Inputs** — `packageId` (from `flipagent_list_forwarder_inventory` or `flipagent_refresh_forwarder`). **Output** — `{ jobId, status: "queued", poll_with: "flipagent_get_forwarder_job", terminal_states: ["completed", "failed"] }`. Once terminal, the job result carries `photos: [{ kind, url }]`; pass these urls to `flipagent_create_listing.images[]`. **Prereqs** — extension paired, user signed into planetexpress.com. **Example** — `{ packageId: "PE-12345" }`.';

export async function planetExpressPackagePhotosExecute(
	config: Config,
	args: Record<string, unknown>,
): Promise<unknown> {
	const packageId = String(args.packageId);
	try {
		const client = getClient(config);
		return await client.forwarder.packages.photos({ provider: "planetexpress", packageId });
	} catch (err) {
		return toolErrorEnvelope(
			err,
			"request_package_photos_failed",
			`/v1/forwarder/planetexpress/packages/${packageId}/photos`,
			PE_LOGIN_HINT,
		);
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
	'Instruct Planet Express to ship a held package out to the buyer. Calls POST /v1/forwarder/planetexpress/packages/{packageId}/dispatch. **When to use** — sell-side fulfillment after a sale: the extension drives PE\'s outbound flow (enters recipient address, picks service tier, generates label) inside the user\'s logged-in session. **Inputs** — `packageId`, `toAddress` (recipient: name, line1, city, state, postalCode, country in ISO codes), optional `service` (`usps_priority | usps_ground_advantage | ups_ground | fedex_home`), optional `declaredValueCents`, optional `ebayOrderId` (for idempotency + traceability), optional `notes`. **Output** — `{ jobId, status: "queued", poll_with: "flipagent_get_forwarder_job", terminal_states: ["completed", "failed"] }`. Once terminal, the job result carries `shipment: { carrier, trackingNumber, labelUrl }` — feed these to `flipagent_ship_sale` to close the loop. **Idempotent on** `(packageId, ebayOrderId)` so a retried webhook can\'t double-book. **Prereqs** — extension paired, user signed into planetexpress.com. **Example** — `{ packageId: "PE-12345", toAddress: { name: "...", line1: "...", city: "NY", state: "NY", postalCode: "10001", country: "US" }, ebayOrderId: "O-1" }`.';

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
		return toolErrorEnvelope(
			err,
			"dispatch_package_failed",
			`/v1/forwarder/planetexpress/packages/${packageId}/dispatch`,
			PE_LOGIN_HINT,
		);
	}
}

/* ------------------------------ get address ------------------------------- */

export const planetExpressGetAddressInput = Type.Object({});

export const planetExpressGetAddressDescription =
	'One-time onboarding: read the user\'s assigned suite + warehouse address from Planet Express via the Chrome extension, so the agent can seed an eBay merchant location (POST /v1/locations) for ship-from. Calls POST /v1/forwarder/planetexpress/address. **When to use** — first time the agent needs a US ship-from for a sell-side flow (`flipagent_create_listing`) and `flipagent_list_locations` returns empty. **Inputs** — none. **Output** — `{ jobId, status: "queued", poll_with: "flipagent_get_forwarder_job", terminal_states: ["completed", "failed"] }`. Poll the job; once `completed`, the result carries `address: { name, line1, line2 (suite), city, region, postalCode, country, phone? }`. Pass that to `flipagent_upsert_location`. **Prereqs** — extension installed + paired; user signed into planetexpress.com in that profile. If the user has no PE account yet, surface https://planetexpress.com/signup before calling this. **Example** — call with `{}`.';

export async function planetExpressGetAddressExecute(config: Config, _args: Record<string, unknown>): Promise<unknown> {
	try {
		const client = getClient(config);
		return await client.forwarder.getAddress({ provider: "planetexpress" });
	} catch (err) {
		return toolErrorEnvelope(err, "get_forwarder_address_failed", "/v1/forwarder/planetexpress/address", PE_LOGIN_HINT);
	}
}

/* ------------------------------ inventory list ----------------------------- */

export const planetExpressInventoryInput = Type.Object({});

export const planetExpressInventoryDescription =
	'List the Planet Express inventory the bridge has reconciled for this api key. Calls GET /v1/forwarder/planetexpress/inventory. **When to use** — find a package\'s id from its marketplace sku before queueing `flipagent_dispatch_package`; track lifecycle progress across the receive → photograph → list → sell → dispatch → ship pipeline. **Inputs** — none. **Output** — `{ inventory: [{ packageId, sku?, ebayOrderId?, state: "received" | "photographed" | "listed" | "sold" | "dispatched" | "shipped", inbound?, outbound?, lastUpdatedAt }] }`, newest first. **Prereqs** — flipagent extension paired (no live PE login needed for this read — it\'s served from the reconciled state in flipagent\'s db). **Example** — call with `{}`.';

export async function planetExpressInventoryExecute(config: Config, _args: Record<string, unknown>): Promise<unknown> {
	try {
		const client = getClient(config);
		return await client.forwarder.inventory.list({ provider: "planetexpress" });
	} catch (err) {
		return toolErrorEnvelope(err, "forwarder_inventory_list_failed", "/v1/forwarder/planetexpress/inventory");
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
	'Bind a Planet Express package to a marketplace sku (and optional eBay offer id). Calls POST /v1/forwarder/planetexpress/packages/{packageId}/link. **When to use** — call this once after `flipagent_create_listing` (or `flipagent_relist_listing`) succeeds. The sold-event handler then uses the sku to find the package automatically and queue `flipagent_dispatch_package` when the listing sells — so the agent never has to thread the linkage by hand. **Inputs** — `packageId`, `sku`, optional `ebayOfferId` (returned by `flipagent_update_listing`). **Output** — `{ packageId, sku, ebayOfferId? }`. **Idempotent on** `(packageId, sku)`; re-linking a different sku overwrites. **Prereqs** — extension paired (no live PE login needed). **Example** — `{ packageId: "PE-12345", sku: "CANON-50-USED" }`.';

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
		return toolErrorEnvelope(
			err,
			"forwarder_packages_link_failed",
			`/v1/forwarder/planetexpress/packages/${packageId}/link`,
		);
	}
}

/* -------------------------------- job status ------------------------------- */

export const planetExpressJobStatusInput = Type.Object(
	{ jobId: Type.String({ format: "uuid" }) },
	{ $id: "PlanetExpressJobStatusInput" },
);

export const planetExpressJobStatusDescription =
	'Poll a previously-queued Planet Express bridge job until terminal. Calls GET /v1/forwarder/planetexpress/jobs/{jobId}. **When to use** — every async forwarder tool (`flipagent_refresh_forwarder`, `flipagent_request_package_photos`, `flipagent_dispatch_package`) returns a `jobId` and `poll_with: "flipagent_get_forwarder_job"`. Loop with backoff until `status` is terminal. **Inputs** — `jobId` (UUID). **Output** — `{ jobId, status: "queued" | "running" | "completed" | "failed", queuedAt, completedAt?, packages?, photos?, shipment?, failureReason? }`. The task-specific payload key (`packages` / `photos` / `shipment`) depends on which tool queued the job. **Prereqs** — `FLIPAGENT_API_KEY`. **Example** — `{ jobId: "abcd1234-..." }`.';

export async function planetExpressJobStatusExecute(config: Config, args: Record<string, unknown>): Promise<unknown> {
	const jobId = String(args.jobId);
	try {
		const client = getClient(config);
		return await client.forwarder.jobs.get({ provider: "planetexpress", jobId });
	} catch (err) {
		return toolErrorEnvelope(err, "forwarder_jobs_get_failed", `/v1/forwarder/planetexpress/jobs/${jobId}`);
	}
}
