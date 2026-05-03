/**
 * `/v1/media/*` — pre-signed image + video upload + status.
 *
 *   POST /v1/media/uploads { type: "image" | "video", contentType? }
 *     → { mediaId, uploadUrl, uploadHeaders, expiresAt, publicUrl? }
 *
 * Image uploads land on flipagent-managed Azure Blob Storage (Azurite
 * for local dev). The `publicUrl` returned is what callers pass to
 * `imageUrls[]` when creating a listing. Video uploads go to eBay's
 * commerce/media surface (no `publicUrl` — eBay tracks the asset by id).
 */

import { type Media, MediaUploadRequest } from "@flipagent/types";
import { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import { requireApiKey } from "../../middleware/auth.js";
import { BlobNotConfiguredError, createMediaUpload, getMedia } from "../../services/media.js";
import { errorResponse, tbBody } from "../../utils/openapi.js";

export const mediaRoute = new Hono();

const COMMON = { 401: errorResponse("Auth missing."), 502: errorResponse("Upstream eBay failed.") };

mediaRoute.post(
	"/uploads",
	describeRoute({
		tags: ["Media"],
		summary: "Get a pre-signed image / video upload URL",
		description:
			"Returns `{mediaId, uploadUrl, uploadHeaders, expiresAt}` plus `publicUrl` for image uploads. " +
			"PUT the binary directly to `uploadUrl` with the supplied headers. Use `publicUrl` in the " +
			"listing's `imageUrls[]`.",
		responses: {
			201: { description: "Upload URL." },
			503: errorResponse("Image hosting not configured — set BLOB_CONNECTION_STRING."),
			...COMMON,
		},
	}),
	requireApiKey,
	tbBody(MediaUploadRequest),
	async (c) => {
		try {
			return c.json(await createMediaUpload(c.req.valid("json"), { apiKeyId: c.var.apiKey.id }), 201);
		} catch (err) {
			if (err instanceof BlobNotConfiguredError) {
				return c.json({ error: err.code, message: err.message }, 503);
			}
			throw err;
		}
	},
);

mediaRoute.get(
	"/:id",
	describeRoute({
		tags: ["Media"],
		summary: "Get media status",
		responses: { 200: { description: "Media." }, ...COMMON },
	}),
	requireApiKey,
	async (c) => {
		const type = (c.req.query("type") as "image" | "video" | undefined) ?? "image";
		const r = await getMedia(c.req.param("id"), type, { apiKeyId: c.var.apiKey.id });
		if (!r) return c.json({ error: "media_not_found" }, 404);
		return c.json(r satisfies Media);
	},
);
