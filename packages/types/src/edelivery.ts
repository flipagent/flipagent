/**
 * `/v1/edelivery/*` — eBay eDelivery International Shipping. Niche
 * cross-border seller program (separate from domestic Sell Logistics).
 *
 * Resources:
 *   - packages: create + confirm + label-print + cancel + clone + bulk-ops
 *   - bundles: package-bundles for consolidated drop-off
 *   - labels / tracking / handover-sheet: post-create artifacts
 *   - preferences (address, consign), agents, dropoff-sites, services,
 *     battery-qualifications, complaints
 *
 * The eDelivery surface is large but mostly thin — wrapped types use
 * pass-through `Type.Unknown()` for body shapes that mirror eBay's spec
 * verbatim (no flipagent reformatting). Keys are kept lowerCamelCase to
 * match the rest of `/v1/*`.
 */

import { type Static, Type } from "@sinclair/typebox";
import { ResponseSource } from "./_common.js";

const Untyped = Type.Unknown();
const SourceField = Type.Object({ source: Type.Optional(ResponseSource) });

/* ---------------- packages ---------------- */

export const EDeliveryPackagesListResponse = Type.Composite(
	[Type.Object({ packages: Type.Array(Untyped), total: Type.Optional(Type.Integer()) }), SourceField],
	{ $id: "EDeliveryPackagesListResponse" },
);
export type EDeliveryPackagesListResponse = Static<typeof EDeliveryPackagesListResponse>;

export const EDeliveryPackageCreateResponse = Type.Composite([Type.Object({ id: Type.String() }), SourceField], {
	$id: "EDeliveryPackageCreateResponse",
});
export type EDeliveryPackageCreateResponse = Static<typeof EDeliveryPackageCreateResponse>;

export const EDeliveryPackageResponse = Type.Composite([Type.Object({ package: Untyped }), SourceField], {
	$id: "EDeliveryPackageResponse",
});
export type EDeliveryPackageResponse = Static<typeof EDeliveryPackageResponse>;

/* ---------------- bundles ---------------- */

export const EDeliveryBundlesListResponse = Type.Composite(
	[Type.Object({ bundles: Type.Array(Untyped), total: Type.Optional(Type.Integer()) }), SourceField],
	{ $id: "EDeliveryBundlesListResponse" },
);
export type EDeliveryBundlesListResponse = Static<typeof EDeliveryBundlesListResponse>;

export const EDeliveryBundleCreateResponse = Type.Composite([Type.Object({ id: Type.String() }), SourceField], {
	$id: "EDeliveryBundleCreateResponse",
});
export type EDeliveryBundleCreateResponse = Static<typeof EDeliveryBundleCreateResponse>;

export const EDeliveryBundleResponse = Type.Composite([Type.Object({ bundle: Untyped }), SourceField], {
	$id: "EDeliveryBundleResponse",
});
export type EDeliveryBundleResponse = Static<typeof EDeliveryBundleResponse>;

/* ---------------- generic raw passthrough ---------------- */

/**
 * eDelivery has many small read endpoints (labels, tracking, agents,
 * dropoff-sites, services, etc.) where the response shape is so eBay-
 * specific that flipagent doesn't reshape. We expose them under a
 * `data` envelope + `source` so the wire contract is consistent.
 */
export const EDeliveryRawResponse = Type.Composite([Type.Object({ data: Untyped }), SourceField], {
	$id: "EDeliveryRawResponse",
});
export type EDeliveryRawResponse = Static<typeof EDeliveryRawResponse>;

export const EDeliveryOkResponse = Type.Composite([Type.Object({ ok: Type.Boolean() }), SourceField], {
	$id: "EDeliveryOkResponse",
});
export type EDeliveryOkResponse = Static<typeof EDeliveryOkResponse>;
