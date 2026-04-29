/**
 * Caller-side telemetry policy for the flipagent MCP server.
 *
 * The only telemetry path is `flipagent_match_trace` — a tool the host
 * agent invokes voluntarily after `match_pool` returned a delegate
 * prompt and the host's LLM produced decisions. The trace tells the
 * flipagent backend "for prompt X, my LLM said Y", which keeps the
 * scoring math calibrated as host models drift.
 *
 * Opt-out is environment-driven, in line with OSS conventions
 * (Homebrew `HOMEBREW_NO_ANALYTICS`, Next.js `NEXT_TELEMETRY_DISABLED`,
 * Astro `ASTRO_TELEMETRY_DISABLED`):
 *
 *   FLIPAGENT_TELEMETRY=0    → trace uploads disabled
 *   FLIPAGENT_TELEMETRY=off  → trace uploads disabled
 *   FLIPAGENT_TELEMETRY=false → trace uploads disabled
 *   anything else / unset    → enabled
 *
 * Disabling does not break any tool — `flipagent_match_trace` returns
 * a `{ skipped: "telemetry_disabled" }` payload and exits.
 *
 * What we collect when enabled:
 *  - traceId (server-issued in /v1/match delegate response)
 *  - candidate.itemId
 *  - per-pool-item decision + reason
 *  - llmModel (free-form string the host self-reports)
 *  - clientVersion (`flipagent-mcp/<semver>`)
 *
 * What we do NOT collect:
 *  - the API key id (only a SHA-256 prefix for rate-limit accounting)
 *  - prompts the host invented on its own
 *  - any user identity
 */

const OFF_VALUES = new Set(["0", "off", "false", "no", "disabled"]);

export function telemetryEnabled(): boolean {
	const raw = process.env.FLIPAGENT_TELEMETRY?.trim().toLowerCase();
	if (!raw) return true;
	return !OFF_VALUES.has(raw);
}

/** First-run banner shown via stderr. Mirrors npm-style "we collect X, opt out with Y". */
export function telemetryBanner(): string {
	if (!telemetryEnabled()) {
		return "[flipagent] telemetry disabled (FLIPAGENT_TELEMETRY=0).";
	}
	return [
		"[flipagent] anonymous telemetry is on.",
		"[flipagent] we collect delegate-mode match decisions to keep our scoring calibrated.",
		"[flipagent] no api key, no user id, only the trace id we hand you. opt out: FLIPAGENT_TELEMETRY=0",
	].join("\n");
}
