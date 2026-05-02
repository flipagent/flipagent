# infra/azure-channels

Optional sidecar VM that runs **Claude Code Channels** with `flipagent-mcp`
loaded — so a Discord channel becomes a frontend to the flipagent toolchain.
Sibling of `infra/azure`; independent lifecycle (you can destroy it without
touching the prod api).

| Resource | Why |
|---|---|
| Resource Group `flipagent-channels-<env>` | Independent blast radius |
| VNet + Subnet + NSG (port 22 only) | Reachable from your IP, nothing else |
| Static Public IP | Survives deallocate/start cycles |
| Linux VM (Ubuntu 24.04, B2s by default) | Runs Claude Code in a tmux+systemd loop |

## What you get

- A VM with Node 22, Claude Code (`@anthropic-ai/claude-code`), and the
  `flipagent` repo cloned + built.
- `flipagent-mcp` registered under Claude Code's user scope, so any session
  on that VM (including the Channels one) sees `evaluate_listing`,
  `ebay_search`, `ebay_buy_item`, etc.
- A systemd unit (`flipagent-channels.service`) that runs
  `claude --channels` inside a detached tmux session, restarts on failure,
  and tails to journalctl.
- A `Makefile` for the on/off cycle.

## Cost (eastus2, no Azure credits)

| State | ~$/mo |
|---|---|
| Running 24/7 (B2s) | $30–35 |
| Deallocated (disk only) | $3 |
| Running ~3h/day | $4–5 |

Spin up only when you want; deallocate when you're done.

## First-time deploy

```bash
cd infra/azure-channels

cp terraform.tfvars.example terraform.tfvars
$EDITOR terraform.tfvars                    # set ssh_pubkey_path + ssh_source_cidr

terraform init
terraform apply

# SSH in (also surfaced as `make ssh`):
$(terraform output -raw ssh_command)

# On the VM:
sudo tail -f /var/log/cloud-init-output.log # watch bootstrap finish (5–10 min)

# Once you see "flipagent-channels VM bootstrapped":
sudoedit /etc/flipagent-channels.env        # fill keys + Discord IDs
claude /login                                # one-time Anthropic login (interactive)
sudo systemctl enable --now flipagent-channels
sudo journalctl -u flipagent-channels -f    # confirm Channels is listening
```

## /etc/flipagent-channels.env

```
ANTHROPIC_API_KEY=sk-ant-...                # for the matcher; Claude Code itself uses /login
FLIPAGENT_API_KEY=fa_...                    # issued from the dashboard
FLIPAGENT_BASE_URL=https://api.flipagent.dev
DISCORD_BOT_TOKEN=...                        # Discord developer portal → bot token
DISCORD_CHANNEL_ID=...                       # right-click channel → Copy Channel ID
DISCORD_ALLOWED_USER_IDS=123,456             # comma-separated; only these IDs can issue commands
```

`DISCORD_*` names track what the Channels plugin reads — confirm against
the version of Claude Code you installed (`claude --version`); the
research-preview flag set may have shifted.

## Day-to-day

```bash
make up        # az vm start — VM boots, systemd unit auto-starts, channel goes live
make down      # az vm deallocate — stops compute billing
make status    # power state + systemd unit status (over SSH)
make logs      # tail journalctl for the Channels session
make ssh       # interactive shell
make rebuild   # taint VM + re-apply (wipes ~/.claude, re-clones repo)
make destroy   # terraform destroy — full teardown
```

The IP is static (`terraform output -raw public_ip`), so your `~/.ssh/config`
entry survives deallocate/start.

## When NOT to use this

- **Real multi-tenant Discord access** (each user buys against their own
  eBay account). Channels gives one Claude Code session bound to one
  Anthropic login — every Discord command runs as the same user with the
  same `FLIPAGENT_API_KEY`. Fine for showcase / small allowlist; wrong shape
  for "open it up to a public channel."
- **Production-grade uptime.** This is one VM, no HA. If `az vm deallocate`
  is your "off switch," that's by design — don't expect five-nines.
- For multi-tenant, build a Discord bot on top of the
  [Claude Agent SDK](https://platform.claude.com/docs/en/agent-sdk/mcp)
  with per-user `FLIPAGENT_API_KEY` mapping. Different infra; sibling
  module candidate (`infra/azure-discord-bot/`) when you need it.

## Tearing down

```bash
make destroy
```

Wipes the RG including the OS disk. Anthropic login + Discord token live on
that disk; rotate the bot token if you're paranoid.
