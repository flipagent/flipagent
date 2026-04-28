import { Hono } from "hono";
import { requireApiKey } from "../../middleware/auth.js";
import { ebayCommerceTaxonomyRoute } from "./commerce-taxonomy.js";
import { ebayItemBatchRoute } from "./item-batch.js";
import { ebayItemDetailRoute } from "./item-detail.js";
import { ebayOrderRoute } from "./order.js";
import { ebayOrderV2Route } from "./order-v2.js";
import { ebaySearchRoute } from "./search.js";
import { ebaySellAccountRoute } from "./sell-account.js";
import { ebaySellFinancesRoute } from "./sell-finances.js";
import { ebaySellFulfillmentRoute } from "./sell-fulfillment.js";
import { ebaySellInventoryRoute } from "./sell-inventory.js";
import { ebaySoldSearchRoute } from "./sold-search.js";

export const ebayRoutes = new Hono();

// Marketplace surface — unified `/v1/{resource}/*` for the full reseller
// cycle. Marketplace-agnostic shape; future Amazon/Mercari adapters reuse
// the same paths via a `marketplace` parameter rather than path prefixes.
ebayRoutes.use("/v1/listings/*", requireApiKey);
ebayRoutes.use("/v1/sold/*", requireApiKey);
ebayRoutes.use("/v1/orders/*", requireApiKey);
ebayRoutes.use("/v1/inventory/*", requireApiKey);
ebayRoutes.use("/v1/fulfillment/*", requireApiKey);
ebayRoutes.use("/v1/finance/*", requireApiKey);
ebayRoutes.use("/v1/markets/*", requireApiKey);

// Listings: search + batch + detail. item-batch mounts BEFORE item-detail
// so the static suffix paths (e.g. /get_items) aren't swallowed by the
// dynamic /:itemId.
ebayRoutes.route("/v1/listings/search", ebaySearchRoute);
ebayRoutes.route("/v1/listings", ebayItemBatchRoute);
ebayRoutes.route("/v1/listings", ebayItemDetailRoute);
ebayRoutes.route("/v1/sold/search", ebaySoldSearchRoute);
ebayRoutes.route("/v1/orders/checkout", ebayOrderRoute);
ebayRoutes.route("/v1/orders/guest", ebayOrderV2Route);
ebayRoutes.route("/v1/inventory", ebaySellInventoryRoute);
ebayRoutes.route("/v1/fulfillment", ebaySellFulfillmentRoute);
ebayRoutes.route("/v1/finance", ebaySellFinancesRoute);
ebayRoutes.route("/v1/markets/policies", ebaySellAccountRoute);
ebayRoutes.route("/v1/markets/taxonomy", ebayCommerceTaxonomyRoute);
