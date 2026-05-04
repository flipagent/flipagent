/**
 * Auto-recharge widget. One job: configure the threshold-driven
 * auto-recharge. When `creditsRemaining` drops below the threshold,
 * the api fires an off-session PaymentIntent against the saved card.
 *
 * Layout — heading + switch on top, threshold input revealed only when
 * the switch is on. No top-up amount picker (server applies a tier
 * default: Hobby 5k / Standard 25k / Growth 100k).
 *
 * Free-tier users see the same heading + switch (disabled) + a
 * one-line "Subscribe to enable" hint. The threshold field stays
 * hidden because it's never editable from a free tier.
 */

import type {
	BillingAutoRechargeConfig,
	BillingAutoRechargeUpdateRequest,
	BillingTopUpQuotesResponse,
} from "@flipagent/types";
import * as RxSwitch from "@radix-ui/react-switch";
import * as RxTooltip from "@radix-ui/react-tooltip";
import { useEffect, useState } from "react";
import { apiFetch } from "../../lib/authClient";
import "./BillingTopUp.css";

type Tier = "free" | "hobby" | "standard" | "growth";

interface Props {
	tier: Tier;
	onError: (message: string | null) => void;
	/** Re-fetch the parent profile after a config change. */
	onChanged?: () => void;
}

export function BillingTopUp({ tier, onError, onChanged }: Props) {
	const isFree = tier === "free";

	const [config, setConfig] = useState<BillingAutoRechargeConfig | null>(null);
	const [topUpDisplay, setTopUpDisplay] = useState<string | null>(null);
	const [loading, setLoading] = useState(true);
	const [savingConfig, setSavingConfig] = useState(false);

	const [enabled, setEnabled] = useState(false);
	const [thresholdInput, setThresholdInput] = useState("1000");

	useEffect(() => {
		let alive = true;
		(async () => {
			try {
				// /quote 403s on free; skip it there. Auto-recharge config
				// works on every tier (returns the off-by-default shape
				// for free).
				const [c, q] = await Promise.all([
					apiFetch<BillingAutoRechargeConfig>("/v1/billing/auto-recharge"),
					isFree
						? Promise.resolve(null)
						: apiFetch<BillingTopUpQuotesResponse>("/v1/billing/quote").catch(() => null),
				]);
				if (!alive) return;
				setConfig(c);
				setEnabled(c.enabled);
				if (c.thresholdCredits) setThresholdInput(String(c.thresholdCredits));
				if (q && c.topUpCredits) {
					const match = q.quotes.find((x) => x.credits === c.topUpCredits);
					if (match) setTopUpDisplay(`${c.topUpCredits.toLocaleString()} credits (${match.priceDisplay})`);
				}
			} catch (err) {
				if (alive) onError(err instanceof Error ? err.message : String(err));
			} finally {
				if (alive) setLoading(false);
			}
		})();
		return () => {
			alive = false;
		};
	}, [isFree, onError]);

	async function saveConfig(nextEnabled: boolean) {
		// Free can't toggle on — switch is disabled in the JSX, but the
		// guard here keeps the function honest if it's ever called.
		if (isFree) return;
		setSavingConfig(true);
		onError(null);
		try {
			const threshold = Number(thresholdInput);
			const body: BillingAutoRechargeUpdateRequest = nextEnabled
				? { enabled: true, thresholdCredits: threshold }
				: { enabled: false };
			const updated = await apiFetch<BillingAutoRechargeConfig>("/v1/billing/auto-recharge", {
				method: "PUT",
				body: JSON.stringify(body),
			});
			setConfig(updated);
			setEnabled(updated.enabled);
			onChanged?.();
		} catch (err) {
			onError(err instanceof Error ? err.message : String(err));
		} finally {
			setSavingConfig(false);
		}
	}

	if (loading) {
		return (
			<div className="dash-card">
				<div className="dash-card-eyebrow">Auto-recharge</div>
				<p className="topup-empty">Loading…</p>
			</div>
		);
	}

	const switchDisabled = isFree || savingConfig;
	// Same friendly description for everyone — the "you can't enable
	// this yet" signal lives in the tooltip on the disabled switch,
	// not in the body copy. Keeps the card welcoming on free.
	const helpText =
		topUpDisplay && enabled
			? `Top up ${topUpDisplay} automatically when your balance gets low.`
			: "Top up your credits automatically when your balance gets low.";

	return (
		<div className="dash-card">
			<div className="dash-card-eyebrow">Auto-recharge</div>

			<div className="dash-card-row">
				<div className="dash-card-row-text">
					<h3>Enable Auto Recharge</h3>
					<p>{helpText}</p>
				</div>
				<RxTooltip.Provider delayDuration={150}>
					<RxTooltip.Root>
						{/* Wrap the switch in a span trigger — Radix Tooltip
						    can't surface pointer events on a disabled
						    <button>, so the span carries the hover and the
						    inner switch handles the (no-op) interaction. */}
						<RxTooltip.Trigger asChild>
							<span className="topup-switch-wrap">
								<RxSwitch.Root
									className="topup-switch"
									checked={enabled}
									onCheckedChange={(next) => {
										setEnabled(next);
										void saveConfig(next);
									}}
									disabled={switchDisabled}
								>
									<RxSwitch.Thumb className="topup-switch-thumb" />
								</RxSwitch.Root>
							</span>
						</RxTooltip.Trigger>
						{isFree && (
							<RxTooltip.Portal>
								<RxTooltip.Content side="left" sideOffset={8} className="ui-info-tooltip">
									Subscribe to Hobby or higher to enable.
									<RxTooltip.Arrow className="ui-info-tooltip-arrow" />
								</RxTooltip.Content>
							</RxTooltip.Portal>
						)}
					</RxTooltip.Root>
				</RxTooltip.Provider>
			</div>

			{enabled && !isFree && (
				<div className="topup-field">
					<label htmlFor="topup-threshold" className="topup-field-label">
						Trigger threshold
					</label>
					<div className="topup-field-row">
						<input
							id="topup-threshold"
							type="number"
							min={100}
							max={50_000}
							step={100}
							value={thresholdInput}
							onChange={(e) => setThresholdInput(e.target.value)}
							disabled={savingConfig}
						/>
						<span className="topup-field-suffix">credits</span>
						<button
							type="button"
							className="dash-btn"
							onClick={() => saveConfig(true)}
							disabled={savingConfig}
						>
							{savingConfig ? "Saving…" : "Save"}
						</button>
					</div>
				</div>
			)}

			{config?.lastRechargedAt && enabled && !isFree && (
				<p className="topup-last">
					Last auto-recharged {new Date(config.lastRechargedAt).toLocaleString()}
				</p>
			)}
		</div>
	);
}
