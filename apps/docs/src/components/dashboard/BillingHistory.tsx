/**
 * Billing History card. Lists the user's Stripe invoices (subscription
 * bills) and standalone charges (auto-recharge top-ups), newest-first,
 * with a download link per row. Mirrors the OpenAI / Anthropic Console
 * "Billing History" pattern: minimal table, "No invoices found." empty
 * state, no editable controls.
 *
 * Renders nothing (returns null) when Stripe isn't configured on this
 * instance — self-host without billing shouldn't see a billing card.
 */

import type { BillingTransaction, BillingHistoryResponse } from "@flipagent/types";
import { useEffect, useState } from "react";
import { apiFetch } from "../../lib/authClient";
import "./BillingHistory.css";

interface Props {
	stripeEnabled: boolean;
	onError: (message: string | null) => void;
}

export function BillingHistory({ stripeEnabled, onError }: Props) {
	const [rows, setRows] = useState<BillingTransaction[] | null>(null);
	const [loading, setLoading] = useState(true);

	useEffect(() => {
		if (!stripeEnabled) {
			setLoading(false);
			return;
		}
		let alive = true;
		(async () => {
			try {
				const res = await apiFetch<BillingHistoryResponse>("/v1/billing/invoices");
				if (alive) setRows(res.transactions);
			} catch (err) {
				if (alive) onError(err instanceof Error ? err.message : String(err));
			} finally {
				if (alive) setLoading(false);
			}
		})();
		return () => {
			alive = false;
		};
	}, [stripeEnabled, onError]);

	if (!stripeEnabled) return null;

	return (
		<div className="dash-card billing-history" id="billing-history">
			<div className="dash-card-eyebrow">Billing History</div>

			<div className="billing-history-table" role="table" aria-label="Billing history">
				<div className="billing-history-head" role="row">
					<span role="columnheader">Number</span>
					<span role="columnheader">Date</span>
					<span role="columnheader">Amount</span>
					<span role="columnheader">Status</span>
					<span role="columnheader">Download</span>
				</div>

				{loading && <div className="billing-history-empty">Loading…</div>}
				{!loading && rows && rows.length === 0 && (
					<div className="billing-history-empty">No invoices found.</div>
				)}
				{!loading && rows?.map((r) => (
					<div className="billing-history-row" role="row" key={r.id}>
						<span role="cell" className="billing-history-number">
							{r.number ?? (r.type === "top_up" ? "Top-up" : "—")}
						</span>
						<span role="cell">
							{new Date(r.createdAt).toLocaleDateString(undefined, {
								month: "short",
								day: "numeric",
								year: "numeric",
							})}
						</span>
						<span role="cell">{r.amountDisplay}</span>
						<span role="cell">
							<span className={`billing-history-status billing-history-status--${r.status}`}>{r.status}</span>
						</span>
						<span role="cell">
							{r.downloadUrl ? (
								<a href={r.downloadUrl} target="_blank" rel="noopener noreferrer" className="dash-link">
									Download
								</a>
							) : (
								<span className="billing-history-muted">—</span>
							)}
						</span>
					</div>
				))}
			</div>
		</div>
	);
}
