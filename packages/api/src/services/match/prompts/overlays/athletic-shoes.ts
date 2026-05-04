/**
 * Athletic Shoes — eBay Browse REST categoryId 15709.
 * Universal-across-brands: Jordan, Yeezy, Dunk, Adidas, New Balance,
 * Asics — all share size + year + sub-model discipline plus heavy
 * replica risk. Multi-variation parent listings are common.
 */

export const ATHLETIC_SHOES_VERIFY_OVERLAY = `═══ ATHLETIC SHOES ═══
Variant axes that MUST match: Men's US shoe size, release year (when colorway re-released across years), sub-model (Retro / Mid / Low / SE / OG / Spizike / "What The" / etc.).

Size discipline:
- Pre-school (PS), Grade-school (GS), Toddler (TD), Women's (W) sizes are DIFFERENT products from Men's at the same numeric value. REJECT.
- Multi-size parent listings ("All Sizes", "Size 8-12", "Men & GS") confirm only when variations[] contains the candidate's exact Men's size at a comparable price tier (Rule 3 path 2).
- A title naming "Men's Size N" / "M N" / "US N" confirms.

Year discipline: the same colorway is often re-released years later (Jordan 4 Black Cat 2020 vs 2025, Dunk Panda variants, etc.) — different price tiers. If candidate names a year and item names a different year, REJECT. If item is silent on year, accept when other signals align.

Sub-model discipline: Retro / Mid / Low / SE / OG / Spizike / "What The" are distinct sub-models — REJECT cross-sub-model.

REPLICA RISK (stricter than base): title fully matches AND price < 40% of candidate's price → REJECT, "suspect price (likely replica)". Multi-size listing offering Men's sizes at one flat low price (e.g. "All Sizes $85" when adult retail is $300+) → REJECT.`;
