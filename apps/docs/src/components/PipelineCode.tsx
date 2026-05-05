import { AnimatePresence, motion } from "motion/react";
import { useState } from "react";
import "./PipelineCode.css";
import "./CodeTabs.css";

type StepId = "sourcing" | "evaluate" | "buy" | "list" | "orders" | "ship";
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
			<path d="M4 14a8 8 0 0 1 16 0" />
			<path d="M12 14l3-4" />
			<circle cx="12" cy="14" r="0.9" fill="currentColor" />
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
		id: "sourcing",
		num: "01",
		label: "Sourcing",
		desc: "Spot deals worth flipping",
		icon: ICON.search,
		code: {
			python: [
				<>{KEY("import")} requests</>,
				"",
				<>r = requests.{FN("get")}(</>,
				<>{"  "}{STR('"https://api.flipagent.dev/v1/items/search"')},</>,
				<>{"  "}params={"{"}</>,
				<>{"    "}{STR('"q"')}: {STR('"canon ef 50mm"')},</>,
				<>{"    "}{STR('"marketplace"')}: {STR('"ebay_us"')},</>,
				<>{"    "}{STR('"buyingOption"')}: {STR('"auction"')},</>,
				<>{"    "}{STR('"sort"')}: {STR('"ending_soonest"')},</>,
				<>{"    "}{STR('"priceMax"')}: {NUM("2000")}, {COM("# cents — ≤ $20.00")}</>,
				<>{"    "}{STR('"categoryId"')}: {STR('"15247"')}, {COM("# Camera Lenses")}</>,
				<>{"  "}{"}"},</>,
				<>{"  "}headers={"{"}{STR('"X-API-Key"')}: {STR('"fa_…"')}{"}"},</>,
				")",
			],
			node: [
				<>{KEY("import")} {"{ createFlipagentClient }"} {KEY("from")} {STR('"@flipagent/sdk"')};</>,
				"",
				<>{KEY("const")} client = {FN("createFlipagentClient")}({"{"} apiKey: {STR('"fa_…"')} {"}"});</>,
				<>{KEY("const")} {"{"} items {"}"} = {KEY("await")} client.items.{FN("search")}({"{"}</>,
				<>{"  "}q: {STR('"canon ef 50mm"')}, marketplace: {STR('"ebay_us"')},</>,
				<>{"  "}buyingOption: {STR('"auction"')}, sort: {STR('"ending_soonest"')},</>,
				<>{"  "}priceMax: {NUM("2000")}, categoryId: {STR('"15247"')},</>,
				"});",
			],
			curl: [
				<>{FN("curl")} {STR('"https://api.flipagent.dev/v1/items/search?q=canon+ef+50mm&marketplace=ebay&buyingOption=auction&sort=ending_soonest&priceMax=2000&categoryId=15247"')} \</>,
				<>{"  "}-H {STR('"X-API-Key: fa_…"')}</>,
			],
			cli: [
				<>{FN("flipagent_search_items")}({"{"} q: {STR('"canon ef 50mm"')}, buyingOption: {STR('"auction"')}, sort: {STR('"ending_soonest"')}, priceMax: {NUM("2000")} {"}"})</>,
			],
		},
		plain: {
			python:
				'import requests\n\nr = requests.get(\n  "https://api.flipagent.dev/v1/items/search",\n  params={\n    "q": "canon ef 50mm",\n    "marketplace": "ebay_us",\n    "buyingOption": "auction",\n    "sort": "ending_soonest",\n    "priceMax": 2000,  # cents — ≤ $20.00\n    "categoryId": "15247",  # Camera Lenses\n  },\n  headers={"X-API-Key": "fa_…"},\n)',
			node: 'import { createFlipagentClient } from "@flipagent/sdk";\n\nconst client = createFlipagentClient({ apiKey: "fa_…" });\nconst { items } = await client.items.search({\n  q: "canon ef 50mm", marketplace: "ebay_us",\n  buyingOption: "auction", sort: "ending_soonest",\n  priceMax: 2000, categoryId: "15247",\n});',
			curl: 'curl "https://api.flipagent.dev/v1/items/search?q=canon+ef+50mm&marketplace=ebay&buyingOption=auction&sort=ending_soonest&priceMax=2000&categoryId=15247" \\\n  -H "X-API-Key: fa_…"',
			cli: 'flipagent_search_items({ q: "canon ef 50mm", buyingOption: "auction", sort: "ending_soonest", priceMax: 2000 })',
		},
		result: [
			<>{"{"}</>,
			<>{"  "}{STR('"items"')}: [{"{"}</>,
			<>{"    "}{STR('"id"')}: {STR('"ebay:v|3852…|0"')},</>,
			<>{"    "}{STR('"marketplace"')}: {STR('"ebay_us"')},</>,
			<>{"    "}{STR('"title"')}: {STR('"Canon EF 50mm f/1.8 STM"')},</>,
			<>{"    "}{STR('"url"')}: {STR('"https://www.ebay.com/itm/3852…"')},</>,
			<>{"    "}{STR('"price"')}: {"{"} {STR('"value"')}: {NUM("950")}, {STR('"currency"')}: {STR('"USD"')} {"}"},</>,
			<>{"    "}{STR('"condition"')}: {STR('"Used"')},</>,
			<>{"    "}{STR('"buyingOptions"')}: [{STR('"auction"')}],</>,
			<>{"    "}{STR('"bidding"')}: {"{"} {STR('"count"')}: {NUM("0")}, {STR('"currentBid"')}: {"{"} {STR('"value"')}: {NUM("950")}, {STR('"currency"')}: {STR('"USD"')} {"}"} {"}"},</>,
			<>{"    "}{STR('"endsAt"')}: {STR('"2026-05-04T16:42Z"')},</>,
			<>{"    "}{STR('"watchCount"')}: {NUM("14")},</>,
			<>{"    "}{STR('"seller"')}: {"{"} {STR('"username"')}: {STR('"tokyo_camera"')}, {STR('"feedbackPercentage"')}: {STR('"99.5"')} {"}"},</>,
			<>{"    "}{STR('"images"')}: [{STR('"https://i.ebayimg.com/…/canon-50mm.jpg"')}],</>,
			<>{"    "}{STR('"location"')}: {"{"} {STR('"country"')}: {STR('"JP"')} {"}"}</>,
			<>{"  "}{"}"}],</>,
			<>{"  "}{STR('"total"')}: {NUM("12")}</>,
			"}",
		],
	},
	{
		id: "evaluate",
		num: "02",
		label: "Evaluate",
		desc: "Know if it'll resell before you buy",
		icon: ICON.gauge,
		code: {
			python: [
				<>r = requests.{FN("post")}(</>,
				<>{"  "}{STR('"https://api.flipagent.dev/v1/evaluate"')},</>,
				<>{"  "}json={"{"}{STR('"itemId"')}: {STR('"ebay:v|3852…|0"')}{"}"},</>,
				<>{"  "}headers={"{"}{STR('"X-API-Key"')}: {STR('"fa_…"')}{"}"},</>,
				")",
			],
			node: [
				<>{KEY("const")} evaluation = {KEY("await")} client.evaluate.{FN("listing")}({"{"}</>,
				<>{"  "}itemId: {STR('"ebay:v|3852…|0"')},</>,
				<>{"  "}opts: {"{"} forwarder: {"{"} destState: {STR('"NY"')}, weightG: {NUM("500")} {"}"} {"}"},</>,
				"});",
			],
			curl: [
				<>{FN("curl")} -X POST https://api.flipagent.dev/v1/evaluate \</>,
				<>{"  "}-H {STR('"X-API-Key: fa_…"')} \</>,
				<>{"  "}-d {STR(`'{"itemId": "ebay:v|3852…|0"}'`)}</>,
			],
			cli: [
				<>{FN("flipagent_evaluate_item")}({"{"} itemId: {STR('"ebay:v|3852…|0"')} {"}"})</>,
			],
		},
		plain: {
			python:
				'r = requests.post(\n  "https://api.flipagent.dev/v1/evaluate",\n  json={"itemId": "ebay:v|3852…|0"},\n  headers={"X-API-Key": "fa_…"},\n)',
			node: 'const evaluation = await client.evaluate.listing({\n  itemId: "ebay:v|3852…|0",\n  opts: { forwarder: { destState: "NY", weightG: 500 } },\n});',
			curl: 'curl -X POST https://api.flipagent.dev/v1/evaluate \\\n  -H "X-API-Key: fa_…" \\\n  -d \'{"itemId": "ebay:v|3852…|0"}\'',
			cli: 'flipagent_evaluate_item({ itemId: "ebay:v|3852…|0" })',
		},
		result: [
			<>{"{"}</>,
			<>{"  "}{STR('"evaluation"')}: {"{"}</>,
			<>{"    "}{STR('"rating"')}: {STR('"buy"')},</>,
			<>{"    "}{STR('"reason"')}: {STR('"Net $31.20 at p50, 0.92 confidence"')},</>,
			<>{"    "}{STR('"expectedNetCents"')}: {NUM("3120")},</>,
			<>{"    "}{STR('"netRangeCents"')}: {"{"} {STR('"p10Cents"')}: {NUM("1800")}, {STR('"p90Cents"')}: {NUM("4400")} {"}"},</>,
			<>{"    "}{STR('"confidence"')}: {NUM("0.92")},</>,
			<>{"    "}{STR('"landedCostCents"')}: {NUM("4920")},</>,
			<>{"    "}{STR('"bidCeilingCents"')}: {NUM("1840")},</>,
			<>{"    "}{STR('"safeBidBreakdown"')}: {"{"} {STR('"estimatedSaleCents"')}: {NUM("8500")}, {STR('"feesCents"')}: {NUM("1105")}, {STR('"shippingCents"')}: {NUM("1000")}, {STR('"targetNetCents"')}: {NUM("3120")} {"}"},</>,
			<>{"    "}{STR('"signals"')}: [{"{"} {STR('"name"')}: {STR('"under_median"')}, {STR('"weight"')}: {NUM("0.4")} {"}"}],</>,
			<>{"    "}{STR('"recommendedExit"')}: {"{"} {STR('"listPriceCents"')}: {NUM("8500")}, {STR('"expectedDaysToSell"')}: {NUM("5.2")}, {STR('"sellProb14d"')}: {NUM("0.81")}, {STR('"netCents"')}: {NUM("3120")} {"}"}</>,
			<>{"  "}{"}"},</>,
			<>{"  "}{STR('"market"')}: {"{"} {STR('"medianCents"')}: {NUM("8500")}, {STR('"p25Cents"')}: {NUM("7400")}, {STR('"p75Cents"')}: {NUM("9200")}, {STR('"salesPerDay"')}: {NUM("2.3")}, {STR('"meanDaysToSell"')}: {NUM("5.4")}, {STR('"nObservations"')}: {NUM("47")} {"}"},</>,
			<>{"  "}{STR('"sold"')}: {"{"} {STR('"count"')}: {NUM("47")}, {STR('"lastSalePriceCents"')}: {NUM("8200")}, {STR('"recentTrend"')}: {"{"} {STR('"direction"')}: {STR('"flat"')}, {STR('"change14dPct"')}: {NUM("-1.2")} {"}"} {"}"},</>,
			<>{"  "}{STR('"active"')}: {"{"} {STR('"count"')}: {NUM("12")}, {STR('"bestPriceCents"')}: {NUM("7900")}, {STR('"sellerConcentration"')}: {STR('"diverse"')} {"}"},</>,
			<>{"  "}{STR('"filter"')}: {"{"} {STR('"soldKept"')}: {NUM("47")}, {STR('"soldRejected"')}: {NUM("12")}, {STR('"activeKept"')}: {NUM("12")}, {STR('"activeRejected"')}: {NUM("3")} {"}"}</>,
			"}",
		],
	},
	{
		id: "buy",
		num: "03",
		label: "Buy",
		desc: "Bought and stored at your forwarder",
		icon: ICON.box,
		code: {
			python: [
				<>r = requests.{FN("post")}(</>,
				<>{"  "}{STR('"https://api.flipagent.dev/v1/purchases"')},</>,
				<>{"  "}json={"{"}</>,
				<>{"    "}{STR('"items"')}: [{"{"}{STR('"itemId"')}: {STR('"ebay:v|3852…|0"')}, {STR('"quantity"')}: {NUM("1")}{"}"}],</>,
				<>{"  "}{"}"},</>,
				<>{"  "}headers={"{"}{STR('"X-API-Key"')}: {STR('"fa_…"')}{"}"},</>,
				")",
			],
			node: [
				<>{KEY("const")} purchase = {KEY("await")} client.purchases.{FN("create")}({"{"}</>,
				<>{"  "}items: [{"{"} itemId: {STR('"ebay:v|3852…|0"')}, quantity: {NUM("1")} {"}"}],</>,
				"});",
			],
			curl: [
				<>{FN("curl")} -X POST https://api.flipagent.dev/v1/purchases \</>,
				<>{"  "}-H {STR('"X-API-Key: fa_…"')} \</>,
				<>{"  "}-d {STR(`'{"items":[{"itemId":"ebay:v|3852…|0","quantity":1}]}'`)}</>,
			],
			cli: [
				<>{FN("flipagent_create_purchase")}({"{"} itemId: {STR('"ebay:v|3852…|0"')} {"}"})</>,
			],
		},
		plain: {
			python:
				'r = requests.post(\n  "https://api.flipagent.dev/v1/purchases",\n  json={\n    "items": [{"itemId": "ebay:v|3852…|0", "quantity": 1}],\n  },\n  headers={"X-API-Key": "fa_…"},\n)',
			node: 'const purchase = await client.purchases.create({\n  items: [{ itemId: "ebay:v|3852…|0", quantity: 1 }],\n});',
			curl: 'curl -X POST https://api.flipagent.dev/v1/purchases \\\n  -H "X-API-Key: fa_…" \\\n  -d \'{"items":[{"itemId":"ebay:v|3852…|0","quantity":1}]}\'',
			cli: 'flipagent_create_purchase({ itemId: "ebay:v|3852…|0" })',
		},
		result: [
			<>{"{"}</>,
			<>{"  "}{STR('"id"')}: {STR('"15-12345-67890"')},</>,
			<>{"  "}{STR('"marketplace"')}: {STR('"ebay_us"')},</>,
			<>{"  "}{STR('"status"')}: {STR('"completed"')},</>,
			<>{"  "}{STR('"items"')}: [{"{"} itemId: {STR('"ebay:v|3852…|0"')}, quantity: {NUM("1")}, title: {STR('"Canon EF 50mm f/1.8 STM"')}, price: {"{"} value: {NUM("1840")}, currency: {STR('"USD"')} {"}"}, image: {STR('"https://i.ebayimg.com/…/canon-50mm.jpg"')} {"}"}],</>,
			<>{"  "}{STR('"pricing"')}: {"{"}</>,
			<>{"    "}{STR('"subtotal"')}: {"{"} {STR('"value"')}: {NUM("1840")}, {STR('"currency"')}: {STR('"USD"')} {"}"},</>,
			<>{"    "}{STR('"shipping"')}: {"{"} {STR('"value"')}: {NUM("1860")}, {STR('"currency"')}: {STR('"USD"')} {"}"},</>,
			<>{"    "}{STR('"tax"')}: {"{"} {STR('"value"')}: {NUM("1000")}, {STR('"currency"')}: {STR('"USD"')} {"}"},</>,
			<>{"    "}{STR('"total"')}: {"{"} {STR('"value"')}: {NUM("4700")}, {STR('"currency"')}: {STR('"USD"')} {"}"}</>,
			<>{"  "}{"}"},</>,
			<>{"  "}{STR('"marketplaceOrderId"')}: {STR('"16-78901-23456"')},</>,
			<>{"  "}{STR('"createdAt"')}: {STR('"2026-04-26T15:02Z"')},</>,
			<>{"  "}{STR('"completedAt"')}: {STR('"2026-04-26T15:03Z"')}</>,
			"}",
		],
	},
	{
		id: "list",
		num: "04",
		label: "List",
		desc: "Listed live, written for you",
		icon: ICON.doc,
		code: {
			python: [
				<>r = requests.{FN("post")}(</>,
				<>{"  "}{STR('"https://api.flipagent.dev/v1/listings"')},</>,
				<>{"  "}json={"{"}</>,
				<>{"    "}{STR('"title"')}: {STR('"Canon EF 50mm f/1.8 STM Lens"')},</>,
				<>{"    "}{STR('"price"')}: {"{"} {STR('"value"')}: {NUM("9999")}, {STR('"currency"')}: {STR('"USD"')} {"}"},</>,
				<>{"    "}{STR('"condition"')}: {STR('"used_good"')},</>,
				<>{"    "}{STR('"categoryId"')}: {STR('"15247"')},</>,
				<>{"    "}{STR('"images"')}: [{STR('"https://cdn.flipagent.dev/canon.jpg"')}],</>,
				<>{"    "}{STR('"marketplace"')}: {STR('"ebay_us"')},</>,
				<>{"  "}{"}"},</>,
				<>{"  "}headers={"{"}{STR('"X-API-Key"')}: {STR('"fa_…"')}{"}"},</>,
				")",
			],
			node: [
				<>{KEY("const")} listing = {KEY("await")} client.listings.{FN("create")}({"{"}</>,
				<>{"  "}title: {STR('"Canon EF 50mm f/1.8 STM Lens"')},</>,
				<>{"  "}price: {"{"} value: {NUM("9999")}, currency: {STR('"USD"')} {"}"},</>,
				<>{"  "}condition: {STR('"used_good"')}, categoryId: {STR('"15247"')},</>,
				<>{"  "}images: [{STR('"https://cdn.flipagent.dev/canon.jpg"')}],</>,
				<>{"  "}marketplace: {STR('"ebay_us"')},</>,
				"});",
			],
			curl: [
				<>{FN("curl")} -X POST https://api.flipagent.dev/v1/listings \</>,
				<>{"  "}-H {STR('"X-API-Key: fa_…"')} \</>,
				<>{"  "}-d {STR(`'{"title":"Canon EF 50mm…","price":{"value":9999,"currency":"USD"},"condition":"used_good","categoryId":"15247","images":["…"],"marketplace":"ebay_us"}'`)}</>,
			],
			cli: [
				<>{FN("flipagent_create_listing")}({"{"} title, price: {"{"} value: {NUM("9999")}, currency: {STR('"USD"')} {"}"}, condition: {STR('"used_good"')}, categoryId: {STR('"15247"')}, images {"}"})</>,
			],
		},
		plain: {
			python:
				'r = requests.post(\n  "https://api.flipagent.dev/v1/listings",\n  json={\n    "title": "Canon EF 50mm f/1.8 STM Lens",\n    "price": {"value": 9999, "currency": "USD"},\n    "condition": "used_good",\n    "categoryId": "15247",\n    "images": ["https://cdn.flipagent.dev/canon.jpg"],\n    "marketplace": "ebay_us",\n  },\n  headers={"X-API-Key": "fa_…"},\n)',
			node: 'const listing = await client.listings.create({\n  title: "Canon EF 50mm f/1.8 STM Lens",\n  price: { value: 9999, currency: "USD" },\n  condition: "used_good", categoryId: "15247",\n  images: ["https://cdn.flipagent.dev/canon.jpg"],\n  marketplace: "ebay_us",\n});',
			curl: 'curl -X POST https://api.flipagent.dev/v1/listings \\\n  -H "X-API-Key: fa_…" \\\n  -d \'{"title":"Canon EF 50mm…","price":{"value":9999,"currency":"USD"},"condition":"used_good","categoryId":"15247","images":["…"],"marketplace":"ebay_us"}\'',
			cli: 'flipagent_create_listing({ title, price: { value: 9999, currency: "USD" }, condition: "used_good", categoryId: "15247", images })',
		},
		result: [
			<>{"{"}</>,
			<>{"  "}{STR('"id"')}: {STR('"408517…"')},</>,
			<>{"  "}{STR('"sku"')}: {STR('"flipagent-d2k3…"')},</>,
			<>{"  "}{STR('"offerId"')}: {STR('"9876543210"')},</>,
			<>{"  "}{STR('"marketplace"')}: {STR('"ebay_us"')},</>,
			<>{"  "}{STR('"status"')}: {STR('"active"')},</>,
			<>{"  "}{STR('"title"')}: {STR('"Canon EF 50mm f/1.8 STM Lens"')},</>,
			<>{"  "}{STR('"price"')}: {"{"} value: {NUM("9999")}, currency: {STR('"USD"')} {"}"},</>,
			<>{"  "}{STR('"quantity"')}: {NUM("1")},</>,
			<>{"  "}{STR('"condition"')}: {STR('"used_good"')},</>,
			<>{"  "}{STR('"categoryId"')}: {STR('"15247"')},</>,
			<>{"  "}{STR('"format"')}: {STR('"fixed_price"')},</>,
			<>{"  "}{STR('"url"')}: {STR('"https://www.ebay.com/itm/408517…"')},</>,
			<>{"  "}{STR('"createdAt"')}: {STR('"2026-04-29T11:15Z"')}</>,
			"}",
		],
	},
	{
		id: "orders",
		num: "05",
		label: "Orders",
		desc: "Sales come in, ready to ship",
		icon: ICON.wallet,
		code: {
			python: [
				<>r = requests.{FN("get")}(</>,
				<>{"  "}{STR('"https://api.flipagent.dev/v1/sales"')},</>,
				<>{"  "}params={"{"}{STR('"status"')}: {STR('"paid"')}, {STR('"limit"')}: {NUM("50")}{"}"},</>,
				<>{"  "}headers={"{"}{STR('"X-API-Key"')}: {STR('"fa_…"')}{"}"},</>,
				")",
			],
			node: [
				<>{KEY("const")} {"{"} sales {"}"} = {KEY("await")} client.sales.{FN("list")}({"{"}</>,
				<>{"  "}status: {STR('"paid"')}, limit: {NUM("50")},</>,
				"});",
			],
			curl: [
				<>{FN("curl")} {STR('"https://api.flipagent.dev/v1/sales?status=paid&limit=50"')} \</>,
				<>{"  "}-H {STR('"X-API-Key: fa_…"')}</>,
			],
			cli: [
				<>{FN("flipagent_list_sales")}({"{"} status: {STR('"paid"')} {"}"})</>,
			],
		},
		plain: {
			python:
				'r = requests.get(\n  "https://api.flipagent.dev/v1/sales",\n  params={"status": "paid", "limit": 50},\n  headers={"X-API-Key": "fa_…"},\n)',
			node: 'const { sales } = await client.sales.list({\n  status: "paid", limit: 50,\n});',
			curl: 'curl "https://api.flipagent.dev/v1/sales?status=paid&limit=50" \\\n  -H "X-API-Key: fa_…"',
			cli: 'flipagent_list_sales({ status: "paid" })',
		},
		result: [
			<>{"{"}</>,
			<>{"  "}{STR('"sales"')}: [{"{"}</>,
			<>{"    "}{STR('"id"')}: {STR('"27-12345-67890"')},</>,
			<>{"    "}{STR('"marketplace"')}: {STR('"ebay_us"')},</>,
			<>{"    "}{STR('"status"')}: {STR('"paid"')},</>,
			<>{"    "}{STR('"items"')}: [{"{"} lineItemId: {STR('"ln_a1…"')}, itemId: {STR('"408517…"')}, title: {STR('"Canon EF 50mm…"')}, quantity: {NUM("1")}, price: {"{"} value: {NUM("9999")}, currency: {STR('"USD"')} {"}"} {"}"}],</>,
			<>{"    "}{STR('"buyer"')}: {"{"} {STR('"username"')}: {STR('"lens_collector_22"')} {"}"},</>,
			<>{"    "}{STR('"shipTo"')}: {"{"} line1: {STR('"123 Main St"')}, city: {STR('"New York"')}, region: {STR('"NY"')}, postalCode: {STR('"10001"')}, country: {STR('"US"')} {"}"},</>,
			<>{"    "}{STR('"pricing"')}: {"{"}</>,
			<>{"      "}{STR('"subtotal"')}: {"{"} {STR('"value"')}: {NUM("9999")}, {STR('"currency"')}: {STR('"USD"')} {"}"},</>,
			<>{"      "}{STR('"shipping"')}: {"{"} {STR('"value"')}: {NUM("0")}, {STR('"currency"')}: {STR('"USD"')} {"}"},</>,
			<>{"      "}{STR('"tax"')}: {"{"} {STR('"value"')}: {NUM("880")}, {STR('"currency"')}: {STR('"USD"')} {"}"},</>,
			<>{"      "}{STR('"total"')}: {"{"} {STR('"value"')}: {NUM("10879")}, {STR('"currency"')}: {STR('"USD"')} {"}"}</>,
			<>{"    "}{"}"},</>,
			<>{"    "}{STR('"shipping"')}: null,</>,
			<>{"    "}{STR('"paidAt"')}: {STR('"2026-04-26T18:14Z"')},</>,
			<>{"    "}{STR('"createdAt"')}: {STR('"2026-04-26T18:13Z"')}</>,
			<>{"  "}{"}"}],</>,
			<>{"  "}{STR('"total"')}: {NUM("12")}</>,
			"}",
		],
	},
	{
		id: "ship",
		num: "06",
		label: "Ship",
		desc: "Packed and shipped for you",
		icon: ICON.truck,
		code: {
			python: [
				<>r = requests.{FN("post")}(</>,
				<>{"  "}{FN("f")}{STR('"https://api.flipagent.dev/v1/sales/{saleId}/ship"')},</>,
				<>{"  "}json={"{"}{STR('"trackingNumber"')}: {STR('"94001…"')}, {STR('"carrier"')}: {STR('"USPS"')}{"}"},</>,
				<>{"  "}headers={"{"}{STR('"X-API-Key"')}: {STR('"fa_…"')}{"}"},</>,
				")",
			],
			node: [
				<>{KEY("const")} sale = {KEY("await")} client.sales.{FN("ship")}(saleId, {"{"}</>,
				<>{"  "}trackingNumber: {STR('"94001…"')},</>,
				<>{"  "}carrier: {STR('"USPS"')},</>,
				"});",
			],
			curl: [
				<>{FN("curl")} -X POST https://api.flipagent.dev/v1/sales/27-12345-67890/ship \</>,
				<>{"  "}-H {STR('"X-API-Key: fa_…"')} \</>,
				<>{"  "}-d {STR(`'{"trackingNumber":"94001…","carrier":"USPS"}'`)}</>,
			],
			cli: [
				<>{FN("flipagent_ship_sale")}({"{"} orderId: {STR('"27-12345-67890"')}, trackingNumber: {STR('"94001…"')}, carrier: {STR('"USPS"')} {"}"})</>,
			],
		},
		plain: {
			python:
				'r = requests.post(\n  f"https://api.flipagent.dev/v1/sales/{saleId}/ship",\n  json={"trackingNumber": "94001…", "carrier": "USPS"},\n  headers={"X-API-Key": "fa_…"},\n)',
			node: 'const sale = await client.sales.ship(saleId, {\n  trackingNumber: "94001…",\n  carrier: "USPS",\n});',
			curl: 'curl -X POST https://api.flipagent.dev/v1/sales/27-12345-67890/ship \\\n  -H "X-API-Key: fa_…" \\\n  -d \'{"trackingNumber":"94001…","carrier":"USPS"}\'',
			cli: 'flipagent_ship_sale({ orderId: saleId, trackingNumber, carrier: "USPS" })',
		},
		result: [
			<>{"{"}</>,
			<>{"  "}{STR('"id"')}: {STR('"27-12345-67890"')},</>,
			<>{"  "}{STR('"marketplace"')}: {STR('"ebay_us"')},</>,
			<>{"  "}{STR('"status"')}: {STR('"shipped"')},</>,
			<>{"  "}{STR('"items"')}: [{"{"} lineItemId: {STR('"ln_a1…"')}, itemId: {STR('"408517…"')}, title: {STR('"Canon EF 50mm…"')}, quantity: {NUM("1")}, price: {"{"} value: {NUM("9999")}, currency: {STR('"USD"')} {"}"} {"}"}],</>,
			<>{"  "}{STR('"pricing"')}: {"{"} total: {"{"} value: {NUM("10879")}, currency: {STR('"USD"')} {"}"} {"}"},</>,
			<>{"  "}{STR('"shipping"')}: {"{"}</>,
			<>{"    "}{STR('"carrier"')}: {STR('"USPS"')},</>,
			<>{"    "}{STR('"trackingNumber"')}: {STR('"94001…"')},</>,
			<>{"    "}{STR('"shippedAt"')}: {STR('"2026-04-26T19:08Z"')}</>,
			<>{"  "}{"}"},</>,
			<>{"  "}{STR('"paidAt"')}: {STR('"2026-04-26T18:14Z"')}</>,
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
	const [activeStep, setActiveStep] = useState<StepId>("sourcing");
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
