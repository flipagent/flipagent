/**
 * Quick existence check for higher-tier model IDs.
 */
import OpenAI from "openai";
import { GoogleGenAI } from "@google/genai";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const google = new GoogleGenAI({ apiKey: process.env.GOOGLE_API_KEY });

const candidates = {
	openai: ["gpt-5.4", "gpt-5.5", "gpt-5.5-mini", "gpt-5.4-pro", "gpt-5"],
	google: ["gemini-3-flash-preview", "gemini-3-pro-preview", "gemini-3.1-pro-preview", "gemini-3.1-flash-preview", "gemini-3.1-flash", "gemini-2.5-pro"],
};

for (const m of candidates.openai) {
	try {
		const t = performance.now();
		const r = await openai.chat.completions.create({ model: m, max_completion_tokens: 16, messages: [{ role: "user", content: "say ok" }] });
		console.log(`✓ openai/${m}  ${Math.round(performance.now()-t)}ms  "${r.choices[0]?.message?.content?.slice(0,30)}"`);
	} catch (e) {
		const msg = (e as Error).message.slice(0, 80);
		console.log(`✗ openai/${m}  ${msg}`);
	}
}

for (const m of candidates.google) {
	try {
		const t = performance.now();
		const r = await google.models.generateContent({ model: m, contents: [{ role: "user", parts: [{ text: "say ok" }] }], config: { maxOutputTokens: 16 } });
		console.log(`✓ google/${m}  ${Math.round(performance.now()-t)}ms  "${(r.text ?? "").slice(0,30)}"`);
	} catch (e) {
		const msg = (e as Error).message.slice(0, 80);
		console.log(`✗ google/${m}  ${msg}`);
	}
}
process.exit(0);
