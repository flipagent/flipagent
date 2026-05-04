# flipagent-cli

Set up flipagent for AI agents and drive the API from your shell.
Zero runtime deps — node built-ins only — so `npx -y` is fast.

```bash
npm install -g flipagent-cli   # or just use npx -y flipagent-cli
```

## Auth (one-time)

```bash
# Get a free key at https://flipagent.dev/signup, then:
flipagent login --key fa_free_xxx

# Verify
flipagent whoami
```

Stored at `~/.flipagent/config.json` (mode 0600). Subsequent commands
pick it up automatically. Auth precedence: `--key` flag > `FLIPAGENT_API_KEY`
env > stored config.

## Drive the API

```bash
# Search active listings (eBay-shape envelope)
flipagent search "canon ef 50mm 1.8" --limit 10

# Search sold listings (last 90 days)
flipagent sold "canon ef 50mm 1.8" --limit 50

# Score one listing — composite (server fetches detail + sold + active)
flipagent evaluate 'v1|123456789|0'

# Forwarder catalog + per-item quote
flipagent ship providers
flipagent ship quote --item 'v1|123456789|0' --weight 500 --dest NY
```

All commands print JSON to stdout — pipe to `jq`, redirect to a file,
or read from another script.

## Set up MCP

```bash
flipagent init --mcp
```

Detects the MCP host config on this machine (Claude Code by default;
the installer also recognizes other common stdio hosts), writes the
flipagent server entry, and backs up the original config (`<path>.bak`)
on first touch. Restart the host after running.

Re-running is idempotent — only the `flipagent` entry is replaced.

## All commands

`flipagent --help` (or `-h`) prints the full reference; the canonical
list lives there. Headlines:

```
# Auth + diagnostics
flipagent login [--key <value>] [--base-url <url>]
flipagent logout
flipagent whoami
flipagent doctor                                         # which features wired + key scope

# Sourcing + decisions
flipagent search <query> [--limit N] [--filter <expr>] [--sort <key>]
flipagent sold <query> [--limit N]
flipagent evaluate <itemId> [--lookback-days N] [--sold-limit N] [--min-net <cents>]
flipagent ship providers
flipagent ship quote --item <id> --weight <g> --dest <state> [--provider <id>]

# Buy
flipagent buy <itemId> [--quantity N] [--variation <id>]

# Sell + finance
flipagent sales list [--status paid|shipped|delivered|refunded|cancelled] [--limit N]
flipagent sales ship <orderId> --tracking <num> --carrier <name>
flipagent payouts list [--limit N]
flipagent transactions list [--type sale|refund|fee|adjustment] [--payout-id <id>] [--limit N]

# Buyer comms + post-sale
flipagent messages list [--type from_ebay|from_members] [--limit N]
flipagent messages thread <conversationId> --type from_ebay|from_members
flipagent messages send (--conversation <id> | --to <username>) --body <text> [--listing <itemId>]
flipagent offers list [--direction incoming|outgoing] [--status pending|accepted|...]
flipagent disputes list [--status open|awaiting_seller|...] [--type return|cancellation|inr|snad|inquiry]
flipagent feedback awaiting
flipagent feedback list [--role buyer|seller] [--rating positive|neutral|negative]

# Setup
flipagent init [--mcp] [--keys] [--key <value>]
```

## Manual MCP setup

If you'd rather paste it yourself, drop this into your host's MCP config:

```jsonc
{
  "mcpServers": {
    "flipagent": {
      "command": "npx",
      "args": ["-y", "flipagent-mcp"],
      "env": { "FLIPAGENT_API_KEY": "fa_free_xxx" }
    }
  }
}
```

## Get a key

[flipagent.dev/signup](https://flipagent.dev/signup) — free tier (1,000 credits one-time, no card).

## License

MIT.
