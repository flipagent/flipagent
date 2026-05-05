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
						flipagent is an eBay reseller API for AI agents and apps. One key covers the full
						flip cycle: finding deals, checking if they're actually profitable, drafting and
						managing listings, fulfilling sales, and routing buys through a US package
						forwarder.
					</>
				),
			},
			{
				q: "Does flipagent work with Claude Code?",
				a: (
					<>
						Yes, that's the primary host. The <code>flipagent-mcp</code> server exposes every
						endpoint as an MCP tool, so Claude Code or any other MCP-compatible host
						can search eBay, evaluate deals, and manage orders. Run{" "}
						<code>npx -y flipagent-cli init --mcp</code> and the CLI writes the config for you.
						See <a href="/docs/mcp/">/docs/mcp</a>.
					</>
				),
			},
			{
				q: "Do I need an eBay developer account?",
				a: (
					<>
						No. flipagent runs the eBay app for you. For selling and buying on your own
						account, authorize once via OAuth at <code>/v1/connect/ebay</code> with your
						normal eBay account. Self-hosting is the only case where you register your own
						eBay app; see <a href="/docs/self-host/">/docs/self-host</a>.
					</>
				),
			},
			{
				q: "Do I need a Chrome extension?",
				a: (
					<>
						Only for buying. Search, evaluate, and selling-side endpoints work without it.{" "}
						<code>/v1/purchases</code> and <code>/v1/forwarder/*</code> run inside your active
						eBay session, so they need flipagent's Chrome extension paired to your browser.
						See <a href="/docs/extension/">/docs/extension</a>.
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
				q: "I'm an eBay seller and want to opt out. How?",
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
						Yes. 1,000 credits as a one-time grant, no card, no trial timer. Enough for ~12
						full evaluations on your real inventory. Credits cover the heavy work flipagent
						runs on its own servers: pulling fresh marketplace data, scoring whether a deal is
						worth buying, and AI agent chat. Upgrade to a paid plan for monthly credits. See{" "}
						<a href="/pricing/">/pricing</a>.
					</>
				),
			},
			{
				q: "How are credits charged?",
				a: (
					<>
						Sourcing reads against eBay's catalog (<code>/v1/items</code>,{" "}
						<code>/v1/categories</code>, <code>/v1/products</code>) cost 1 credit per call.{" "}
						<code>/v1/evaluate</code> costs 80 because one call answers "should I flip this?".
						It pulls the actual recent sales of the same product and works out the profit,
						demand, and risk for you. Agent chat (<code>/v1/agent/chat</code>) costs per turn
						by model: <code>gemini-2.5-flash</code> 3, <code>gpt-5.4-mini</code> 5 (default),{" "}
						<code>claude-sonnet-4-7</code> 15, <code>gpt-5.5</code> 25. Free tier reaches the
						two cheapest (mini + Flash); paid tiers unlock all four. Anything that runs on your
						own connected accounts (listing, fulfilling, messaging, buying through your browser,
						taxonomy lookups, shipping math) is free of credits. Burst rate-limits still apply.
						Full table at <a href="/pricing/#api-credits">/pricing#api-credits</a>.
					</>
				),
			},
			{
				q: "What happens when I run out of credits?",
				a: (
					<>
						You get <code>429 Too Many Requests</code> with{" "}
						<code>error: "credits_exceeded"</code> and your usage in the body. Paid plans
						refill on the 1st of each month UTC; the response carries <code>resetAt</code>.
						The Free tier is a one-time grant and doesn't refill, so a maxed-out Free key has
						to upgrade to keep going. Auto-recharge keeps your balance at or above your
						target — set a target floor on the dashboard and we top up the saved card when it
						dips below. Upgrades from the dashboard kick in immediately.
					</>
				),
			},
			{
				q: "Are there per-minute or per-hour rate limits too?",
				a: (
					<>
						Yes. Burst caps sit alongside the monthly credit budget so a runaway loop can't
						drain your plan in seconds. Free + Hobby 30/min, Standard 120/min, Growth 600/min.
						Hourly caps (200 / 1,200 / 6,000 / 25,000) separate the tiers further. Normal automation never trips them. If you spike too fast you'll get a{" "}
						<code>429</code> with <code>error: "burst_rate_limited"</code>.
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
						We don't auto-refund unused credits in a billing period. For duplicate charges,
						accidental upgrades, or anything broken on our end, email{" "}
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
						The full reseller cycle under <code>/v1/*</code>. Sourcing without an eBay account:{" "}
						<code>/v1/items/search</code> for active or sold listings, <code>/v1/categories</code>
						{" "}for taxonomy, <code>/v1/evaluate</code> for a one-call buy/hold/skip verdict on a
						listing. Selling on your eBay account after OAuth: <code>/v1/listings</code>,{" "}
						<code>/v1/sales</code>, <code>/v1/payouts</code>, <code>/v1/transactions</code>,{" "}
						<code>/v1/policies</code>. Buying and fulfillment through the Chrome extension:{" "}
						<code>/v1/purchases</code>, <code>/v1/forwarder/*</code>. Shipping math at{" "}
						<code>/v1/ship/providers</code> and <code>/v1/ship/quote</code>. Full reference at{" "}
						<a href="/docs/api/">/docs/api</a>.
					</>
				),
			},
			{
				q: "How fresh is the cached data?",
				a: (
					<>
						60 minutes for active listings, 12 hours for sold and completed listings, 4 hours
						for item detail. The cache absorbs concurrent requests for the same question; it
						is not long-term storage. A takedown approval flushes the relevant entries within
						seconds.
					</>
				),
			},
			{
				q: "Do I need to use the TypeScript SDK?",
				a: (
					<>
						No. flipagent is plain HTTPS at <code>api.flipagent.dev</code>. Authenticate with{" "}
						<code>Authorization: Bearer fa_...</code> or <code>X-API-Key: fa_...</code> and
						call any endpoint from any language. The TypeScript SDK (<code>@flipagent/sdk</code>)
						{" "}is sugar on top, with namespaces matching the routes: <code>client.items</code>,{" "}
						<code>client.listings</code>, <code>client.purchases</code>,{" "}
						<code>client.sales</code>, <code>client.payouts</code>, <code>client.evaluate</code>,{" "}
						<code>client.ship</code>, and so on.
					</>
				),
			},
			{
				q: "What does the response shape look like?",
				a: (
					<>
						flipagent has its own JSON shape, not eBay's wire format. Money is integer cents,
						timestamps are ISO 8601, status enums are lowercase, and every record carries a{" "}
						<code>marketplace</code> field. When eBay adds fields upstream, our parsers ignore
						the new bits and existing code keeps working. Breaking upstream changes get a
						parser update.
					</>
				),
			},
			{
				q: "Can I self-host flipagent?",
				a: (
					<>
						Yes. The whole API server is open source under FSL-1.1-ALv2, which converts to
						Apache 2.0 two years after each release. The OSS packages (
						<code>@flipagent/types</code>, <code>@flipagent/sdk</code>,{" "}
						<code>@flipagent/ebay-scraper</code>, <code>flipagent-mcp</code>) ship as MIT.
						Bring your own Postgres and your own scraper-vendor credentials. See{" "}
						<a href="/docs/self-host/">/docs/self-host</a> for the runbook.
					</>
				),
			},
			{
				q: "What does flipagent collect?",
				a: (
					<>
						No agent prompts, no opaque telemetry. We log the API call (path, status,
						latency, SHA-256 prefix of your API key for rate-limit accounting) and the
						marketplace data we cache for the takedown channel. Nothing else. See{" "}
						<a href="/legal/privacy/">/legal/privacy</a>.
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
