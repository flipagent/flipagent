import { useState } from "react";
import "./AgentInstall.css";
import "./CodeTabs.css";

const STR = (s: string) => <span className="t-str">{s}</span>;
const FN = (s: string) => <span className="t-fn">{s}</span>;
const COM = (s: string) => <span className="t-com">{s}</span>;

interface CardProps {
	icon: React.ReactNode;
	eyebrow: string;
	tag: string;
	body: string;
	lines: React.ReactNode[];
	plain: string;
}

function InstallCard({ icon, eyebrow, tag, body, lines, plain }: CardProps) {
	const [copied, setCopied] = useState(false);
	async function handleCopy() {
		try {
			await navigator.clipboard.writeText(plain);
			setCopied(true);
			setTimeout(() => setCopied(false), 1400);
		} catch {
			/* ignore */
		}
	}
	return (
		<div className="install-card">
			<div className="install-eyebrow">
				<span className="install-eyebrow-icon" aria-hidden="true">
					{icon}
				</span>
				{eyebrow}
			</div>
			<p className="install-body">
				<strong>{tag}.</strong> {body}
			</p>
			<div className="install-code">
				<div className="install-code-head">
					<button type="button" className="install-copy" onClick={handleCopy}>
						<svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
							<rect x="5" y="5" width="9" height="9" rx="1.5" />
							<path d="M3 11V3a1 1 0 0 1 1-1h7" />
						</svg>
						{copied ? "Copied" : "Copy"}
					</button>
				</div>
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
			</div>
		</div>
	);
}

export default function AgentInstall() {
	const cliLines: React.ReactNode[] = [
		COM("# installs SDK + scaffolds your MCP config"),
		<>
			{FN("npx")} -y {STR("flipagent-cli@latest")} init --mcp --keys
		</>,
	];

	const mcpLines: React.ReactNode[] = [
		"{",
		<>{"  "}{STR('"mcpServers"')}: {"{"}</>,
		<>{"    "}{STR('"flipagent"')}: {"{"}</>,
		<>{"      "}{STR('"command"')}: {STR('"npx"')},</>,
		<>{"      "}{STR('"args"')}: [{STR('"-y"')}, {STR('"flipagent-mcp"')}],</>,
		<>{"      "}{STR('"env"')}: {"{"}</>,
		<>{"        "}{STR('"FLIPAGENT_API_KEY"')}: {STR('"fa_…"')}</>,
		<>{"      "}{"}"}</>,
		<>{"    "}{"}"}</>,
		<>{"  "}{"}"}</>,
		"}",
	];

	const cliPlain = "npx -y flipagent-cli@latest init --mcp --keys";
	const mcpPlain = `{
  "mcpServers": {
    "flipagent": {
      "command": "npx",
      "args": ["-y", "flipagent-mcp"],
      "env": {
        "FLIPAGENT_API_KEY": "fa_…"
      }
    }
  }
}`;

	return (
		<div className="install-grid">
			<InstallCard
				icon={
					<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
						<path d="M2 4l3 3-3 3M7 11h6" />
					</svg>
				}
				eyebrow="One command"
				tag="CLI"
				body="Detects your AI client and writes the MCP entry for you."
				lines={cliLines}
				plain={cliPlain}
			/>
			<InstallCard
				icon={
					<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
						<path d="M5 2v4M11 2v4M3 6h10v3a5 5 0 0 1-10 0V6zM8 14v0" />
					</svg>
				}
				eyebrow="Manual config"
				tag="MCP"
				body="Paste this into any MCP-compatible AI client."
				lines={mcpLines}
				plain={mcpPlain}
			/>
		</div>
	);
}
