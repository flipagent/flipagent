import { AnimatePresence, motion } from "motion/react";
import { useState } from "react";
import "./PipelineCode.css";
import "./CodeTabs.css";

type StepId = "search" | "score" | "quote" | "list" | "ship" | "payout";
type LangId = "python" | "node" | "curl" | "cli";

const STR = (s: string) => <span className="t-str">{s}</span>;
const KEY = (s: string) => <span className="t-key">{s}</span>;
const FN = (s: string) => <span className="t-fn">{s}</span>;
const NUM = (s: string) => <span className="t-num">{s}</span>;
const COM = (s: string) => <span className="t-com">{s}</span>;

interface Step {
	id: StepId;
	num: string;
	label: string;
	desc: string;
	icon: React.ReactNode;
	code: Record<LangId, React.ReactNode[]>;
	plain: Record<LangId, string>;
	result: React.ReactNode[];
}

const ICON = {
	search: (
		<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
			<circle cx="11" cy="11" r="7" />
			<path d="m20 20-3.5-3.5" />
		</svg>
	),
	gauge: (
		<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
			<path d="M12 14a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z" />
			<path d="M12 4v2M4 12h2M12 20v-2M20 12h-2M5.6 5.6l1.4 1.4M16.9 7l1.5-1.4M5.6 18.4 7 17M16.9 17l1.5 1.4" />
		</svg>
	),
	box: (
		<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
			<path d="M22 12h-6l-2 3h-4l-2-3H2" />
			<path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" />
		</svg>
	),
	doc: (
		<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
			<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
			<path d="M14 2v6h6M9 13h6M9 17h6" />
		</svg>
	),
	truck: (
		<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
			<path d="M3 7h11v10H3z" />
			<path d="M14 11h5l2 3v3h-7z" />
			<circle cx="7" cy="19" r="2" />
			<circle cx="18" cy="19" r="2" />
		</svg>
	),
	wallet: (
		<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
			<path d="M21 5H6a3 3 0 0 0-3 3v8a3 3 0 0 0 3 3h15z" />
			<path d="M3 8h18M16 13h2" />
		</svg>
	),
};

