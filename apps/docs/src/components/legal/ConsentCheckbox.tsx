/**
 * Single source of clickwrap consent UX — checkbox + agreement copy +
 * the three legal links. Used in two places:
 *
 *   - `Auth.tsx` signup tab, gating the Sign Up + social-OAuth buttons.
 *   - `Dashboard.tsx` re-consent modal, when the user's recorded
 *     `termsAcceptedVersion` doesn't match the current `TERMS_VERSION`.
 *
 * Centralising avoids the trap where a copy edit on one surface
 * doesn't track on the other and the two click-throughs diverge —
 * which would weaken the Meyer enforceability story.
 */

interface ConsentCheckboxProps {
	checked: boolean;
	onChange: (next: boolean) => void;
	/**
	 * `auth` renders inside the auth-page surface (uses .auth-consent
	 * styling); `dashboard` renders inside the dash-modal surface
	 * (uses .dash-consent styling). The agreement copy is identical;
	 * only the surrounding container class differs to match the
	 * page chrome each surface owns.
	 */
	variant: "auth" | "dashboard";
	/** Optional id so a wrapping <label> elsewhere can target the input. */
	inputId?: string;
}

export function ConsentCheckbox({ checked, onChange, variant, inputId = "consent-terms" }: ConsentCheckboxProps) {
	const wrapperClass = variant === "auth" ? "auth-consent" : "dash-consent";
	return (
		<label className={wrapperClass} htmlFor={inputId}>
			<input
				id={inputId}
				type="checkbox"
				checked={checked}
				onChange={(e) => onChange(e.target.checked)}
			/>
			<span>
				I agree to the{" "}
				<a href="/legal/terms/" target="_blank" rel="noreferrer">Terms of Service</a>,{" "}
				<a href="/legal/privacy/" target="_blank" rel="noreferrer">Privacy Policy</a>, and{" "}
				<a href="/legal/aup/" target="_blank" rel="noreferrer">Acceptable Use Policy</a>.
				I understand flipagent acts on third-party marketplaces (including eBay)
				under credentials I provide and that I am responsible for compliance with
				those marketplaces' terms.
			</span>
		</label>
	);
}
