/**
 * Wristwatches — eBay Browse REST categoryId 31387.
 * Universal-across-brands: Casio, Seiko, Citizen, Rolex, Tissot all use
 * model + suffix SKU schemes where the suffix encodes colorway and the
 * BASE alone is ambiguous (one base reference covers many colorways).
 *
 * Base prompt's Rule 1 already handles regional packaging equivalence
 * generally. This overlay only adds the bare-model rule and model-line
 * discipline that watches need.
 */

export const WRISTWATCHES_VERIFY_OVERLAY = `═══ WRISTWATCHES ═══
Watch SKUs follow {base model}-{colorway}{regional suffix}. The same BASE covers multiple colorways, so a title showing only the base reference does NOT identify the variant.

BARE-MODEL RULE: when the CANDIDATE has a colorway suffix and the ITEM title shows only the base reference (no suffix at all), the colorway is unconfirmed by title. Apply Rule 3 strictly — only MATCH if aspects, variations, or description explicitly name the candidate's specific suffix.

MODEL-LINE DISCIPLINE: a letter inserted into the base reference itself (B, M, GM, GMA, GW prefixes/infixes on Casio; comparable patterns on Seiko/Citizen) denotes a different watch — Bluetooth, metal, women's, solar — even when the same base number appears. REJECT cross-line matches.`;
