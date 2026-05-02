import { Type } from "@sinclair/typebox";
import { getClient, toApiCallError } from "../client.js";
import type { Config } from "../config.js";

export const expensesSummaryInput = Type.Object(
	{
		windowDays: Type.Optional(
			Type.Integer({ minimum: 1, maximum: 365, description: "Days back from now. Default 30." }),
		),
	},
	{ $id: "ExpensesSummaryInput" },
);

export const expensesSummaryDescription =
	"Aggregated cost-side metrics for the window. Calls GET /v1/expenses/summary. Returns counts + costs (acquisition + forwarder + expense). For full P&L combine with /v1/transactions (eBay Finances normalized). Aggregates across every API key belonging to the same owner.";

export async function expensesSummaryExecute(config: Config, args: Record<string, unknown>): Promise<unknown> {
	const client = getClient(config);
	const windowDays = typeof args.windowDays === "number" ? args.windowDays : undefined;
	try {
		return await client.expenses.summary({ windowDays });
	} catch (err) {
		const e = toApiCallError(err, "/v1/expenses/summary");
		return { error: "expenses_summary_failed", status: e.status, message: e.message, url: e.url };
	}
}
