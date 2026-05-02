/**
 * Hand-curated fixtures for the logged-out Sourcing tab in the landing
 * hero. Same shapes the real `/v1/categories` and `/v1/items/search`
 * endpoints return so PlaygroundSourcing's render path is unchanged in
 * mockMode.
 *
 * Three "leaf" categories (no drill-down in compact mode) chosen to
 * cover the resell archetypes a visitor recognises: Watches, Sneakers,
 * Camera lenses. The first listing in each category uses an itemId that
 * matches an EvaluateFixture in mockData.ts so the drawer's mock-Run
 * Evaluate renders coherent data; the rest fall through to the generic
 * mockEvaluateFixture clone (visually fine, content drift acceptable
 * for a hero demo).
 */

import type { BrowseSearchResponse, ItemSummary } from "./types";

export interface MockCategoryNode {
	id: string;
	name: string;
	path?: string;
	parentId?: string;
	isLeaf?: boolean;
}

/** Compact-mode chip strip — three "leaves" we treat as terminals. */
export const MOCK_SOURCING_ROOTS: ReadonlyArray<MockCategoryNode> = [
	{
		id: "31387",
		name: "Wristwatches",
		path: "Jewelry & Watches/Watches, Parts & Accessories/Watches/Wristwatches",
		isLeaf: true,
	},
	{
		id: "15709",
		name: "Sneakers",
		path: "Clothing, Shoes & Accessories/Men's Shoes/Athletic Shoes",
		isLeaf: true,
	},
	{
		id: "78997",
		name: "Camera Lenses",
		path: "Cameras & Photo/Lenses & Filters/Lenses",
		isLeaf: true,
	},
];

/* ----------------------------- helpers ----------------------------- */

function listing(args: {
	itemId: string;
	title: string;
	priceCents: number;
	condition?: string;
	imageUrl?: string;
}): ItemSummary {
	const legacy = args.itemId.replace(/^v1\|/, "").replace(/\|0$/, "");
	return {
		itemId: args.itemId,
		legacyItemId: legacy,
		title: args.title,
		itemWebUrl: `https://www.ebay.com/itm/${legacy}`,
		condition: args.condition ?? "Pre-owned",
		conditionId: "3000",
		price: { value: (args.priceCents / 100).toFixed(2), currency: "USD" },
		image: args.imageUrl ? { imageUrl: args.imageUrl } : undefined,
		buyingOptions: ["FIXED_PRICE", "BEST_OFFER"],
	};
}

/* ----------------------------- watches ----------------------------- */

const WATCH_ITEMS: ItemSummary[] = [
	listing({
		itemId: "v1|388236252829|0",
		title: "Gucci G-Timeless Women's Silver Dial Watch YA1264153",
		priceCents: 49900,
		imageUrl: "/demo/gucci-watch.jpg",
	}),
	listing({
		itemId: "v1|388236252830|0",
		title: "Gucci G-Timeless YA1264153 38mm — full bracelet kit",
		priceCents: 53500,
		imageUrl: "/demo/gucci-watch.jpg",
	}),
	listing({
		itemId: "v1|315812441127|0",
		title: "Tag Heuer Carrera Calibre 5 39mm WAR211A",
		priceCents: 118500,
	}),
	listing({
		itemId: "v1|315812441128|0",
		title: "Tudor Black Bay 58 79030N — 2024 papers",
		priceCents: 348000,
	}),
	listing({
		itemId: "v1|315812441129|0",
		title: "Seiko SKX007 diver — automatic, NH36 mod",
		priceCents: 18500,
	}),
	listing({
		itemId: "v1|315812441130|0",
		title: "Omega Seamaster Aqua Terra 38mm — 2022 box+papers",
		priceCents: 412000,
	}),
];

/* ----------------------------- sneakers ----------------------------- */

const SNEAKER_ITEMS: ItemSummary[] = [
	listing({
		itemId: "v1|127595526397|0",
		title: "Nike Air Jordan 1 High OG Travis Scott Mocha (sz 9)",
		priceCents: 110000,
		imageUrl: "/demo/aj1-mocha.jpg",
	}),
	listing({
		itemId: "v1|127595526398|0",
		title: "Travis Scott AJ1 Mocha sz 9 — used, original box",
		priceCents: 124500,
		imageUrl: "/demo/aj1-mocha.jpg",
	}),
	listing({
		itemId: "v1|127595526399|0",
		title: "AJ1 Mocha sz 10 555088-105 — VNDS",
		priceCents: 118000,
		imageUrl: "/demo/aj1-mocha.jpg",
	}),
	listing({
		itemId: "v1|127595526400|0",
		title: "Yeezy 350 V2 Zebra (sz 10) — replacement laces",
		priceCents: 24500,
	}),
	listing({
		itemId: "v1|127595526401|0",
		title: "Nike Dunk Low Panda (sz 9) — pre-owned",
		priceCents: 11800,
	}),
	listing({
		itemId: "v1|127595526402|0",
		title: "New Balance 990v6 Grey (sz 10) — original box",
		priceCents: 18900,
	}),
];

/* ----------------------------- lenses ----------------------------- */

const LENS_ITEMS: ItemSummary[] = [
	listing({
		itemId: "v1|285927416032|0",
		title: "Canon EF 50mm f/1.8 STM Lens — used, with caps",
		priceCents: 8200,
		imageUrl: "/demo/canon-50-1.png",
	}),
	listing({
		itemId: "v1|285927416033|0",
		title: "Canon EF 50mm f/1.8 STM — clean glass, original caps",
		priceCents: 8900,
		imageUrl: "/demo/canon-50-2.png",
	}),
	listing({
		itemId: "v1|285927416034|0",
		title: "Canon EF 50mm f/1.8 STM — like new w/ box",
		priceCents: 10500,
		imageUrl: "/demo/canon-50-3.png",
	}),
	listing({
		itemId: "v1|285927416035|0",
		title: "Canon EF 24-105mm f/4L IS USM — pro zoom",
		priceCents: 38500,
		imageUrl: "/demo/canon-24-105.jpg",
	}),
	listing({
		itemId: "v1|285927416036|0",
		title: "Canon RF 50mm f/1.8 STM — mirrorless nifty fifty",
		priceCents: 14200,
		imageUrl: "/demo/canon-rf-50.jpg",
	}),
	listing({
		itemId: "v1|285927416037|0",
		title: "Sigma 35mm f/1.4 DG HSM Art Canon EF mount",
		priceCents: 42500,
	}),
];

/* ----------------------------- maps ----------------------------- */

export const MOCK_LISTINGS_BY_CATEGORY: Record<string, BrowseSearchResponse> = {
	"31387": { itemSummaries: WATCH_ITEMS, total: WATCH_ITEMS.length, offset: 0, limit: 50, source: "scrape" },
	"15709": { itemSummaries: SNEAKER_ITEMS, total: SNEAKER_ITEMS.length, offset: 0, limit: 50, source: "scrape" },
	"78997": { itemSummaries: LENS_ITEMS, total: LENS_ITEMS.length, offset: 0, limit: 50, source: "scrape" },
};
