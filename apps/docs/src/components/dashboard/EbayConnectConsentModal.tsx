/**
 * eBay-connect JIT consent modal. Renders only while the user is acting
 * on a connect button (Settings panel "Connect eBay" CTA). The disclosure
 * mirrors the prose at /legal/terms#connected-ebay-account; bumping that
 * page must also bump `EBAY_CONNECT_DISCLAIMER_VERSION` in
 * `packages/types/src/legal.ts` (which both the api gate and this modal
 * import). The api 412s on `/v1/me/ebay/connect` unless the request
 * carries `?ack=<version>` matching that constant.
 */

interface EbayConnectConsentModalProps {
	open: boolean;
	agreed: boolean;
	onAgreedChange: (next: boolean) => void;
	onCancel: () => void;
	onConfirm: () => void;
}

export function EbayConnectConsentModal({
	open,
	agreed,
	onAgreedChange,
	onCancel,
	onConfirm,
}: EbayConnectConsentModalProps) {
	if (!open) return null;
	return (
		<div className="dash-modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="ebay-consent-title">
			<div className="dash-modal">
				<div className="dash-modal-head">
					<h2 id="ebay-consent-title">Connect your eBay account</h2>
					<button type="button" className="dash-link" onClick={onCancel}>Cancel</button>
				</div>
				<div className="dash-modal-body">
					<p style={{ margin: 0, fontSize: 13, lineHeight: 1.5, color: "var(--text-2)" }}>
						Before redirecting you to eBay, please confirm:
					</p>
					<ul style={{ margin: 0, paddingLeft: 18, fontSize: 12.5, lineHeight: 1.6, color: "var(--text-2)" }}>
						<li>flipagent will request the OAuth scopes <code>api_scope</code>, <code>sell.inventory</code>, <code>sell.fulfillment</code>, <code>sell.finances</code>, <code>sell.account</code>, and <code>commerce.identity.readonly</code> — read + write on listings, orders, payouts, and policies.</li>
						<li>Refresh tokens are valid for up to 18 months under eBay's standard issuance.</li>
						<li>Disconnecting at flipagent removes the token from our database. To revoke at eBay's end, also visit <a href="https://www.ebay.com/mye/myebay/preferences" target="_blank" rel="noreferrer" style={{ color: "var(--brand)" }}>eBay → Account → Permissions</a>.</li>
						<li>The eBay account you're about to connect must be yours (or one you're authorized to operate), in good standing, and not under an open enforcement action whose terms would be violated by automated activity. Activity flipagent takes under your authorization counts as your activity under eBay's User Agreement.</li>
					</ul>
					<label className="dash-consent" htmlFor="ebay-consent-input">
						<input
							id="ebay-consent-input"
							type="checkbox"
							checked={agreed}
							onChange={(e) => onAgreedChange(e.target.checked)}
						/>
						<span>
							I acknowledge and agree to the items above. See the full text in our{" "}
							<a href="/legal/terms/#connected-ebay-account" target="_blank" rel="noreferrer">Terms of Service</a> and{" "}
							<a href="/legal/aup/" target="_blank" rel="noreferrer">Acceptable Use Policy</a>.
						</span>
					</label>
					<button
						type="button"
						className="dash-btn dash-btn--brand"
						onClick={onConfirm}
						disabled={!agreed}
						style={{ width: "100%" }}
					>
						Acknowledge and continue to eBay
					</button>
				</div>
			</div>
		</div>
	);
}
