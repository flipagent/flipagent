/**
 * Dispute / case / return tools — backed by `/v1/disputes`. Unified
 * surface for eBay's Returns, Cancellations, INR/SNAD cases, and
 * Inquiries with a `type` discriminator.
 */

import {
	CancellationCreateRequest,
	CancellationEligibilityRequest,
	DisputeRespond,
	DisputesListQuery,
} from "@flipagent/types";
import { Type } from "@sinclair/typebox";
import { getClient, toolErrorEnvelope } from "../client.js";
import type { Config } from "../config.js";

/* -------------------------- flipagent_disputes_list ------------------------ */

export { DisputesListQuery as disputesListInput };

export const disputesListDescription =
	'List active disputes — returns, cancellations, INR (item-not-received), SNAD (significantly-not-as-described), inquiries — for the connected seller. Calls GET /v1/disputes. **When to use** — daily triage: pull `status: "awaiting_seller"` to find cases that need a response within eBay\'s deadline. Pair with `flipagent_get_dispute` to read the buyer\'s claim before responding. **Inputs** — optional `type` (`return | cancellation | inr | snad | inquiry`), optional `status` (`open | awaiting_seller | awaiting_buyer | resolved | escalated`), pagination `limit` + `offset`. **Output** — `{ disputes: Dispute[], limit, offset }`. **Prereqs** — eBay seller account connected. On 401 the response carries `next_action`. **Example** — `{ status: "awaiting_seller" }`.';

export async function disputesListExecute(config: Config, args: Record<string, unknown>): Promise<unknown> {
	try {
		const client = getClient(config);
		return await client.disputes.list(args as Parameters<typeof client.disputes.list>[0]);
	} catch (err) {
		return toolErrorEnvelope(err, "disputes_list_failed", "/v1/disputes");
	}
}

/* -------------------------- flipagent_disputes_get ------------------------- */

export const disputesGetInput = Type.Object({ id: Type.String({ minLength: 1 }) });

export const disputesGetDescription =
	'Fetch full detail for one dispute. Calls GET /v1/disputes/{id}. **When to use** — read the buyer\'s claim, attached evidence (photos, messages), deadlines, and which actions are still legal in this state before calling `flipagent_respond_to_dispute`. **Inputs** — `id` (from `flipagent_list_disputes`). **Output** — `{ id, type, status, buyer, listingId, orderId, claim, evidence: [...], deadline?, availableActions: [...], history: [...] }`. **Prereqs** — eBay seller account connected. **Example** — `{ id: "5012345678" }`.';

export async function disputesGetExecute(config: Config, args: Record<string, unknown>): Promise<unknown> {
	const id = String(args.id);
	try {
		const client = getClient(config);
		return await client.disputes.get(id);
	} catch (err) {
		return toolErrorEnvelope(err, "disputes_get_failed", `/v1/disputes/${id}`);
	}
}

/* ------------------------ flipagent_disputes_respond ----------------------- */

export const disputesRespondInput = Type.Composite([
	Type.Object({ id: Type.String({ minLength: 1 }) }),
	DisputeRespond,
]);

export const disputesRespondDescription =
	'Take action on a dispute. Calls POST /v1/disputes/{id}/respond. **When to use** — close out cases from `flipagent_list_disputes({ status: "seller_action_required" })`. **Always** call `flipagent_get_dispute` first to confirm the legal action for the current state. **Inputs** — `id` plus `action: "accept" | "decline" | "counter" | "provide_tracking" | "offer_refund" | "escalate"`. Action-dependent extras: `amount` (for `offer_refund` / `counter`), `trackingNumber` + `carrier` (for `provide_tracking`), `message` (any), `returnAddress` (for SNAD-reason payment-dispute contests). Action semantics by dispute type: payment → `accept` pays the buyer / anything else contests; return + case + cancellation + inquiry → `accept`/`decline` use eBay\'s decisionType verbs. **Output** — refreshed `Dispute`. **Example** — `{ id: "5012345678", action: "offer_refund", amount: { value: 2500, currency: "USD" } }`.';

