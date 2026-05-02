/**
 * Dispute / case / return tools — backed by `/v1/disputes`. Unified
 * surface for eBay's Returns, Cancellations, INR/SNAD cases, and
 * Inquiries with a `type` discriminator.
 */

import { DisputeRespond, DisputesListQuery } from "@flipagent/types";
import { Type } from "@sinclair/typebox";
import { getClient, toApiCallError } from "../client.js";
import type { Config } from "../config.js";

/* -------------------------- flipagent_disputes_list ------------------------ */

export { DisputesListQuery as disputesListInput };

export const disputesListDescription =
	"List active disputes / returns / cancellations / cases for the connected seller. GET /v1/disputes. Filter by `type` (return|cancellation|inr|snad|inquiry) + `status` (open|awaiting_seller|awaiting_buyer|resolved|escalated). Use `status:'awaiting_seller'` to surface what needs a response.";

export async function disputesListExecute(config: Config, args: Record<string, unknown>): Promise<unknown> {
	try {
		const client = getClient(config);
		return await client.disputes.list(args as Parameters<typeof client.disputes.list>[0]);
	} catch (err) {
		const e = toApiCallError(err, "/v1/disputes");
		return { error: "disputes_list_failed", status: e.status, url: e.url, message: e.message };
	}
}

/* -------------------------- flipagent_disputes_get ------------------------- */

export const disputesGetInput = Type.Object({ id: Type.String({ minLength: 1 }) });

export const disputesGetDescription =
	"Fetch full detail for one dispute — buyer claim, evidence, deadline, available actions. GET /v1/disputes/{id}.";

export async function disputesGetExecute(config: Config, args: Record<string, unknown>): Promise<unknown> {
	const id = String(args.id);
	try {
		const client = getClient(config);
		return await client.disputes.get(id);
	} catch (err) {
		const e = toApiCallError(err, `/v1/disputes/${id}`);
		return { error: "disputes_get_failed", status: e.status, url: e.url, message: e.message };
	}
}

/* ------------------------ flipagent_disputes_respond ----------------------- */

export const disputesRespondInput = Type.Composite([
	Type.Object({ id: Type.String({ minLength: 1 }) }),
	DisputeRespond,
]);

export const disputesRespondDescription =
	"Respond to a dispute — accept, refund, partial refund, ship replacement, escalate, or send a message. POST /v1/disputes/{id}/respond. `action` enum varies by `type` from `flipagent_disputes_get`; pass the matching shape (e.g. `{ action: 'refund_full' }`, `{ action: 'partial_refund', amountCents }`, `{ action: 'message', message }`).";

export async function disputesRespondExecute(config: Config, args: Record<string, unknown>): Promise<unknown> {
	const { id, ...body } = args as { id: string } & Record<string, unknown>;
	try {
		const client = getClient(config);
		return await client.disputes.respond(id, body as Parameters<typeof client.disputes.respond>[1]);
	} catch (err) {
		const e = toApiCallError(err, `/v1/disputes/${id}/respond`);
		return { error: "disputes_respond_failed", status: e.status, url: e.url, message: e.message };
	}
}
