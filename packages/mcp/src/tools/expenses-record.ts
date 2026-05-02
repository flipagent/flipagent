import { type ExpenseRecordRequest, ExpenseRecordRequest as ExpensesRecordInputSchema } from "@flipagent/types";
import { getClient, toApiCallError } from "../client.js";
import type { Config } from "../config.js";

export { ExpensesRecordInputSchema as expensesRecordInput };

export const expensesRecordDescription =
	"Record one cost-side event (purchased | forwarder_fee | expense). Calls POST /v1/expenses/record. eBay-side cash flow (sales / refunds / final-value fees) is read from /v1/payouts + /v1/transactions — don't double-record those here. `amountCents` is always positive. For `purchased` events, set `payload.predictedNetCents` (and optionally `payload.predictedDaysToSell`) to preserve evaluate()'s prediction for the future calibration loop.";

export async function expensesRecordExecute(config: Config, args: Record<string, unknown>): Promise<unknown> {
	const client = getClient(config);
	try {
		return await client.expenses.record(args as unknown as ExpenseRecordRequest);
	} catch (err) {
		const e = toApiCallError(err, "/v1/expenses/record");
		return { error: "expenses_record_failed", status: e.status, message: e.message, url: e.url };
	}
}
