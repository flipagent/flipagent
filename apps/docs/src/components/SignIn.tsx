import { useState } from "react";
import { signIn } from "../lib/authClient";
import "./SignIn.css";

export default function SignIn() {
	const [pending, setPending] = useState(false);
	const [error, setError] = useState<string | null>(null);

	async function handleGitHub() {
		setPending(true);
		setError(null);
		try {
			await signIn.social({
				provider: "github",
				callbackURL: `${window.location.origin}/dashboard/`,
			});
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
			setPending(false);
		}
	}

	return (
		<div className="signin">
			<button type="button" className="btn signin-btn" onClick={handleGitHub} disabled={pending}>
				<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
					<path d="M12 0c-6.6 0-12 5.4-12 12 0 5.3 3.4 9.8 8.2 11.4.6.1.8-.3.8-.6v-2c-3.3.7-4-1.6-4-1.6-.6-1.4-1.4-1.8-1.4-1.8-1.1-.7.1-.7.1-.7 1.2.1 1.9 1.2 1.9 1.2 1.1 1.9 2.9 1.4 3.6 1 .1-.8.4-1.4.8-1.7-2.7-.3-5.5-1.3-5.5-6 0-1.3.5-2.4 1.2-3.2-.1-.3-.5-1.5.1-3.2 0 0 1-.3 3.3 1.2 1-.3 2-.4 3-.4s2 .1 3 .4c2.3-1.5 3.3-1.2 3.3-1.2.6 1.7.2 2.9.1 3.2.8.8 1.2 1.9 1.2 3.2 0 4.6-2.8 5.6-5.5 6 .4.4.8 1.1.8 2.2v3.3c0 .3.2.7.8.6C20.6 21.8 24 17.3 24 12c0-6.6-5.4-12-12-12z" />
				</svg>
				{pending ? "Redirecting…" : "Continue with GitHub"}
			</button>
			<p className="signin-note">
				By continuing you agree to flipagent's terms. We read your public profile and email — nothing else.
			</p>
			{error && <p className="signin-error">{error}</p>}
		</div>
	);
}
