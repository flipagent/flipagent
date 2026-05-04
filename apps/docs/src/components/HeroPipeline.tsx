/**
 * Landing-hero — single chat surface.
 *
 * The hero used to host a five-tab compose card (Sourcing · Evaluate ·
 * Buy · List · Ship) demoing each pipeline stage. It now renders the
 * agent chat directly: one window, one surface, no in-card tabs. The
 * pipeline stage demos still live elsewhere — section §01 walks the
 * end-to-end flow via PipelineCode below the hero.
 *
 * Two visitor classes:
 *   - **Logged in**: example chips deep-link to `/dashboard/?view=agent&seed=…`
 *     so the agent panel auto-sends the prompt as the first turn. Free
 *     typing on the landing surface still works against the live API.
 *   - **Logged out**: ConnectionsProvider supplies a no-network fallback
 *     so the surface mounts (no eBay status fetch errors). Phase-2 work
 *     wires a canned simulation under the chips.
 */

import { useSession } from "../lib/authClient";
import { ConnectionsProvider } from "./connections/ConnectionsContext";
import { PlaygroundAgent } from "./playground/PlaygroundAgent";

export default function HeroPipeline() {
	const session = useSession();
	const loggedIn = !!session.data?.user;

	function gotoDashboardWithSeed(prompt: string) {
		const url = `/dashboard/?view=agent&seed=${encodeURIComponent(prompt)}`;
		window.location.href = url;
	}

	return (
		<ConnectionsProvider mock={!loggedIn}>
			{/* `agent-host-hero` scopes a few CSS overrides to the landing
			    mount only — drops the "What do you want to flip today?"
			    title, kills the viewport-fill min-height, and tightens
			    spacing so the composer sits flush under the hero copy.
			    Dashboard mount has no wrapper class, default styling. */}
			<div className="agent-host-hero">
				<PlaygroundAgent
					mockMode={!loggedIn}
					onExamplePrompt={loggedIn ? gotoDashboardWithSeed : undefined}
				/>
			</div>
		</ConnectionsProvider>
	);
}
