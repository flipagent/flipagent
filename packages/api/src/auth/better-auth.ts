/**
 * Better-Auth singleton. Handles session cookies, email+password sign in,
 * and social OAuth (GitHub always; Google when env is set).
 *
 * The handler is mounted at /api/auth/* in app.ts; the singleton is null
 * when GITHUB_CLIENT_ID/SECRET/BETTER_AUTH_SECRET are unset, so /api/auth/*
 * and /v1/me/* return 503 in that case (matches the eBay/Stripe opt-in
 * pattern).
 */

import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { eq } from "drizzle-orm";
import { config, isAdminEmail, isAuthConfigured, isEmailConfigured } from "../config.js";
import { db } from "../db/client.js";
import { account, session, user, verification } from "../db/schema.js";
import { clientIpFromRequest } from "../utils/client-ip.js";
import { TERMS_VERSION } from "./legal-versions.js";

function createAuth() {
	const socialProviders: Record<string, { clientId: string; clientSecret: string }> = {
		github: {
			clientId: config.GITHUB_CLIENT_ID!,
			clientSecret: config.GITHUB_CLIENT_SECRET!,
		},
	};
	if (config.GOOGLE_CLIENT_ID && config.GOOGLE_CLIENT_SECRET) {
		socialProviders.google = {
			clientId: config.GOOGLE_CLIENT_ID,
			clientSecret: config.GOOGLE_CLIENT_SECRET,
		};
	}

	return betterAuth({
		baseURL: config.BETTER_AUTH_URL,
		secret: config.BETTER_AUTH_SECRET!,
		database: drizzleAdapter(db, {
			provider: "pg",
			schema: { user, session, account, verification },
		}),
		// Email + password — uses the existing `account.password` column.
		// `sendResetPassword` is wired through Resend (see `./email.ts`); when
		// RESEND_API_KEY is unset the helper throws "email_not_configured" and
		// the /forget-password endpoint returns a 500 the UI surfaces.
		// `requireEmailVerification` gates sign-in: unverified accounts get a
		// 403 EMAIL_NOT_VERIFIED with a fresh email re-sent (sendOnSignIn). On
		// instances without Resend wired we fall back to the open flow so the
		// system stays usable; the dashboard banner still nags.
		emailAndPassword: {
			enabled: true,
			autoSignIn: true,
			requireEmailVerification: isEmailConfigured(),
			minPasswordLength: 8,
			sendResetPassword: async ({ user, url }) => {
				const { sendPasswordResetEmail } = await import("./email.js");
				await sendPasswordResetEmail({
					to: user.email,
					name: (user as { name?: string | null }).name ?? null,
					resetUrl: url,
				});
			},
		},
		// Email verification — sent at sign-up and re-sent on any sign-in
		// attempt that hits the verification gate. The callback is always
		// present so a manual `/api/auth/send-verification-email` still
		// surfaces the "email_not_configured" error for the UI to handle if
		// it ever fires on an unconfigured instance.
		emailVerification: {
			sendOnSignUp: isEmailConfigured(),
			sendOnSignIn: isEmailConfigured(),
			autoSignInAfterVerification: true,
			sendVerificationEmail: async ({ user, url }) => {
				const { sendVerificationEmail } = await import("./email.js");
				await sendVerificationEmail({
					to: user.email,
					name: (user as { name?: string | null }).name ?? null,
					verifyUrl: url,
				});
			},
		},
		socialProviders,
		user: {
			additionalFields: {
				tier: { type: "string", defaultValue: "free", input: false },
				role: { type: "string", defaultValue: "user", input: false },
				stripeCustomerId: { type: "string", required: false, input: false },
				stripeSubscriptionId: { type: "string", required: false, input: false },
				subscriptionStatus: { type: "string", required: false, input: false },
				/**
				 * Clickwrap consent. The signup form posts the version of the
				 * Terms the user just ticked the checkbox for. The after-hook
				 * (below) folds it into termsAcceptedAt + termsAcceptedIp.
				 * Social-OAuth users land here without a value (the OAuth
				 * provider doesn't carry our checkbox); the dashboard
				 * surfaces a re-consent modal that POSTs /v1/me/terms-acceptance.
				 */
				termsVersion: { type: "string", required: false, input: true },
				termsAcceptedAt: { type: "date", required: false, input: false },
				termsAcceptedIp: { type: "string", required: false, input: false },
			},
		},
		// First-time sign-up (any provider) gets a "default" free-tier API key
		// auto-issued, so the dashboard's "Connect eBay" button is enabled
		// immediately without forcing the user to click "New key" first. The
		// plaintext is NOT shown — they can issue a named key any time and
		// will see the plaintext then; the auto-issued key just gives them a
		// usable id to start the eBay handshake against.
		databaseHooks: {
			user: {
				create: {
					after: async (newUser, ctx) => {
						const userId = (newUser as { id?: string }).id;
						try {
							const { issueKey } = await import("./keys.js");
							await issueKey({
								tier: "free",
								name: "default",
								ownerEmail: newUser.email,
								userId,
							});
						} catch (err) {
							// Best-effort — never break sign-up on this.
							console.error("[default-key] failed for", newUser.email, err);
						}
						// Auto-promote ADMIN_EMAILS members on first sign-up so the
						// first admin doesn't need a SQL UPDATE to bootstrap.
						if (userId && isAdminEmail(newUser.email)) {
							try {
								await db.update(user).set({ role: "admin" }).where(eq(user.id, userId));
							} catch (err) {
								console.error("[admin-promote] failed for", newUser.email, err);
							}
						}
						// Clickwrap consent — record only when the signup form
						// actually carried a `termsVersion`, which means the
						// email/password form's checkbox was ticked. Social-
						// OAuth signups don't get the field; the dashboard
						// re-consent gate captures them post-sign-in.
						const submittedVersion = (newUser as { termsVersion?: string | null }).termsVersion;
						if (userId && submittedVersion === TERMS_VERSION) {
							try {
								const ip = clientIpFromRequest(ctx?.request);
								await db
									.update(user)
									.set({
										termsAcceptedAt: new Date(),
										termsVersion: submittedVersion,
										termsAcceptedIp: ip,
									})
									.where(eq(user.id, userId));
							} catch (err) {
								console.error("[terms-consent] persist failed for", newUser.email, err);
							}
						}
					},
				},
			},
		},
		// The dashboard at apps/docs runs on a different origin (e.g. flipagent.dev),
		// so Better-Auth needs the trusted-origin treatment for cross-site cookies.
		trustedOrigins: [config.APP_URL],
		advanced: {
			// `secure` is keyed off the actual scheme of BETTER_AUTH_URL, not
			// NODE_ENV — dev tunnels (api-dev.flipagent.dev) serve over HTTPS
			// even with NODE_ENV=development, and a Lax cookie without the
			// Secure flag in an HTTPS cross-subdomain redirect chain gets
			// dropped by the browser → state_mismatch on the OAuth callback.
			defaultCookieAttributes: {
				sameSite: "lax",
				secure: config.BETTER_AUTH_URL.startsWith("https://"),
			},
		},
	});
}

export type BetterAuthInstance = ReturnType<typeof createAuth>;

let initialised = false;
let cached: BetterAuthInstance | null = null;

export function getAuth(): BetterAuthInstance | null {
	if (initialised) return cached;
	initialised = true;
	if (!isAuthConfigured()) {
		cached = null;
		return null;
	}
	cached = createAuth();
	return cached;
}
