/**
 * `/v1/edelivery/*` — eBay eDelivery International Shipping. Niche
 * cross-border seller program (separate from domestic Sell Logistics).
 *
 * Resources:
 *   - /packages: create + confirm + label-print + cancel + clone + bulk-ops
 *   - /bundles: package-bundles for consolidated drop-off
 *   - /labels, /tracking, /handover-sheet: post-create artifacts
 *   - /preferences/{address,consign}, /agents, /dropoff-sites, /services,
 *     /battery-qualifications, /complaints
 *
 * eDelivery's response shapes are eBay-specific and dense — we
 * pass-through under `{ data, source }` envelopes rather than reshape.
 */

import {
	EDeliveryBundleCreateResponse,
	EDeliveryBundleResponse,
	EDeliveryBundlesListResponse,
	EDeliveryOkResponse,
	EDeliveryPackageCreateResponse,
	EDeliveryPackageResponse,
	EDeliveryPackagesListResponse,
	EDeliveryRawResponse,
} from "@flipagent/types";
import { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import { requireApiKey } from "../../middleware/auth.js";
import * as edelivery from "../../services/edelivery/operations.js";
import { errorResponse, jsonResponse } from "../../utils/openapi.js";

export const edeliveryRoute = new Hono();

const COMMON = {
	401: errorResponse("API key missing or eBay account not connected."),
	502: errorResponse("Upstream eBay request failed."),
};

const QUERY_KEYS_TO_RECORD = (c: { req: { query: () => Record<string, string> } }) => c.req.query();

function ctx(c: { var: { apiKey: { id: string } }; req: { header: (k: string) => string | undefined } }) {
	return { apiKeyId: c.var.apiKey.id, marketplace: c.req.header("X-EBAY-C-MARKETPLACE-ID") };
}

/* ---------- /packages ---------- */

edeliveryRoute.get(
	"/packages",
	describeRoute({
		tags: ["eDelivery"],
		summary: "List packages",
		responses: { 200: jsonResponse("Packages.", EDeliveryPackagesListResponse), ...COMMON },
	}),
	requireApiKey,
	async (c) => {
		const data = (await edelivery.listPackages(QUERY_KEYS_TO_RECORD(c), ctx(c))) as {
			packages?: unknown[];
			total?: number;
		};
		return c.json({
			packages: data?.packages ?? [],
			...(data?.total !== undefined ? { total: data.total } : {}),
			source: "rest" as const,
		});
	},
);

edeliveryRoute.post(
	"/packages",
	describeRoute({
		tags: ["eDelivery"],
		summary: "Create a package",
		responses: { 201: jsonResponse("Created.", EDeliveryPackageCreateResponse), ...COMMON },
	}),
	requireApiKey,
	async (c) => {
		const body = (await c.req.json()) as Record<string, unknown>;
		const r = await edelivery.createPackage(body, ctx(c));
		return c.json({ id: r.id, source: "rest" as const }, 201);
	},
);

edeliveryRoute.get(
	"/packages/:id",
	describeRoute({
		tags: ["eDelivery"],
		summary: "Get a package",
		responses: { 200: jsonResponse("Package.", EDeliveryPackageResponse), ...COMMON },
	}),
	requireApiKey,
	async (c) => c.json({ package: await edelivery.getPackage(c.req.param("id"), ctx(c)), source: "rest" as const }),
);

edeliveryRoute.post(
	"/packages/:id/cancel",
	describeRoute({
		tags: ["eDelivery"],
		summary: "Cancel a package",
		responses: { 200: jsonResponse("Cancelled.", EDeliveryOkResponse), ...COMMON },
	}),
	requireApiKey,
	async (c) => {
		await edelivery.cancelPackage(c.req.param("id"), ctx(c));
		return c.json({ ok: true, source: "rest" as const });
	},
);

edeliveryRoute.post(
	"/packages/:id/confirm",
	describeRoute({
		tags: ["eDelivery"],
		summary: "Confirm a package",
		responses: { 200: jsonResponse("Confirmed.", EDeliveryRawResponse), ...COMMON },
	}),
	requireApiKey,
	async (c) => {
		const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
		return c.json({ data: await edelivery.confirmPackage(c.req.param("id"), body, ctx(c)), source: "rest" as const });
	},
);

edeliveryRoute.post(
	"/packages/:id/clone",
	describeRoute({
		tags: ["eDelivery"],
		summary: "Clone a package",
		responses: { 201: jsonResponse("Created.", EDeliveryPackageCreateResponse), ...COMMON },
	}),
	requireApiKey,
	async (c) => {
		const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
		const r = await edelivery.clonePackage(c.req.param("id"), body, ctx(c));
		return c.json({ id: r.id, source: "rest" as const }, 201);
	},
);

edeliveryRoute.get(
	"/packages/:orderLineItemId/item",
	describeRoute({
		tags: ["eDelivery"],
		summary: "Get a package's order line item",
		responses: { 200: jsonResponse("Item.", EDeliveryRawResponse), ...COMMON },
	}),
	requireApiKey,
	async (c) =>
		c.json({ data: await edelivery.getPackageItem(c.req.param("orderLineItemId"), ctx(c)), source: "rest" as const }),
);

edeliveryRoute.post(
	"/packages/bulk-cancel",
	describeRoute({
		tags: ["eDelivery"],
		summary: "Bulk-cancel packages",
		responses: { 200: jsonResponse("Result.", EDeliveryRawResponse), ...COMMON },
	}),
	requireApiKey,
	async (c) => {
		const body = (await c.req.json()) as Record<string, unknown>;
		return c.json({ data: await edelivery.bulkCancelPackages(body, ctx(c)), source: "rest" as const });
	},
);

edeliveryRoute.post(
	"/packages/bulk-confirm",
	describeRoute({
		tags: ["eDelivery"],
		summary: "Bulk-confirm packages",
		responses: { 200: jsonResponse("Result.", EDeliveryRawResponse), ...COMMON },
	}),
	requireApiKey,
	async (c) => {
		const body = (await c.req.json()) as Record<string, unknown>;
		return c.json({ data: await edelivery.bulkConfirmPackages(body, ctx(c)), source: "rest" as const });
	},
);

edeliveryRoute.post(
	"/packages/bulk-delete",
	describeRoute({
		tags: ["eDelivery"],
		summary: "Bulk-delete packages",
		responses: { 200: jsonResponse("Result.", EDeliveryRawResponse), ...COMMON },
	}),
	requireApiKey,
	async (c) => {
		const body = (await c.req.json()) as Record<string, unknown>;
		return c.json({ data: await edelivery.bulkDeletePackages(body, ctx(c)), source: "rest" as const });
	},
);

/* ---------- /bundles ---------- */

edeliveryRoute.get(
	"/bundles",
	describeRoute({
		tags: ["eDelivery"],
		summary: "List bundles",
		responses: { 200: jsonResponse("Bundles.", EDeliveryBundlesListResponse), ...COMMON },
	}),
	requireApiKey,
	async (c) => {
		const data = (await edelivery.listBundles(QUERY_KEYS_TO_RECORD(c), ctx(c))) as {
			bundles?: unknown[];
			total?: number;
		};
		return c.json({
			bundles: data?.bundles ?? [],
			...(data?.total !== undefined ? { total: data.total } : {}),
			source: "rest" as const,
		});
	},
);

edeliveryRoute.post(
	"/bundles",
	describeRoute({
		tags: ["eDelivery"],
		summary: "Create a bundle",
		responses: { 201: jsonResponse("Created.", EDeliveryBundleCreateResponse), ...COMMON },
	}),
	requireApiKey,
	async (c) => {
		const body = (await c.req.json()) as Record<string, unknown>;
		const r = await edelivery.createBundle(body, ctx(c));
		return c.json({ id: r.id, source: "rest" as const }, 201);
	},
);

edeliveryRoute.get(
	"/bundles/:id",
	describeRoute({
		tags: ["eDelivery"],
		summary: "Get a bundle",
		responses: { 200: jsonResponse("Bundle.", EDeliveryBundleResponse), ...COMMON },
	}),
	requireApiKey,
	async (c) => c.json({ bundle: await edelivery.getBundle(c.req.param("id"), ctx(c)), source: "rest" as const }),
);

edeliveryRoute.post(
	"/bundles/:id/cancel",
	describeRoute({
		tags: ["eDelivery"],
		summary: "Cancel a bundle",
		responses: { 200: jsonResponse("Cancelled.", EDeliveryOkResponse), ...COMMON },
	}),
	requireApiKey,
	async (c) => {
		await edelivery.cancelBundle(c.req.param("id"), ctx(c));
		return c.json({ ok: true, source: "rest" as const });
	},
);

edeliveryRoute.get(
	"/bundles/:id/label",
	describeRoute({
		tags: ["eDelivery"],
		summary: "Get a bundle's shipping label",
		responses: { 200: jsonResponse("Label.", EDeliveryRawResponse), ...COMMON },
	}),
	requireApiKey,
	async (c) => c.json({ data: await edelivery.getBundleLabel(c.req.param("id"), ctx(c)), source: "rest" as const }),
);

/* ---------- /labels, /tracking, /handover-sheet ---------- */

edeliveryRoute.get(
	"/labels",
	describeRoute({
		tags: ["eDelivery"],
		summary: "List shipping labels",
		responses: { 200: jsonResponse("Labels.", EDeliveryRawResponse), ...COMMON },
	}),
	requireApiKey,
	async (c) => c.json({ data: await edelivery.getLabels(QUERY_KEYS_TO_RECORD(c), ctx(c)), source: "rest" as const }),
);

edeliveryRoute.get(
	"/tracking",
	describeRoute({
		tags: ["eDelivery"],
		summary: "Get tracking information",
		responses: { 200: jsonResponse("Tracking.", EDeliveryRawResponse), ...COMMON },
	}),
	requireApiKey,
	async (c) => c.json({ data: await edelivery.getTracking(QUERY_KEYS_TO_RECORD(c), ctx(c)), source: "rest" as const }),
);

edeliveryRoute.get(
	"/handover-sheet",
	describeRoute({
		tags: ["eDelivery"],
		summary: "Get the handover sheet",
		responses: { 200: jsonResponse("Handover sheet.", EDeliveryRawResponse), ...COMMON },
	}),
	requireApiKey,
	async (c) =>
		c.json({ data: await edelivery.getHandoverSheet(QUERY_KEYS_TO_RECORD(c), ctx(c)), source: "rest" as const }),
);

/* ---------- preferences / config ---------- */

edeliveryRoute.get(
	"/actual-costs",
	describeRoute({
		tags: ["eDelivery"],
		summary: "Get actual shipping costs",
		responses: { 200: jsonResponse("Costs.", EDeliveryRawResponse), ...COMMON },
	}),
	requireApiKey,
	async (c) =>
		c.json({ data: await edelivery.getActualCosts(QUERY_KEYS_TO_RECORD(c), ctx(c)), source: "rest" as const }),
);

edeliveryRoute.get(
	"/preferences/address",
	describeRoute({
		tags: ["eDelivery"],
		summary: "Get the address preference",
		responses: { 200: jsonResponse("Preference.", EDeliveryRawResponse), ...COMMON },
	}),
	requireApiKey,
	async (c) => c.json({ data: await edelivery.getAddressPreference(ctx(c)), source: "rest" as const }),
);

edeliveryRoute.post(
	"/preferences/address",
	describeRoute({
		tags: ["eDelivery"],
		summary: "Set the address preference",
		responses: { 200: jsonResponse("Saved.", EDeliveryRawResponse), ...COMMON },
	}),
	requireApiKey,
	async (c) => {
		const body = (await c.req.json()) as Record<string, unknown>;
		return c.json({ data: await edelivery.setAddressPreference(body, ctx(c)), source: "rest" as const });
	},
);

edeliveryRoute.get(
	"/preferences/consign",
	describeRoute({
		tags: ["eDelivery"],
		summary: "Get the consign preference",
		responses: { 200: jsonResponse("Preference.", EDeliveryRawResponse), ...COMMON },
	}),
	requireApiKey,
	async (c) => c.json({ data: await edelivery.getConsignPreference(ctx(c)), source: "rest" as const }),
);

edeliveryRoute.post(
	"/preferences/consign",
	describeRoute({
		tags: ["eDelivery"],
		summary: "Set the consign preference",
		responses: { 200: jsonResponse("Saved.", EDeliveryRawResponse), ...COMMON },
	}),
	requireApiKey,
	async (c) => {
		const body = (await c.req.json()) as Record<string, unknown>;
		return c.json({ data: await edelivery.setConsignPreference(body, ctx(c)), source: "rest" as const });
	},
);

edeliveryRoute.get(
	"/agents",
	describeRoute({
		tags: ["eDelivery"],
		summary: "List agents",
		responses: { 200: jsonResponse("Agents.", EDeliveryRawResponse), ...COMMON },
	}),
	requireApiKey,
	async (c) => c.json({ data: await edelivery.listAgents(QUERY_KEYS_TO_RECORD(c), ctx(c)), source: "rest" as const }),
);

edeliveryRoute.get(
	"/dropoff-sites",
	describeRoute({
		tags: ["eDelivery"],
		summary: "List dropoff sites",
		responses: { 200: jsonResponse("Sites.", EDeliveryRawResponse), ...COMMON },
	}),
	requireApiKey,
	async (c) =>
		c.json({ data: await edelivery.listDropoffSites(QUERY_KEYS_TO_RECORD(c), ctx(c)), source: "rest" as const }),
);

edeliveryRoute.get(
	"/battery-qualifications",
	describeRoute({
		tags: ["eDelivery"],
		summary: "Get battery qualifications",
		responses: { 200: jsonResponse("Qualifications.", EDeliveryRawResponse), ...COMMON },
	}),
	requireApiKey,
	async (c) =>
		c.json({
			data: await edelivery.getBatteryQualifications(QUERY_KEYS_TO_RECORD(c), ctx(c)),
			source: "rest" as const,
		}),
);

edeliveryRoute.get(
	"/services",
	describeRoute({
		tags: ["eDelivery"],
		summary: "List shipping services",
		responses: { 200: jsonResponse("Services.", EDeliveryRawResponse), ...COMMON },
	}),
	requireApiKey,
	async (c) => c.json({ data: await edelivery.getServices(QUERY_KEYS_TO_RECORD(c), ctx(c)), source: "rest" as const }),
);

edeliveryRoute.get(
	"/complaints",
	describeRoute({
		tags: ["eDelivery"],
		summary: "List complaints",
		responses: { 200: jsonResponse("Complaints.", EDeliveryRawResponse), ...COMMON },
	}),
	requireApiKey,
	async (c) =>
		c.json({ data: await edelivery.listComplaints(QUERY_KEYS_TO_RECORD(c), ctx(c)), source: "rest" as const }),
);

edeliveryRoute.post(
	"/complaints",
	describeRoute({
		tags: ["eDelivery"],
		summary: "Create a complaint",
		responses: { 201: jsonResponse("Created.", EDeliveryRawResponse), ...COMMON },
	}),
	requireApiKey,
	async (c) => {
		const body = (await c.req.json()) as Record<string, unknown>;
		return c.json({ data: await edelivery.createComplaint(body, ctx(c)), source: "rest" as const }, 201);
	},
);
