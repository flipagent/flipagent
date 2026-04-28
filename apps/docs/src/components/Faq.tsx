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
				q: "Is this allowed by eBay's terms of service?",
				a: (
					<>
						Cached responses always carry the original <code>ebay.com/itm/…</code> URL, TTL is short
						(60 min active, 12h sold), and we honor seller opt-outs through{" "}
						<a href="/legal/takedown/">/legal/takedown</a>. The cache is anti-thundering-herd, not
						archival. We do not redistribute raw listing content divorced from the source link.
					</>
				),
			},
			{
				q: "I'm an eBay seller — how do I opt out?",
				a: (
					<>
						Submit your itemId at <a href="/legal/takedown/">/legal/takedown</a>. Approved
						takedowns flush our cache for that item immediately and add it to a blocklist so it
						stops appearing in future scrapes.
					</>
				),
			},
			{
				q: "Do I need an eBay developer account?",
				a: (
					<>
						No. <code>api.flipagent.dev</code> mirrors eBay's Browse and Marketplace Insights paths
						exactly, so any eBay SDK works against it without OAuth. If you do have your own
						eBay developer credentials, you can swap the base URL and use the same flipagent-mcp
						server against <code>api.ebay.com</code> directly.
					</>
				),
			},
			{
				q: "How is this different from running my own scraper?",
				a: (
					<>
						You skip the parts that don't differentiate your product: residential proxy
						rotation, parser maintenance, response caching, takedown handling, and rate-limit
						math. The whole backend lives at <code>packages/api</code> in the public repo —
						yours to inspect, fork, or self-host.
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
						Yes — 100 calls / month, indefinitely. No card on file, no trial clock.
						Upgrade only when you outgrow it. See <a href="/pricing/">/pricing</a> for the full
						breakdown.
					</>
				),
			},
			{
				q: "What counts as a billable call?",
				a: (
					<>
						Each call to a marketplace or value-add endpoint —{" "}
						<code>/v1/listings/*</code>, <code>/v1/sold/*</code>, <code>/v1/orders/*</code>,{" "}
						<code>/v1/inventory/*</code>, <code>/v1/fulfillment/*</code>,{" "}
						<code>/v1/finance/*</code>, <code>/v1/markets/*</code>, <code>/v1/evaluate</code>,{" "}
						<code>/v1/discover</code>, <code>/v1/ship/*</code> — increments your monthly counter.
						Cache hits still count: you're paying for the latency, the parser, and the takedown
						layer. Free routes: <code>/healthz</code>, <code>/v1/keys/*</code>,{" "}
						<code>/v1/takedown</code>, and the billing routes themselves.
					</>
				),
			},
			{
				q: "What happens when I hit my monthly limit?",
				a: (
					<>
						You'll get <code>429 Too Many Requests</code> with a header pointing at the next
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
						the current billing period — no clawback, no awkward email.
					</>
				),
			},
			{
				q: "Do you offer refunds?",
				a: (
					<>
						We don't auto-refund unused calls in a billing period. For edge cases — duplicate
						charge, accidental upgrade, anything visibly broken on our end — email{" "}
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
				q: "Which endpoints do you cover?",
				a: (
					<>
						The full reseller cycle under one unified <code>/v1/*</code> surface:{" "}
						<code>/v1/listings</code> (search + detail), <code>/v1/sold</code> (comps),{" "}
						<code>/v1/evaluate</code> + <code>/v1/discover</code> (server-side scoring),{" "}
						<code>/v1/ship</code> (forwarder quote + catalog). Sell-side passes through to
						eBay via OAuth: <code>/v1/orders</code>, <code>/v1/inventory</code>,{" "}
						<code>/v1/fulfillment</code>, <code>/v1/finance</code>, <code>/v1/markets</code>.
						Bring your own eBay developer credentials for the sell-side.
					</>
				),
			},
			{
				q: "How fresh is the cached data?",
				a: (
					<>
						60 min for active listings, 12 hours for sold/completed, 4 hours for item detail.
						The cache is anti-thundering-herd, not archival — built so 1,000 agents asking the
						same question only hit eBay once.
					</>
				),
			},
			{
				q: "Can I use my existing eBay SDK?",
				a: (
					<>
						Yes. Any SDK that lets you override the base URL works — point it at{" "}
						<code>api.flipagent.dev</code> and pass your flipagent key as{" "}
						<code>Authorization: Bearer …</code> (or <code>X-API-Key</code>). For TypeScript we
						ship a typed <code>@flipagent/sdk</code> that wraps the full eBay surface area.
					</>
				),
			},
			{
				q: "What if eBay changes their response shape?",
				a: (
					<>
						We mirror eBay's response shape verbatim, so most additions pass through
						transparently. Breaking changes get a parser update — if you hit one in the wild,
						file an issue and we typically have it patched in hours, not days.
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
