/**
 * Live smoke test for the Azure Blob client + Azurite emulator.
 *
 * Run: BLOB_CONNECTION_STRING=… npx tsx scripts/test-blob.ts
 */

import { loadAzureBlobClient } from "../src/services/blob/azure.js";

async function main() {
	const client = loadAzureBlobClient();
	if (!client) {
		console.error("BLOB_CONNECTION_STRING not set");
		process.exit(1);
	}

	console.log("[blob-test] requesting upload URL…");
	const upload = await client.createUploadUrl({
		contentType: "image/png",
		ext: "png",
		prefix: "media/image",
	});
	console.log("[blob-test] mediaId =", upload.mediaId);
	console.log("[blob-test] uploadUrl =", upload.uploadUrl);
	console.log("[blob-test] publicUrl =", upload.publicUrl);
	console.log("[blob-test] expiresAt =", upload.expiresAt);

	// 1×1 transparent PNG.
	const pngBytes = Buffer.from(
		"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
		"base64",
	);

	console.log("[blob-test] PUT-ing 1×1 PNG to uploadUrl…");
	const putRes = await fetch(upload.uploadUrl, {
		method: "PUT",
		headers: upload.uploadHeaders,
		body: pngBytes,
	});
	if (!putRes.ok) {
		console.error("[blob-test] PUT failed:", putRes.status, await putRes.text());
		process.exit(1);
	}
	console.log("[blob-test] PUT 201 ok");

	console.log("[blob-test] GET", upload.publicUrl);
	const getRes = await fetch(upload.publicUrl);
	if (!getRes.ok) {
		console.error("[blob-test] GET failed:", getRes.status, await getRes.text());
		process.exit(1);
	}
	const ct = getRes.headers.get("content-type");
	const len = (await getRes.arrayBuffer()).byteLength;
	console.log("[blob-test] GET ok — content-type:", ct, "length:", len);

	if (len !== pngBytes.length) {
		console.error(`[blob-test] FAIL — expected ${pngBytes.length} bytes, got ${len}`);
		process.exit(1);
	}
	console.log("[blob-test] ✅ round-trip OK");
}

main().catch((err) => {
	console.error("[blob-test] error:", err);
	process.exit(1);
});
