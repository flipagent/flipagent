/**
 * Pricing-page row for `/v1/agent/chat`. Inline Radix Select picks the
 * model; credits/turn + tier note update in place. One row, two
 * options — replaces the previous two-row layout that listed each
 * model separately.
 */

import * as RxSelect from "@radix-ui/react-select";
import { useState } from "react";

type AgentModel = "gpt-5.4-mini" | "gemini-2.5-flash" | "claude-sonnet-4-7" | "gpt-5.5";

const MODELS: ReadonlyArray<{ id: AgentModel; credits: number }> = [
	{ id: "gpt-5.4-mini", credits: 5 },
	{ id: "gemini-2.5-flash", credits: 3 },
	{ id: "claude-sonnet-4-7", credits: 15 },
	{ id: "gpt-5.5", credits: 25 },
];

const ROW_NOTE = "Plan a flip, run an evaluation, draft a listing, queue a buy. All in chat.";

export default function AgentChatPriceRow() {
	const [model, setModel] = useState<AgentModel>("gpt-5.4-mini");
	const active = MODELS.find((m) => m.id === model) ?? MODELS[0]!;
	return (
		<div className="pricing-row-item">
			<div className="pricing-row-item-text">
				<svg
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
					<path d="M21 12c0 4.97-4.03 9-9 9-1.4 0-2.73-.32-3.92-.89L3 21l1.05-3.94A8.96 8.96 0 0 1 3 12c0-4.97 4.03-9 9-9s9 4.03 9 9z" />
				</svg>
				<div>
					<span className="agent-chat-title">
						Agent chat (<ModelSelect value={model} onChange={setModel} />)
					</span>
					<span>{ROW_NOTE}</span>
				</div>
			</div>
			<div className="pricing-row-item-value">
				<span className="num">{active.credits}</span>
				<span className="unit">/ turn</span>
			</div>
		</div>
	);
}

function ModelSelect({
	value,
	onChange,
}: {
	value: AgentModel;
	onChange: (v: AgentModel) => void;
}) {
	return (
		<RxSelect.Root value={value} onValueChange={(v) => onChange(v as AgentModel)}>
			<RxSelect.Trigger
				className="agent-chat-model-trigger"
				aria-label="Pick an agent model"
			>
				<RxSelect.Value>{value}</RxSelect.Value>
				<RxSelect.Icon aria-hidden="true" className="agent-chat-model-chev">
					<svg
						width="9"
						height="9"
						viewBox="0 0 10 10"
						fill="none"
						stroke="currentColor"
						strokeWidth="1.6"
						strokeLinecap="round"
						strokeLinejoin="round"
					>
						<path d="m3 4 2 2 2-2" />
					</svg>
				</RxSelect.Icon>
			</RxSelect.Trigger>
			<RxSelect.Portal>
				<RxSelect.Content position="popper" sideOffset={4} className="agent-chat-model-content">
					<RxSelect.Viewport className="agent-chat-model-viewport">
						{MODELS.map((m) => (
							<RxSelect.Item key={m.id} value={m.id} className="agent-chat-model-item">
								<RxSelect.ItemText>{m.id}</RxSelect.ItemText>
								<RxSelect.ItemIndicator className="agent-chat-model-check" aria-hidden="true">
									<svg
										width="12"
										height="12"
										viewBox="0 0 12 12"
										fill="none"
										stroke="currentColor"
										strokeWidth="2"
										strokeLinecap="round"
										strokeLinejoin="round"
									>
										<path d="m2.5 6 2.5 2.5L9.5 3.5" />
									</svg>
								</RxSelect.ItemIndicator>
							</RxSelect.Item>
						))}
					</RxSelect.Viewport>
				</RxSelect.Content>
			</RxSelect.Portal>
		</RxSelect.Root>
	);
}
