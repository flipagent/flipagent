/**
 * Test if OpenAI strict JSON-schema mode reduces verify latency.
 * Compares: free-form (current) vs json_schema strict.
 */

import { readFileSync } from "node:fs";
import OpenAI from "openai";
import type { ItemSummary } from "@flipagent/types/ebay/buy";

const SNAP = process.env.SNAPSHOT!;
const snap = JSON.parse(readFileSync(SNAP, "utf8")) as { seed: ItemSummary; soldRaw: ItemSummary[]; activeRaw: ItemSummary[] };
const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const model = process.env.OPENAI_MODEL ?? "gpt-5.4-mini";

const items = snap.soldRaw.slice(0, 10);
const SYSTEM = `You verify each ITEM against a CANDIDATE on eBay. Return same:true if same product. For each item give i, same, reason.`;
const USER = `CANDIDATE: ${snap.seed.title} | ${snap.seed.condition} | $${snap.seed.price?.value}\nITEMS:\n${items.map((it, i) => `[${i}] ${it.title} | ${it.condition} | $${it.price?.value ?? it.lastSoldPrice?.value}`).join("\n")}`;

const SCHEMA = {
	type: "object",
	properties: {
		decisions: {
			type: "array",
			items: {
				type: "object",
				properties: {
					i: { type: "integer" },
					same: { type: "boolean" },
					reason: { type: "string" },
				},
				required: ["i", "same", "reason"],
				additionalProperties: false,
			},
		},
	},
	required: ["decisions"],
	additionalProperties: false,
};

async function run(label: string, useSchema: boolean): Promise<void> {
	const reps = 3;
	const times: number[] = [];
	for (let r = 0; r < reps; r++) {
		const t = performance.now();
		const res = await client.chat.completions.create({
			model,
			max_completion_tokens: 1024,
			messages: [{ role: "system", content: SYSTEM }, { role: "user", content: USER }],
			...(useSchema
				? { response_format: { type: "json_schema", json_schema: { name: "verify", schema: SCHEMA, strict: true } } }
				: {}),
		});
		const dur = Math.round(performance.now() - t);
		times.push(dur);
		const u = (res as unknown as { usage?: { prompt_tokens?: number; completion_tokens?: number; prompt_tokens_details?: { cached_tokens?: number } } }).usage;
		console.log(`[${label}] rep=${r} ${dur}ms   prompt=${u?.prompt_tokens} cached=${u?.prompt_tokens_details?.cached_tokens} completion=${u?.completion_tokens}`);
	}
	const avg = times.reduce((a, b) => a + b, 0) / reps;
	console.log(`[${label}] avg ${Math.round(avg)}ms`);
}

await run("freeform", false);
await run("json_schema", true);
process.exit(0);