export async function disputesRespondExecute(config: Config, args: Record<string, unknown>): Promise<unknown> {
	const { id, ...body } = args as { id: string } & Record<string, unknown>;
	try {
		const client = getClient(config);
		return await client.disputes.respond(id, body as Parameters<typeof client.disputes.respond>[1]);
	} catch (err) {
		return toolErrorEnvelope(err, "disputes_respond_failed", `/v1/disputes/${id}/respond`);
	}
}

/* ------------------------- flipagent_disputes_activity --------------------- */

export const disputesActivityInput = Type.Object({ id: Type.String({ minLength: 1 }) });

export const disputesActivityDescription =
	'Activity history for a payment dispute. Calls GET /v1/disputes/{id}/activity. **When to use** — audit the timeline of a payment dispute (open / contested / evidence-added / resolved) before responding, or to verify your contest landed. **Limitation** — eBay only exposes activity history for `type: payment` disputes; returns / cases / cancellations / inquiries 404 here. **Inputs** — `id`. **Output** — `{ disputeId, activity: [{ activityType, actor, date, notes? }] }`. **Prereqs** — eBay seller account connected. **Example** — `{ id: "5012345678" }`.';

export async function disputesActivityExecute(config: Config, args: Record<string, unknown>): Promise<unknown> {
	const id = String(args.id);
	try {
		const client = getClient(config);
		return await client.disputes.activity(id);
	} catch (err) {
		return toolErrorEnvelope(err, "disputes_activity_failed", `/v1/disputes/${id}/activity`);
	}
}

/* ------------------ flipagent_check_cancellation_eligibility --------------- */

export { CancellationEligibilityRequest as cancellationEligibilityInput };
export const cancellationEligibilityDescription =
	"Check whether an order can still be cancelled by the seller. Calls POST /v1/disputes/cancellations/check-eligibility. **When to use** — before calling `flipagent_create_cancellation` to confirm cancellation is allowed (some orders pass the cancellation window). **Inputs** — `{ legacyOrderId, items: [{ itemId, transactionId? }] }`. **Output** — `{ eligible, reasons: [...allowed-reason-codes...] }`.";
export async function cancellationEligibilityExecute(config: Config, args: Record<string, unknown>): Promise<unknown> {
	try {
		return await getClient(config).disputes.checkCancellation(
			args as Parameters<ReturnType<typeof getClient>["disputes"]["checkCancellation"]>[0],
		);
	} catch (err) {
		return toolErrorEnvelope(err, "cancellation_eligibility_failed", "/v1/disputes/cancellations/check-eligibility");
	}
}

/* ------------------------ flipagent_create_cancellation -------------------- */

export { CancellationCreateRequest as cancellationCreateInput };
export const cancellationCreateDescription =
	'Create a seller-initiated cancellation on a sold order. Calls POST /v1/disputes/cancellations. **When to use** — out-of-stock, address issues, or honoring a buyer\'s cancel request before ship. Distinct from responding to a buyer-initiated cancellation (use `flipagent_respond_to_dispute` with action="accept" for that). **Inputs** — `{ legacyOrderId, reason: "BUYER_ASKED_CANCEL" | "OUT_OF_STOCK_OR_CANNOT_FULFILL" | "ADDRESS_ISSUES", items: [...] }`. **Output** — `{ cancelId, status }`.';
export async function cancellationCreateExecute(config: Config, args: Record<string, unknown>): Promise<unknown> {
	try {
		return await getClient(config).disputes.createCancellation(
			args as Parameters<ReturnType<typeof getClient>["disputes"]["createCancellation"]>[0],
		);
	} catch (err) {
		return toolErrorEnvelope(err, "cancellation_create_failed", "/v1/disputes/cancellations");
	}
}
