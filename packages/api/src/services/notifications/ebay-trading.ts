/**
 * eBay Trading API Platform Notifications.
 *
 * Trading is the legacy SOAP/XML API. We only touch two calls:
 *
 *   SetNotificationPreferences  →  subscribe a seller to events that hit
 *                                  our public callback URL
 *   GetNotificationPreferences  →  read back what's currently subscribed
 *
 * Inbound: eBay POSTs SOAP/XML envelopes to EBAY_NOTIFY_URL whenever a
 * subscribed event happens. The signature in the SOAP header is
 *
 *     Base64(MD5(Timestamp + DevID + AppID + CertID))
 *
 * computed from the message Timestamp + the developer credentials. We
 * verify it locally — no extra round-trip to eBay.
 *
 * The 5 events we care about today:
 *
 *   ItemSold                  — auction-format item sold
 *   AuctionCheckoutComplete   — buyer paid for auction win
 *   FixedPriceTransaction     — fixed-price (BIN) sale, the modern path
 *   OutBid                    — buy-side, log only (informational)
 *   ItemUnsold                — auction expired without sale
 *
 * `ItemSold` and `FixedPriceTransaction` mostly overlap; eBay sends one
 * or the other depending on listing format. `AuctionCheckoutComplete`
 * arrives later and gives us the actual paid amount + checkout status.
 * Dedupe at the row level via marketplace_notifications.dedupe_key
 * (sha256 of raw body), then again at the ledger level via
 * (api_key_id, kind=sold, external_id=transactionId).
 */

import { createHash } from "node:crypto";
import { XMLParser } from "fast-xml-parser";
import { config } from "../../config.js";

const TRADING_ENDPOINT = "https://api.ebay.com/ws/api.dll";
// Compatibility level — pinned. eBay deprecates old levels slowly; 1349
// is current as of 2026 and supports every event we use.
const COMPAT_LEVEL = "1349";

/** Events flipagent subscribes a seller to in one shot. */
export const TRACKED_EVENTS = [
	"ItemSold",
	"AuctionCheckoutComplete",
	"FixedPriceTransaction",
	"OutBid",
	"ItemUnsold",
] as const;
export type TrackedEvent = (typeof TRACKED_EVENTS)[number];

const xmlParser = new XMLParser({
	ignoreAttributes: false,
	removeNSPrefix: true, // strip soapenv:/ebl: so paths are predictable
	parseTagValue: true,
	trimValues: true,
});

interface SetPrefsResult {
	ack: "Success" | "Warning" | "Failure";
	errors: Array<{ code: string; message: string; severity: string }>;
	raw: unknown;
}

/**
 * Subscribe one seller to TRACKED_EVENTS, pointing at EBAY_NOTIFY_URL.
 * Idempotent — calling twice with the same prefs is a no-op on eBay's side.
 */
export async function setNotificationPreferences(accessToken: string): Promise<SetPrefsResult> {
	if (!config.EBAY_NOTIFY_URL) throw new Error("EBAY_NOTIFY_URL not set");
	const body = buildSetPrefsBody(config.EBAY_NOTIFY_URL);
	const res = await tradingCall("SetNotificationPreferences", accessToken, body);
	return parseAck(res);
}

/** Read back the seller's current subscription (for /v1/notifications/ebay/subscribe GET). */
export async function getNotificationPreferences(accessToken: string): Promise<{
	ack: "Success" | "Warning" | "Failure";
	applicationUrl: string | null;
	applicationEnabled: boolean;
	enabledEvents: string[];
	raw: unknown;
}> {
	// Two calls — eBay returns App-level prefs only when filter is omitted
	// or set to Application, and User-level prefs only when filter=User.
	// The single-call form drops one or the other depending on which is
	// asked for. Two calls is the only reliable way to read both.
	const appBody = `<?xml version="1.0" encoding="utf-8"?>
<GetNotificationPreferencesRequest xmlns="urn:ebay:apis:eBLBaseComponents">
	<PreferenceLevel>Application</PreferenceLevel>
</GetNotificationPreferencesRequest>`;
	const userBody = `<?xml version="1.0" encoding="utf-8"?>
<GetNotificationPreferencesRequest xmlns="urn:ebay:apis:eBLBaseComponents">
	<PreferenceLevel>User</PreferenceLevel>
</GetNotificationPreferencesRequest>`;
	const [appRes, userRes] = await Promise.all([
		tradingCall("GetNotificationPreferences", accessToken, appBody),
		tradingCall("GetNotificationPreferences", accessToken, userBody),
	]);
	const appParsed = xmlParser.parse(appRes) as Record<string, unknown>;
	const userParsed = xmlParser.parse(userRes) as Record<string, unknown>;
	const appRoot = (appParsed.GetNotificationPreferencesResponse ?? {}) as Record<string, unknown>;
	const userRoot = (userParsed.GetNotificationPreferencesResponse ?? {}) as Record<string, unknown>;
	const ack = (appRoot.Ack as SetPrefsResult["ack"]) ?? "Failure";
	const app = (appRoot.ApplicationDeliveryPreferences ?? {}) as Record<string, unknown>;
	const userArr = (userRoot.UserDeliveryPreferenceArray ?? {}) as Record<string, unknown>;
	const prefs = arrayify(userArr.NotificationEnable);
	return {
		ack,
		applicationUrl: (app.ApplicationURL as string) ?? null,
		applicationEnabled: app.ApplicationEnable === "Enable",
		enabledEvents: prefs
			.filter((p) => p.EventEnable === "Enable")
			.map((p) => p.EventType as string)
			.filter(Boolean),
		raw: { app: appParsed, user: userParsed },
	};
}

