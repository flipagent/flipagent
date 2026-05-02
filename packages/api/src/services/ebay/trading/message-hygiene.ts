/**
 * Off-eBay contact-info filter for outbound buyer/seller messages.
 *
 * eBay's "Offering to buy or sell outside of eBay" policy prohibits
 * surfacing email addresses, phone numbers, or external URLs through
 * the eBay messaging system. flipagent's AUP repeats the prohibition.
 * The filter here is the server-side guard that catches accidental or
 * automated leaks before they reach Trading API's AddMemberMessageRTQ.
 *
 * Behaviour:
 *   - Detects email addresses (RFC-5322-lite), phone numbers (10+ digit
 *     groupings, common separators), and non-eBay URLs.
 *   - Returns a redacted message body + a list of what was redacted.
 *   - Caller decides whether to (a) silently ship the redacted version
 *     or (b) reject the request with a 422 + the redaction list. The
 *     route handler picks (b) by default so the user knows their copy
 *     was scrubbed and can edit before retry.
 */

const EMAIL_RE = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g;
// Phone numbers: international/US formats with spaces, dashes, dots, or
// parentheses. Avoid matching prices or order IDs by requiring at least
// 10 digits total across the candidate.
const PHONE_RE = /(?:\+?\d[\d.\s()-]{9,}\d)/g;
// URLs: capture http(s)://* and bare-domain forms. Whitelist eBay
// hostnames after match because eBay's own system links (ebay.com/itm/…,
// ebay.com/mesg/…) are legitimate.
const URL_RE = /\bhttps?:\/\/[^\s<>"']+|\b(?:[a-z0-9-]+\.)+(?:com|net|org|io|co|uk|de|fr|jp|kr|cn|ru)\b[^\s<>"']*/gi;

const EBAY_HOST_RE = /(?:^|\.)ebay\.[a-z.]+$/i;

export interface MessageHygieneResult {
	cleanBody: string;
	redactions: Array<{ kind: "email" | "phone" | "url"; original: string }>;
}

function isEbayUrl(candidate: string): boolean {
	try {
		const url = new URL(candidate.startsWith("http") ? candidate : `https://${candidate}`);
		return EBAY_HOST_RE.test(url.hostname);
	} catch {
		return false;
	}
}

export function scrubMessageBody(input: string): MessageHygieneResult {
	const redactions: MessageHygieneResult["redactions"] = [];
	let out = input;
	out = out.replace(EMAIL_RE, (m) => {
		redactions.push({ kind: "email", original: m });
		return "[email removed]";
	});
	out = out.replace(PHONE_RE, (m) => {
		// Trim trailing punctuation that the loose PHONE_RE may have grabbed.
		const trimmed = m.replace(/[.,;]+$/, "");
		redactions.push({ kind: "phone", original: trimmed });
		return "[phone removed]";
	});
	out = out.replace(URL_RE, (m) => {
		if (isEbayUrl(m)) return m;
		redactions.push({ kind: "url", original: m });
		return "[link removed]";
	});
	return { cleanBody: out, redactions };
}