const STEPS: Step[] = [
	{
		id: "search",
		num: "01",
		label: "Search",
		desc: "Active listings by keyword",
		icon: ICON.search,
		code: {
			python: [
				<>{KEY("import")} requests</>,
				"",
				<>r = requests.{FN("get")}(</>,
				<>{"  "}{STR('"https://api.flipagent.dev/v1/listings/search"')},</>,
				<>{"  "}params={"{"}{STR('"q"')}: {STR('"canon ef 50mm 1.8"')}, {STR('"marketplace"')}: {STR('"ebay_us"')}, {STR('"limit"')}: {NUM("25")}{"}"},</>,
				<>{"  "}headers={"{"}{STR('"X-API-Key"')}: {STR('"fa_…"')}{"}"},</>,
				")",
			],
			node: [
				<>{KEY("import")} {"{ createFlipagentClient }"} {KEY("from")} {STR('"@flipagent/sdk"')};</>,
				"",
				<>{KEY("const")} client = {FN("createFlipagentClient")}({"{"} apiKey: {STR('"fa_…"')} {"}"});</>,
				<>{KEY("const")} {"{"} listings {"}"} = {KEY("await")} client.listings.{FN("search")}({"{"}</>,
				<>{"  "}q: {STR('"canon ef 50mm 1.8"')}, marketplace: {STR('"ebay_us"')}, limit: {NUM("25")},</>,
				"});",
			],
			curl: [
				<>{FN("curl")} {STR('"https://api.flipagent.dev/v1/listings/search?q=canon+ef+50mm+1.8&marketplace=ebay_us&limit=25"')} \</>,
				<>{"  "}-H {STR('"X-API-Key: fa_…"')}</>,
			],
			cli: [
				<>{FN("flipagent_search")}({"{"} q: {STR('"canon ef 50mm 1.8"')}, marketplace: {STR('"ebay_us"')} {"}"})</>,
			],
		},
		plain: {
			python:
				'import requests\n\nr = requests.get(\n  "https://api.flipagent.dev/v1/listings/search",\n  params={"q": "canon ef 50mm 1.8", "marketplace": "ebay_us", "limit": 25},\n  headers={"X-API-Key": "fa_…"},\n)',
			node: 'import { createFlipagentClient } from "@flipagent/sdk";\n\nconst client = createFlipagentClient({ apiKey: "fa_…" });\nconst { listings } = await client.listings.search({\n  q: "canon ef 50mm 1.8", marketplace: "ebay_us", limit: 25,\n});',
			curl: 'curl "https://api.flipagent.dev/v1/listings/search?q=canon+ef+50mm+1.8&marketplace=ebay_us&limit=25" \\\n  -H "X-API-Key: fa_…"',
			cli: 'flipagent_search({ q: "canon ef 50mm 1.8", marketplace: "ebay_us" })',
		},
		result: [
			<>{"{"}</>,
			<>{"  "}{STR('"listings"')}: [{"{"}</>,
			<>{"    "}{STR('"id"')}: {STR('"v1|3852…|0"')},</>,
			<>{"    "}{STR('"title"')}: {STR('"Canon EF 50mm f/1.8 STM"')},</>,
			<>{"    "}{STR('"price"')}: {"{"} {STR('"value"')}: {STR('"42.00"')}, {STR('"currency"')}: {STR('"USD"')} {"}"},</>,
			<>{"    "}{STR('"url"')}: {STR('"https://www.ebay.com/itm/3852…"')},</>,
			<>{"    "}{STR('"marketplace"')}: {STR('"ebay_us"')}</>,
			<>{"  "}{"}"}],</>,
			<>{"  "}{STR('"total"')}: {NUM("847")}</>,
			"}",
		],
	},
	{
		id: "score",
		num: "02",
		label: "Score",
		desc: "Sold-price comp + expected margin",
		icon: ICON.gauge,
		code: {
			python: [
				<>r = requests.{FN("post")}(</>,
				<>{"  "}{STR('"https://api.flipagent.dev/v1/evaluate"')},</>,
				<>{"  "}json={"{"}{STR('"item"')}: listing, {STR('"opts"')}: {"{"}{STR('"comps"')}: comps{"}"}{"}"},</>,
				<>{"  "}headers={"{"}{STR('"X-API-Key"')}: {STR('"fa_…"')}{"}"},</>,
				")",
			],
			node: [
				<>{KEY("const")} verdict = {KEY("await")} client.evaluate.{FN("listing")}({"{"}</>,
				<>{"  "}item: listing,</>,
				<>{"  "}opts: {"{"} comps, forwarder: {"{"} destState: {STR('"NY"')}, weightG: {NUM("500")} {"}"} {"}"}</>,
				"});",
			],
			curl: [
				<>{FN("curl")} -X POST https://api.flipagent.dev/v1/evaluate \</>,
				<>{"  "}-H {STR('"X-API-Key: fa_…"')} \</>,
				<>{"  "}-d {STR(`'{"item": {...}, "opts": {"comps": [...]}}'`)}</>,
			],
			cli: [
				<>{FN("evaluate_listing")}({"{"} item: listing, opts: {"{"} comps {"}"} {"}"})</>,
			],
		},
		plain: {
			python:
				'r = requests.post(\n  "https://api.flipagent.dev/v1/evaluate",\n  json={"item": listing, "opts": {"comps": comps}},\n  headers={"X-API-Key": "fa_…"},\n)',
			node: 'const verdict = await client.evaluate.listing({\n  item: listing,\n  opts: { comps, forwarder: { destState: "NY", weightG: 500 } },\n});',
			curl: 'curl -X POST https://api.flipagent.dev/v1/evaluate \\\n  -H "X-API-Key: fa_…" \\\n  -d \'{"item": {...}, "opts": {"comps": [...]}}\'',
			cli: 'evaluate_listing({ item: listing, opts: { comps } })',
		},
		result: [
			<>{"{"}</>,
			<>{"  "}{STR('"roi"')}: {NUM("0.74")},</>,
			<>{"  "}{STR('"netCents"')}: {NUM("3120")},</>,
			<>{"  "}{STR('"confidence"')}: {NUM("0.92")},</>,
			<>{"  "}{STR('"landedCostCents"')}: {NUM("4920")},</>,
			<>{"  "}{STR('"signals"')}: [{STR('"under_median"')}, {STR('"good_seller"')}],</>,
			<>{"  "}{STR('"rating"')}: {STR('"buy"')}</>,
			"}",
		],
	},
	{
		id: "buy",
		num: "03",
		label: "Buy",
		desc: "Order routed to your forwarder",
		icon: ICON.box,
		code: {
			python: [
				<>r = requests.{FN("post")}(</>,
				<>{"  "}{STR('"https://api.flipagent.dev/v1/purchases"')},</>,
				<>{"  "}json={"{"}</>,
				<>{"    "}{STR('"listingId"')}: {STR('"v1|3852…|0"')},</>,
				<>{"    "}{STR('"forwarderAddressId"')}: {STR('"fwd_pe_us_west"')},</>,
				<>{"    "}{STR('"maxPriceCents"')}: {NUM("5000")},</>,
				<>{"  "}{"}"},</>,
				<>{"  "}headers={"{"}{STR('"X-API-Key"')}: {STR('"fa_…"')}{"}"},</>,
				")",
			],
			node: [
				<>{KEY("const")} {"{"} purchaseId, expectedArrival {"}"} = {KEY("await")} client.purchases.{FN("create")}({"{"}</>,
				<>{"  "}listingId: {STR('"v1|3852…|0"')},</>,
				<>{"  "}forwarderAddressId: {STR('"fwd_pe_us_west"')},</>,
				<>{"  "}maxPriceCents: {NUM("5000")},</>,
				"});",
			],
			curl: [
				<>{FN("curl")} -X POST https://api.flipagent.dev/v1/purchases \</>,
				<>{"  "}-H {STR('"X-API-Key: fa_…"')} \</>,
				<>{"  "}-d {STR(`'{"listingId":"v1|3852…|0","forwarderAddressId":"fwd_pe_us_west"}'`)}</>,
			],
			cli: [
				<>{FN("flipagent_buy_listing")}({"{"} listingId, forwarderAddressId {"}"})</>,
			],
		},
		plain: {
			python:
				'r = requests.post(\n  "https://api.flipagent.dev/v1/purchases",\n  json={\n    "listingId": "v1|3852…|0",\n    "forwarderAddressId": "fwd_pe_us_west",\n    "maxPriceCents": 5000,\n  },\n  headers={"X-API-Key": "fa_…"},\n)',
			node: 'const { purchaseId, expectedArrival } = await client.purchases.create({\n  listingId: "v1|3852…|0",\n  forwarderAddressId: "fwd_pe_us_west",\n  maxPriceCents: 5000,\n});',
			curl: 'curl -X POST https://api.flipagent.dev/v1/purchases \\\n  -H "X-API-Key: fa_…" \\\n  -d \'{"listingId":"v1|3852…|0","forwarderAddressId":"fwd_pe_us_west"}\'',
			cli: 'flipagent_buy_listing({ listingId, forwarderAddressId })',
		},
		result: [
			<>{"{"}</>,
			<>{"  "}{STR('"purchaseId"')}: {STR('"buy_8x21…"')},</>,
			<>{"  "}{STR('"status"')}: {STR('"submitted"')},</>,
			<>{"  "}{STR('"totalCents"')}: {NUM("4700")},</>,
			<>{"  "}{STR('"forwarderAddressId"')}: {STR('"fwd_pe_us_west"')},</>,
			<>{"  "}{STR('"expectedArrival"')}: {STR('"2026-05-04"')}</>,
			"}",
		],
	},
	{
		id: "list",
		num: "04",
		label: "List",
		desc: "Auto-publish with photos + price",
		icon: ICON.doc,
		code: {
			python: [
				<>r = requests.{FN("post")}(</>,
				<>{"  "}{STR('"https://api.flipagent.dev/v1/listings"')},</>,
				<>{"  "}json={"{"}</>,
				<>{"    "}{STR('"sku"')}: {STR('"canon_ef_50mm_001"')}, {STR('"marketplace"')}: {STR('"ebay_us"')},</>,
				<>{"    "}{STR('"title"')}: {STR('"Canon EF 50mm f/1.8 STM Lens"')},</>,
				<>{"    "}{STR('"priceCents"')}: {NUM("9999")}, {STR('"condition"')}: {STR('"USED_GOOD"')},</>,
				<>{"    "}{STR('"photos"')}: [{STR('"https://cdn.flipagent.dev/canon.jpg"')}],</>,
				<>{"  "}{"}"},</>,
				<>{"  "}headers={"{"}{STR('"X-API-Key"')}: {STR('"fa_…"')}{"}"},</>,
				")",
			],
			node: [
				<>{KEY("const")} {"{"} listingId, url {"}"} = {KEY("await")} client.listings.{FN("publish")}({"{"}</>,
				<>{"  "}sku: {STR('"canon_ef_50mm_001"')}, marketplace: {STR('"ebay_us"')},</>,
				<>{"  "}title: {STR('"Canon EF 50mm f/1.8 STM Lens"')},</>,
				<>{"  "}priceCents: {NUM("9999")}, condition: {STR('"USED_GOOD"')},</>,
				<>{"  "}photos: [{STR('"https://cdn.flipagent.dev/canon.jpg"')}],</>,
				"});",
			],
			curl: [
				<>{FN("curl")} -X POST https://api.flipagent.dev/v1/listings \</>,
				<>{"  "}-H {STR('"X-API-Key: fa_…"')} \</>,
				<>{"  "}-d {STR(`'{"sku":"canon_…","marketplace":"ebay_us","priceCents":9999,…}'`)}</>,
			],
			cli: [
				<>{FN("flipagent_publish_listing")}({"{"} sku, marketplace: {STR('"ebay_us"')}, priceCents {"}"})</>,
			],
		},
		plain: {
			python:
				'r = requests.post(\n  "https://api.flipagent.dev/v1/listings",\n  json={\n    "sku": "canon_ef_50mm_001", "marketplace": "ebay_us",\n    "title": "Canon EF 50mm f/1.8 STM Lens",\n    "priceCents": 9999, "condition": "USED_GOOD",\n    "photos": ["https://cdn.flipagent.dev/canon.jpg"],\n  },\n  headers={"X-API-Key": "fa_…"},\n)',
			node: 'const { listingId, url } = await client.listings.publish({\n  sku: "canon_ef_50mm_001", marketplace: "ebay_us",\n  title: "Canon EF 50mm f/1.8 STM Lens",\n  priceCents: 9999, condition: "USED_GOOD",\n  photos: ["https://cdn.flipagent.dev/canon.jpg"],\n});',
			curl: 'curl -X POST https://api.flipagent.dev/v1/listings \\\n  -H "X-API-Key: fa_…" \\\n  -d \'{"sku":"canon_…","marketplace":"ebay_us","priceCents":9999,…}\'',
			cli: 'flipagent_publish_listing({ sku, marketplace: "ebay_us", priceCents })',
		},
		result: [
			<>{"{"}</>,
			<>{"  "}{STR('"listingId"')}: {STR('"lst_d2…"')},</>,
			<>{"  "}{STR('"marketplace"')}: {STR('"ebay_us"')},</>,
			<>{"  "}{STR('"url"')}: {STR('"https://www.ebay.com/itm/408517…"')},</>,
			<>{"  "}{STR('"status"')}: {STR('"live"')}</>,
			"}",
		],
	},
	{
		id: "sell",
		num: "05",
		label: "Sell",
		desc: "New orders + buyer details",
		icon: ICON.wallet,
		code: {
			python: [
				<>r = requests.{FN("get")}(</>,
				<>{"  "}{STR('"https://api.flipagent.dev/v1/orders"')},</>,
				<>{"  "}params={"{"}{STR('"status"')}: {STR('"awaiting_shipment"')}, {STR('"limit"')}: {NUM("50")}{"}"},</>,
				<>{"  "}headers={"{"}{STR('"X-API-Key"')}: {STR('"fa_…"')}{"}"},</>,
				")",
			],
			node: [
				<>{KEY("const")} {"{"} orders {"}"} = {KEY("await")} client.orders.{FN("list")}({"{"}</>,
				<>{"  "}status: {STR('"awaiting_shipment"')}, limit: {NUM("50")},</>,
				"});",
			],
			curl: [
				<>{FN("curl")} {STR('"https://api.flipagent.dev/v1/orders?status=awaiting_shipment&limit=50"')} \</>,
				<>{"  "}-H {STR('"X-API-Key: fa_…"')}</>,
			],
			cli: [
				<>{FN("flipagent_list_orders")}({"{"} status: {STR('"awaiting_shipment"')} {"}"})</>,
			],
		},
		plain: {
			python:
				'r = requests.get(\n  "https://api.flipagent.dev/v1/orders",\n  params={"status": "awaiting_shipment", "limit": 50},\n  headers={"X-API-Key": "fa_…"},\n)',
			node: 'const { orders } = await client.orders.list({\n  status: "awaiting_shipment", limit: 50,\n});',
			curl: 'curl "https://api.flipagent.dev/v1/orders?status=awaiting_shipment&limit=50" \\\n  -H "X-API-Key: fa_…"',
			cli: 'flipagent_list_orders({ status: "awaiting_shipment" })',
		},
		result: [
			<>{"{"}</>,
			<>{"  "}{STR('"orders"')}: [{"{"}</>,
			<>{"    "}{STR('"orderId"')}: {STR('"ord_1f9c…"')},</>,
			<>{"    "}{STR('"marketplace"')}: {STR('"ebay_us"')},</>,
			<>{"    "}{STR('"lineItems"')}: [{"{"} listingId: {STR('"lst_d2…"')}, qty: {NUM("1")} {"}"}],</>,
			<>{"    "}{STR('"buyerAddress"')}: {"{"} country: {STR('"US"')}, state: {STR('"NY"')} {"}"},</>,
			<>{"    "}{STR('"totalCents"')}: {NUM("9999")},</>,
			<>{"    "}{STR('"paidAt"')}: {STR('"2026-04-26T18:14Z"')}</>,
			<>{"  "}{"}"}],</>,
			<>{"  "}{STR('"total"')}: {NUM("12")}</>,
			"}",
		],
	},
	{
		id: "ship",
		num: "06",
		label: "Ship",
		desc: "Forwarder dispatches with tracking",
		icon: ICON.truck,
		code: {
			python: [
				<>r = requests.{FN("post")}(</>,
				<>{"  "}{FN("f")}{STR('"https://api.flipagent.dev/v1/orders/{order_id}/fulfillments"')},</>,
				<>{"  "}json={"{"}{STR('"forwarderShipment"')}: {KEY("True")}, {STR('"service"')}: {STR('"usps_priority"')}{"}"},</>,
				<>{"  "}headers={"{"}{STR('"X-API-Key"')}: {STR('"fa_…"')}{"}"},</>,
				")",
			],
			node: [
				<>{KEY("const")} fulfillment = {KEY("await")} client.fulfillments.{FN("create")}(orderId, {"{"}</>,
				<>{"  "}forwarderShipment: {KEY("true")},</>,
				<>{"  "}service: {STR('"usps_priority"')},</>,
				"});",
			],
			curl: [
				<>{FN("curl")} -X POST https://api.flipagent.dev/v1/orders/ord_1f9c…/fulfillments \</>,
				<>{"  "}-H {STR('"X-API-Key: fa_…"')} \</>,
				<>{"  "}-d {STR(`'{"forwarderShipment":true,"service":"usps_priority"}'`)}</>,
			],
			cli: [
				<>{FN("flipagent_ship_order")}({"{"} orderId, forwarderShipment: {KEY("true")} {"}"})</>,
			],
		},
		plain: {
			python:
				'r = requests.post(\n  f"https://api.flipagent.dev/v1/orders/{order_id}/fulfillments",\n  json={"forwarderShipment": True, "service": "usps_priority"},\n  headers={"X-API-Key": "fa_…"},\n)',
			node: 'const fulfillment = await client.fulfillments.create(orderId, {\n  forwarderShipment: true,\n  service: "usps_priority",\n});',
			curl: 'curl -X POST https://api.flipagent.dev/v1/orders/ord_1f9c…/fulfillments \\\n  -H "X-API-Key: fa_…" \\\n  -d \'{"forwarderShipment":true,"service":"usps_priority"}\'',
			cli: 'flipagent_ship_order({ orderId, forwarderShipment: true })',
		},
		result: [
			<>{"{"}</>,
			<>{"  "}{STR('"fulfillmentId"')}: {STR('"shp_22…"')},</>,
			<>{"  "}{STR('"carrier"')}: {STR('"USPS"')},</>,
			<>{"  "}{STR('"trackingNumber"')}: {STR('"94001…"')},</>,
			<>{"  "}{STR('"shippedAt"')}: {STR('"2026-04-26T19:08Z"')},</>,
			<>{"  "}{STR('"syncedToMarketplace"')}: {KEY("true")}</>,
			"}",
		],
	},
];

const LANGS: { id: LangId; label: string; icon: React.ReactNode }[] = [
	{
		id: "python",
		label: "Python",
		icon: (
			<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
				<path d="M11.9 1c-2.4 0-4.4 1-4.4 3v2.5h4.5v.7H5.5C3.5 7.2 2 8.7 2 11.1v2.3c0 1.9 1.4 3.4 3.3 3.4h1.7v-2.6c0-1.9 1.6-3.5 3.5-3.5h4.4c1.6 0 2.9-1.3 2.9-2.9V4c0-1.6-1.3-2.6-2.9-2.8C13.7 1.1 12.7 1 11.9 1zm-2 1.3c.5 0 .9.4.9.9s-.4.9-.9.9-.9-.4-.9-.9.4-.9.9-.9z" />
				<path d="M16.7 7.2v2.5c0 2-1.7 3.6-3.5 3.6H8.8c-1.5 0-2.9 1.3-2.9 2.9v5.4c0 1.5 1.3 2.4 2.9 2.9 1.9.6 3.7.7 5.5 0 1.5-.5 2.9-1.4 2.9-2.9v-2.5h-4.5v-.7h6.5c1.9 0 2.7-1.3 3.3-3.3.6-2.1.6-4.1 0-5.7-.5-1.5-1.4-2.2-3.3-2.2h-2.5zm-2.5 12.6c.5 0 .9.4.9.9s-.4.9-.9.9-.9-.4-.9-.9.4-.9.9-.9z" />
			</svg>
		),
	},
	{
		id: "node",
		label: "Node.js",
		icon: (
			<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
				<path d="M12 1.85c-.27 0-.55.07-.78.2l-7.44 4.3c-.48.28-.78.8-.78 1.36v8.58c0 .56.3 1.08.78 1.36l1.95 1.12c.95.47 1.29.47 1.72.47 1.4 0 2.21-.85 2.21-2.33V8.44c0-.12-.1-.22-.22-.22h-.93c-.13 0-.23.1-.23.22v8.47c0 .66-.68 1.31-1.78.76L4.45 16.5a.26.26 0 0 1-.13-.22V7.7c0-.09.05-.17.13-.22l7.44-4.29c.07-.04.16-.04.23 0l7.44 4.29c.08.05.13.13.13.22v8.58c0 .09-.05.17-.13.22l-7.44 4.29c-.07.04-.16.04-.23 0L9.99 19.66a.21.21 0 0 0-.21-.01c-.53.3-.63.36-1.13.53-.12.04-.31.11.07.32l2.48 1.47c.24.14.51.21.79.21s.55-.07.79-.21l7.44-4.29c.48-.28.78-.8.78-1.36V7.7c0-.56-.3-1.08-.78-1.36l-7.44-4.3a1.62 1.62 0 0 0-.78-.2zm1.99 7.94c-2.12 0-3.39.9-3.39 2.4 0 1.63 1.27 2.08 3.32 2.28 2.45.24 2.64.6 2.64 1.08 0 .84-.66 1.19-2.23 1.19-1.96 0-2.4-.49-2.55-1.46-.02-.1-.1-.18-.21-.18h-.96c-.12 0-.21.09-.21.21 0 1.24.67 2.71 3.93 2.71 2.36 0 3.7-.92 3.7-2.54 0-1.6-1.08-2.03-3.37-2.34-2.31-.3-2.54-.46-2.54-1 0-.45.2-1.04 1.91-1.04 1.53 0 2.09.33 2.32 1.36.02.1.11.17.21.17h.96c.06 0 .11-.02.16-.06.04-.05.06-.11.06-.17-.15-1.78-1.33-2.61-3.71-2.61z" />
			</svg>
		),
	},
	{
		id: "curl",
		label: "cURL",
		icon: (
			<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
				<path d="M5 3c-1 0-2 .6-2 2v2c0 .6-.4 1-1 1 .6 0 1 .4 1 1v2c0 1.4 1 2 2 2" />
				<path d="M11 3c1 0 2 .6 2 2v2c0 .6.4 1 1 1-.6 0-1 .4-1 1v2c0 1.4-1 2-2 2" />
			</svg>
		),
	},
	{
		id: "cli",
		label: "MCP",
		icon: (
			<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
				<rect x="2" y="3" width="12" height="10" rx="1.5" />
				<path d="M5 7l2 2-2 2M9 11h3" />
			</svg>
		),
	},
];

interface CodeBlockProps {
	lines: React.ReactNode[];
}

function CodeBlock({ lines }: CodeBlockProps) {
	return (
		<div className="cp-code">
			<div className="cp-gutter" aria-hidden="true">
				{lines.map((_, i) => (
					<span key={i}>{i + 1}</span>
				))}
			</div>
			<pre className="cp-pre">
				<code>
					{lines.map((line, i) => (
						<div className="cp-line" key={i}>
							{line === "" ? " " : line}
						</div>
					))}
				</code>
			</pre>
		</div>
	);
}

export default function PipelineCode() {
	const [activeStep, setActiveStep] = useState<StepId>("search");
	const [activeLang, setActiveLang] = useState<LangId>("python");
	const [copied, setCopied] = useState(false);

	const step = STEPS.find((s) => s.id === activeStep)!;
	const codeLines = step.code[activeLang];
	const plainText = step.plain[activeLang];

	async function handleCopy() {
		try {
			await navigator.clipboard.writeText(plainText);
			setCopied(true);
			setTimeout(() => setCopied(false), 1400);
		} catch {
			/* ignore */
		}
	}

	return (
		<div className="pcode">
			<div className="pcode-steps" role="tablist" aria-label="Pipeline step">
				{STEPS.map((s) => (
					<button
						type="button"
						key={s.id}
						role="tab"
						aria-selected={s.id === activeStep}
						className={`pcode-step ${s.id === activeStep ? "active" : ""}`}
						onClick={() => setActiveStep(s.id)}
					>
						<span className="pcode-step-num">{s.num}</span>
						<span className="pcode-step-icon">{s.icon}</span>
						<span className="pcode-step-label">{s.label}</span>
						<span className="pcode-step-desc">{s.desc}</span>
					</button>
				))}
			</div>
			<div className="codepanel">
				<div className="codepanel-tabs" role="tablist" aria-label="Language">
					{LANGS.map((l) => (
						<button
							type="button"
							key={l.id}
							role="tab"
							aria-selected={l.id === activeLang}
							className={`codepanel-tab ${l.id === activeLang ? "active" : ""}`}
							onClick={() => setActiveLang(l.id)}
						>
							<span className="codepanel-tab-icon" aria-hidden="true">
								{l.icon}
							</span>
							{l.label}
						</button>
					))}
					<div className="codepanel-tabs-spacer" />
					<button type="button" className="codepanel-copy" onClick={handleCopy}>
						<svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
							<rect x="5" y="5" width="9" height="9" rx="1.5" />
							<path d="M3 11V3a1 1 0 0 1 1-1h7" />
						</svg>
						{copied ? "Copied" : "Copy code"}
					</button>
				</div>
				<div className="codepanel-grid">
					<AnimatePresence mode="wait">
						<motion.div
							key={`${activeStep}-${activeLang}-code`}
							className="codepanel-side codepanel-side--code"
							initial={{ opacity: 0 }}
							animate={{ opacity: 1 }}
							exit={{ opacity: 0 }}
							transition={{ duration: 0.15 }}
						>
							<CodeBlock lines={codeLines} />
						</motion.div>
					</AnimatePresence>
					<AnimatePresence mode="wait">
						<motion.div
							key={`${activeStep}-out`}
							className="codepanel-side codepanel-side--out"
							initial={{ opacity: 0 }}
							animate={{ opacity: 1 }}
							exit={{ opacity: 0 }}
							transition={{ duration: 0.15 }}
						>
							<div className="codepanel-side-head">
								<span className="codepanel-dots" aria-hidden="true">
									<i />
									<i />
									<i />
								</span>
								<span className="codepanel-out-label">[ .JSON ]</span>
							</div>
							<CodeBlock lines={step.result} />
						</motion.div>
					</AnimatePresence>
				</div>
			</div>
		</div>
	);
}
