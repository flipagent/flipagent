/**
 * InfoTooltip — shadcn-style info hint. Renders a small ⓘ trigger that
 * opens the standard `<Tooltip>` popup on hover/focus.
 *
 * Usage:
 *   <InfoTooltip>Explanation text here.</InfoTooltip>
 *
 * For tooltips on existing elements (cells, pills, prices), wrap with
 * the underlying `<Tooltip content={…}>` directly — this component is
 * specifically the "ⓘ-icon next to a label" idiom.
 */

import { Tooltip } from "./Tooltip";

export function InfoTooltip({ children }: { children: React.ReactNode }) {
	return (
		<Tooltip content={children}>
			<button type="button" className="ui-info-tooltip-trigger" aria-label="More info">
				<InfoIcon />
			</button>
		</Tooltip>
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
