import { AnimatePresence, motion } from "motion/react";
import { useState } from "react";
import "./Faq.css";

interface QA {
	q: string;
	a: React.ReactNode;
}

interface Group {
	label: string;
	items: QA[];
}

const GROUPS: Group[] = [
	{
		label: "General",
		items: [
			{
				q: "What is flipagent?",
				a: (
					<>
						flipagent is an eBay reseller API for AI agents and apps. One unified surface covers
						the full flipping cycle: sourcing deals, evaluating margins against sold listings,
						drafting listings, tracking orders, and routing fulfillment through a US package
						forwarder. Today it ships eBay coverage. Amazon, Mercari, and Poshmark are next.
					</>
				),
			},
			{
				q: "Does flipagent work with Claude, Cursor, and other MCP clients?",
				a: (
					<>
						Yes. The <code>flipagent-mcp</code> server exposes every endpoint as an MCP tool, so
						Claude Desktop, Cursor, Cline, and any MCP-compatible agent can search eBay,
						evaluate deals, and manage orders directly. Run{" "}
						<code>npx -y flipagent-cli init --mcp</code> and the CLI writes the config for you.
						See <a href="/docs/mcp/">/docs/mcp</a> for setup.
					</>
				),
			},
			{
				q: "Do I need an eBay developer account?",
				a: (
					<>
						For the sourcing side, no. <code>/v1/items</code>, <code>/v1/categories</code>,{" "}
						<code>/v1/products</code>, and <code>/v1/evaluate</code> all work with just your
						flipagent key. For the selling side, you connect your own eBay account once via
						OAuth at <code>/v1/connect/ebay</code> and flipagent backs{" "}
						<code>/v1/listings</code>, <code>/v1/sales</code>, <code>/v1/payouts</code>,{" "}
						<code>/v1/transactions</code>, <code>/v1/policies</code>, etc. with your token.
						We never hold eBay developer credentials on your behalf.
					</>
				),
			},
			{
				q: "Is using eBay search data through flipagent allowed by eBay?",
				a: (
					<>
						Yes. Cached responses always carry the original <code>ebay.com/itm/...</code> URL,
						the cache TTL is short (60 minutes for active listings, 12 hours for sold listings,
						4 hours for item detail), and we honor seller takedown requests at{" "}
						<a href="/legal/takedown/">/legal/takedown</a>. The cache exists so 1,000 agents
						asking the same question don't all hit eBay. It is not an archive, and we never
						redistribute raw listing content divorced from the source link.
					</>
				),
			},
			{
				q: "I'm an eBay seller and don't want my listings indexed. How do I opt out?",
				a: (
					<>
						Submit your itemId at <a href="/legal/takedown/">/legal/takedown</a>. Approved
						takedowns flush our cache for that item within seconds and add it to a blocklist so
						it stops appearing in future calls. The same channel covers GDPR Article 17 and
						CCPA delete requests.
					</>
				),
			},
		],
	},
	{
		label: "Billing",
		items: [
			{
				q: "Is the free tier really free?",
				a: (
					<>
						Yes. 500 credits as a one-time grant. Credits cover the work we run on our
						infrastructure: scraping, comp pulls, and AI scoring. No credit card, no
						trial timer. Upgrade to a paid plan for monthly credits. See{" "}
						<a href="/pricing/">/pricing</a> for the full breakdown.
					</>
				),
			},
			{
				q: "How are credits charged?",
				a: (
					<>
						We charge for what runs on our infrastructure. Sourcing reads against
						eBay's catalog (<code>/v1/items</code>, <code>/v1/categories</code>,{" "}
						<code>/v1/products</code>, <code>/v1/trends</code>) cost 1 credit each;{" "}
						<code>/v1/evaluate</code> is 50 (scrape + AI scoring). Everything that runs
						on your own connected accounts — listing, fulfilling, messaging, buying
						through your browser, taxonomy lookups, shipping math — is free.
						Burst rate-limits still apply. See{" "}
						<a href="/pricing/#api-credits">the pricing table</a> for the full breakdown.
					</>
				),
			},
			{
				q: "What happens when I run out of credits?",
				a: (
					<>
						You get <code>429 Too Many Requests</code> with{" "}
						<code>error: "credits_exceeded"</code> and your usage in the body. Paid plans
						refill on the 1st of each month (UTC) — the response carries{" "}
						<code>resetAt</code>. The Free tier is a one-time 500-credit grant and doesn't
						refill, so a maxed-out Free key has to upgrade to keep going. Upgrades from the
						dashboard kick in immediately. We surface the next-plan-up math in your
						dashboard at 80% utilization.
					</>
				),
			},
			{
				q: "Are there per-minute or per-hour rate limits too?",
				a: (
					<>
						Yes. Burst caps sit alongside the monthly credit budget so a runaway script
						can't drain your plan in seconds. Free 10/min, Hobby 30/min, Standard 120/min, Growth 600/min. Normal automation
						never trips them. If you spike too fast you'll get a <code>429</code> with{" "}
						<code>error: "burst_rate_limited"</code>; slow down or upgrade for a higher cap.
					</>
				),
			},
			{
				q: "Can I cancel anytime?",
				a: (
					<>
						Yes. Click <b>Manage billing</b> in your dashboard to cancel, change plan, or
						update payment. Cancellation drops you back to Free at the end of the current
						billing period. No clawback.
					</>
				),
			},
			{
				q: "Do you offer refunds?",
				a: (
					<>
						We don't auto-refund unused calls in a billing period. For edge cases like
						duplicate charges, accidental upgrades, or anything broken on our end, email{" "}
						<a href="mailto:hello@flipagent.dev">hello@flipagent.dev</a> and we'll sort it.
					</>
				),
			},
		],
	},
	{
		label: "API",
		items: [
			{
				q: "Which endpoints does flipagent cover?",
				a: (
					<>
						The full reseller cycle under <code>/v1/*</code>. The sourcing side runs without an
						eBay account: <code>/v1/items/search</code> for active or sold listings,{" "}
						<code>/v1/categories</code> for taxonomy + suggestions, and <code>/v1/evaluate</code>{" "}
						for server-side scoring (composite — the server searches sold + active and ranks).
						The selling side runs against your eBay account once you connect via OAuth:{" "}
						<code>/v1/listings</code>, <code>/v1/sales</code>, <code>/v1/payouts</code>,{" "}
						<code>/v1/transactions</code>, <code>/v1/policies</code>. Shipping intelligence
						sits at <code>/v1/ship/providers</code> (forwarder catalog) and{" "}
						<code>/v1/ship/quote</code> (rate quotes). Full reference at{" "}
						<a href="/docs/api/">/docs/api</a>.
					</>
				),
			},
			{
				q: "How fresh is the cached data?",
				a: (
					<>
						60 minutes for active listings, 12 hours for sold and completed listings, 4 hours
						for item detail. The cache exists to absorb concurrent requests for the same
						question; it is not long-term storage. A takedown approval flushes the relevant
						cache entries within seconds.
					</>
				),
			},
			{
				q: "Can I use my existing eBay SDK?",
				a: (
					<>
						Yes. Any SDK that lets you override the base URL works. Point it at{" "}
						<code>api.flipagent.dev</code> and pass your flipagent key as{" "}
						<code>Authorization: Bearer fa_...</code> or <code>X-API-Key: fa_...</code>. For
						TypeScript we ship a typed <code>@flipagent/sdk</code> that wraps the unified
						surface in marketplace passthrough namespaces (<code>listings</code>,{" "}
						<code>sold</code>, <code>orders</code>, <code>inventory</code>) and intelligence
						namespaces (<code>evaluate</code>, <code>ship</code>,{" "}
						<code>market</code>).
					</>
				),
			},
			{
				q: "What if eBay changes their response shape?",
				a: (
					<>
						flipagent mirrors eBay's response shape verbatim, so additive changes pass through
						transparently. Breaking changes get a parser update. If you hit one in the wild,
						file an issue on GitHub and the patch usually lands the same day.
					</>
				),
			},
			{
				q: "Can I self-host flipagent?",
				a: (
					<>
						Yes. The whole API server is open source under FSL-1.1-ALv2 (which converts to
						Apache 2.0 two years after each release), and the OSS packages (
						<code>@flipagent/types</code>, <code>@flipagent/sdk</code>,{" "}
						<code>@flipagent/ebay-scraper</code>, <code>flipagent-mcp</code>) ship as MIT.
						Bring your own Postgres and your own scraper proxy credentials. See{" "}
						<a href="/docs/self-host/">/docs/self-host</a> for the runbook.
					</>
				),
			},
			{
				q: "What does flipagent collect?",
				a: (
					<>
						No host-LLM prompts, no opaque telemetry. We log the API call (path,
						status, latency, SHA-256 prefix of your API key for rate-limit accounting)
						and the marketplace data we cache for the takedown channel. Nothing else.
						See <a href="/legal/privacy/">/legal/privacy</a>.
					</>
				),
			},
		],
	},
];

interface FaqProps {
	/**
	 * Optional filter — render only groups whose `label` is in this list.
	 * Defaults to every group (homepage usage). Pricing/rate-limits pages
	 * pass `["Billing"]` to surface only the billing Q&A in the same skin.
	 */
	labels?: string[];
}

export default function Faq({ labels }: FaqProps = {}) {
	const groups = labels ? GROUPS.filter((g) => labels.includes(g.label)) : GROUPS;
	const [open, setOpen] = useState<string | null>("0-0");

	return (
		<div className="faq">
			{groups.map((group, gi) => (
				<div className="faq-group" key={group.label}>
					<div className="faq-side">
						<h3>{group.label}</h3>
					</div>
					<div className="faq-list">
						{group.items.map((item, i) => {
							const key = `${gi}-${i}`;
							const isOpen = open === key;
							return (
								<div className="faq-item" key={item.q}>
									<button
										className="faq-q"
										aria-expanded={isOpen}
										onClick={() => setOpen(isOpen ? null : key)}
									>
										<span>{item.q}</span>
										<svg
											className="faq-icon"
											width="14"
											height="14"
											viewBox="0 0 24 24"
											fill="none"
											stroke="currentColor"
											strokeWidth="2"
											strokeLinecap="round"
											strokeLinejoin="round"
											aria-hidden="true"
										>
											<polyline points="6 9 12 15 18 9" />
										</svg>
									</button>
									<AnimatePresence initial={false}>
										{isOpen && (
											<motion.div
												initial={{ height: 0, opacity: 0 }}
												animate={{ height: "auto", opacity: 1 }}
												exit={{ height: 0, opacity: 0 }}
												transition={{ duration: 0.22, ease: "easeOut" }}
											>
												<div className="faq-a">{item.a}</div>
											</motion.div>
										)}
									</AnimatePresence>
								</div>
							);
						})}
					</div>
				</div>
			))}
		</div>
	);
}
