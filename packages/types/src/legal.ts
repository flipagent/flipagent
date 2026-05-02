/**
 * Legal-document version constants — the single source of truth for
 * clickwrap acceptance versioning. Both the api (consent persistence,
 * acceptance-endpoint validation) and the docs frontend (signup
 * checkbox, dashboard re-consent gate, eBay-connect JIT modal) import
 * from here so a version bump only happens in one file.
 *
 * Bump in lockstep with the corresponding /legal page's `Last updated`
 * date. The api rejects acceptance posts at any other value with a 400.
 */

export const TERMS_VERSION = "2026-05-01";

/**
 * eBay-connect JIT disclosure version — independent of TERMS_VERSION
 * because the connect disclosure (scopes, 18-month refresh, disconnect
 * limits) can change without retriggering global Terms re-acceptance.
 */
export const EBAY_CONNECT_DISCLAIMER_VERSION = "2026-05-01";

/**
 * Shared client+server localStorage key for the OAuth-roundtrip
 * pending-consent stash. The signup form writes here before triggering
 * a social-OAuth redirect; the dashboard's first /v1/me read replays
 * the stash via /v1/me/terms-acceptance once a session lands.
 */
export const PENDING_CONSENT_KEY = "flipagent.pendingTermsConsent";
