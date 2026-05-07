/**
 * Smartphones — eBay Browse REST categoryId 9355.
 * Universal-across-brands: iPhone / Samsung Galaxy / Pixel / OnePlus all
 * follow the same axes — capacity, color, carrier (locked vs unlocked),
 * model line + generation. Same noise too — sellers consistently miscode
 * chipset / network / battery aspects.
 */

export const SMARTPHONES_VERIFY_OVERLAY = `═══ SMARTPHONES ═══
Variant axes that MUST match: capacity, color, model line, generation, carrier-lock state.

Aspect noise to IGNORE when title is clear (these aspects are unreliable on phone listings, regardless of brand):
- Network / Carrier aspect (Spectrum, Verizon, AT&T, T-Mobile) on titles that say "Unlocked" — trust the title.
- Chipset Model / Processor aspect on listings whose title clearly names the model — sellers copy-paste wrong specs.
- Battery Health % on brand-new sealed listings.

Re-flashed device scam pattern — REJECT regardless of brand:
- "TikTok", "CapCut", or "installed" in the title (re-flashed device sold as new).
- Multi-capacity title ("256GB 512GB 1TB" together) — bundle / wrong product offering.

Color discipline: when the candidate's color name is implausible for the model line (i.e. seller miscoded the candidate itself), treat candidate's color as UNDETERMINED and accept any of the model line's actual colors that the item names.`;
