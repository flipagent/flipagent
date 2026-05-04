/**
 * Shared inline-SVG icon vocabulary for the extension's on-page UI.
 * One source of truth across `evaluate-chip.ts` (the floating chip on
 * /itm/) and `evaluate-srp.ts` (the per-row pill on /sch/) so both
 * surfaces read identically — same shape per state, same stroke
 * weight, same viewport.
 *
 * Conventions:
 *   - 16x16 viewBox so consumers can size via CSS without re-tuning paths
 *   - `currentColor` for stroke / fill — host's color flows through
 *   - 1.6 stroke width — lands ~1px on screen at the 12–16px display
 *     sizes both chip and SRP use, matching the dashboard playground's
 *     icon weight
 *
 * State → icon mapping (match playground SearchResult.tsx EvalButton):
 *   idle    → gauge   (Evaluate)
 *   running → spinner (replaces icon while a job is in flight)
 *   done    → eye     (View evaluation)
 *   error   → refresh (Retry)
 *   sign-in → sparkle (brand mark; signals "primary brand action")
 */

export type IconName = "sparkle" | "gauge" | "eye" | "refresh" | "signin" | "spinner";

/** SVG strings for everything except `spinner`, which is rendered as
 * a CSS-only rotating ring (no SVG). Consumers branch on icon name
 * before reaching this map. */
export const ICONS: Record<Exclude<IconName, "spinner">, string> = {
	sparkle:
		'<svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M8 0.5 L9.4 6.6 L15.5 8 L9.4 9.4 L8 15.5 L6.6 9.4 L0.5 8 L6.6 6.6 Z"/></svg>',
	gauge: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 11a5 5 0 0 1 10 0"/><path d="M8 11l2.5-2.5"/><circle cx="8" cy="11" r="0.6" fill="currentColor"/></svg>',
	eye: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 8s2.5-4.5 6-4.5S14 8 14 8s-2.5 4.5-6 4.5S2 8 2 8z"/><circle cx="8" cy="8" r="1.6"/></svg>',
	refresh:
		'<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 8a6 6 0 1 0 6-6c-1.67 0-3.27.67-4.47 1.73L2 5.33"/><path d="M2 2v3.33h3.33"/></svg>',
	/* log-in style: arrow entering a door / box */
	signin:
		'<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 2h3.5A1.5 1.5 0 0 1 14 3.5v9a1.5 1.5 0 0 1-1.5 1.5H9"/><path d="M2 8h8"/><path d="M7 5l3 3-3 3"/></svg>',
};
