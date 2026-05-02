/**
 * Selling-policy tools — return / payment / fulfillment policy ids.
 * `flipagent_listings_create` requires policy ids in the `policies`
 * field; agents should call `flipagent_policies_list` first to find
 * the seller's existing policy ids (or guide the user to create them
 * in the eBay seller hub if none exist — flipagent doesn't create
 * policies, it reads them).
 */

import { Type } from "@sinclair/typebox";
import { getClient, toApiCallError } from "../client.js";
import type { Config } from "../config.js";

/* ------------------------- flipagent_policies_list ------------------------- */

export const policiesListInput = Type.Object({});

export const policiesListDescription =
	"List all selling policies (return + payment + fulfillment) bound to the connected seller. GET /v1/policies. Each policy carries an `id` you pass to `flipagent_listings_create` under `policies.{return,payment,fulfillment}Id`.";

export async function policiesListExecute(config: Config, _args: Record<string, unknown>): Promise<unknown> {
	try {
		const client = getClient(config);
		return await client.policies.list();
	} catch (err) {
		const e = toApiCallError(err, "/v1/policies");
		return { error: "policies_list_failed", status: e.status, url: e.url, message: e.message };
	}
}

/* ---------------------- flipagent_policies_list_by_type --------------------- */

export const policiesListByTypeInput = Type.Object({
	type: Type.Union([Type.Literal("return"), Type.Literal("payment"), Type.Literal("fulfillment")]),
});

export const policiesListByTypeDescription =
	"List one policy type only — return | payment | fulfillment. GET /v1/policies/{type}. Use when you already know the policy you need (e.g. picking a fulfillment policy by carrier).";

export async function policiesListByTypeExecute(config: Config, args: Record<string, unknown>): Promise<unknown> {
	const type = args.type as "return" | "payment" | "fulfillment";
	try {
		const client = getClient(config);
		return await client.policies.listByType(type);
	} catch (err) {
		const e = toApiCallError(err, `/v1/policies/${type}`);
		return { error: "policies_list_by_type_failed", status: e.status, url: e.url, message: e.message };
	}
}
