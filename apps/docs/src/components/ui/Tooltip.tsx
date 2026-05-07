/**
 * Tooltip — generic Radix wrapper. Wrap any element with `<Tooltip
 * content={…}>` to get the same styled hover/focus popup the rest of
 * the dashboard uses (`.ui-info-tooltip` / `.ui-info-tooltip-arrow` in
 * `ui.css`). Use this in place of native `title="…"` whenever the
 * tooltip is conveying meaningful information rather than a redundant
 * accessibility label.
 *
 * The Provider is bundled in so a single `<Tooltip>` works without a
 * surrounding scaffold; multiple tooltips on the same page share the
 * Radix delay-duration timer because Provider is lightweight + safe to
 * nest (Radix dedupes internally).
 *
 * For the "ⓘ icon next to a label" pattern, use `<InfoTooltip>` —
 * it composes this primitive with the standard ⓘ trigger.
 */

import * as RxTooltip from "@radix-ui/react-tooltip";
import type { ReactNode } from "react";

interface TooltipProps {
	content: ReactNode;
	children: ReactNode;
	side?: "top" | "right" | "bottom" | "left";
	align?: "start" | "center" | "end";
	delayMs?: number;
	/** Disable the tooltip without unmounting. Useful when content is
	 *  conditionally null/empty — keeps the wrapped element stable. */
	disabled?: boolean;
}

export function Tooltip({
	content,
	children,
	side = "top",
	align = "center",
	delayMs = 150,
	disabled = false,
}: TooltipProps) {
	if (disabled || content == null || content === "") {
		return <>{children}</>;
	}
	return (
		<RxTooltip.Provider delayDuration={delayMs}>
			<RxTooltip.Root>
				<RxTooltip.Trigger asChild>{children}</RxTooltip.Trigger>
				<RxTooltip.Portal>
					<RxTooltip.Content
						side={side}
						align={align}
						sideOffset={6}
						collisionPadding={8}
						className="ui-info-tooltip"
					>
						{content}
						<RxTooltip.Arrow className="ui-info-tooltip-arrow" />
					</RxTooltip.Content>
				</RxTooltip.Portal>
			</RxTooltip.Root>
		</RxTooltip.Provider>
	);
}
