/**
 * Extract a best-effort client IP from a Fetch `Request` for audit
 * purposes (consent records, abuse logs). Reads the leftmost entry of
 * `x-forwarded-for` first — Azure Front Door + Container Apps both
 * terminate TLS upstream and inject XFF — falling back to `x-real-ip`
 * and finally to null when nothing is available.
 *
 * The output is descriptive, not authoritative: we don't authenticate
 * against it, so the standard caveat about XFF spoofability doesn't
 * change its evidentiary use as a "what address did the consent ping
 * come from" record.
 */

export function clientIpFromRequest(req: Request | null | undefined): string | null {
	if (!req) return null;
	const xff = req.headers.get("x-forwarded-for");
	if (xff) {
		const first = xff.split(",")[0]?.trim();
		if (first) return first;
	}
	const real = req.headers.get("x-real-ip");
	return real ? real.trim() : null;
}
