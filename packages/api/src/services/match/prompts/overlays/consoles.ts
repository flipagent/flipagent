/**
 * Video Game Consoles — eBay Browse REST categoryId 139973.
 * Universal-across-platforms: Switch / PlayStation / Xbox / Steam Deck —
 * all share model SKU + storage + edition discipline plus heavy bundle
 * traffic.
 */

export const CONSOLES_VERIFY_OVERLAY = `═══ VIDEO GAME CONSOLES ═══
Variant axes that MUST match: model SKU (Switch HEG-001 OLED ≠ HAC-001 base ≠ HDH-001 Lite; PS5 vs PS5 Slim vs PS5 Pro; Xbox Series S vs X), storage capacity, edition / colorway.

Bundle discipline (frequent in console listings):
- Title naming added items ("with case", "with games", "+ N games", "Bundle") → bundle, not the bare console. REJECT.
- Multi-console listings ("1 White 1 Black", "x2", "two consoles") are LOTS. REJECT.
- Description mentioning "includes screen protector" or "with charger" is NOT a bundle — those are standard accessories. MATCH if the underlying console matches.

Edition variants: Splatoon Edition, Mario Edition, Pokémon Edition, Zelda Edition, Animal Crossing Edition, Limited Edition, Special Edition — these ship with custom colorways/accessories distinct from the base console. REJECT cross-edition matches.

Regional imports: Japan / Hong Kong / EU / UK editions of the same model SKU are the SAME PRODUCT (handled by base regional-imports rule).`;
