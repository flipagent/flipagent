/**
 * Re-export of the shared legal-version constants from `@flipagent/types`.
 * Kept as a thin alias so existing api imports (`./legal-versions.js`)
 * keep working; the actual values live in `packages/types/src/legal.ts`
 * where both the api and the docs frontend can reach them, eliminating
 * the manual sync between TERMS_VERSION on the server vs the client.
 */

export { EBAY_CONNECT_DISCLAIMER_VERSION, PENDING_CONSENT_KEY, TERMS_VERSION } from "@flipagent/types";
