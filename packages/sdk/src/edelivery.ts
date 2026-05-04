/**
 * `client.edelivery.*` — eBay eDelivery International Shipping. Niche
 * cross-border seller program.
 *
 * Most endpoints pass through eBay's payload under `{ data, source }`
 * because eDelivery's response shapes are eBay-specific (carrier codes,
 * customs declarations, dropoff schedules) and we don't reshape.
 */

import type {
	EDeliveryBundleCreateResponse,
	EDeliveryBundleResponse,
	EDeliveryBundlesListResponse,
	EDeliveryOkResponse,
	EDeliveryPackageCreateResponse,
	EDeliveryPackageResponse,
	EDeliveryPackagesListResponse,
	EDeliveryRawResponse,
} from "@flipagent/types";
import type { FlipagentHttp } from "./http.js";

type Q = Record<string, string | number | undefined>;
type Body = Record<string, unknown>;

export interface EDeliveryClient {
	// packages
	listPackages(query?: Q): Promise<EDeliveryPackagesListResponse>;
	createPackage(body: Body): Promise<EDeliveryPackageCreateResponse>;
	getPackage(id: string): Promise<EDeliveryPackageResponse>;
	cancelPackage(id: string): Promise<EDeliveryOkResponse>;
	confirmPackage(id: string, body?: Body): Promise<EDeliveryRawResponse>;
	clonePackage(id: string, body?: Body): Promise<EDeliveryPackageCreateResponse>;
	getPackageItem(orderLineItemId: string): Promise<EDeliveryRawResponse>;
	bulkCancelPackages(body: Body): Promise<EDeliveryRawResponse>;
	bulkConfirmPackages(body: Body): Promise<EDeliveryRawResponse>;
	bulkDeletePackages(body: Body): Promise<EDeliveryRawResponse>;
	// bundles
	listBundles(query?: Q): Promise<EDeliveryBundlesListResponse>;
	createBundle(body: Body): Promise<EDeliveryBundleCreateResponse>;
	getBundle(id: string): Promise<EDeliveryBundleResponse>;
	cancelBundle(id: string): Promise<EDeliveryOkResponse>;
	getBundleLabel(id: string): Promise<EDeliveryRawResponse>;
	// labels / tracking / handover
	labels(query?: Q): Promise<EDeliveryRawResponse>;
	tracking(query?: Q): Promise<EDeliveryRawResponse>;
	handoverSheet(query?: Q): Promise<EDeliveryRawResponse>;
	// preferences / config
	actualCosts(query?: Q): Promise<EDeliveryRawResponse>;
	getAddressPreference(): Promise<EDeliveryRawResponse>;
	setAddressPreference(body: Body): Promise<EDeliveryRawResponse>;
	getConsignPreference(): Promise<EDeliveryRawResponse>;
	setConsignPreference(body: Body): Promise<EDeliveryRawResponse>;
	agents(query?: Q): Promise<EDeliveryRawResponse>;
	dropoffSites(query?: Q): Promise<EDeliveryRawResponse>;
	batteryQualifications(query?: Q): Promise<EDeliveryRawResponse>;
	services(query?: Q): Promise<EDeliveryRawResponse>;
	listComplaints(query?: Q): Promise<EDeliveryRawResponse>;
	createComplaint(body: Body): Promise<EDeliveryRawResponse>;
}

export function createEDeliveryClient(http: FlipagentHttp): EDeliveryClient {
	return {
		listPackages: (query) => http.get("/v1/edelivery/packages", query),
		createPackage: (body) => http.post("/v1/edelivery/packages", body),
		getPackage: (id) => http.get(`/v1/edelivery/packages/${encodeURIComponent(id)}`),
		cancelPackage: (id) => http.post(`/v1/edelivery/packages/${encodeURIComponent(id)}/cancel`, {}),
		confirmPackage: (id, body) => http.post(`/v1/edelivery/packages/${encodeURIComponent(id)}/confirm`, body ?? {}),
		clonePackage: (id, body) => http.post(`/v1/edelivery/packages/${encodeURIComponent(id)}/clone`, body ?? {}),
		getPackageItem: (orderLineItemId) =>
			http.get(`/v1/edelivery/packages/${encodeURIComponent(orderLineItemId)}/item`),
		bulkCancelPackages: (body) => http.post("/v1/edelivery/packages/bulk-cancel", body),
		bulkConfirmPackages: (body) => http.post("/v1/edelivery/packages/bulk-confirm", body),
		bulkDeletePackages: (body) => http.post("/v1/edelivery/packages/bulk-delete", body),

		listBundles: (query) => http.get("/v1/edelivery/bundles", query),
		createBundle: (body) => http.post("/v1/edelivery/bundles", body),
		getBundle: (id) => http.get(`/v1/edelivery/bundles/${encodeURIComponent(id)}`),
		cancelBundle: (id) => http.post(`/v1/edelivery/bundles/${encodeURIComponent(id)}/cancel`, {}),
		getBundleLabel: (id) => http.get(`/v1/edelivery/bundles/${encodeURIComponent(id)}/label`),

		labels: (query) => http.get("/v1/edelivery/labels", query),
		tracking: (query) => http.get("/v1/edelivery/tracking", query),
		handoverSheet: (query) => http.get("/v1/edelivery/handover-sheet", query),

		actualCosts: (query) => http.get("/v1/edelivery/actual-costs", query),
		getAddressPreference: () => http.get("/v1/edelivery/preferences/address"),
		setAddressPreference: (body) => http.post("/v1/edelivery/preferences/address", body),
		getConsignPreference: () => http.get("/v1/edelivery/preferences/consign"),
		setConsignPreference: (body) => http.post("/v1/edelivery/preferences/consign", body),
		agents: (query) => http.get("/v1/edelivery/agents", query),
		dropoffSites: (query) => http.get("/v1/edelivery/dropoff-sites", query),
		batteryQualifications: (query) => http.get("/v1/edelivery/battery-qualifications", query),
		services: (query) => http.get("/v1/edelivery/services", query),
		listComplaints: (query) => http.get("/v1/edelivery/complaints", query),
		createComplaint: (body) => http.post("/v1/edelivery/complaints", body),
	};
}
