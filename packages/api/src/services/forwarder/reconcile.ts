/**
 * Reconcile bridge job results into the forwarder_inventory table.
 *
 * Called from the /v1/bridge/result handler when a forwarder.* job
 * completes — translates the result payload into the right inventory
 * service call. Centralised here so the bridge route stays thin and
 * the reconcile policy (which kind→which method) lives next to the
 * inventory data layer.
 *
 * Errors are not fatal at the call site; log + continue. Webhook
 * delivery and inventory reconciliation are independent — a database
 * blip on reconcile must not break webhook fanout.
 */

import { recordDispatch, recordPhotos, upsertReceived } from "./inventory.js";

interface ReconcileInput {
	apiKeyId: string;
	source: string;
	kind: string | null;
	itemId: string;
	metadata: Record<string, unknown> | null;
	result: Record<string, unknown> | null;
}

export async function reconcileBridgeResult(input: ReconcileInput): Promise<void> {
	if (!input.kind) return;

	if (input.kind === "forwarder.refresh") {
		// Bridge returns `{ packages: [{ id, trackingNumber?, weightG?, ... }] }`.
		// Upsert each — first time creates the row, subsequent refreshes
		// just touch the intake fields without disturbing downstream
		// lifecycle state.
		const packages = Array.isArray(input.result?.packages)
			? (input.result.packages as Array<Record<string, unknown>>)
			: [];
		await Promise.all(
			packages.map((p) => {
				const packageId = typeof p.id === "string" ? p.id : null;
				if (!packageId) return Promise.resolve();
				return upsertReceived({
					apiKeyId: input.apiKeyId,
					provider: input.source,
					packageId,
					weightG: typeof p.weightG === "number" ? p.weightG : null,
					dimsCm: extractDims(p.dimsCm),
					inboundTracking: typeof p.trackingNumber === "string" ? p.trackingNumber : null,
				}).then(
					() => undefined,
					(err) => console.error("[reconcile] upsertReceived failed:", err),
				);
			}),
		);
		return;
	}

	if (input.kind === "forwarder.photos") {
		const photos = Array.isArray(input.result?.photos)
			? (input.result.photos as Array<{ url: string; caption?: string; capturedAt?: string }>)
			: [];
		if (photos.length === 0) return;
		await recordPhotos({
			apiKeyId: input.apiKeyId,
			provider: input.source,
			packageId: input.itemId,
			photos,
		});
		return;
	}

	if (input.kind === "forwarder.dispatch") {
		const shipment = (input.result?.shipment as Record<string, unknown> | null) ?? null;
		if (!shipment) return;
		await recordDispatch({
			apiKeyId: input.apiKeyId,
			provider: input.source,
			packageId: input.itemId,
			shipmentId: typeof shipment.shipmentId === "string" ? shipment.shipmentId : null,
			carrier: typeof shipment.carrier === "string" ? shipment.carrier : null,
			tracking: typeof shipment.tracking === "string" ? shipment.tracking : null,
			costCents: typeof shipment.costCents === "number" ? shipment.costCents : null,
			labelUrl: typeof shipment.labelUrl === "string" ? shipment.labelUrl : null,
			shippedAt: typeof shipment.shippedAt === "string" ? new Date(shipment.shippedAt) : null,
		});
	}
}

function extractDims(d: unknown): { l?: number; w?: number; h?: number } | null {
	if (!d || typeof d !== "object") return null;
	const o = d as Record<string, unknown>;
	const out: { l?: number; w?: number; h?: number } = {};
	if (typeof o.l === "number") out.l = o.l;
	if (typeof o.w === "number") out.w = o.w;
	if (typeof o.h === "number") out.h = o.h;
	return Object.keys(out).length > 0 ? out : null;
}
