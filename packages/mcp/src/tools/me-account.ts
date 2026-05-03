/**
 * Caller-side tools — quota + program enrollment.
 */

import { ProgramOptRequest } from "@flipagent/types";
import { Type } from "@sinclair/typebox";
import { getClient, toolErrorEnvelope } from "../client.js";
import type { Config } from "../config.js";

/* --------------------------- flipagent_get_quota --------------------------- */

export const meQuotaInput = Type.Object({});

export const meQuotaDescription =
	"Read the caller's API rate-limit budget. Calls GET /v1/me/quota. **When to use** — before bursting many calls (bulk reprice, evaluation pool), check `userQuota` for the relevant API to avoid 429s. **Inputs** — none. **Output** — `{ apiQuota: [{ apiContext, apiName, apiVersion, resources: [{ name, limit, remaining, reset, timeWindow }] }], userQuota: same }`. `apiQuota` is the app-wide budget across all flipagent users on this app credential; `userQuota` is per-connected-eBay-account. **Prereqs** — eBay seller account connected. **Example** — call with `{}`.";

export async function meQuotaExecute(config: Config, _args: Record<string, unknown>): Promise<unknown> {
	try {
		const client = getClient(config);
		return await client.me.quota();
	} catch (err) {
		return toolErrorEnvelope(err, "me_quota_failed", "/v1/me/quota");
	}
}

/* ------------------------- flipagent_list_programs ------------------------- */

export const mePrograms_listInput = Type.Object({});

export const mePrograms_listDescription =
	"List seller programs the caller is opted in to. Calls GET /v1/me/programs. **When to use** — gate behavior on program enrollment (e.g. skip Promoted Listings tools if the seller hasn't joined the Selling Policy Management program). **Inputs** — none. **Output** — `{ programs: [{ programType }] }`. Empty array means no programs. **Prereqs** — eBay seller account connected. **Example** — call with `{}`.";

export async function mePrograms_listExecute(config: Config, _args: Record<string, unknown>): Promise<unknown> {
	try {
		const client = getClient(config);
		return await client.me.listPrograms();
	} catch (err) {
		return toolErrorEnvelope(err, "me_programs_list_failed", "/v1/me/programs");
	}
}

/* ------------------------- flipagent_opt_in_program ------------------------ */

export { ProgramOptRequest as mePrograms_optInInput };

export const mePrograms_optInDescription =
	"Opt the connected seller into a marketplace program. Calls POST /v1/me/programs/opt-in. **When to use** — automate enrollment in Selling Policy Management (required for business-policy-driven listings) or other programs after a seller connects. **Caution** — opting in may change billing/tax obligations on eBay's side; only call when the user has explicitly consented or the program is a hard prereq for the workflow. **Inputs** — `{ programType }` (e.g. `SELLING_POLICY_MANAGEMENT`, `OUT_OF_STOCK_CONTROL`, `EBAY_PLUS_PROGRAM`). **Output** — `{ programType, ok }`. **Prereqs** — eBay seller account connected.";

export async function mePrograms_optInExecute(config: Config, args: Record<string, unknown>): Promise<unknown> {
	try {
		const client = getClient(config);
		return await client.me.optInProgram(args as Parameters<typeof client.me.optInProgram>[0]);
	} catch (err) {
		return toolErrorEnvelope(err, "me_program_opt_in_failed", "/v1/me/programs/opt-in");
	}
}

/* ------------------------- flipagent_opt_out_program ----------------------- */

export { ProgramOptRequest as mePrograms_optOutInput };

export const mePrograms_optOutDescription =
	"Opt the connected seller out of a marketplace program. Calls POST /v1/me/programs/opt-out. Mirror of `flipagent_opt_in_program`. **Inputs** — `{ programType }`. **Output** — `{ programType, ok }`.";

export async function mePrograms_optOutExecute(config: Config, args: Record<string, unknown>): Promise<unknown> {
	try {
		const client = getClient(config);
		return await client.me.optOutProgram(args as Parameters<typeof client.me.optOutProgram>[0]);
	} catch (err) {
		return toolErrorEnvelope(err, "me_program_opt_out_failed", "/v1/me/programs/opt-out");
	}
}
