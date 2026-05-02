/**
 * `/v1/media` — eBay-hosted image/video upload (commerce/media).
 *
 * Two-step flow:
 *   POST /v1/media/uploads → uploadUrl + mediaId
 *   PUT  uploadUrl (multipart binary) → 204
 */

import { type Static, Type } from "@sinclair/typebox";
import { ResponseSource } from "./_common.js";

export const MediaType = Type.Union([Type.Literal("image"), Type.Literal("video")], { $id: "MediaType" });
export type MediaType = Static<typeof MediaType>;

export const MediaUpload = Type.Object(
	{
		mediaId: Type.String(),
		uploadUrl: Type.String(),
		uploadHeaders: Type.Record(Type.String(), Type.String()),
		expiresAt: Type.String(),
		source: Type.Optional(ResponseSource),
	},
	{ $id: "MediaUpload" },
);
export type MediaUpload = Static<typeof MediaUpload>;

export const MediaUploadRequest = Type.Object({ type: MediaType }, { $id: "MediaUploadRequest" });
export type MediaUploadRequest = Static<typeof MediaUploadRequest>;

export const Media = Type.Object(
	{
		id: Type.String(),
		type: MediaType,
		url: Type.Optional(Type.String()),
		status: Type.String({ description: "READY | PROCESSING | FAILED | …" }),
		source: Type.Optional(ResponseSource),
	},
	{ $id: "Media" },
);
export type Media = Static<typeof Media>;
