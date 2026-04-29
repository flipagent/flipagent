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
						the full flipping cycle: sourcing deals, evaluating margins against sold comparables,
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
						For the sourcing side, no. <code>/v1/buy/browse/*</code>,{" "}
						<code>/v1/buy/marketplace_insights/*</code>, <code>/v1/evaluate</code>, and{" "}
						<code>/v1/discover</code> all work with just your flipagent key. For the selling
						side, you connect your own eBay account once via OAuth at{" "}
						<code>/v1/connect/ebay</code> and flipagent passes calls through to{" "}
						<code>/v1/sell/inventory/*</code>, <code>/v1/sell/fulfillment/*</code>,{" "}
						<code>/v1/sell/finances/*</code>, <code>/v1/sell/account/*</code>, and{" "}
						<code>/v1/commerce/*</code>. We never hold eBay developer credentials on your
						behalf.
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
						Yes. 100 API calls per month, indefinitely. No credit card required, no trial
						timer. Upgrade only when you outgrow it. See <a href="/pricing/">/pricing</a> for
						the full breakdown.
					</>
				),
			},
			{
				q: "What counts as a billable call?",
				a: (
					<>
						Any call to a marketplace or intelligence endpoint counts toward your monthly
						quota: <code>/v1/buy/*</code>, <code>/v1/sell/*</code>, <code>/v1/commerce/*</code>,{" "}
						<code>/v1/post-order/*</code>, <code>/v1/forwarder/*</code>,{" "}
						<code>/v1/messages</code>, <code>/v1/best-offer</code>, <code>/v1/feedback</code>,{" "}
						<code>/v1/match</code>, <code>/v1/evaluate</code>, <code>/v1/discover</code>,{" "}
						<code>/v1/research</code>, <code>/v1/draft</code>, <code>/v1/reprice</code>,{" "}
						<code>/v1/ship</code>. Cache hits still count, because
						you're paying for the latency, the parser, and the takedown layer. Free routes:{" "}
						<code>/v1/health</code>, <code>/v1/me/keys</code>, <code>/v1/takedown</code>, and
						the billing routes themselves.
					</>
				),
			},
			{
				q: "What happens when I hit my monthly limit?",
				a: (
					<>
						You get <code>429 Too Many Requests</code> with a header pointing at the next
						reset. Limits roll over on the 1st of each month (UTC). Upgrade from the dashboard
						and the new ceiling kicks in immediately.
					</>
				),
			},
			{
				q: "Can I cancel anytime?",
				a: (
					<>
						Yes. Manage your subscription through the Stripe portal at{" "}
						<code>/v1/billing/portal</code>. Cancellation drops you back to Free at the end of
						the current billing period. No clawback.
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
						eBay account: <code>/v1/buy/browse/item_summary/search</code> for active listings,{" "}
						<code>/v1/buy/marketplace_insights/item_sales/search</code> for completed sales, <code>/v1/evaluate</code> and{" "}
						<code>/v1/discover</code> for server-side scoring, and{" "}
						<code>/v1/research/summary</code> for market price calculations. The selling side
						passes through to eBay over OAuth once you connect your account:{" "}
						<code>/v1/sell/inventory</code>, <code>/v1/sell/fulfillment</code>, <code>/v1/sell/finances</code>,
						and <code>/v1/commerce/taxonomy</code>. Shipping intelligence sits at{" "}
						<code>/v1/ship/providers</code> (forwarder catalog) and{" "}
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
						namespaces (<code>evaluate</code>, <code>discover</code>, <code>ship</code>,{" "}
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
				q: "Inside Claude Code / Cursor I'm already paying for Claude. Why should I pay flipagent for an LLM call too?",
				a: (
					<>
						You shouldn't, and you don't have to. Pass{" "}
						<code>options.mode: "delegate"</code> to <code>match_pool</code> (or its{" "}
						<code>POST /v1/match</code> endpoint). The server skips its own LLM entirely
						and returns a ready-to-run prompt + JSON schema. Your host LLM (Claude Opus,
						GPT-5, whatever) does the matching reasoning in-band, you parse{" "}
						<code>[&#123;i, bucket, reason&#125;]</code> back into a{" "}
						<code>MatchResponse</code> locally, and the rest of the pipeline (
						<code>research_summary</code>, <code>evaluate_listing</code>,{" "}
						<code>discover_deals</code>) runs as normal because none of them hit an LLM.
						The default is <code>hosted</code> — we run it for you — because that path is
						what cron jobs, scripts, and weak-host agents need. See{" "}
						<a href="/docs/mcp/#hosted-vs-delegate">/docs/mcp#hosted-vs-delegate</a>.
					</>
				),
			},
			{
				q: "What does flipagent collect, and how do I opt out?",
				a: (
					<>
						The only telemetry path is <code>flipagent_match_trace</code> (
						<code>POST /v1/traces/match</code>). It runs only after a delegate-mode{" "}
						<code>match_pool</code> call and uploads the host LLM's per-item decisions so
						our scoring math stays calibrated as host models drift. We store the trace id
						we issued, the decisions, and a SHA-256 prefix of your API key for rate-limit
						accounting — no account link, no host-LLM prompts beyond the ones we already
						handed you. Hosted-mode runs and read-only tools never produce traces. To opt
						out entirely, set <code>FLIPAGENT_TELEMETRY=0</code> in your MCP client's{" "}
						<code>env</code>; the tool short-circuits without making any network call.
						<code>off</code>, <code>false</code>, <code>no</code>, <code>disabled</code>{" "}
						are also accepted. See{" "}
						<a href="/docs/mcp/#telemetry">/docs/mcp#telemetry</a>.
					</>
				),
			},
		],
	},
];

export default function Faq() {
	const [open, setOpen] = useState<string | null>("0-0");

	return (
		<div className="faq">
			{GROUPS.map((group, gi) => (
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
