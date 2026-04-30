/**
 * Forwarder inventory service. The `forwarder_inventory` table is the
 * stable identity that lets every cycle stage anchor on a packageId:
 *
 *   refresh   → upserts received packages (status=received)
 *   photos    → records image set (status=photographed)
 *   /link     → maps sku + ebayOfferId (status=listed)
 *   sold      → marks status=sold
 *   dispatch  → records outbound shipment (status=shipped)
 *
 * Without this table, an agent had to thread the sku↔packageId
 * mapping by hand through every sold-event webhook. With it, the
 * sold handler can look up `findBySku(apiKeyId, sku)` and queue a
 * dispatch with the package's existing context.
 */

import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "../../db/client.js";
import { type ForwarderInventory, forwarderInventory } from "../../db/schema.js";

export type InventoryStatus = ForwarderInventory["status"];

export interface UpsertReceivedInput {
	apiKeyId: string;
	provider: string;
	packageId: string;
	weightG?: number | null;
	dimsCm?: { l?: number; w?: number; h?: number } | null;
	inboundTracking?: string | null;
	carrier?: string | null;
}

/**
 * Insert-or-touch on (apiKeyId, provider, packageId). Refresh fires
 * this for every package the bridge reports back; existing rows keep
 * their downstream lifecycle fields (sku, photos, dispatch result)
 * untouched — only the intake-side metadata is refreshed in case PE
 * updated weight or tracking after first receipt.
 */
export async function upsertReceived(input: UpsertReceivedInput): Promise<ForwarderInventory> {
	const now = new Date();
	const [row] = await db
		.insert(forwarderInventory)
		.values({
			apiKeyId: input.apiKeyId,
			provider: input.provider,
			packageId: input.packageId,
			weightG: input.weightG ?? null,
			dimsCm: input.dimsCm ?? null,
			inboundTracking: input.inboundTracking ?? null,
			status: "received",
		})
		.onConflictDoUpdate({
			target: [forwarderInventory.apiKeyId, forwarderInventory.provider, forwarderInventory.packageId],
			set: {
				// Only refresh the intake-side fields — keep sku /
				// photos / dispatch state intact.
				weightG: input.weightG ?? sql`${forwarderInventory.weightG}`,
				dimsCm: input.dimsCm ?? sql`${forwarderInventory.dimsCm}`,
				inboundTracking: input.inboundTracking ?? sql`${forwarderInventory.inboundTracking}`,
				updatedAt: now,
			},
		})
		.returning();
	if (!row) throw new Error("forwarder_inventory upsert returned no row");
	return row;
}

export interface RecordPhotosInput {
	apiKeyId: string;
	provider: string;
	packageId: string;
	photos: Array<{ url: string; caption?: string; capturedAt?: string }>;
}

export async function recordPhotos(input: RecordPhotosInput): Promise<ForwarderInventory | null> {
	const now = new Date();
	// Upsert pattern — if the bridge reports photos before refresh has
	// surfaced the package (race), create the row; subsequent refresh
	// will fill in weight/dims.
	const [row] = await db
		.insert(forwarderInventory)
		.values({
			apiKeyId: input.apiKeyId,
			provider: input.provider,
			packageId: input.packageId,
			photos: input.photos,
			status: "photographed",
		})
		.onConflictDoUpdate({
			target: [forwarderInventory.apiKeyId, forwarderInventory.provider, forwarderInventory.packageId],
			set: {
				photos: input.photos,
				// Only step status forward — don't drop "listed"/"sold"
				// back to "photographed" if the agent re-fetches photos.
				status: sql`CASE
					WHEN ${forwarderInventory.status} IN ('received') THEN 'photographed'::forwarder_inventory_status
					ELSE ${forwarderInventory.status}
				END`,
				updatedAt: now,
			},
		})
		.returning();
	return row ?? null;
}

export interface LinkSkuInput {
	apiKeyId: string;
	provider: string;
	packageId: string;
	sku: string;
	ebayOfferId?: string | null;
}

/**
 * Mark this package as listed against a marketplace sku. Called
 * after `ebay_publish_offer` succeeds. The sold-event handler
 * looks up by sku to find the package.
 */
