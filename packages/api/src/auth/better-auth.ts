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
		emailAndPassword: {
			enabled: true,
			autoSignIn: true,
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
		// Email verification — only auto-sent at sign-up when Resend is wired
		// (so an unconfigured instance doesn't fail every sign-up on the throw
		// from `sendVerificationEmail`). The callback itself is always present
		// so a manual `/api/auth/send-verification-email` still surfaces the
		// "email_not_configured" error for the UI to handle if it ever fires.
		emailVerification: {
			sendOnSignUp: isEmailConfigured(),
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
					after: async (newUser) => {
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
					},
				},
			},
		},
		// The dashboard at apps/docs runs on a different origin (e.g. flipagent.dev),
		// so Better-Auth needs the trusted-origin treatment for cross-site cookies.
		trustedOrigins: [config.APP_URL],
		advanced: {
			defaultCookieAttributes: { sameSite: "lax", secure: config.NODE_ENV === "production" },
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
