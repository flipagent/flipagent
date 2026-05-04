/**
 * `UploadSiteHostedPictures` — Trading API call that accepts a binary
 * image and returns a stable `https://i.ebayimg.com/...` URL the seller
 * can drop into a listing's `imageUrls[]`. Distinct from the standard
 * `tradingCall` helper because this endpoint uses multipart/form-data
 * (XML envelope as one part, binary image as another) instead of a
 * single XML POST.
 *
 * Why expose this at all when flipagent's own /v1/media (Azure Blob)
 * works? eBay-direct upload is the path most casual sellers expect:
 * binary in → eBay-hosted URL out, no third-party storage to think
 * about. The blob path is for multi-marketplace + permanent-catalog
 * cases (Amazon + Mercari can reuse the same URL); eBay-direct is
 * eBay-only and the URL evicts after the listing ends + a grace.
 *
 * Auth: IAF token via `X-EBAY-API-IAF-TOKEN` header (same as the
 * other Trading calls). No RequesterCredentials block in the XML.
 */

import { escapeXml, parseTrading, stringFrom, TRADING_COMPAT_LEVEL, TradingApiError } from "./client.js";

const TRADING_ENDPOINT = process.env.EBAY_TRADING_URL ?? "https://api.ebay.com/ws/api.dll";

const DEFAULT_TIMEOUT_MS = 60_000; // multipart bodies + image bytes — give it room

interface UploadResult {
	/** Stable eBay-hosted URL. Use as-is in `imageUrls[]`. */
	fullUrl: string;
	/** Optional secondary URLs (different sizes — eBay generates a Standard + a Supersize set). */
	memberUrls: string[];
	/** Expiry — eBay deletes the picture this many days after the last listing referencing it ends. */
	extensionInDays: number;
}

interface UploadInput {
	accessToken: string;
	body: Uint8Array;
	contentType: string;
	/** Optional human-friendly tag. eBay shows it in the seller's Picture Manager. */
	pictureName?: string;
	/** 1, 5, 7, 30, 60 — caps grace period after the last listing ends. Default 30. */
	extensionInDays?: 1 | 5 | 7 | 30 | 60;
}

/** Multipart boundary — must not appear in the body. Random ASCII string is safe. */
function makeBoundary(): string {
	return `flipagent-${Math.random().toString(36).slice(2)}-${Date.now()}`;
}

export async function uploadSiteHostedPicture(input: UploadInput): Promise<UploadResult> {
	const extension = input.extensionInDays ?? 30;
	const xml = `<?xml version="1.0" encoding="utf-8"?>
<UploadSiteHostedPicturesRequest xmlns="urn:ebay:apis:eBLBaseComponents">
  <PictureName>${escapeXml(input.pictureName ?? "flipagent-image")}</PictureName>
  <PictureSet>Supersize</PictureSet>
  <ExtensionInDays>${extension}</ExtensionInDays>
</UploadSiteHostedPicturesRequest>`;

	const boundary = makeBoundary();
	const lf = "\r\n";

	const xmlPart =
		`--${boundary}${lf}` +
		`Content-Disposition: form-data; name="XML Payload"${lf}` +
		`Content-Type: text/xml;charset=utf-8${lf}${lf}` +
		`${xml}${lf}`;

	const imagePartHeader =
		`--${boundary}${lf}` +
		`Content-Disposition: form-data; name="dummy"; filename="image"${lf}` +
		`Content-Transfer-Encoding: binary${lf}` +
		`Content-Type: ${input.contentType}${lf}${lf}`;

	const tail = `${lf}--${boundary}--${lf}`;

	const xmlBytes = new TextEncoder().encode(xmlPart);
	const imageHeaderBytes = new TextEncoder().encode(imagePartHeader);
	const tailBytes = new TextEncoder().encode(tail);

	const total = xmlBytes.length + imageHeaderBytes.length + input.body.length + tailBytes.length;
	const body = new Uint8Array(total);
	let offset = 0;
	body.set(xmlBytes, offset);
	offset += xmlBytes.length;
	body.set(imageHeaderBytes, offset);
	offset += imageHeaderBytes.length;
	body.set(input.body, offset);
	offset += input.body.length;
	body.set(tailBytes, offset);

	const ctrl = new AbortController();
	const timer = setTimeout(() => ctrl.abort(), DEFAULT_TIMEOUT_MS);
	let res: Response;
	try {
		res = await fetch(TRADING_ENDPOINT, {
			method: "POST",
			headers: {
				"X-EBAY-API-CALL-NAME": "UploadSiteHostedPictures",
				"X-EBAY-API-COMPATIBILITY-LEVEL": TRADING_COMPAT_LEVEL,
				"X-EBAY-API-SITEID": "0",
				"X-EBAY-API-IAF-TOKEN": input.accessToken,
				"Content-Type": `multipart/form-data; boundary=${boundary}`,
			},
			body,
			signal: ctrl.signal,
		});
	} catch (err) {
		clearTimeout(timer);
		if (err instanceof Error && err.name === "AbortError") {
			throw new TradingApiError(
				"UploadSiteHostedPictures",
				504,
				[],
				`upstream timeout after ${DEFAULT_TIMEOUT_MS}ms`,
			);
		}
		throw err;
	}
	clearTimeout(timer);
	const text = await res.text();
	if (!res.ok) {
		throw new TradingApiError("UploadSiteHostedPictures", res.status, [], text.slice(0, 500));
	}
	const parsed = parseTrading<{ SiteHostedPictureDetails?: Record<string, unknown> }>(
		text,
		"UploadSiteHostedPictures",
	);
	const details = (parsed.SiteHostedPictureDetails ?? {}) as Record<string, unknown>;
	const fullUrl = stringFrom(details.FullURL);
	if (!fullUrl) {
		throw new TradingApiError("UploadSiteHostedPictures", 502, [], "response missing FullURL");
	}
	const set = (details.PictureSetMember ?? []) as Array<Record<string, unknown>> | Record<string, unknown>;
	const members = Array.isArray(set) ? set : [set];
	const memberUrls = members
		.map((m) => stringFrom((m as { MemberURL?: unknown }).MemberURL))
		.filter((u): u is string => !!u);
	return { fullUrl, memberUrls, extensionInDays: extension };
}
