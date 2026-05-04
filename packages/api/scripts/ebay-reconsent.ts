/**
 * One-shot eBay re-consent helper.
 *
 * The api dev server has its own in-memory state map and api-key auth
 * for the canonical consent flow. This script bypasses both for the
 * specific case "I added new scopes to EBAY_SCOPES, my existing token
 * doesn't have them, and I want to re-OAuth without going through the
 * dashboard." It:
 *
 *   1. Builds the eBay authorize URL (state generated locally).
 *   2. Listens on the same port the api dev server uses (default 4000)
 *      for the callback. eBay's RU_NAME must already resolve to
 *      `http://localhost:<port>/v1/connect/ebay/callback`.
 *   3. Captures the `?code=`, exchanges it for tokens, and UPSERTS the
 *      same `userEbayOauth` row the api would have written.
 *   4. Prints the granted scope set so you can verify the new ones came
 *      back; exits.
 *
 * IMPORTANT: stop your `npm run dev` first — this script needs port
 * 4000 free. Restart `npm run dev` after it exits.
 *
 * Usage:
 *   cd packages/api && node --env-file=.env --import tsx scripts/ebay-reconsent.ts
 *
 * Optional:
 *   APIKEY_ID=<uuid>  re-bind a specific api-key (default: first row in user_ebay_oauth)
 *   PORT=4000         override the listen port if your RU_NAME points elsewhere
 */

import { createServer } from "node:http";
import { encryptSecret } from "../src/auth/secret-envelope.js";
import { config } from "../src/config.js";
import { db } from "../src/db/client.js";
import { userEbayOauth } from "../src/db/schema.js";
import { exchangeCode, fetchEbayUserSummary } from "../src/services/ebay/oauth.js";
import { buildEbayAuthorizeUrl, rememberState } from "../src/services/ebay/oauth-state.js";

const PORT = Number(process.env.PORT ?? config.PORT ?? 4000);

async function pickApiKeyId(): Promise<string> {
	if (process.env.APIKEY_ID) return process.env.APIKEY_ID;
	const rows = await db.select({ id: userEbayOauth.apiKeyId }).from(userEbayOauth).limit(1);
	if (!rows[0]) throw new Error("No userEbayOauth row to re-bind. Run /v1/connect/ebay flow first.");
	return rows[0].id;
}

async function main(): Promise<void> {
	const apiKeyId = await pickApiKeyId();
	const state = rememberState(apiKeyId, "/dashboard", { version: "2026-05-01" });
	const url = buildEbayAuthorizeUrl(state);
	console.log("Re-binding apiKeyId:", apiKeyId);
	console.log("\nScopes being requested:");
	for (const s of config.EBAY_SCOPES.split(" ")) console.log(" ", s);
	console.log("\nOpen this URL in your browser, click Agree, then come back here:\n");
	console.log(url);
	console.log(`\nWaiting on http://localhost:${PORT}/v1/connect/ebay/callback ...`);

	const server = createServer(async (req, res) => {
		if (!req.url || !req.url.startsWith("/v1/connect/ebay/callback")) {
			res.writeHead(404).end("Not found");
			return;
		}
		const u = new URL(req.url, `http://localhost:${PORT}`);
		const code = u.searchParams.get("code");
		const errParam = u.searchParams.get("error");
		if (errParam) {
			res.writeHead(400).end(`eBay declined consent: ${errParam}`);
			console.error("eBay declined:", errParam);
			process.exit(1);
		}
		if (!code) {
			res.writeHead(400).end("Missing code");
			return;
		}
		try {
			const tokens = await exchangeCode(code);
			const accessExpires = new Date(Date.now() + tokens.expires_in * 1000);
			const refreshExpires = tokens.refresh_token_expires_in
				? new Date(Date.now() + tokens.refresh_token_expires_in * 1000)
				: null;
			const summary = await fetchEbayUserSummary(tokens.access_token).catch(() => null);
			await db
				.insert(userEbayOauth)
				.values({
					apiKeyId,
					ebayUserId: summary?.userId ?? null,
					ebayUserName: summary?.username ?? null,
					accessToken: encryptSecret(tokens.access_token),
					accessTokenExpiresAt: accessExpires,
					refreshToken: encryptSecret(tokens.refresh_token),
					refreshTokenExpiresAt: refreshExpires,
					scopes: config.EBAY_SCOPES,
					disclaimerAcceptedAt: new Date(),
					disclaimerVersion: "2026-05-01",
					updatedAt: new Date(),
				})
				.onConflictDoUpdate({
					target: userEbayOauth.apiKeyId,
					set: {
						ebayUserId: summary?.userId ?? null,
						ebayUserName: summary?.username ?? null,
						accessToken: encryptSecret(tokens.access_token),
						accessTokenExpiresAt: accessExpires,
						refreshToken: encryptSecret(tokens.refresh_token),
						refreshTokenExpiresAt: refreshExpires,
						scopes: config.EBAY_SCOPES,
						disclaimerAcceptedAt: new Date(),
						disclaimerVersion: "2026-05-01",
						updatedAt: new Date(),
					},
				});
			res.writeHead(200, { "Content-Type": "text/html" }).end(
				`<h1>Re-consent OK</h1><p>Bound to ${summary?.username ?? "(no username)"} — you can close this tab.</p>`,
			);
			console.log("\n✓ Token upserted. eBay user:", summary?.username);
			console.log("Access expires:", accessExpires.toISOString());
			console.log("Refresh expires:", refreshExpires?.toISOString() ?? "(unset)");
			console.log("\nNow re-run the probe:");
			console.log("  node --env-file=.env --import tsx scripts/ebay-endpoint-probe.ts");
			server.close();
			setTimeout(() => process.exit(0), 200);
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			res.writeHead(500).end(`Token exchange failed: ${msg}`);
			console.error("Token exchange failed:", err);
			process.exit(1);
		}
	});
	server.listen(PORT);
}

main().catch((err) => {
	console.error("[reconsent] fatal:", err);
	process.exit(1);
});
