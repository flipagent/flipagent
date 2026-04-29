/**
 * Forwarder inbox service. Wraps the bridge-queue infrastructure
 * (`services/orders/queue.ts`) for provider-specific package ops —
 * refresh the inbox, list cached packages, etc.
 *
 * Distinct from `services/forwarder/{estimate,zones,providers}` which
 * compute shipping rates. This file is the bridge-driven ops surface
 * (read the user's logged-in PE inbox, return packages).
 *
 * Used in both buy and sell flows: a reseller sources items abroad
 * (forwarder receives), consolidates, and may also ship outbound to
 * eBay buyers from forwarder stock.
 */

import type { ForwarderJobResponse, ForwarderJobStatus, ForwarderPackage, ForwarderProvider } from "@flipagent/types";
import type { PurchaseOrder } from "../../db/schema.js";
import { createOrder, getOrderForApiKey } from "../orders/queue.js";

export interface RefreshArgs {
	provider: ForwarderProvider;
	apiKeyId: string;
	userId: string | null;
}

export async function refreshForwarder(args: RefreshArgs): Promise<ForwarderJobResponse> {
	const order = await createOrder({
		apiKeyId: args.apiKeyId,
		userId: args.userId,
		// Provider name doubles as bridge source — the extension's
		// content-script registry keys off this.
		source: args.provider,
		// Forwarder reads have no item id; pass a synthetic constant so
		// the (legacy) `purchase_orders` schema's NOT NULL is satisfied.
		// The PE content-script handler ignores it.
		itemId: "inbox",
		quantity: 1,
		maxPriceCents: null,
		idempotencyKey: null,
		metadata: { kind: "forwarder.refresh" },
	});
	return toForwarderJob(args.provider, order);
}

export async function getForwarderJob(
	provider: ForwarderProvider,
	jobId: string,
	apiKeyId: string,
): Promise<ForwarderJobResponse | null> {
	const order = await getOrderForApiKey(jobId, apiKeyId);
	if (!order) return null;
	if (order.source !== provider) return null;
	return toForwarderJob(provider, order);
}

/* ------------------------------ helpers ------------------------------ */

function toForwarderJob(provider: ForwarderProvider, order: PurchaseOrder): ForwarderJobResponse {
	return {
		jobId: order.id,
		provider,
		status: mapInternalStatus(order.status),
		packages: extractPackages(order.result),
		failureReason: order.failureReason ?? null,
		createdAt: order.createdAt.toISOString(),
		updatedAt: order.updatedAt.toISOString(),
		expiresAt: order.expiresAt.toISOString(),
	};
}

function mapInternalStatus(s: PurchaseOrder["status"]): ForwarderJobStatus {
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
