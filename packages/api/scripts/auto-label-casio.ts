/**
 * Auto-label the new (post-condition-filter) Casio snapshot pool.
 * Rule: MATCH iff title implies the all-black GA-2100-1A (any regional packaging code).
 * Pool already pre-filtered to NEW tier so we don't need to think about condition.
 */
import { readFileSync, writeFileSync } from "node:fs";
import type { ItemSummary } from "@flipagent/types/ebay/buy";

const SNAP = process.argv[2]!;
const snap = JSON.parse(readFileSync(SNAP, "utf8")) as { seed: ItemSummary; soldRaw: ItemSummary[]; activeRaw: ItemSummary[] };

function labelTitle(title: string): { label: "match" | "reject"; note: string } {
	const t = title.toUpperCase().replace(/\s+/g, " ");
	const norm = t.replace(/[\s-]/g, ""); // remove hyphens/spaces for matching

	// REJECT: different model lines or colorway codes
	if (/GA2000/.test(norm)) return { label: "reject", note: "GA-2000 different model" };
	if (/GAB2100|GA-?B2100/.test(t.replace(/\s/g, ""))) return { label: "reject", note: "GA-B2100 Bluetooth Solar different model" };
	if (/GM2100|GMS2100|GMAS2100/.test(norm)) return { label: "reject", note: "GM/GMA different line (G-Steel/smaller)" };
	if (/GA2110/.test(norm)) return { label: "reject", note: "GA-2110 different model" };
	if (/GA2100BCE/.test(norm)) return { label: "reject", note: "GA2100BCE LED variant" };
	if (/GA2100HDS/.test(norm)) return { label: "reject", note: "GA2100HDS White Hidden Glow" };
	if (/GA2100RL/.test(norm)) return { label: "reject", note: "GA-2100RL Bio-Based variant" };
	if (/GA2100SRS/.test(norm)) return { label: "reject", note: "GA2100SRS Rainbow variant" };
	if (/GA2100VB/.test(norm)) return { label: "reject", note: "GA-2100VB Virtual Blue colorway" };
	if (/GA2100GB/.test(norm)) return { label: "reject", note: "GA-2100GB Glossy Black/Gold" };
	if (/GA21001A3|GA21001A3ER/.test(norm)) return { label: "reject", note: "GA-2100-1A3ER Utility Black colorway" };
	if (/GA21002A|GA21007A/.test(norm)) return { label: "reject", note: "different colorway digit (-2A/-7A)" };
	if (/(WHITE\s*CARBON|RAINBOW|UTILITY\s*BLACK|BLUE\s*VIOLET|VIRTUAL\s*BLUE|GLOSSY\s*BLACK)/i.test(t)) {
		return { label: "reject", note: "different colorway in title" };
	}

	// MATCH: GA-2100-1A* (regional packaging variants of all-black CasiOak)
	// Operate on original title (spaces/hyphens preserved) so "1A 200M" boundary works
	const refPattern = /GA[-\s]?2100[-\s]?1A1?(?:JF|DR|ER|JM|AJF)?(?=$|[^A-Z0-9])/i;
	if (refPattern.test(t)) {
		return { label: "match", note: "GA-2100-1A all-black CasiOak (regional packaging variant)" };
	}
	// Plain "GA-2100" with "Black" but no other colorway = likely all-black
	if (/GA[-\s]?2100\b/i.test(t) && /BLACK/i.test(t) && !/(WHITE|BLUE|GOLD|GREY|GRAY|RAINBOW|RED|GREEN)/i.test(t)) {
		return { label: "match", note: "plain GA-2100 black (likely all-black variant)" };
	}

	return { label: "reject", note: "no clear all-black GA-2100-1A reference" };
}

const labels = { sold: {} as Record<string, { label: "match"|"reject"; note: string }>,
                 active: {} as Record<string, { label: "match"|"reject"; note: string }> };
for (let i = 0; i < snap.soldRaw.length; i++) labels.sold[String(i)] = labelTitle(snap.soldRaw[i]!.title);
for (let i = 0; i < snap.activeRaw.length; i++) labels.active[String(i)] = labelTitle(snap.activeRaw[i]!.title);

const total = Object.keys(labels.sold).length + Object.keys(labels.active).length;
const m = [...Object.values(labels.sold), ...Object.values(labels.active)].filter(l => l.label==="match").length;
console.log(`labeled ${total}: match=${m} reject=${total-m}`);

const out = { seed: { itemId: snap.seed.itemId, title: snap.seed.title }, labels };
const path = "scripts/.bench-out/labels-casio-ga2100-v2.json";
writeFileSync(path, JSON.stringify(out, null, 2));
console.log(`→ ${path}`);
