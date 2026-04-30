-- Rename `purchase_orders` → `bridge_jobs`. The table was originally a
-- buy-side queue but evolved into a multi-source bridge-job queue
-- (source=ebay buys, planetexpress forwarder ops, browser DOM ops,
-- ebay_data scraper jobs, control extension reloads). Internal name now
-- reflects that.
--
-- The eBay-shape wire contract (`EbayPurchaseOrder`,
-- `/v1/buy/order/purchase_order/{purchaseOrderId}`,
-- `purchaseOrderId` response field) is unchanged — `/v1/buy/order/*`
-- still renders source='ebay' rows in eBay shape.
--
-- `buy_checkout_sessions.purchase_order_id` column intentionally NOT
-- renamed: in that context the link only ever targets source='ebay'
-- rows (a placed eBay purchase order), so the column name reflects its
-- role, not the underlying table name.
--
-- Pure metadata rename — zero data movement, zero downtime.

ALTER TYPE "public"."purchase_order_status" RENAME TO "bridge_job_status";--> statement-breakpoint

ALTER TABLE "purchase_orders" RENAME TO "bridge_jobs";--> statement-breakpoint

ALTER INDEX "purchase_orders_api_key_idx" RENAME TO "bridge_jobs_api_key_idx";--> statement-breakpoint
ALTER INDEX "purchase_orders_status_idx" RENAME TO "bridge_jobs_status_idx";--> statement-breakpoint
ALTER INDEX "purchase_orders_idem_unique" RENAME TO "bridge_jobs_idem_unique";--> statement-breakpoint

ALTER TABLE "bridge_jobs" RENAME CONSTRAINT "purchase_orders_api_key_id_fk" TO "bridge_jobs_api_key_id_fk";--> statement-breakpoint
ALTER TABLE "bridge_jobs" RENAME CONSTRAINT "purchase_orders_user_id_fk" TO "bridge_jobs_user_id_fk";
