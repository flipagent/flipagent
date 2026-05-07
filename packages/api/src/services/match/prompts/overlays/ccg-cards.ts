/**
 * CCG Individual Cards — eBay Browse REST categoryId 183454.
 * Universal-across-games: Pokemon / Magic / Yu-Gi-Oh / sports cards —
 * all share grade-driven pricing, card-number identity, and grader-
 * specific trust. Browse REST surfaces grade in conditionDescriptors[].
 */

export const CCG_CARDS_VERIFY_OVERLAY = `═══ CCG INDIVIDUAL CARDS ═══
Variant axes that MUST match: card number / set, grader (PSA / BGS / CGC / SGC / HGA / TAG), numeric grade, edition (1st Edition / Unlimited / Shadowless / etc.), language / region of print.

Edition discipline:
- "1st Edition" / "1st Ed" / "OG" (collector slang for original print) ≠ "Unlimited" / "Unlim" / "later print" — different products.
- If candidate title says "1st Edition" / "OG" / nothing-explicit and item title says "Unlimited" → REJECT.
- If candidate title says "Unlimited" and item title says "1st Edition" → REJECT.
- If both silent on edition → match on other axes (cards from older sets default to whatever's stated in aspects, otherwise indeterminate).

Card identity:
- Card NUMBER is the unique product key. "#NNN", "NNN/MMM", "No. NNN" all name the same number; numeric mismatch → REJECT.
- Sellers use varied rarity descriptors for the SAME number ("Hyper Rare", "Gold Hyper Rare", "Hyper Rare Gold", "GOLD #NNN", "Illustration Rare #NNN"). Same number = same card regardless of rarity-name aliasing. Don't reject for rarity-descriptor differences when numbers match.
- Different number IDs WITHIN the same set ARE different cards — distinct rarities/SKUs. Cross-number → REJECT.
- Foreign-language prints (Chinese, Japanese, Korean, German) are different products from the English print → REJECT unless candidate explicitly is the foreign print.

Grade discipline:
- Grader matters: PSA ≠ BGS ≠ CGC ≠ SGC ≠ HGA. REJECT cross-grader.
- Numeric grade matters: 10 ≠ 9 ≠ 8 — strict. Half-grades (BGS 9.5) ≠ whole grades.
- Lesser-known grader stamps (AC, AGS, etc.) ≠ PSA / BGS — REJECT.
- Raw / ungraded ≠ slabbed.
- conditionDescriptors precedence: when both candidate and item carry conditionDescriptors with explicit Grade rows that differ → REJECT. Title-only "PSA 10" on both sides also suffices — do NOT reject for missing or inconsistent conditionDescriptors when title agrees.`;
