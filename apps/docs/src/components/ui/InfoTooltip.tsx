/**
 * InfoTooltip — shadcn-style info hint built on @radix-ui/react-tooltip.
 *
 * Renders a small ⓘ trigger that opens a styled popup on hover/focus.
 * Provider lives at module scope so multiple tooltips share one
 * delay-duration timer (matches the shadcn/Radix recommended setup).
 *
 * Usage:
 *   <InfoTooltip>Explanation text here.</InfoTooltip>
 *
 * The styled popup classes (`ui-info-tooltip`, `ui-info-tooltip-trigger`)
 * live in `ui.css` so the visual weight (size, contrast, shadow) is
 * tunable without touching component code.
 */

import * as RxTooltip from "@radix-ui/react-tooltip";

export function InfoTooltip({ children }: { children: React.ReactNode }) {
	return (
		<RxTooltip.Provider delayDuration={150}>
			<RxTooltip.Root>
				<RxTooltip.Trigger asChild>
					<button
						type="button"
						className="ui-info-tooltip-trigger"
						aria-label="More info"
					>
						<InfoIcon />
					</button>
				</RxTooltip.Trigger>
				<RxTooltip.Portal>
					<RxTooltip.Content
						side="top"
						align="center"
						sideOffset={6}
						className="ui-info-tooltip"
					>
						{children}
						<RxTooltip.Arrow className="ui-info-tooltip-arrow" />
					</RxTooltip.Content>
				</RxTooltip.Portal>
			</RxTooltip.Root>
		</RxTooltip.Provider>
	);
}

/** Inline SVG so the icon size + stroke weight match the surrounding
 * type without depending on a font glyph. 14×14 with a 1.6 stroke
 * lands visually consistent next to 13–15px labels. */
function InfoIcon() {
	return (
		<svg
			width="14"
			height="14"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth="1.8"
			strokeLinecap="round"
			strokeLinejoin="round"
			aria-hidden="true"
		>
			<circle cx="12" cy="12" r="9" />
			<line x1="12" y1="11" x2="12" y2="16.5" />
			<circle cx="12" cy="8" r="0.6" fill="currentColor" stroke="none" />
		</svg>
	);
}
