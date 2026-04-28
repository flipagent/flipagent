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

import { TakedownRequest, TakedownResponse } from "@flipagent/types";
import { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import { db } from "../../db/client.js";
import { takedownRequests } from "../../db/schema.js";
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
		return c.json({ id: row?.id ?? "", status: "pending" as const, slaHours: SLA_HOURS }, 201);
	},
);