interface ParsedNotification {
	eventType: string;
	timestamp: string;
	signature: string | null;
	recipientUserId: string | null;
	transactionId: string | null;
	itemId: string | null;
	amountCents: number | null;
	currency: string | null;
	raw: Record<string, unknown>;
}

/**
 * Parse an inbound SOAP/XML envelope from eBay. Returns the bits we need
 * for dedupe, signature verification, and ledger write. Does NOT verify
 * the signature — caller must call verifySignature() with the result.
 */
export function parseNotification(xml: string): ParsedNotification | null {
	const parsed = xmlParser.parse(xml) as Record<string, unknown>;
	const envelope = (parsed.Envelope ?? {}) as Record<string, unknown>;
	const header = (envelope.Header ?? {}) as Record<string, unknown>;
	const body = (envelope.Body ?? {}) as Record<string, unknown>;
	const reqCreds = (header.RequesterCredentials ?? {}) as Record<string, unknown>;
	const signature = typeof reqCreds.NotificationSignature === "string" ? reqCreds.NotificationSignature : null;

	// Body holds exactly one *Notification element whose name is the
	// event type — e.g. <ItemSoldNotification>...</ItemSoldNotification>.
	// Find it.
	const notifKey = Object.keys(body).find((k) => k.endsWith("Notification") || k.endsWith("Response"));
	if (!notifKey) return null;
	const notif = body[notifKey] as Record<string, unknown>;
	const eventType =
		(typeof notif.NotificationEventName === "string" && notif.NotificationEventName) ||
		notifKey.replace(/Notification$/, "").replace(/Response$/, "");
	const timestamp = typeof notif.Timestamp === "string" ? notif.Timestamp : "";
	const recipientUserId = typeof notif.RecipientUserID === "string" ? notif.RecipientUserID : null;

	const transaction = (notif.Transaction ?? {}) as Record<string, unknown>;
	const item = (notif.Item ?? transaction.Item ?? {}) as Record<string, unknown>;
	const transactionId = stringFrom(transaction.TransactionID);
	const itemId = stringFrom(item.ItemID);

	// Sale price lives in Transaction.AmountPaid for paid sales,
	// Transaction.TransactionPrice for unpaid ones, or Item.SellingStatus
	// for non-transaction events.
	const sellingStatus = (item.SellingStatus ?? {}) as Record<string, unknown>;
	const priceNode =
		(transaction.AmountPaid as Record<string, unknown> | undefined) ??
		(transaction.TransactionPrice as Record<string, unknown> | undefined) ??
		(sellingStatus.CurrentPrice as Record<string, unknown> | undefined);
	const { amountCents, currency } = extractMoney(priceNode);

	return {
		eventType,
		timestamp,
		signature,
		recipientUserId,
		transactionId,
		itemId,
		amountCents,
		currency,
		raw: parsed,
	};
}

/**
 * Verify NotificationSignature = Base64(MD5(Timestamp + DevID + AppID + CertID)).
 * Returns false (not throw) when env is missing — caller decides what to
 * do with a failed verify (we still log the row, just with
 * signature_valid=false).
 */
export function verifySignature(notif: { timestamp: string; signature: string | null }): boolean {
	if (!notif.signature || !notif.timestamp) return false;
	if (!config.EBAY_DEV_ID || !config.EBAY_CLIENT_ID || !config.EBAY_CLIENT_SECRET) return false;
	const payload = `${notif.timestamp}${config.EBAY_DEV_ID}${config.EBAY_CLIENT_ID}${config.EBAY_CLIENT_SECRET}`;
	const expected = createHash("md5").update(payload).digest("base64");
	return expected === notif.signature;
}

