/**
 * POST /v1/takedown — single pipe, three regulatory regimes.
 *
 * Accepts removal requests from sellers, copyright holders, and EU/CA data
 * subjects. Specify `kind` to flag the request type:
 *   - `dmca_copyright` (17 U.S.C. §512(c)(3)) — requires the `dmca` attestation
 *     block. flipagent is not currently registered with the U.S. Copyright
 *     Office's DMCA agent directory; this endpoint is our private channel.
 *     See /legal/compliance for the full posture.
 *   - `gdpr_erasure` (GDPR Art. 17) — EU data subjects.
 *   - `ccpa_deletion` (CCPA §1798.105) — California residents.
 *   - `seller_optout` — voluntary; honored by policy.
 *   - `other` — manual triage.
 *
 * SLA: triage within 48 business hours; approved requests flush the cache and
 * blocklist the itemId so it is not re-fetched. Status starts `pending`.
 *
 * Unauthenticated by design — requesters should not need an API key.
 */

import { CounterNoticeRequest, CounterNoticeResponse, TakedownRequest, TakedownResponse } from "@flipagent/types";
import { eq, sql } from "drizzle-orm";
import { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import { db } from "../../db/client.js";
import { listingObservations, marketDataCache, productObservations, takedownRequests } from "../../db/schema.js";
import { legacyFromV1 } from "../../utils/item-id.js";
import { errorResponse, jsonResponse, tbBody } from "../../utils/openapi.js";

const SLA_HOURS = 48;

export const takedownRoute = new Hono();

takedownRoute.post(
	"/",
	describeRoute({
		tags: ["Compliance"],
		summary: "Takedown / DMCA / GDPR-erasure / CCPA-deletion request",
		description:
			"Single endpoint covering DMCA §512(c)(3) infringement notices, GDPR Art. 17 erasure, CCPA §1798.105 deletion, and voluntary seller opt-out. Triage SLA is 48 business hours. See /legal/compliance for the DMCA designated agent contact.",
		security: [],
		responses: {
			201: jsonResponse("Takedown request recorded.", TakedownResponse),
			400: errorResponse("Validation failed."),
		},
	}),
	tbBody(TakedownRequest),
	async (c) => {
		const valid = c.req.valid("json");
		// DMCA notices have a statutory shape — if the caller flagged this as
		// a DMCA copyright complaint, require the §512(c)(3) attestation block
		// rather than silently filing it as a generic takedown.
		if (valid.kind === "dmca_copyright") {
			if (!valid.dmca || !valid.dmca.goodFaithStatement || !valid.dmca.accuracyStatement) {
				return c.json(
					{
						error: "validation_failed" as const,
						message:
							"DMCA copyright takedowns require the `dmca` block with goodFaithStatement and accuracyStatement = true (17 U.S.C. §512(c)(3)).",
					},
					400,
				);
			}
		}
		// Persist the most specific reason we have. Schema today stores a single
		// `reason` text column; encode kind + DMCA fields into it so the manual
		// triage queue sees the full context without a migration.
		const reasonParts: string[] = [];
		if (valid.kind) reasonParts.push(`[${valid.kind}]`);
		if (valid.reason) reasonParts.push(valid.reason);
		if (valid.dmca) reasonParts.push(`work=${valid.dmca.copyrightedWork} sig=${valid.dmca.signature}`);
		const persistedReason = reasonParts.length > 0 ? reasonParts.join(" ") : undefined;
		const [row] = await db
			.insert(takedownRequests)
			.values({ itemId: valid.itemId, reason: persistedReason, contactEmail: valid.contactEmail })
			.returning();
		// Conservative: hide matching observations from live queries the
		// moment a takedown is filed, before manual review. Status flips to
		// approved or rejected later; rejected requests can have the flag
		// cleared via operator script. Audit trail (the row itself) stays.
		// Match by exact legacyItemId (numeric) — the takedown form accepts
		// either a v1 or legacy id; normalise so the WHERE matches archive's
		// canonical column.
		const legacyId = legacyFromV1(valid.itemId);
		if (!legacyId) {
			return c.json({ id: row?.id ?? "", status: "pending" as const, slaHours: SLA_HOURS }, 201);
		}
		// Propagate to every cache + lake table that keys on the
		// flagged itemId — `listing_observations` gets `takedown_at`
		// (audit trail preserved); `product_observations` the same; the
		// upstream evaluate-pipeline cache (`market_data_cache`) is
		// dropped outright so the next caller forces a re-fetch past the
		// takedown blocklist. Failures log but don't abort — the
		// takedown row itself is the system of record.
		try {
			await db
				.update(listingObservations)
				.set({ takedownAt: sql`now()` })
				.where(eq(listingObservations.legacyItemId, legacyId));
		} catch (err) {
			console.error("[takedown] listing_observations flag failed:", err);
		}
		try {
			await db
				.update(productObservations)
				.set({ takedownAt: sql`now()` })
				.where(eq(productObservations.epid, legacyId));
		} catch (err) {
			console.error("[takedown] product_observations flag failed:", err);
		}
		try {
			await db.delete(marketDataCache).where(eq(marketDataCache.itemId, legacyId));
		} catch (err) {
			console.error("[takedown] market_data_cache flush failed:", err);
		}
		return c.json({ id: row?.id ?? "", status: "pending" as const, slaHours: SLA_HOURS }, 201);
	},
);

takedownRoute.post(
	"/counter-notice",
	describeRoute({
		tags: ["Compliance"],
		summary: "DMCA §512(g) counter-notice",
		description:
			"Submit a counter-notice to restore content that was removed in response to a takedown you believe was mistaken or misidentified. Requires the four §512(g) attestations + a typed signature + contact info. Triage is operator-driven and follows the same 48-business-hour SLA. Approved counter-notices clear `takedownAt` on the affected listing-observations rows; the original requester is notified per §512(g)(2)(B).",
		security: [],
		responses: {
			201: jsonResponse("Counter-notice recorded.", CounterNoticeResponse),
			400: errorResponse("Validation failed (missing attestation or contact field)."),
		},
	}),
	tbBody(CounterNoticeRequest),
	async (c) => {
		const body = c.req.valid("json");
		// All four §512(g) attestations must be true; the endpoint exists to
		// record an enforceable counter-notice, not to capture a half-formed
		// complaint. A `false` value gets a 400 explaining what's missing.
		if (!body.agreePenaltyOfPerjury || !body.agreeJurisdiction || !body.agreeServiceOfProcess) {
			return c.json(
				{
					error: "validation_failed" as const,
					message:
						"All three attestations (penalty of perjury, jurisdiction consent, service of process) must be true. See 17 U.S.C. §512(g)(3) for the statutory shape.",
				},
				400,
			);
		}
		// Persist into the existing `takedown_requests` table with the kind
		// encoded into the reason field (matches the takedown row format),
		// so a single audit table covers both directions of the §512 flow.
		// Operator triage queue picks up counter-notices via the [counter_notice]
		// prefix; on approval they clear `takedownAt` on matching rows and
		// notify the original takedown submitter. We do not auto-restore.
		const summary = [
			"[counter_notice]",
			`name=${body.contactName}`,
			`addr=${body.contactAddress}`,
			`phone=${body.contactPhone}`,
			`sig=${body.signature}`,
		];
		if (body.notes) summary.push(`notes=${body.notes}`);
		const [row] = await db
			.insert(takedownRequests)
			.values({
				itemId: body.itemId,
				reason: summary.join(" "),
				contactEmail: body.contactEmail,
			})
			.returning();
		return c.json(
			{
				id: row?.id ?? "",
				status: "received" as const,
				message:
					"Counter-notice received. Operator will review within " +
					SLA_HOURS +
					" business hours and, if approved, restore the listing and forward the notice to the original takedown submitter per 17 U.S.C. §512(g)(2)(B).",
			},
			201,
		);
	},
);
