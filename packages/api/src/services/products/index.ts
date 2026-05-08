/**
 * Products barrel — flipagent-native Product CRUD + resolve + identifier
 * index. Single import surface:
 *
 *   import { resolveProductRef, getProduct, ... } from "../products/index.js";
 *
 * Distinct from `services/ebay/catalog.ts`, which is the eBay-EPID
 * mirror adapter (a different domain).
 */

export type { IdentifierKind, IdentifierLookup, IdentifierResolution } from "./identifiers.js";
export {
	attachIdentifier,
	findByIdentifier,
	findFirstByIdentifiers,
	listIdentifiers,
} from "./identifiers.js";
export { isProductId, isVariantId, newProductId, newVariantId, parseVariantKey, variantKey } from "./keys.js";
export type { ProductRefInput, ResolveContext, ResolveResult } from "./resolve.js";
export { CatalogResolveError, resolveProductRef } from "./resolve.js";
export { createProduct, getProduct, listVariants, takedownProduct, updateProduct, upsertVariant } from "./upsert.js";
