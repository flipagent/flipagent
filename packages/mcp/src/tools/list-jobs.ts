/**
 * `flipagent_list_jobs` — recall recent flipagent operations the api
 * key has performed across every surface (extension, playground, MCP,
 * agent, this SDK call). Returns lean per-row metadata (label,
 * subLabel, status, kind, createdAt, completedAt). Click into any
 * specific row via the per-kind tools (`flipagent_get_evaluate_job`,
 * etc.) for the full result.
 *
 * Free read; never charged. Useful when the user asks "what did I
 * evaluate yesterday?" or "show me my recent searches".
 */

import { Type } from "@sinclair/typebox";
import { getClient, toolErrorEnvelope } from "../client.js";
import type { Config } from "../config.js";

export const listJobsInput = Type.Object({
	kind: Type.Optional(
		Type.Union([Type.Literal("evaluate"), Type.Literal("search")], {
			description: "Filter by kind. Omit for cross-kind history.",
		}),
	),
	status: Type.Optional(
		Type.Union(
			[
				Type.Literal("queued"),
				Type.Literal("running"),
				Type.Literal("completed"),
				Type.Literal("failed"),
				Type.Literal("cancelled"),
			],
			{ description: "Filter by lifecycle status." },
		),
	),
	since: Type.Optional(Type.String({ format: "date-time", description: "ISO timestamp lower bound on createdAt." })),
	cursor: Type.Optional(
		Type.String({
			format: "date-time",
			description: "Keyset paging cursor. Pass the previous response's `cursor` to fetch the next page.",
		}),
	),
	limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100, default: 20 })),
});

export const listJobsDescription =
	'Recall recent flipagent operations the api key has performed — across every surface (extension, playground, MCP, agent, SDK) and kind (evaluate, search). Returns lean per-row metadata: `{ id, kind, status, label, subLabel?, imageUrl?, createdAt, completedAt }`. Click into a specific row via the per-kind tool (`flipagent_get_evaluate_job` for evaluate) for the full result. **When to use** — "what did I evaluate yesterday?" / "show me my recent searches" / "what was the rating on that Jordan 1 I checked?". **Inputs** (all optional) — `kind` (`evaluate` | `search`; omit for cross-kind), `status` (`queued|running|completed|failed|cancelled`), `since` (ISO 8601 lower bound on createdAt), `cursor` (keyset paging — pass the previous response\'s cursor for next page), `limit` (default 20, max 100). **Cost** — free; never charged. **Prereqs** — `FLIPAGENT_API_KEY`. **Example** — `{ kind: "evaluate", status: "completed", limit: 10 }`.';

export async function listJobsExecute(config: Config, args: Record<string, unknown>): Promise<unknown> {
	const client = getClient(config);
	try {
		const query = args as {
			kind?: "evaluate" | "search";
			status?: "queued" | "running" | "completed" | "failed" | "cancelled";
			since?: string;
			cursor?: string;
			limit?: number;
		};
		const res = await client.jobs.list(query);
		return {
			items: res.items,
			cursor: res.cursor,
			hint: res.cursor
				? "More rows available — call again with `cursor` set to this value to page back further."
				: "End of history within the requested window.",
		};
	} catch (err) {
		return toolErrorEnvelope(err, "list_jobs_failed", "/v1/jobs");
	}
}
