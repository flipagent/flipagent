/**
 * Pure scoring helpers for product-identity matching. Tokenize titles,
 * compute pool-level IDF, score one comp against a candidate by
 * IDF-weighted token overlap. No regex extraction, no per-domain SKU
 * tables — IDF naturally up-weights rare tokens (model numbers,
 * reference codes) and down-weights common ones ("watch", "men's",
 * "new") so the algorithm generalizes across categories.
 */

const STOPWORDS = new Set([
	"the",
	"and",
	"for",
	"with",
	"from",
	"in",
	"on",
	"of",
	"to",
	"or",
	"a",
	"an",
	"is",
	"by",
	"at",
	"de",
	"la",
	"el",
]);

/**
 * Lowercase, strip non-alphanumeric, drop too-short tokens and a small
 * stopword list. Korean / Japanese / Chinese characters survive
 * because the alphanumeric filter only strips punctuation; CJK script
 * is preserved as discrete tokens.
 */
export function tokenize(text: string): string[] {
	return text
		.toLowerCase()
		.normalize("NFKD")
		.replace(/[^\p{L}\p{N}]+/gu, " ")
		.split(/\s+/)
		.filter((t) => t.length >= 2 && !STOPWORDS.has(t));
}

/** Build IDF map over a pool of titles. `idf(t) = log(N / df(t))`. */
export function buildIdf(titles: string[]): Map<string, number> {
	const N = Math.max(1, titles.length);
	const df = new Map<string, number>();
	for (const title of titles) {
		const seen = new Set(tokenize(title));
		for (const t of seen) df.set(t, (df.get(t) ?? 0) + 1);
	}
	const idf = new Map<string, number>();
	for (const [t, count] of df) idf.set(t, Math.log(N / count));
	return idf;
}

/**
 * IDF-weighted Jaccard-ish overlap. Numerator = sum of IDF for tokens
 * shared with the candidate. Denominator = sum of IDF for the
 * candidate's tokens. Result in [0, 1] where 1 means every weighted
 * candidate token is present in the comp.
 */
export function idfWeightedOverlap(
	candidateTokens: ReadonlySet<string>,
	compTokens: ReadonlySet<string>,
	idf: ReadonlyMap<string, number>,
): number {
	let shared = 0;
	let total = 0;
	for (const t of candidateTokens) {
		const w = idf.get(t) ?? 0;
		total += w;
		if (compTokens.has(t)) shared += w;
	}
	if (total <= 0) return 0;
	return shared / total;
}
