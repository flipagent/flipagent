/**
 * Self-host admin tool — issue an API key directly without going through
 * the dashboard. The hosted service uses /v1/me/keys (session auth via
 * Better-Auth); self-hosters who don't want to wire up GitHub OAuth just
 * for one bootstrap key can run:
 *
 *   npm run --workspace @flipagent/api db:issue-key -- you@example.com [pro]
 *
 * Tier defaults to "free". The plaintext is printed once and gone.
 */

import { issueKey, type Tier } from "../auth/keys.js";
import { closeDb } from "../db/client.js";

async function main(): Promise<void> {
	const [, , email, tierArg] = process.argv;
	if (!email) {
		console.error("usage: db:issue-key <email> [free|hobby|pro|business]");
		process.exit(1);
	}
	const tier: Tier = (tierArg as Tier) ?? "free";
	const valid: Tier[] = ["free", "hobby", "pro", "business"];
	if (!valid.includes(tier)) {
		console.error(`tier must be one of: ${valid.join(", ")}`);
		process.exit(1);
	}
	const issued = await issueKey({ tier, ownerEmail: email });
	console.log("");
	console.log("  tier:      ", issued.tier);
	console.log("  prefix:    ", issued.prefix);
	console.log("  plaintext: ", issued.plaintext);
	console.log("");
	console.log("Save the plaintext now — it will never be shown again.");
	await closeDb();
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
