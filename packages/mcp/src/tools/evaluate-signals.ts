import { EvaluateSignalsRequest as EvaluateSignalsInputSchema, type EvaluateSignalsRequest } from "@flipagent/types";
import { getClient, toApiCallError } from "../client.js";
import type { Config } from "../config.js";

export { EvaluateSignalsInputSchema as evaluateSignalsInput };

export const evaluateSignalsDescription =
	"Run signal detectors over a listing without composing a verdict. Calls POST /v1/evaluate/signals. Useful when the agent wants raw evidence (under_median, ending_soon_low_watchers, poor_title) to feed a custom scoring policy. Pass `item` (ItemSummary) and `comps` (sold listings — `under_median` only fires when comps are present).";

export async function evaluateSignalsExecute(config: Config, args: Record<string, unknown>): Promise<unknown> {
	const client = getClient(config);
	try {
		return await client.evaluate.signals(args as unknown as EvaluateSignalsRequest);
	} catch (err) {
		const e = toApiCallError(err, "/v1/evaluate/signals");
		return { error: "evaluate_signals_failed", status: e.status, message: e.message, url: e.url };
	}
}
