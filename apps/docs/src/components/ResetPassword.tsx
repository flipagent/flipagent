/**
 * Standalone reset-password surface, linked to from the email Resend sends.
 * Reads the `token` query param, takes a new password, calls Better-Auth's
 * `resetPassword`. Three terminal states:
 *
 *   - missing  → no `?token=` at all (email link malformed)
 *   - expired  → backend rejected the token (>60 min old or already used)
 *   - done     → password updated, redirecting to /signup
 */

import { useEffect, useState } from "react";
import { Toaster, toast } from "sonner";
import { authClient } from "../lib/authClient";

type Phase = "missing" | "form" | "expired" | "done";

export default function ResetPassword() {
	const [phase, setPhase] = useState<Phase>("form");
	const [token, setToken] = useState<string | null>(null);
	const [password, setPassword] = useState("");
	const [confirm, setConfirm] = useState("");
	const [pending, setPending] = useState(false);

	useEffect(() => {
		const params = new URLSearchParams(window.location.search);
		const t = params.get("token");
		if (!t) {
			setPhase("missing");
			return;
		}
		setToken(t);
	}, []);

	async function handleSubmit(e: React.FormEvent) {
		e.preventDefault();
		if (!token) return;
		if (password.length < 8) {
			toast.error("Password must be at least 8 characters.");
			return;
		}
		if (password !== confirm) {
			toast.error("Passwords don't match.");
			return;
		}
		setPending(true);
		try {
			await authClient.resetPassword({ newPassword: password, token });
			setPhase("done");
			setTimeout(() => {
				window.location.href = "/signup/?reset=ok";
			}, 1600);
		} catch (err) {
			const msg = extractMessage(err);
			if (looksLikeExpiredToken(msg, err)) {
				setPhase("expired");
			} else {
				toast.error(msg);
			}
			setPending(false);
		}
	}

	return (
		<>
			<section className="auth-section auth-section--brand">
				<div className="auth-rail">
					<a href="/" className="auth-brand">
						<img src="/logo-32.png" width="80" height="24" alt="" aria-hidden="true" />
						<span>flipagent</span>
					</a>
				</div>
			</section>

			<section className="auth-section auth-section--form">
				<div className="auth-rail">
					{phase === "done" && (
						<div className="auth-done">
							<p className="auth-done-h">Password updated.</p>
							<p className="auth-done-p">Redirecting you to sign in…</p>
						</div>
					)}

					{phase === "missing" && (
						<TerminalPanel
							title="Reset link is incomplete"
							body="The link you opened is missing its token. Request a new one and try again."
							ctaLabel="Request a new link"
							ctaHref="/signup/"
						/>
					)}

					{phase === "expired" && (
						<TerminalPanel
							title="Reset link expired"
							body="Reset links are valid for 60 minutes (or until used once). Request a new one to continue."
							ctaLabel="Request a new link"
							ctaHref="/signup/"
						/>
					)}

					{phase === "form" && (
						<form className="auth-form" onSubmit={handleSubmit}>
							<div className="auth-reset-head">
								<h2 className="auth-reset-title">Set a new password</h2>
								<p className="auth-reset-sub">At least 8 characters.</p>
							</div>
							<label className="auth-field">
								<span>New password</span>
								<input
									type="password"
									autoComplete="new-password"
									value={password}
									onChange={(e) => setPassword(e.target.value)}
									required
									minLength={8}
									placeholder="••••••••"
								/>
							</label>
							<label className="auth-field">
								<span>Confirm password</span>
								<input
									type="password"
									autoComplete="new-password"
									value={confirm}
									onChange={(e) => setConfirm(e.target.value)}
									required
									minLength={8}
									placeholder="••••••••"
								/>
							</label>
							<button type="submit" className="auth-cta" disabled={pending || !token}>
								{pending ? "Updating…" : "Update password"}
							</button>
						</form>
					)}
				</div>
			</section>

			<section className="auth-section auth-section--foot">
				<div className="auth-rail">
					<div className="auth-foot">
						<a href="/signup/">Back to sign in</a>
					</div>
				</div>
			</section>

			<Toaster position="top-right" richColors closeButton />
		</>
	);
}

interface TerminalPanelProps {
	title: string;
	body: string;
	ctaLabel: string;
	ctaHref: string;
}

function TerminalPanel({ title, body, ctaLabel, ctaHref }: TerminalPanelProps) {
	return (
		<div className="auth-terminal">
			<h2 className="auth-reset-title">{title}</h2>
			<p className="auth-terminal-body">{body}</p>
			<a href={ctaHref} className="auth-cta auth-cta-link">{ctaLabel}</a>
		</div>
	);
}

/** Heuristic: Better-Auth surfaces token errors as INVALID_TOKEN / EXPIRED_TOKEN. */
function looksLikeExpiredToken(msg: string, err: unknown): boolean {
	const lower = msg.toLowerCase();
	if (lower.includes("expired") || lower.includes("invalid token") || lower.includes("invalid_token")) {
		return true;
	}
	if (err && typeof err === "object") {
		const code = (err as { code?: string; status?: number }).code;
		const status = (err as { code?: string; status?: number }).status;
		if (code && /token|expired/i.test(code)) return true;
		if (status === 400 && /token/.test(lower)) return true;
	}
	return false;
}

function extractMessage(err: unknown): string {
	if (err instanceof Error) return err.message;
	if (err && typeof err === "object" && "message" in err) return String((err as { message: unknown }).message);
	return "Something went wrong.";
}
