---
"@flipagent/types": major
"@flipagent/sdk": major
"flipagent-mcp": major
"flipagent-cli": major
---

**Breaking: `/v1/messages` redesigned around eBay's conversation-threaded model.**

Previously `/v1/messages` returned a flat `Message[]` (Trading XML
GetMyMessages-shaped). It now returns `Conversation[]` matching
eBay's REST `commerce/message/v1` model. Three handlers replace
the old flat-list:

  GET  /v1/messages              → list conversations
  GET  /v1/messages/{id}?type=…  → fetch the messages within one thread
  POST /v1/messages              → send into existing thread (or open one)

**SDK**: `client.messages.list()` now returns `ConversationsListResponse`
(was `MessagesListResponse`). New methods `client.messages.thread(id, query)`
and `client.messages.send(MessageSendRequest)` (replaces the old
`send(MessageCreate)` shape — now requires `conversationId` OR
`otherPartyUsername` + `messageText`).

**MCP tools renamed**:
  - `flipagent_list_messages` → `flipagent_list_conversations`
  - new: `flipagent_get_conversation_thread`
  - `flipagent_send_message` body shape changed (see SDK)

**CLI**: `flipagent messages` flags changed from `--unread`/`--direction`/
`--subject` to `--type from_ebay|from_members`, `--conversation`/`--to`,
`--listing`. New `flipagent messages thread <id> --type <…>`.

**OAuth scopes added**: `commerce.message`, `commerce.feedback`. Existing
connected users will need to re-consent on next `/v1/connect/ebay/start`.

`/v1/feedback/*` migrated to REST internally too — external shape
unchanged.
