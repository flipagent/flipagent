/**
 * `/v1/purchases/*` — flipagent-native buy-side surface.
 *
 *   POST   /v1/purchases              one-shot buy (initiate + place_order)
 *   GET    /v1/purchases              list mine
 *   GET    /v1/purchases/{id}         single purchase by id
 *   POST   /v1/purchases/{id}/cancel  cancel a non-terminal purchase
 *
 * The contract from a caller's perspective is two outcomes: terminal
 * status on the response (done) or non-terminal with `nextAction.url`
 * (open the URL for the user to complete the action on the
 * marketplace UI). The server picks how the order flows internally;
 * the response shape is identical across modes.
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
import { isExtensionPaired } from "../../auth/bridge-tokens.js";
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
import { errorResponse, jsonResponse, paramsFor, tbBody, tbCoerce } from "../../utils/openapi.js";

export const purchasesRoute = new Hono();

const COMMON_RESPONSES = {
	401: errorResponse("API key missing or eBay account not connected (POST /v1/connect/ebay)."),
	412: errorResponse("Precondition failed."),
	502: errorResponse("Upstream marketplace failed."),
	503: errorResponse("This api instance does not have eBay configured."),
};

function mapPurchaseError(c: Context, err: unknown) {
	if (err instanceof PurchaseError) {
		return c.json({ error: err.code, message: err.message }, err.status as 400 | 401 | 404 | 412 | 502);
	}
	return null;
}

purchasesRoute.post(
	"/",
	describeRoute({
		tags: ["Purchases"],
		summary: "Buy an item (one-shot)",
		description:
			"Place a purchase. The response is either terminal (the order is fully placed; render the receipt) or non-terminal with `nextAction.url` (direct the user to that URL to complete the purchase on the marketplace UI, then poll `GET /v1/purchases/{id}`). Either way the response shape is identical.",
		responses: {
			201: jsonResponse("Purchase (status may be terminal or pending).", PurchaseResponse),
			400: errorResponse("Validation failed."),
			...COMMON_RESPONSES,
		},
	}),
	requireApiKey,
	tbBody(PurchaseCreate),
	async (c) => {
		const body = c.req.valid("json");
		try {
			const bridgePaired = await isExtensionPaired(c.var.apiKey.id);
			const result = await createPurchase(body, {
				apiKeyId: c.var.apiKey.id,
				userId: c.var.apiKey.userId ?? null,
				bridgePaired,
			});
			renderResultHeaders(c, result);
			return c.json(result.body, 201);
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
		description: "Newest first. Same Purchase shape as POST + GET single.",
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
		// of mode. List the rows for this api key, then materialise
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
		const body: PurchasesListResponse = { purchases: filtered, limit, offset };
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
		return c.json(result.body);
	},
);

/* Mid-checkout updates. Honored only when the server can place the
 * order directly; otherwise 412 with a clean message. The schemas are
 * stable across server states so the same client code keeps working
 * if the server's order-placement capability is enabled later. */

purchasesRoute.patch(
	"/:id/shipping",
	describeRoute({
		tags: ["Purchases"],
		summary: "Update shipping address mid-checkout",
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
			return c.json(result.body);
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
		summary: "Update payment instrument mid-checkout",
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
			return c.json(result.body);
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
		summary: "Apply or remove a coupon mid-checkout",
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
			return c.json(result.body);
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
		summary: "Remove the applied coupon",
		responses: { 200: jsonResponse("Updated purchase.", PurchaseResponse), ...COMMON_RESPONSES },
	}),
	requireApiKey,
	async (c) => {
		try {
			const result = await updatePurchaseCoupon(c.req.param("id"), null, c.var.apiKey.id);
			if (!result) return c.json({ error: "purchase_not_found" }, 404);
			renderResultHeaders(c, result);
			return c.json(result.body);
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
		return c.json(result.body);
	},
);
