/**
 * Unified eBay-connect modal — replaces the SettingsPanel-only
 * EbayConnectConsentModal. Covers both states in one Radix dialog:
 *
 *   - not connected → consent disclosure + checkbox + "Continue to eBay"
 *     (redirects to `/v1/me/ebay/connect?ack=…`).
 *   - connected     → handle + Disconnect button + how-to-revoke-at-eBay
 *     pointer.
 *
 * Bumping the disclosure copy means bumping `EBAY_CONNECT_DISCLAIMER_VERSION`
 * in `packages/types/src/legal.ts` — same gate the api enforces (412
 * `ack_required` if the param doesn't match). The modal mounts at
 * `<ConnectionsProvider>`; consumers open it via `useConnections()`.
 */

import { EBAY_CONNECT_DISCLAIMER_VERSION } from "@flipagent/types";
import * as RxDialog from "@radix-ui/react-dialog";
import { useEffect, useState } from "react";
import { apiBase } from "../../lib/authClient";

interface EbayConnectModalProps {
	open: boolean;
	onClose: () => void;
	connected: boolean;
	ebayUserName: string | null;
	onDisconnect: () => Promise<void>;
}

export function EbayConnectModal({ open, onClose, connected, ebayUserName, onDisconnect }: EbayConnectModalProps) {
	const [agreed, setAgreed] = useState(false);
	const [busy, setBusy] = useState<"connecting" | "disconnecting" | null>(null);

	// Reset transient state whenever the modal closes so a re-open lands
	// on a fresh dialog (no stale "agreed" carry-over from prior session).
	useEffect(() => {
		if (!open) {
			setAgreed(false);
			setBusy(null);
		}
	}, [open]);

	function startConnect() {
		setBusy("connecting");
		const ack = EBAY_CONNECT_DISCLAIMER_VERSION;
		const redirect = encodeURIComponent(`${window.location.origin}/dashboard/`);
		window.location.href = `${apiBase}/v1/me/ebay/connect?ack=${ack}&redirect=${redirect}`;
	}

	async function startDisconnect() {
		setBusy("disconnecting");
		try {
			await onDisconnect();
		} finally {
			setBusy(null);
		}
	}

	return (
		<RxDialog.Root open={open} onOpenChange={(v) => !v && onClose()}>
			<RxDialog.Portal>
				<RxDialog.Overlay className="rx-dialog-overlay" />
				<RxDialog.Content className="rx-dialog-content rx-dialog-content-wide">
					<RxDialog.Title className="rx-dialog-title">
						{connected ? "eBay account" : "Connect your eBay account"}
					</RxDialog.Title>
					{connected ? (
						<>
							<RxDialog.Description className="rx-dialog-desc">
								Connected as <strong>@{ebayUserName ?? "signed in"}</strong>. Disconnecting removes the
								local token; eBay-side authorization stays until you revoke it at{" "}
								<a href="https://www.ebay.com/mye/myebay/preferences" target="_blank" rel="noreferrer">
									eBay → Account → Permissions
								</a>
								.
							</RxDialog.Description>
							<div className="rx-dialog-actions">
								<RxDialog.Close asChild>
									<button type="button" className="rx-dialog-btn">
										Close
									</button>
								</RxDialog.Close>
								<button
									type="button"
									className="rx-dialog-btn rx-dialog-btn-danger"
									onClick={startDisconnect}
									disabled={busy != null}
								>
									{busy === "disconnecting" ? "Disconnecting…" : "Disconnect"}
								</button>
							</div>
						</>
					) : (
						<>
							<RxDialog.Description className="rx-dialog-desc">
								Before redirecting you to eBay, please confirm:
							</RxDialog.Description>
							<ul className="rx-dialog-list">
								<li>
									OAuth scopes requested: <code>api_scope</code>, <code>sell.inventory</code>,{" "}
									<code>sell.fulfillment</code>, <code>sell.finances</code>, <code>sell.account</code>,{" "}
									<code>commerce.identity.readonly</code> — read + write on listings, orders, payouts,
									and policies.
								</li>
								<li>Refresh tokens are valid up to 18 months under eBay's standard issuance.</li>
								<li>
									Disconnecting at flipagent removes the token from our database. To revoke at eBay's
									end too, visit{" "}
									<a
										href="https://www.ebay.com/mye/myebay/preferences"
										target="_blank"
										rel="noreferrer"
									>
										eBay → Account → Permissions
									</a>
									.
								</li>
								<li>
									The eBay account must be yours (or one you're authorized to operate), in good
									standing, not under enforcement. Activity flipagent takes under your authorization
									counts as your activity under eBay's User Agreement.
								</li>
							</ul>
							<label className="rx-dialog-consent">
								<input
									type="checkbox"
									checked={agreed}
									onChange={(e) => setAgreed(e.target.checked)}
								/>
								<span>
									I acknowledge the items above. See full text in our{" "}
									<a href="/legal/terms/#connected-ebay-account" target="_blank" rel="noreferrer">
										Terms of Service
									</a>{" "}
									and{" "}
									<a href="/legal/aup/" target="_blank" rel="noreferrer">
										Acceptable Use Policy
									</a>
									.
								</span>
							</label>
							<div className="rx-dialog-actions">
								<RxDialog.Close asChild>
									<button type="button" className="rx-dialog-btn">
										Cancel
									</button>
								</RxDialog.Close>
								<button
									type="button"
									className="rx-dialog-btn rx-dialog-btn-primary"
									onClick={startConnect}
									disabled={!agreed || busy != null}
								>
									{busy === "connecting" ? "Redirecting…" : "Continue to eBay"}
								</button>
							</div>
						</>
					)}
				</RxDialog.Content>
			</RxDialog.Portal>
		</RxDialog.Root>
	);
}
