/**
 * Auto-recharge widget. Configures a single target balance — when the
 * caller's `creditsRemaining` drops below the target, the api charges
 * the saved card to refill the gap (Stripe-min-bounded). One number
 * controls everything: trigger and recharge size collapse into "the
 * floor balance you want maintained".
 *
 * Layout — heading + switch on top, target input revealed only when
 * the switch is on. Free-tier users see a disabled switch + a one-line
 * "Subscribe to enable" tooltip; the target field stays hidden.
 */

import type {
	BillingAutoRechargeConfig,
	BillingAutoRechargeUpdateRequest,
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

/**
 * Per-tier `targetCredits` upper bound — must match
 * `TARGET_RANGE_BY_TIER` in `packages/api/src/auth/limits.ts`. The
 * server re-validates so the dashboard can be opportunistic about
 * showing a sensible max here.
 */
const TARGET_MAX_BY_TIER: Record<Exclude<Tier, "free">, number> = {
	hobby: 10_000,
	standard: 50_000,
	growth: 200_000,
};

const TARGET_MIN = 500;
const DEFAULT_TARGET = 1_000;

export function BillingTopUp({ tier, onError, onChanged }: Props) {
	const isFree = tier === "free";
	const targetMax = isFree ? TARGET_MAX_BY_TIER.hobby : TARGET_MAX_BY_TIER[tier];

	const [config, setConfig] = useState<BillingAutoRechargeConfig | null>(null);
	const [loading, setLoading] = useState(true);
	const [savingConfig, setSavingConfig] = useState(false);

	const [enabled, setEnabled] = useState(false);
	const [targetInput, setTargetInput] = useState(String(DEFAULT_TARGET));

	useEffect(() => {
		let alive = true;
		(async () => {
			try {
				const c = await apiFetch<BillingAutoRechargeConfig>("/v1/billing/auto-recharge");
				if (!alive) return;
				setConfig(c);
				setEnabled(c.enabled);
				if (c.targetCredits) setTargetInput(String(c.targetCredits));
			} catch (err) {
				if (alive) onError(err instanceof Error ? err.message : String(err));
			} finally {
				if (alive) setLoading(false);
			}
		})();
		return () => {
			alive = false;
		};
	}, [onError]);

	async function saveConfig(nextEnabled: boolean) {
		// Free can't toggle on — switch is disabled in the JSX, but the
		// guard here keeps the function honest if it's ever called.
		if (isFree) return;
		setSavingConfig(true);
		onError(null);
		try {
			const target = Number(targetInput);
			const body: BillingAutoRechargeUpdateRequest = nextEnabled
				? { enabled: true, targetCredits: target }
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
	const helpText = enabled
		? `We keep your balance at or above the target by topping up the saved card when it dips below.`
		: "Keep your balance topped up automatically. Set a target floor and we refill when it dips below.";

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
					<label htmlFor="topup-target" className="topup-field-label">
						Target balance
					</label>
					<div className="topup-field-row">
						<input
							id="topup-target"
							type="number"
							min={TARGET_MIN}
							max={targetMax}
							step={100}
							value={targetInput}
							onChange={(e) => setTargetInput(e.target.value)}
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
