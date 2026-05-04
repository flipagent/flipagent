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
import { withTradingAuth } from "../../middleware/with-trading-auth.js";
import { BlobNotConfiguredError, createMediaUpload, getMedia } from "../../services/media.js";
import { uploadSiteHostedPicture } from "../../services/ebay/trading/pictures.js";
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

mediaRoute.post(
	"/ebay-pictures",
	describeRoute({
		tags: ["Media"],
		summary: "Upload an image directly to eBay's Picture Hosting (Trading API)",
		description:
			"One-shot eBay-direct upload. Caller supplies a public `sourceUrl`; flipagent fetches it, wraps in multipart, forwards to eBay's `UploadSiteHostedPictures`, returns the stable `https://i.ebayimg.com/...` URL. Use when you want eBay to host the image (eBay-only listing, no third-party storage in the flow). For multi-marketplace / permanent catalog use, prefer `POST /v1/media/uploads` (flipagent-hosted blob).",
		responses: {
			201: { description: "Picture uploaded; URL ready to use in `imageUrls[]`." },
			401: errorResponse("API key missing or eBay account not connected (POST /v1/connect/ebay)."),
			502: errorResponse("Upstream eBay request failed."),
			503: errorResponse("EBAY_CLIENT_ID/SECRET/RU_NAME unset on this api instance."),
		},
	}),
	requireApiKey,
	withTradingAuth(async (c, accessToken) => {
		const json = await c.req.json();
		const parsed = json as { sourceUrl?: string; pictureName?: string; extensionInDays?: 1 | 5 | 7 | 30 | 60 };
		if (!parsed.sourceUrl || typeof parsed.sourceUrl !== "string") {
			return c.json({ error: "missing_source_url", message: "Body must include `sourceUrl` (HTTPS image URL)." }, 400);
		}
		// Fetch the binary. Cap at 10MB — eBay's own per-image cap is
		// 12MB but we leave a small margin for the multipart envelope.
		const fetched = await fetch(parsed.sourceUrl, { redirect: "follow" });
		if (!fetched.ok) {
			return c.json(
				{ error: "source_unreachable", message: `Couldn't fetch sourceUrl (HTTP ${fetched.status})` },
				400,
			);
		}
		const contentType = fetched.headers.get("content-type") ?? "image/jpeg";
		const arr = await fetched.arrayBuffer();
		if (arr.byteLength > 10 * 1024 * 1024) {
			return c.json(
				{ error: "image_too_large", message: `Image is ${arr.byteLength} bytes; cap is 10485760 (10 MB).` },
				413,
			);
		}
		const result = await uploadSiteHostedPicture({
			accessToken,
			body: new Uint8Array(arr),
			contentType,
			pictureName: parsed.pictureName,
			extensionInDays: parsed.extensionInDays,
		});
		return c.json(result, 201);
	}),
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
