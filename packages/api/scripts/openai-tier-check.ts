/**
 * Inspect OpenAI rate-limit headers to identify our tier.
 * Hits gpt-5.4-mini and gpt-5.4-nano and prints x-ratelimit-* headers.
 */

const KEY = process.env.OPENAI_API_KEY;
if (!KEY) throw new Error("OPENAI_API_KEY missing");

const models = ["gpt-5.4-mini", "gpt-5.4-nano"];

async function check(model: string): Promise<void> {
	const res = await fetch("https://api.openai.com/v1/chat/completions", {
		method: "POST",
		headers: {
			"Authorization": `Bearer ${KEY}`,
			"Content-Type": "application/json",
		},
		body: JSON.stringify({
			model,
			max_completion_tokens: 8,
			messages: [{ role: "user", content: "Say 'ok'." }],
		}),
	});
	console.log(`\n=== ${model} (status ${res.status}) ===`);
	for (const [k, v] of res.headers.entries()) {
		if (k.toLowerCase().startsWith("x-ratelimit") || k.toLowerCase() === "openai-organization") {
			console.log(`  ${k}: ${v}`);
		}
	}
	if (!res.ok) console.log("  body:", await res.text());
}

for (const m of models) await check(m);
process.exit(0);
