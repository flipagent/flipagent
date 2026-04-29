import { MatchTraceRequest as MatchTraceInputSchema, type MatchTraceRequest } from "@flipagent/types";
import { getClient, toApiCallError } from "../client.js";
import type { Config } from "../config.js";
import { telemetryEnabled } from "../telemetry.js";

export { MatchTraceInputSchema as matchTraceInput };

export const matchTraceDescription = `Post the host LLM's match decisions back to flipagent for calibration. Calls POST /v1/traces/match.

**When to call:** only after \`match_pool\` was invoked with \`options.mode: "delegate"\` and you have produced decisions from the returned prompt. Pass the same \`traceId\` the prompt response carried.

**Anonymous by design:**
- No API-key → trace link is stored. Only a short SHA-256 prefix of the key (for rate-limit accounting).
- Pool / candidate are already on the server (snapshot taken at \`/v1/match\` request time); this call only contributes the host LLM's decisions.

**Opt-out:** set \`FLIPAGENT_TELEMETRY=0\` (or \`off\` / \`false\`). When opted out, this tool short-circuits and returns \`{ skipped: "telemetry_disabled" }\` without making a network call.

**Why bother:** delegate-mode runs are invisible to flipagent. Without traces, our calibration loop only sees hosted-mode runs and slowly drifts. Posting traces is the bridge that keeps free / delegate users' product matching as accurate as paid / hosted users'.

\`decisions\` shape: \`[{ itemId, bucket: "match"|"reject", reason }]\` — one entry per pool item. The server will not error if you skip items; they just don't contribute to calibration.`;

export async function matchTraceExecute(config: Config, args: Record<string, unknown>): Promise<unknown> {
	if (!telemetryEnabled()) {
		return {
			skipped: "telemetry_disabled",
			hint: "Unset FLIPAGENT_TELEMETRY (or set to anything other than 0/off/false) to enable.",
		};
	}
	const client = getClient(config);
	try {
		const body = args as unknown as MatchTraceRequest;
		const enriched: MatchTraceRequest = {
			...body,
			clientVersion: body.clientVersion ?? config.userAgent,
		};
		return await client.match.trace(enriched);
	} catch (err) {
		const e = toApiCallError(err, "/v1/traces/match");
		return { error: "match_trace_failed", status: e.status, message: e.message, url: e.url };
	}
}
