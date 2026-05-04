/**
 * Submit 10 verify-style requests via OpenAI Batch API.
 * Time submission → completion. Compare vs realtime.
 *
 *   node --env-file=.env --import tsx scripts/openai-batch-test.ts
 */

import { readFileSync } from "node:fs";
import OpenAI from "openai";
import type { ItemSummary } from "@flipagent/types/ebay/buy";

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const model = process.env.OPENAI_MODEL ?? "gpt-5.4-mini";
const SNAP = process.env.SNAPSHOT;
if (!SNAP) throw new Error("SNAPSHOT env required");

const snap = JSON.parse(readFileSync(SNAP, "utf8")) as {
	seed: ItemSummary;
	soldRaw: ItemSummary[];
	activeRaw: ItemSummary[];
};

// Build 10 chunks of 10 items just like the verify pass.
const all = [...snap.soldRaw, ...snap.activeRaw.filter((a) => !snap.soldRaw.some((s) => s.itemId === a.itemId))];
const chunks: ItemSummary[][] = [];
for (let i = 0; i < 100; i += 10) chunks.push(all.slice(i, i + 10));

const SYSTEM = `You verify each ITEM against a CANDIDATE. Reply ONLY with JSON array [{"i":0,"same":true|false,"reason":"..."}].`;

function summary(it: ItemSummary): string {
	return `${it.title} | ${it.condition ?? "?"} | $${it.price?.value ?? it.lastSoldPrice?.value ?? "?"}`;
}

const requests = chunks.map((chunk, i) => ({
	custom_id: `chunk-${i}`,
	method: "POST",
	url: "/v1/chat/completions",
	body: {
		model,
		max_completion_tokens: 2048,
		messages: [
			{ role: "system", content: SYSTEM },
			{
				role: "user",
				content: `CANDIDATE: ${summary(snap.seed)}\n\nITEMS:\n${chunk.map((c, j) => `[${j}] ${summary(c)}`).join("\n")}`,
			},
		],
	},
}));

const jsonl = requests.map((r) => JSON.stringify(r)).join("\n");

async function main(): Promise<void> {
	console.log(`[batch] preparing ${requests.length} requests, model=${model}`);
	const t0 = performance.now();

	const file = await client.files.create({
		file: new File([Buffer.from(jsonl)], "batch-input.jsonl"),
		purpose: "batch",
	});
	console.log(`[batch] file=${file.id} (${Math.round(performance.now() - t0)}ms)`);

	const batch = await client.batches.create({
		input_file_id: file.id,
		endpoint: "/v1/chat/completions",
		completion_window: "24h",
	});
	console.log(`[batch] batch=${batch.id} status=${batch.status} (${Math.round(performance.now() - t0)}ms)`);

	let last: typeof batch | null = null;
	while (true) {
		await new Promise((r) => setTimeout(r, 5000));
		const cur = await client.batches.retrieve(batch.id);
		const elapsed = Math.round((performance.now() - t0) / 1000);
		console.log(`[batch] t=${elapsed}s status=${cur.status} done=${cur.request_counts.completed}/${cur.request_counts.total} failed=${cur.request_counts.failed}`);
		last = cur;
		if (["completed", "failed", "expired", "cancelled"].includes(cur.status)) break;
		if (elapsed > 1800) {
			console.log("[batch] giving up after 30 minutes");
			break;
		}
	}

	if (last?.status === "completed" && last.output_file_id) {
		const outRes = await client.files.content(last.output_file_id);
		const text = await outRes.text();
		const lines = text.trim().split("\n");
		console.log(`[batch] received ${lines.length} responses, first response usage:`);
		const first = JSON.parse(lines[0]!);
		console.log(JSON.stringify(first.response.body.usage, null, 2));
		console.log(`[batch] TOTAL elapsed = ${Math.round((performance.now() - t0) / 1000)}s`);
	}
}

main()
	.then(() => process.exit(0))
	.catch((e) => {
		console.error(e);
		process.exit(1);
	});