/** sha256 of raw XML body — used as marketplace_notifications.dedupe_key. */
export function dedupeKey(rawBody: string): string {
	return createHash("sha256").update(rawBody).digest("hex");
}

// ─── internals ──────────────────────────────────────────────────────

function buildSetPrefsBody(callbackUrl: string): string {
	const enables = TRACKED_EVENTS.map(
		(ev) =>
			`\t\t<NotificationEnable>\n\t\t\t<EventType>${ev}</EventType>\n\t\t\t<EventEnable>Enable</EventEnable>\n\t\t</NotificationEnable>`,
	).join("\n");
	return `<?xml version="1.0" encoding="utf-8"?>
<SetNotificationPreferencesRequest xmlns="urn:ebay:apis:eBLBaseComponents">
	<ApplicationDeliveryPreferences>
		<ApplicationURL>${escapeXml(callbackUrl)}</ApplicationURL>
		<ApplicationEnable>Enable</ApplicationEnable>
		<DeviceType>Platform</DeviceType>
	</ApplicationDeliveryPreferences>
	<UserDeliveryPreferenceArray>
${enables}
	</UserDeliveryPreferenceArray>
</SetNotificationPreferencesRequest>`;
}

async function tradingCall(callName: string, accessToken: string, body: string): Promise<string> {
	const res = await fetch(TRADING_ENDPOINT, {
		method: "POST",
		headers: {
			"X-EBAY-API-CALL-NAME": callName,
			"X-EBAY-API-COMPATIBILITY-LEVEL": COMPAT_LEVEL,
			"X-EBAY-API-SITEID": "0", // 0 = US
			"X-EBAY-API-IAF-TOKEN": accessToken,
			"Content-Type": "text/xml",
		},
		body,
	});
	const text = await res.text();
	if (!res.ok) throw new Error(`Trading ${callName} ${res.status}: ${text.slice(0, 500)}`);
	return text;
}

function parseAck(xml: string): SetPrefsResult {
	const parsed = xmlParser.parse(xml) as Record<string, unknown>;
	const root = (parsed.SetNotificationPreferencesResponse ??
		parsed.GetNotificationPreferencesResponse ??
		{}) as Record<string, unknown>;
	const ack = (root.Ack as SetPrefsResult["ack"]) ?? "Failure";
	const errs = arrayify(root.Errors).map((e) => ({
		code: stringFrom(e.ErrorCode) ?? "",
		message: stringFrom(e.LongMessage) ?? stringFrom(e.ShortMessage) ?? "",
		severity: stringFrom(e.SeverityCode) ?? "",
	}));
	return { ack, errors: errs, raw: parsed };
}

function arrayify(v: unknown): Array<Record<string, unknown>> {
	if (v == null) return [];
	if (Array.isArray(v)) return v as Array<Record<string, unknown>>;
	return [v as Record<string, unknown>];
}

function stringFrom(v: unknown): string | null {
	if (v == null) return null;
	if (typeof v === "string") return v;
	if (typeof v === "number" || typeof v === "bigint") return String(v);
	return null;
}

function extractMoney(node: Record<string, unknown> | undefined): {
	amountCents: number | null;
	currency: string | null;
} {
	if (!node) return { amountCents: null, currency: null };
	// fast-xml-parser puts attribute @currencyID alongside #text. With
	// parseTagValue: true the bare value lives under "#text" when there
	// are attrs, or as the value itself when there aren't.
	const valueRaw =
		typeof node["#text"] === "number" || typeof node["#text"] === "string"
			? node["#text"]
			: typeof node === "number" || typeof node === "string"
				? node
				: null;
	const num = typeof valueRaw === "number" ? valueRaw : valueRaw ? Number(valueRaw) : NaN;
	if (!Number.isFinite(num)) return { amountCents: null, currency: null };
	const currency = typeof node["@_currencyID"] === "string" ? (node["@_currencyID"] as string) : null;
	return { amountCents: Math.round(num * 100), currency };
}

function escapeXml(s: string): string {
	return s.replace(/[<>&'"]/g, (c) => {
		switch (c) {
			case "<":
				return "&lt;";
			case ">":
				return "&gt;";
			case "&":
				return "&amp;";
			case "'":
				return "&apos;";
			case '"':
				return "&quot;";
			default:
				return c;
		}
	});
}
