/**
 * Periodic maintenance tasks the worker runs alongside the compute-job
 * loop. Each task is idempotent + best-effort: a failure logs but does
 * not propagate, so one stuck dependency cannot starve the others.
 *
 * Tasks:
 *
 *   - takedown SLA enforcer
 *       Find takedown_requests rows still in `pending` past
 *       TAKEDOWN_SLA_HOURS (48h) without a previous breach alert.
 *       Set `slaBreachedAt = now()` and email legal@ via Resend.
 *       Idempotent: the WHERE clause skips rows that already alerted.
 *
 *   - notification PII scrub
 *       After NOTIFICATION_PII_RETENTION_DAYS (90), null out the
 *       `payload` JSONB on marketplace_notifications rows so buyer
 *       email/address/messages no longer sit in the audit table.
 *       Keeps eventType + receivedAt + signatureValid for audit.
 *
 *   - notification hard-delete
 *       After NOTIFICATION_HARD_DELETE_DAYS (548 ≈ 18mo), drop the
 *       row entirely. Aligns with privacy.astro's retention promise.
 *
 *   - forwarder photo cleanup
 *       Drop the `photos` JSONB on forwarder_inventory rows that have
 *       reached terminal status (`shipped`) and were last updated more
 *       than FORWARDER_PHOTO_RETENTION_DAYS (180) ago.
 *
 *   - bridge token TTL
 *       Auto-revoke bridge_tokens whose `lastSeenAt` is older than
 *       BRIDGE_TOKEN_IDLE_DAYS (90). Reduces blast radius if a forgotten
 *       extension install is later compromised.
 *
 * The whole sweep is single-replica safe via row-level WHERE clauses;
 * if two workers tick at once, the second one's UPDATE just touches no
 * rows because the first already set the marker.
 */

import { and, eq, isNotNull, isNull, lt, sql } from "drizzle-orm";
import { sendOpsEmail } from "../../auth/email.js";
import { config } from "../../config.js";
import { db } from "../../db/client.js";
import { bridgeTokens, forwarderInventory, marketplaceNotifications, takedownRequests } from "../../db/schema.js";

const TAKEDOWN_SLA_HOURS = 48;
const NOTIFICATION_PII_RETENTION_DAYS = 90;
const NOTIFICATION_HARD_DELETE_DAYS = 548; // ~18 months
const FORWARDER_PHOTO_RETENTION_DAYS = 180;
const BRIDGE_TOKEN_IDLE_DAYS = 90;

interface SweepResult {
	task: string;
	processed: number;
	error?: string;
}

async function safe(label: string, body: () => Promise<number>): Promise<SweepResult> {
	try {
		const processed = await body();
		return { task: label, processed };
	} catch (err) {
		return { task: label, processed: 0, error: err instanceof Error ? err.message : String(err) };
	}
}

/**
 * Single-tick runner. Returns per-task counts for log line emission.
 * Designed so the worker can call this from a setInterval-style loop
 * without holding the loop on a slow upstream (best-effort always).
 */
export async function runMaintenanceTick(): Promise<SweepResult[]> {
	const results: SweepResult[] = [];
	results.push(await safe("takedown_sla", takedownSlaEnforcer));
	results.push(await safe("notif_pii_scrub", notificationPiiScrub));
	results.push(await safe("notif_hard_delete", notificationHardDelete));
	results.push(await safe("forwarder_photos", forwarderPhotoCleanup));
	results.push(await safe("bridge_token_ttl", bridgeTokenTtl));
	return results;
}

async function takedownSlaEnforcer(): Promise<number> {
	const cutoff = new Date(Date.now() - TAKEDOWN_SLA_HOURS * 3_600_000);
	// Surface rows that breached the SLA but haven't fired an alert yet.
	const breached = await db
		.select({
			id: takedownRequests.id,
			itemId: takedownRequests.itemId,
			contactEmail: takedownRequests.contactEmail,
			createdAt: takedownRequests.createdAt,
			reason: takedownRequests.reason,
		})
		.from(takedownRequests)
		.where(
			and(
				eq(takedownRequests.status, "pending"),
				lt(takedownRequests.createdAt, cutoff),
				isNull(takedownRequests.slaBreachedAt),
			),
		);
	if (breached.length === 0) return 0;
	// Mark first so a crash mid-email doesn't double-fire on the next tick.
	const ids = breached.map((b) => b.id);
	await db
		.update(takedownRequests)
		.set({ slaBreachedAt: new Date() })
		.where(sql`${takedownRequests.id} = ANY(${ids})`);
	// Best-effort notify. Resend is optional; without it we still emit a
	// loud log line so an operator scanning Container Apps logs sees it.
	for (const row of breached) {
		const ageHours = Math.round((Date.now() - row.createdAt.getTime()) / 3_600_000);
		console.warn(
			`[maintenance] takedown SLA breach id=${row.id} itemId=${row.itemId} ageHours=${ageHours} contact=${row.contactEmail}`,
			{ reason: row.reason },
		);
		await sendOpsEmail({
			to: "legal@flipagent.dev",
			subject: `[flipagent] takedown SLA breach — ${row.itemId}`,
			text:
				`Takedown ${row.id} for itemId ${row.itemId} has been pending ${ageHours} hours.\n\n` +
				`Submitter: ${row.contactEmail}\n` +
				`Reason: ${row.reason ?? "(none)"}\n` +
				`Triage at: ${config.APP_URL}/admin/takedowns/${row.id}\n`,
		}).catch((err) => {
			console.error(`[maintenance] takedown SLA email failed id=${row.id}:`, err);
		});
	}
	return breached.length;
}

async function notificationPiiScrub(): Promise<number> {
	const cutoff = new Date(Date.now() - NOTIFICATION_PII_RETENTION_DAYS * 86_400_000);
	const result = await db
		.update(marketplaceNotifications)
		.set({ payload: sql`'{"redacted": true}'::jsonb` })
		.where(
			and(
				lt(marketplaceNotifications.receivedAt, cutoff),
				sql`${marketplaceNotifications.payload} IS NOT NULL`,
				sql`${marketplaceNotifications.payload}::text NOT LIKE '%"redacted":true%'`,
			),
		)
		.returning({ id: marketplaceNotifications.id });
	return result.length;
}

async function notificationHardDelete(): Promise<number> {
	const cutoff = new Date(Date.now() - NOTIFICATION_HARD_DELETE_DAYS * 86_400_000);
	const result = await db
		.delete(marketplaceNotifications)
		.where(lt(marketplaceNotifications.receivedAt, cutoff))
		.returning({ id: marketplaceNotifications.id });
	return result.length;
}

async function forwarderPhotoCleanup(): Promise<number> {
	const cutoff = new Date(Date.now() - FORWARDER_PHOTO_RETENTION_DAYS * 86_400_000);
	const result = await db
		.update(forwarderInventory)
		.set({ photos: null })
		.where(
			and(
				eq(forwarderInventory.status, "shipped"),
				lt(forwarderInventory.updatedAt, cutoff),
				isNotNull(forwarderInventory.photos),
			),
		)
		.returning({ id: forwarderInventory.id });
	return result.length;
}

async function bridgeTokenTtl(): Promise<number> {
	const cutoff = new Date(Date.now() - BRIDGE_TOKEN_IDLE_DAYS * 86_400_000);
	const result = await db
		.update(bridgeTokens)
		.set({ revokedAt: new Date() })
		.where(and(isNull(bridgeTokens.revokedAt), lt(bridgeTokens.lastSeenAt, cutoff)))
		.returning({ id: bridgeTokens.id });
	return result.length;
}
