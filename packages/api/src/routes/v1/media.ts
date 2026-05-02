/**
 * `/v1/media/*` — pre-signed image/video upload + status.
 */

import { type Media, MediaUploadRequest } from "@flipagent/types";
import { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import { requireApiKey } from "../../middleware/auth.js";
import { createMediaUpload, getMedia } from "../../services/media.js";
import { errorResponse, tbBody } from "../../utils/openapi.js";

export const mediaRoute = new Hono();

const COMMON = { 401: errorResponse("Auth missing."), 502: errorResponse("Upstream eBay failed.") };

mediaRoute.post(
	"/uploads",
	describeRoute({
		tags: ["Media"],
		summary: "Get a pre-signed image/video upload URL",
		responses: { 201: { description: "Upload URL." }, ...COMMON },
	}),
	requireApiKey,
	tbBody(MediaUploadRequest),
	async (c) => c.json(await createMediaUpload(c.req.valid("json"), { apiKeyId: c.var.apiKey.id }), 201),
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