export async function linkSku(input: LinkSkuInput): Promise<ForwarderInventory | null> {
	const now = new Date();
	const [row] = await db
		.insert(forwarderInventory)
		.values({
			apiKeyId: input.apiKeyId,
			provider: input.provider,
			packageId: input.packageId,
			sku: input.sku,
			ebayOfferId: input.ebayOfferId ?? null,
			status: "listed",
		})
		.onConflictDoUpdate({
			target: [forwarderInventory.apiKeyId, forwarderInventory.provider, forwarderInventory.packageId],
			set: {
				sku: input.sku,
				ebayOfferId: input.ebayOfferId ?? sql`${forwarderInventory.ebayOfferId}`,
				status: sql`CASE
					WHEN ${forwarderInventory.status} IN ('received', 'photographed') THEN 'listed'::forwarder_inventory_status
					ELSE ${forwarderInventory.status}
				END`,
				updatedAt: now,
			},
		})
		.returning();
	return row ?? null;
}

export interface RecordDispatchInput {
	apiKeyId: string;
	provider: string;
	packageId: string;
	shipmentId: string | null;
	carrier: string | null;
	tracking: string | null;
	costCents: number | null;
	labelUrl: string | null;
	shippedAt: Date | null;
}

/**
 * Recorded after a `forwarder.dispatch` bridge job completes — the
 * outbound shipment fields finalize and status flips to `shipped`.
 * Idempotent: re-running with the same shipment id is a no-op.
 */
export async function recordDispatch(input: RecordDispatchInput): Promise<ForwarderInventory | null> {
	const now = new Date();
	const [row] = await db
		.update(forwarderInventory)
		.set({
			outboundShipmentId: input.shipmentId,
			outboundCarrier: input.carrier,
			outboundTracking: input.tracking,
			outboundCostCents: input.costCents,
			outboundLabelUrl: input.labelUrl,
			shippedAt: input.shippedAt,
			status: "shipped",
			updatedAt: now,
		})
		.where(
			and(
				eq(forwarderInventory.apiKeyId, input.apiKeyId),
				eq(forwarderInventory.provider, input.provider),
				eq(forwarderInventory.packageId, input.packageId),
			),
		)
		.returning();
	return row ?? null;
}

export interface MarkSoldInput {
	apiKeyId: string;
	sku: string;
}

/**
 * Step status forward to `sold`. Called from the inbound notification
 * handler when an `ItemSold` lands. Idempotent — terminal states
 * (`shipped`) stay terminal; `dispatched` stays dispatched.
 */
export async function markSold(input: MarkSoldInput): Promise<ForwarderInventory | null> {
	const now = new Date();
	const [row] = await db
		.update(forwarderInventory)
		.set({
			status: sql`CASE
				WHEN ${forwarderInventory.status} IN ('received', 'photographed', 'listed') THEN 'sold'::forwarder_inventory_status
				ELSE ${forwarderInventory.status}
			END`,
			updatedAt: now,
		})
		.where(and(eq(forwarderInventory.apiKeyId, input.apiKeyId), eq(forwarderInventory.sku, input.sku)))
		.returning();
	return row ?? null;
}

export async function findBySku(apiKeyId: string, sku: string): Promise<ForwarderInventory | null> {
	const rows = await db
		.select()
		.from(forwarderInventory)
		.where(and(eq(forwarderInventory.apiKeyId, apiKeyId), eq(forwarderInventory.sku, sku)))
		.limit(1);
	return rows[0] ?? null;
}

export async function findByPackageId(
	apiKeyId: string,
	provider: string,
	packageId: string,
): Promise<ForwarderInventory | null> {
	const rows = await db
		.select()
		.from(forwarderInventory)
		.where(
			and(
				eq(forwarderInventory.apiKeyId, apiKeyId),
				eq(forwarderInventory.provider, provider),
				eq(forwarderInventory.packageId, packageId),
			),
		)
		.limit(1);
	return rows[0] ?? null;
}

export async function listInventory(apiKeyId: string, provider: string, limit = 100): Promise<ForwarderInventory[]> {
	return db
		.select()
		.from(forwarderInventory)
		.where(and(eq(forwarderInventory.apiKeyId, apiKeyId), eq(forwarderInventory.provider, provider)))
		.orderBy(desc(forwarderInventory.createdAt))
		.limit(limit);
}
