/**
 * Re-consent gate. Renders as a non-dismissable modal overlay when the
 * user's recorded `termsAcceptedVersion` doesn't match the
 * `currentTermsVersion` from /v1/me. Catches three cases:
 *  - social-OAuth signups whose Better-Auth hook didn't carry the
 *    checkbox state (the OAuth provider doesn't relay our consent UI).
 *  - existing users whose acceptance pre-dates a Terms bump.
 *  - email-signup users whose consent persistence raced or failed.
 *
 * The modal blocks dashboard interaction until acceptance lands. We
 * intentionally don't offer a "cancel" — the user can sign out via the
 * top bar if they refuse the new terms.
 */

import { PENDING_CONSENT_KEY } from "@flipagent/types";
import { useState } from "react";
import { toast } from "sonner";
import { apiFetch } from "../../lib/authClient";
import { ConsentCheckbox } from "../legal/ConsentCheckbox";

interface TermsConsentModalProps {
	version: string;
	accepted: string | null;
	onAccepted: () => Promise<void>;
}

export function TermsConsentModal({ version, accepted, onAccepted }: TermsConsentModalProps) {
	const [agreed, setAgreed] = useState(false);
	const [pending, setPending] = useState(false);

	async function submit() {
		if (!agreed) return;
		setPending(true);
		try {
			await apiFetch("/v1/me/terms-acceptance", {
				method: "POST",
				body: JSON.stringify({ version }),
				headers: { "Content-Type": "application/json" },
			});
			try {
				localStorage.removeItem(PENDING_CONSENT_KEY);
			} catch {
				/* no-op */
			}
			await onAccepted();
		} catch (err) {
			toast.error(err instanceof Error ? err.message : String(err));
		} finally {
			setPending(false);
		}
	}

	return (
		<div className="dash-modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="terms-modal-title">
			<div className="dash-modal">
				<div className="dash-modal-head">
					<h2 id="terms-modal-title">{accepted ? "Terms updated" : "One more step"}</h2>
				</div>
				<div className="dash-modal-body">
					<p style={{ margin: 0, fontSize: 13, lineHeight: 1.5, color: "var(--text-2)" }}>
						{accepted
							? `Our Terms of Service, Privacy Policy, and Acceptable Use Policy were updated on ${version}. Please review and accept to continue.`
							: "Before using flipagent, please review and accept our Terms of Service, Privacy Policy, and Acceptable Use Policy."}
					</p>
					<ConsentCheckbox
						variant="dashboard"
						inputId="terms-modal-consent"
						checked={agreed}
						onChange={setAgreed}
					/>
					<button
						type="button"
						className="dash-btn dash-btn--brand"
						onClick={submit}
						disabled={!agreed || pending}
						style={{ width: "100%" }}
					>
						{pending ? "Recording…" : "Accept and continue"}
					</button>
				</div>
			</div>
		</div>
	);
}
