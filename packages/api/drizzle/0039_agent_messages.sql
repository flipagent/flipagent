-- Agent surface migration to Vercel AI SDK. The OpenAI-Responses-API-only
-- `previous_response_id` chain (server-held thread state) is replaced with
-- a local `messages` column carrying the full Vercel AI SDK `UIMessage[]`
-- history. This unlocks running the agent against any provider
-- (OpenAI / Anthropic / Gemini), since neither Anthropic nor Gemini
-- expose a stateful thread API equivalent.
--
-- 0-user state means we drop `openai_response_id` outright — no backfill.

ALTER TABLE "agent_sessions" ADD COLUMN "messages" jsonb NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE "agent_sessions" DROP COLUMN "openai_response_id";
