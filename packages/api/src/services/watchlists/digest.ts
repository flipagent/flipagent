/**
 * Daily / hourly digest mailer for queued deals. Pulls every pending
 * deal that hasn't been notified yet, groups by api_key owner, sends
 * one email per owner with a summary, then marks `notifiedAt` so the
 * next sweep doesn't re-send.
 *
 * Honours `RESEND_API_KEY`; without it, the function logs a heads-up
 * and exits silently — self-host without email config still queues
 * deals, just doesn't email about them.
 *
 * Owner email is resolved via api_keys.ownerEmail (always set when a
 * key is issued through the dashboard); if missing (CLI-issued test
 * keys), the sweep skips that owner.
 */

import { and, eq, isNull, sql } from "drizzle-orm";
import { Resend } from "resend";
import { config, isEmailConfigured } from "../../config.js";
import { db } from "../../db/client.js";
import { apiKeys, type DealQueueRow, dealQueue } from "../../db/schema.js";

let cached: Resend | null | undefined;

function getResend(): Resend | null {
	if (cached !== undefined) return cached;
	cached = isEmailConfigured() ? new Resend(config.RESEND_API_KEY!) : null;
	return cached;
}

/**
 * Group pending un-notified deals by api_key, send one digest per
 * owner, mark rows as notified. Returns the count of distinct owners
 * mailed.
 */
export async function sendDigestEmails(): Promise<number> {
	const resend = getResend();
	if (!resend) {
		// Mark notifiedAt so the queue doesn't grow infinitely with un-
		// emailed rows in deployments without RESEND_API_KEY. The deals
		// themselves still surface via `/v1/queue`; the user just doesn't
		// get a heads-up email.
		await db
			.update(dealQueue)
			.set({ notifiedAt: sql`now()` })
			.where(and(eq(dealQueue.status, "pending"), isNull(dealQueue.notifiedAt)));
		return 0;
	}

	const pending = await db
		.select({
			deal: dealQueue,
			ownerEmail: apiKeys.ownerEmail,
		})
		.from(dealQueue)
		.innerJoin(apiKeys, eq(apiKeys.id, dealQueue.apiKeyId))
		.where(and(eq(dealQueue.status, "pending"), isNull(dealQueue.notifiedAt)));

	if (pending.length === 0) return 0;

	const byOwner = new Map<string, DealQueueRow[]>();
	for (const row of pending) {
		if (!row.ownerEmail) continue;
		const list = byOwner.get(row.ownerEmail) ?? [];
		list.push(row.deal);
		byOwner.set(row.ownerEmail, list);
	}

	let sent = 0;
	for (const [email, deals] of byOwner) {
		try {
			await resend.emails.send({
				from: config.EMAIL_FROM,
				to: email,
				subject: `flipagent — ${deals.length} new deal${deals.length === 1 ? "" : "s"} waiting`,
				html: renderDigestHtml(deals),
			});
			const ids = deals.map((d) => d.id);
			await db.update(dealQueue).set({ notifiedAt: sql`now()` }).where(sql`${dealQueue.id} = ANY(${ids}::uuid[])`);
			sent++;
		} catch (err) {
			console.error(`[watchlists/digest] send to ${email} failed:`, err);
		}
	}
	return sent;
}

function renderDigestHtml(deals: DealQueueRow[]): string {
	const rows = deals
		.map((d) => {
			const item = d.itemSnapshot as { title?: string; price?: { value?: string } };
			const evaluation = d.evaluationSnapshot as {
				recommendedExit?: { listPriceCents: number; expectedDaysToSell: number; netCents: number };
			};
			const exit = evaluation.recommendedExit;
			const buyDollars = item.price?.value ? `$${Math.round(Number.parseFloat(item.price.value))}` : "—";
			const exitLine = exit
				? `list $${Math.round(exit.listPriceCents / 100)} → ~${Math.round(
						exit.expectedDaysToSell,
					)}d · +$${Math.round(exit.netCents / 100)} net`
				: "no exit plan";
			return `
<tr>
  <td style="padding:12px 0;border-bottom:1px solid #ececec;">
    <div style="font-size:14px;color:#0a0a0a;font-weight:500;line-height:1.4;">
      <a href="${escapeHtml(d.itemWebUrl)}" style="color:#0a0a0a;text-decoration:none;">${escapeHtml(item.title ?? d.legacyItemId)}</a>
    </div>
    <div style="font-size:12px;color:#737373;margin-top:4px;font-family:ui-monospace,monospace;">
      buy ${buyDollars} · ${exitLine}
    </div>
  </td>
</tr>`;
		})
		.join("");
	return `<!doctype html>
<html><body style="font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif;background:#fafafa;padding:32px;color:#0a0a0a;">
  <div style="max-width:560px;margin:0 auto;background:#ffffff;border:1px solid #ececec;border-radius:12px;padding:32px;">
    <h1 style="font-size:20px;margin:0 0 8px;font-weight:600;">${deals.length} deal${deals.length === 1 ? "" : "s"} waiting for review</h1>
    <p style="font-size:13px;color:#525252;margin:0 0 16px;line-height:1.55;">Your watchlists found these overnight. Approve or dismiss in the dashboard.</p>
    <table style="width:100%;border-collapse:collapse;">${rows}</table>
  </div>
</body></html>`;
}

function escapeHtml(s: string): string {
	return s
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&#39;");
}
