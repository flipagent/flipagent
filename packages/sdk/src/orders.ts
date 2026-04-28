/**
 * `client.orders.*` — bridge-driven buying flow.
 *
 *   client.orders.checkout(req)          — queue an order; returns immediately.
 *   client.orders.get(id)                — read current state.
 *   client.orders.cancel(id)             — cancel a non-terminal order.
 *   client.orders.wait(id, opts?)        — poll until terminal status (or timeout).
 *
 * The hosted API queues a `purchase_order_id`; the user's flipagent Chrome
 * extension (paired with their API key) picks the job up via the bridge
 * protocol and runs the eBay buy flow inside their real Chrome session,
 * then posts the outcome back. Install + pairing: /docs/extension/.
 *
 * Same SDK surface will swap to eBay's official Order API later (when
 * eBay approves the tenant) without a client-code change.
 */

import type { CheckoutRequest, CheckoutResponse, PurchaseOrder } from "@flipagent/types";
import type { FlipagentHttp } from "./http.js";

export interface WaitOptions {
	/** Stop polling after this many milliseconds. Default 30 min. */
	timeoutMs?: number;
	/** Polling interval in ms. Default 2000. */
	intervalMs?: number;
	/** AbortSignal to cancel the wait. */
	signal?: AbortSignal;
}

export interface OrdersClient {
	checkout(req: CheckoutRequest): Promise<CheckoutResponse>;
	get(id: string): Promise<PurchaseOrder>;
	cancel(id: string): Promise<PurchaseOrder>;
	wait(id: string, opts?: WaitOptions): Promise<PurchaseOrder>;
}

const TERMINAL = new Set(["completed", "failed", "cancelled", "expired"]);

export function createOrdersClient(http: FlipagentHttp): OrdersClient {
	return {
		checkout: (req) => http.post<CheckoutResponse>("/v1/orders/checkout", req),
		get: (id) => http.get<PurchaseOrder>(`/v1/orders/${encodeURIComponent(id)}`),
		cancel: (id) => http.post<PurchaseOrder>(`/v1/orders/${encodeURIComponent(id)}/cancel`),
		async wait(id, opts = {}) {
			const intervalMs = opts.intervalMs ?? 2_000;
			const deadline = Date.now() + (opts.timeoutMs ?? 30 * 60_000);
			while (true) {
				const order = await http.get<PurchaseOrder>(`/v1/orders/${encodeURIComponent(id)}`);
				if (TERMINAL.has(order.status)) return order;
				if (Date.now() >= deadline) return order;
				if (opts.signal?.aborted) throw new DOMException("aborted", "AbortError");
				await new Promise((r) => setTimeout(r, intervalMs));
			}
		},
	};
}
