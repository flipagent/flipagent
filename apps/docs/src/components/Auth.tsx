/**
 * Sign in / Sign up surface. Tab toggle between Log In and Sign Up; both
 * share the same email+password form and the same Google / GitHub / SSO
 * buttons. Wired to Better-Auth via `authClient`.
 *
 * Visual structure mirrors `cmw-bordered + section.lined` from the marketing
 * site: 4 stacked sections each with a top border that spans the viewport,
 * each containing an `.auth-rail` (centered ~480px column) with vertical
 * borders. The borders intersect to form `+` marks at the rail edges.
 */

import { useEffect, useState } from "react";
import { Toaster, toast } from "sonner";
import { authClient } from "../lib/authClient";

type Tab = "login" | "signup";
type Provider = "email" | "google" | "github" | "sso" | "forgot";

const LAST_USED_KEY = "flipagent.lastAuthProvider";

export default function Auth() {
	const [tab, setTab] = useState<Tab>("login");
	const [email, setEmail] = useState("");
	const [password, setPassword] = useState("");
	const [name, setName] = useState("");
	const [pending, setPending] = useState<Provider | null>(null);
	const [lastUsed, setLastUsed] = useState<Provider | null>(null);
	// When email + password sign-up succeeds with `requireEmailVerification`
	// the API returns no session token; when sign-in is attempted on an
	// unverified account we get a 403 EMAIL_NOT_VERIFIED. Both cases swap
	// the form pane for a "check your inbox" panel keyed on this email.
	const [awaitingVerify, setAwaitingVerify] = useState<string | null>(null);

	useEffect(() => {
		try {
			const saved = localStorage.getItem(LAST_USED_KEY) as Provider | null;
			setLastUsed(saved);
		} catch {
			/* no-op */
		}

		// Post-reset / post-verify landing params. ResetPassword.tsx redirects
		// here with ?reset=ok after a successful password change; the verify
		// flow can also drop the user on /signup/ if their session has expired.
		const params = new URLSearchParams(window.location.search);
		if (params.get("reset") === "ok") {
			setTab("login");
			toast.success("Password updated. Sign in with your new password.");
			window.history.replaceState({}, "", window.location.pathname);
		} else if (params.get("verified") === "1" || params.get("verified") === "true") {
			setTab("login");
			toast.success("Email verified. Sign in to continue.");
			window.history.replaceState({}, "", window.location.pathname);
		}
	}, []);

	function rememberLastUsed(p: Provider) {
		try {
			localStorage.setItem(LAST_USED_KEY, p);
		} catch {
			/* no-op */
		}
	}

	/**
	 * Where to land the user after auth. Defaults to /dashboard/, but
	 * honours `?return=<path>` so a click on the landing playground that
	 * gated to /signup lands the visitor right back where they were after
	 * sign-in. Same-origin path-only — anything that looks like an
	 * absolute URL or doesn't start with `/` falls back to /dashboard/
	 * so a bad query string can't be turned into an open redirect.
	 */
	function postAuthDestination(): string {
		const fallback = "/dashboard/";
		try {
			const raw = new URLSearchParams(window.location.search).get("return");
			if (!raw) return fallback;
			if (!raw.startsWith("/") || raw.startsWith("//")) return fallback;
			return raw;
		} catch {
			return fallback;
		}
	}

	async function handleEmail(e: React.FormEvent) {
		e.preventDefault();
		setPending("email");
		try {
			const dest = postAuthDestination();
			const callbackURL = `${window.location.origin}${dest}`;
			let result: { data?: { token?: string | null } | null; error?: { code?: string; status?: number; message?: string } | null } | undefined;
			if (tab === "login") {
				result = await authClient.signIn.email({ email, password, callbackURL });
			} else {
				result = await authClient.signUp.email({
					email,
					password,
					name: name.trim() || email.split("@")[0],
					callbackURL,
				});
			}
			// Better-Auth's react client returns `{data, error}` rather than throwing.
			// EMAIL_NOT_VERIFIED on sign-in (403) and a null token on sign-up both
			// mean "we sent a link, finish in your inbox".
			if (isEmailNotVerified(result?.error)) {
				rememberLastUsed("email");
				setAwaitingVerify(email);
				setPending(null);
				return;
			}
			if (result?.error) {
				throw new Error(result.error.message ?? "sign_in_failed");
			}
			if (tab === "signup" && !result?.data?.token) {
				rememberLastUsed("email");
				setAwaitingVerify(email);
				setPending(null);
				return;
			}
			rememberLastUsed("email");
			window.location.href = dest;
		} catch (err) {
			if (isEmailNotVerified(err)) {
				rememberLastUsed("email");
				setAwaitingVerify(email);
				setPending(null);
				return;
			}
			toast.error(extractMessage(err));
			setPending(null);
		}
	}

	async function handleResend() {
		if (!awaitingVerify) return;
		setPending("email");
		try {
			await authClient.sendVerificationEmail({
				email: awaitingVerify,
				callbackURL: `${window.location.origin}${postAuthDestination()}`,
			});
			toast.success(`Link re-sent to ${awaitingVerify}.`);
		} catch (err) {
			toast.error(extractMessage(err));
		} finally {
			setPending(null);
		}
	}

	async function handleSocial(provider: "google" | "github") {
		// `signIn.social` triggers a window.location redirect to the OAuth
		// provider, so anything *after* the await never runs. Remember first.
		// (Trade-off: if the user cancels at the provider, we still recorded
		// it as "last used" — acceptable for a hint badge.)
		rememberLastUsed(provider);
		setPending(provider);
		try {
			await authClient.signIn.social({
				provider,
				callbackURL: `${window.location.origin}${postAuthDestination()}`,
			});
		} catch (err) {
			toast.error(extractMessage(err));
			setPending(null);
		}
	}

	function handleSso() {
		window.location.href = "mailto:hello@flipagent.dev?subject=SSO%20setup&body=Tell%20us%20about%20your%20org%20and%20IdP.";
	}

	async function handleForgot() {
		const target = email.trim();
		if (!target) {
			toast.info("Type your email above first, then click again.");
			return;
		}
		setPending("forgot");
		try {
			await authClient.requestPasswordReset({
				email: target,
				redirectTo: `${window.location.origin}/reset-password/`,
			});
			toast.success(`If ${target} has an account, a reset link is on its way (valid 60 min).`);
		} catch (err) {
			toast.error(extractMessage(err));
		} finally {
			setPending(null);
		}
	}

	const cta = tab === "login" ? "Sign in" : "Create account";

	return (
		<>
			<section className="auth-section auth-section--brand">
				<div className="auth-rail">
					<a href="/" className="auth-brand">
						<img src="/logo.png" width="80" height="24" alt="" aria-hidden="true" />
						<span>flipagent</span>
					</a>
				</div>
			</section>

			<section className="auth-section auth-section--form">
				<div className="auth-rail">
					{awaitingVerify ? (
						<div className="auth-verify">
							<div className="auth-reset-head">
								<p className="auth-reset-title">Check your inbox</p>
								<p className="auth-reset-sub">
									We sent a confirmation link to <code>{awaitingVerify}</code>. Open it to finish signing in.
								</p>
							</div>
							<button
								type="button"
								className="auth-cta"
								onClick={handleResend}
								disabled={pending !== null}
							>
								{pending === "email" ? "Sending…" : "Resend link"}
							</button>
							<div className="auth-pills">
								<button
									type="button"
									className="auth-pill"
									onClick={() => {
										setAwaitingVerify(null);
										setPassword("");
									}}
								>
									Use a different email
								</button>
							</div>
						</div>
					) : (
					<>
					<div className="auth-tabs" role="tablist">
						<button
							type="button"
							role="tab"
							aria-selected={tab === "login"}
							className={`auth-tab ${tab === "login" ? "active" : ""}`}
							onClick={() => setTab("login")}
						>
							Log In
						</button>
						<button
							type="button"
							role="tab"
							aria-selected={tab === "signup"}
							className={`auth-tab ${tab === "signup" ? "active" : ""}`}
							onClick={() => setTab("signup")}
						>
							Sign Up
						</button>
					</div>

					<form className="auth-form" onSubmit={handleEmail}>
						{tab === "signup" && (
							<label className="auth-field">
								<span>Name</span>
								<input
									type="text"
									autoComplete="name"
									value={name}
									onChange={(e) => setName(e.target.value)}
									placeholder="Your name"
									maxLength={120}
								/>
							</label>
						)}
						<label className="auth-field">
							<span>Email</span>
							<input
								type="email"
								autoComplete="email"
								value={email}
								onChange={(e) => setEmail(e.target.value)}
								placeholder="name@example.com"
								required
							/>
						</label>
						<label className="auth-field">
							<span>Password</span>
							<input
								type="password"
								autoComplete={tab === "login" ? "current-password" : "new-password"}
								value={password}
								onChange={(e) => setPassword(e.target.value)}
								placeholder="••••••••"
								required
								minLength={8}
							/>
						</label>

						<button type="submit" className="auth-cta" disabled={pending !== null}>
							{pending === "email" ? "Working…" : cta}
						</button>
					</form>

					{tab === "login" && (
						<div className="auth-pills">
							<button type="button" className="auth-pill" onClick={handleForgot}>
								Forgot your password?
							</button>
						</div>
					)}
					</>
					)}
				</div>
			</section>

			{!awaitingVerify && (
			<section className="auth-section auth-section--socials">
				<div className="auth-rail">
					<div className="auth-socials">
						<button
							type="button"
							className="auth-social"
							onClick={() => handleSocial("google")}
							disabled={pending !== null}
						>
							<span className="auth-social-icon" aria-hidden="true">
								<svg width="16" height="16" viewBox="0 0 18 18" aria-hidden="true">
									<path
										fill="#fff"
										d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.79 2.71v2.26h2.9c1.7-1.56 2.69-3.87 2.69-6.61z"
									/>
									<path
										fill="#fff"
										opacity="0.85"
										d="M9 18c2.43 0 4.47-.81 5.96-2.18l-2.9-2.26c-.81.54-1.83.86-3.06.86-2.35 0-4.34-1.59-5.05-3.72H.96v2.34A8.997 8.997 0 0 0 9 18z"
									/>
									<path
										fill="#fff"
										opacity="0.7"
										d="M3.95 10.7A5.41 5.41 0 0 1 3.66 9c0-.59.1-1.16.29-1.7V4.96H.96A8.997 8.997 0 0 0 0 9c0 1.45.35 2.83.96 4.04L3.95 10.7z"
									/>
									<path
										fill="#fff"
										opacity="0.55"
										d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58A8.99 8.99 0 0 0 9 0 8.997 8.997 0 0 0 .96 4.96L3.95 7.3C4.66 5.17 6.65 3.58 9 3.58z"
									/>
								</svg>
							</span>
							<span className="auth-social-label">Continue with Google</span>
							{lastUsed === "google" && <span className="auth-social-badge">Last used</span>}
						</button>

						<button
							type="button"
							className="auth-social"
							onClick={() => handleSocial("github")}
							disabled={pending !== null}
						>
							<span className="auth-social-icon" aria-hidden="true">
								<svg width="16" height="16" viewBox="0 0 24 24" fill="#fff" aria-hidden="true">
									<path d="M12 0c-6.6 0-12 5.4-12 12 0 5.3 3.4 9.8 8.2 11.4.6.1.8-.3.8-.6v-2c-3.3.7-4-1.6-4-1.6-.6-1.4-1.4-1.8-1.4-1.8-1.1-.7.1-.7.1-.7 1.2.1 1.9 1.2 1.9 1.2 1.1 1.9 2.9 1.4 3.6 1 .1-.8.4-1.4.8-1.7-2.7-.3-5.5-1.3-5.5-6 0-1.3.5-2.4 1.2-3.2-.1-.3-.5-1.5.1-3.2 0 0 1-.3 3.3 1.2 1-.3 2-.4 3-.4s2 .1 3 .4c2.3-1.5 3.3-1.2 3.3-1.2.6 1.7.2 2.9.1 3.2.8.8 1.2 1.9 1.2 3.2 0 4.6-2.8 5.6-5.5 6 .4.4.8 1.1.8 2.2v3.3c0 .3.2.7.8.6C20.6 21.8 24 17.3 24 12c0-6.6-5.4-12-12-12z" />
								</svg>
							</span>
							<span className="auth-social-label">Continue with GitHub</span>
							{lastUsed === "github" && <span className="auth-social-badge">Last used</span>}
						</button>

						<button type="button" className="auth-social auth-social--sso" onClick={handleSso}>
							<span className="auth-social-icon" aria-hidden="true">
								<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
									<path d="M3 21h18M5 21V7l7-4 7 4v14M9 9h2M9 13h2M9 17h2M13 9h2M13 13h2M13 17h2" />
								</svg>
							</span>
							<span className="auth-social-label">Continue with SSO</span>
						</button>
					</div>
				</div>
			</section>
			)}

			<section className="auth-section auth-section--foot">
				<div className="auth-rail">
					<div className="auth-foot">
						<a href="/legal/privacy/">Privacy Policy</a>
						<span aria-hidden="true">·</span>
						<a href="/legal/terms/">Terms of Service</a>
					</div>
				</div>
			</section>

			<Toaster position="top-right" richColors closeButton />
		</>
	);
}

/**
 * `requireEmailVerification: true` makes Better-Auth reject sign-in with a
 * 403 / `EMAIL_NOT_VERIFIED` and silently re-send the verification email.
 * Both the returned `{error}` shape and any thrown variant flow through here.
 */
function isEmailNotVerified(err: unknown): boolean {
	if (!err || typeof err !== "object") return false;
	const e = err as { code?: unknown; status?: unknown; message?: unknown };
	if (typeof e.code === "string" && e.code === "EMAIL_NOT_VERIFIED") return true;
	if (typeof e.status === "number" && e.status === 403) return true;
	if (typeof e.message === "string" && e.message.toLowerCase().includes("not verified")) return true;
	return false;
}

function extractMessage(err: unknown): string {
	if (err instanceof Error) return err.message;
	if (err && typeof err === "object" && "message" in err) return String((err as { message: unknown }).message);
	return "Something went wrong.";
}
