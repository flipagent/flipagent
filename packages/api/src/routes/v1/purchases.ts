/**
 * `/v1/purchases/*` — flipagent-native buy-side surface.
 *
 *   POST   /v1/purchases              one-shot buy (initiate + place_order)
 *   GET    /v1/purchases              list mine
 *   GET    /v1/purchases/{id}         single purchase by id
 *   POST   /v1/purchases/{id}/cancel  cancel a non-terminal purchase
 *
 * `id` is eBay's `purchaseOrderId`. Both REST and bridge transports
 * are first-class — `selectTransport` picks based on
 * `EBAY_ORDER_API_APPROVED` + bridge pairing + the optional
 * `transport` field on the body.
 */

import {
	PurchaseCouponUpdate,
	PurchaseCreate,
	PurchasePaymentUpdate,
	PurchaseResponse,
	PurchaseShipToUpdate,
	PurchasesListQuery,
	PurchasesListResponse,
} from "@flipagent/types";
import { and, desc, eq } from "drizzle-orm";
import type { Context } from "hono";
import { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import { db } from "../../db/client.js";
import { bridgeJobs } from "../../db/schema.js";
import { requireApiKey } from "../../middleware/auth.js";
import {
	cancelPurchase,
	createPurchase,
	getPurchase,
	PurchaseError,
	updatePurchaseCoupon,
	updatePurchasePayment,
	updatePurchaseShipping,
} from "../../services/purchases/orchestrate.js";
import { renderResultHeaders } from "../../services/shared/headers.js";
import { nextAction } from "../../services/shared/next-action.js";
import { errorResponse, jsonResponse, paramsFor, tbBody, tbCoerce } from "../../utils/openapi.js";

export const purchasesRoute = new Hono();

const COMMON_RESPONSES = {
	401: errorResponse("API key missing or eBay account not connected (POST /v1/connect/ebay)."),
	412: errorResponse("Transport unavailable, or option only valid in REST transport."),
	502: errorResponse("Upstream eBay or bridge transport failed."),
	503: errorResponse("EBAY_CLIENT_ID/SECRET/RU_NAME unset on this api instance."),
};

function mapPurchaseError(c: Context, err: unknown) {
	if (err instanceof PurchaseError) {
		const next_action = err.nextActionKind ? nextAction(c, err.nextActionKind) : undefined;
		return c.json(
			{ error: err.code, message: err.message, ...(next_action ? { next_action } : {}) },
			err.status as 400 | 401 | 404 | 412 | 502,
		);
	}
	return null;
}

purchasesRoute.post(
	"/",
	describeRoute({
		tags: ["Purchases"],
		summary: "Buy an item (one-shot)",
		description:
			"Compresses eBay's two-stage Buy Order flow (initiate + place_order) into one call. Auto-picks REST transport when `EBAY_ORDER_API_APPROVED=1` and the api key has eBay OAuth bound; otherwise bridge (Chrome extension). `shipTo` and `couponCode` only work in REST transport — bridge uses buyer defaults.",
		responses: {
			201: jsonResponse("Purchase placed (status may still be `queued`/`processing`).", PurchaseResponse),
			400: errorResponse("Validation failed."),
			...COMMON_RESPONSES,
		},
	}),
	requireApiKey,
	tbBody(PurchaseCreate),
	async (c) => {
		const body = c.req.valid("json");
		try {
			const result = await createPurchase(body, {
				apiKeyId: c.var.apiKey.id,
				userId: c.var.apiKey.userId ?? null,
			});
			renderResultHeaders(c, result);
			return c.json({ ...result.body, source: result.source }, 201);
		} catch (err) {
			const mapped = mapPurchaseError(c, err);
			if (mapped) return mapped;
			throw err;
		}
	},
);

purchasesRoute.get(
	"/",
	describeRoute({
		tags: ["Purchases"],
		summary: "List my purchases",
		description:
			"Bridge-tracked orders (and REST-placed orders flowing through the same orchestrator). Newest first.",
		parameters: paramsFor("query", PurchasesListQuery),
		responses: {
			200: jsonResponse("Purchases page.", PurchasesListResponse),
			...COMMON_RESPONSES,
		},
	}),
	requireApiKey,
	tbCoerce("query", PurchasesListQuery),
	async (c) => {
		const query = c.req.valid("query");
		const limit = query.limit ?? 50;
		const offset = query.offset ?? 0;
		// We track every orchestrated purchase in `bridge_jobs` regardless
		// of transport. List the rows for this api key, then materialise
		// each through the same `getPurchase` path so the shape matches.
		const rows = await db
			.select({ id: bridgeJobs.id })
			.from(bridgeJobs)
			.where(and(eq(bridgeJobs.apiKeyId, c.var.apiKey.id), eq(bridgeJobs.source, "ebay")))
			.orderBy(desc(bridgeJobs.createdAt))
			.limit(limit)
			.offset(offset);
		const results = (await Promise.all(rows.map((row) => getPurchase(row.id, c.var.apiKey.id)))).filter(
			(r): r is NonNullable<typeof r> => r !== null,
		);
		const purchases = results.map((r) => r.body);
		const filtered = query.status ? purchases.filter((p) => p.status === query.status) : purchases;
		// List is a flipagent-side DB read regardless of which transport
		// originally placed each purchase, so the page-level source is
		// "rest" by convention. Per-row transport is preserved on each
		// `Purchase.transport`.
		c.header("X-Flipagent-Source", "rest");
		const body: PurchasesListResponse = {
			purchases: filtered,
			limit,
			offset,
			source: "rest",
		};
		return c.json(body);
	},
);

purchasesRoute.get(
	"/:id",
	describeRoute({
		tags: ["Purchases"],
		summary: "Get a purchase",
		responses: {
			200: jsonResponse("Purchase.", PurchaseResponse),
			404: errorResponse("Purchase not found."),
			...COMMON_RESPONSES,
		},
	}),
	requireApiKey,
	async (c) => {
		const id = c.req.param("id");
		const result = await getPurchase(id, c.var.apiKey.id);
		if (!result) return c.json({ error: "purchase_not_found", message: `No purchase '${id}'.` }, 404);
		renderResultHeaders(c, result);
		return c.json({ ...result.body, source: result.source });
	},
);

purchasesRoute.patch(
	"/:id/shipping",
	describeRoute({
		tags: ["Purchases"],
		summary: "Update shipping address mid-checkout (REST transport only)",
		responses: { 200: jsonResponse("Updated purchase.", PurchaseResponse), ...COMMON_RESPONSES },
	}),
	requireApiKey,
	tbBody(PurchaseShipToUpdate),
	async (c) => {
		try {
			const body = c.req.valid("json");
			const result = await updatePurchaseShipping(c.req.param("id"), body.shipTo, c.var.apiKey.id);
			if (!result) return c.json({ error: "purchase_not_found" }, 404);
			renderResultHeaders(c, result);
			return c.json({ ...result.body, source: result.source });
		} catch (err) {
			const mapped = mapPurchaseError(c, err);
			if (mapped) return mapped;
			throw err;
		}
	},
);

purchasesRoute.patch(
	"/:id/payment",
	describeRoute({
		tags: ["Purchases"],
		summary: "Update payment instrument mid-checkout (REST transport only)",
		responses: { 200: jsonResponse("Updated purchase.", PurchaseResponse), ...COMMON_RESPONSES },
	}),
	requireApiKey,
	tbBody(PurchasePaymentUpdate),
	async (c) => {
		try {
			const body = c.req.valid("json");
			const result = await updatePurchasePayment(c.req.param("id"), body.paymentInstruments, c.var.apiKey.id);
			if (!result) return c.json({ error: "purchase_not_found" }, 404);
			renderResultHeaders(c, result);
			return c.json({ ...result.body, source: result.source });
		} catch (err) {
			const mapped = mapPurchaseError(c, err);
			if (mapped) return mapped;
			throw err;
		}
	},
);

purchasesRoute.patch(
	"/:id/coupon",
	describeRoute({
		tags: ["Purchases"],
		summary: "Apply or remove a coupon mid-checkout (REST transport only)",
		responses: { 200: jsonResponse("Updated purchase.", PurchaseResponse), ...COMMON_RESPONSES },
	}),
	requireApiKey,
	tbBody(PurchaseCouponUpdate),
	async (c) => {
		try {
			const body = c.req.valid("json");
			const result = await updatePurchaseCoupon(c.req.param("id"), body.couponCode || null, c.var.apiKey.id);
			if (!result) return c.json({ error: "purchase_not_found" }, 404);
			renderResultHeaders(c, result);
			return c.json({ ...result.body, source: result.source });
		} catch (err) {
			const mapped = mapPurchaseError(c, err);
			if (mapped) return mapped;
			throw err;
		}
	},
);

purchasesRoute.delete(
	"/:id/coupon",
	describeRoute({
		tags: ["Purchases"],
		summary: "Remove the applied coupon (REST transport only)",
		responses: { 200: jsonResponse("Updated purchase.", PurchaseResponse), ...COMMON_RESPONSES },
	}),
	requireApiKey,
	async (c) => {
		try {
			const result = await updatePurchaseCoupon(c.req.param("id"), null, c.var.apiKey.id);
			if (!result) return c.json({ error: "purchase_not_found" }, 404);
			renderResultHeaders(c, result);
			return c.json({ ...result.body, source: result.source });
		} catch (err) {
			const mapped = mapPurchaseError(c, err);
			if (mapped) return mapped;
			throw err;
		}
	},
);

purchasesRoute.post(
	"/:id/cancel",
	describeRoute({
		tags: ["Purchases"],
		summary: "Cancel a non-terminal purchase",
		description:
			"Cancels orders that haven't been picked up yet (queued / pre-place processing). Once mid-place, cancel is a no-op and the order continues.",
		responses: {
			200: jsonResponse("Purchase (now cancelled or terminal).", PurchaseResponse),
			404: errorResponse("Purchase not found."),
			...COMMON_RESPONSES,
		},
	}),
	requireApiKey,
	async (c) => {
		const id = c.req.param("id");
		const result = await cancelPurchase(id, c.var.apiKey.id);
		if (!result) return c.json({ error: "purchase_not_found", message: `No purchase '${id}'.` }, 404);
		renderResultHeaders(c, result);
		return c.json({ ...result.body, source: result.source });
	},
);
