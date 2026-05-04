import type { TSchema } from "@sinclair/typebox";
import type { Config } from "../config.js";

/**
 * Toolsets group Phase 1 tools so the host can load only the slice the
 * user actually needs. The default slice ("core") stays inside common
 * host tool caps and within the model's selection-accuracy comfort zone.
 * Opt in to others via `FLIPAGENT_MCP_TOOLSETS=core,comms,forwarder,…`.
 *
 * Phase 1 scope only — non-Phase-1 toolsets (marketing, bulk, discovery)
 * have been removed from the V1 surface; the underlying SDK + service
 * wrappers stay in place at the API for re-introduction later.
 */
export type Toolset =
	| "core" // sourcing + decisions + buy + listing prereqs + sale fulfillment + finance — default-on
	| "comms" // messages + offers + disputes + feedback (post-sale buyer comms)
	| "forwarder" // /v1/forwarder/{provider}/* (Planet Express today)
	| "notifications" // webhooks + eBay platform notifications
	| "seller_account" // /v1/me/seller/* read-only diagnostics + sales tax
	| "admin"; // bridge surfaces, key introspection, status, browser primitive

export const ALL_TOOLSETS: readonly Toolset[] = [
	"core",
	"comms",
	"forwarder",
	"notifications",
	"seller_account",
	"admin",
] as const;

// `core` alone stays well under common host tool caps and within model
// selection-accuracy comfort. Other toolsets are opt-in via
// FLIPAGENT_MCP_TOOLSETS.
export const DEFAULT_TOOLSETS: readonly Toolset[] = ["core"] as const;

/**
 * Tool naming convention: `flipagent_<verb>_<resource>`, snake_case.
 * Action-leading names (`create_listing` over `listings_create`) align
 * better with how LLMs plan tool calls. The `flipagent_` prefix keeps
 * names collision-free when other MCP servers are loaded alongside.
 * Marketplace stays a *parameter*, never part of the tool name —
 * Amazon / Mercari adapters reuse the same names.
 */
export interface Tool {
	name: string;
	description: string;
	inputSchema: TSchema;
	execute: (config: Config, args: Record<string, unknown>) => Promise<unknown>;
	toolset: Toolset;
}
