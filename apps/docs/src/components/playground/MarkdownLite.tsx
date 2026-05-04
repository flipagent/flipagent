/**
 * Markdown rendering for chat output. Wraps `react-markdown` + `remark-gfm`
 * (GitHub-flavored markdown — tables, task lists, strikethrough). All
 * URLs are restricted to `http(s)` / `mailto` / relative; anything else
 * renders as plain text. Code fences get a copy button overlay.
 */

import { type ReactNode, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

const SAFE_URL = /^(https?:\/\/|mailto:|\/)/i;

function safeHref(href: unknown): string | undefined {
	if (typeof href !== "string") return undefined;
	return SAFE_URL.test(href) ? href : undefined;
}

function getCodeText(children: unknown): string {
	if (typeof children === "string") return children;
	if (Array.isArray(children)) return children.map(getCodeText).join("");
	if (children && typeof children === "object" && "props" in children) {
		const props = (children as { props?: { children?: unknown } }).props;
		return getCodeText(props?.children);
	}
	return "";
}

function FencedCode({ lang, children }: { lang?: string; children: ReactNode }) {
	const [copied, setCopied] = useState(false);
	const text = getCodeText(children);
	function copy() {
		navigator.clipboard
			.writeText(text)
			.then(() => {
				setCopied(true);
				setTimeout(() => setCopied(false), 1500);
			})
			.catch(() => {
				/* clipboard blocked — silent no-op */
			});
	}
	return (
		<pre className="md-code">
			<div className="md-code-bar">
				{lang ? <span className="md-code-lang">{lang}</span> : <span />}
				<button type="button" className="md-code-copy" onClick={copy}>
					{copied ? "✓ copied" : "copy"}
				</button>
			</div>
			<code>{children}</code>
		</pre>
	);
}

export function MarkdownLite({ text }: { text: string }) {
	if (!text) return null;
	return (
		<div className="md">
			<ReactMarkdown
				remarkPlugins={[remarkGfm]}
				components={{
					a: ({ href, children, ...rest }) => {
						const safe = safeHref(href);
						if (!safe) return <>{children}</>;
						return (
							<a {...rest} href={safe} target="_blank" rel="noopener noreferrer">
								{children}
							</a>
						);
					},
					code: ({ className, children, ...rest }) => {
						// Inline code (no className) vs fenced code blocks (className="language-X").
						const langMatch = /language-(\w+)/.exec(className ?? "");
						const isInline = !langMatch && !String(children).includes("\n");
						if (isInline) {
							return (
								<code className="md-inline-code" {...rest}>
									{children}
								</code>
							);
						}
						return <FencedCode lang={langMatch?.[1]}>{children}</FencedCode>;
					},
					pre: ({ children }) => <>{children}</>,
				}}
			>
				{text}
			</ReactMarkdown>
		</div>
	);
}
