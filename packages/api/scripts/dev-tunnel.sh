#!/usr/bin/env bash
# Spin up a Cloudflare tunnel that mirrors prod's API + dashboard split:
#
#   https://api-dev.flipagent.dev → http://localhost:$PORT          (API)
#   https://dev.flipagent.dev     → http://localhost:$DASHBOARD_PORT (Dashboard, optional)
#
# One named tunnel, two ingress rules. Used for dev work that needs an
# HTTPS-reachable URL — eBay OAuth callback (RuName redirect points at
# api-dev.flipagent.dev/v1/connect/ebay/callback), eBay event
# notifications, Stripe webhooks, extension pairing through the
# dashboard's `/extension/connect` page, etc.
#
# Subdomain depth note: Cloudflare's free Universal SSL covers *.flipagent.dev
# (one level) but NOT *.dev.flipagent.dev (two levels) — multi-level wildcard
# certs need Advanced Certificate Manager. So we use single-level hyphenated
# names instead of nesting under `dev.`.
#
# Idempotent: creates the tunnel + DNS routes on first run, just runs the
# tunnel after.
#
# Usage:  npm run tunnel                              (api only, port 4000)
#         PORT=4001 npm run tunnel                    (api on 4001)
#         DASHBOARD_PORT=4321 npm run tunnel          (api + dashboard)
#         API_HOSTNAME=api-example.dev npm run tunnel (override api hostname)
#         DASHBOARD_HOSTNAME=other.example.dev …      (override dashboard hostname)
#
# Note: prefix env vars (TUNNEL_, API_, DASHBOARD_) — macOS auto-sets bare
# HOSTNAME to the machine name in interactive shells.
#
# We write a project-local cloudflared config so an existing global
# ~/.cloudflared/config.yml (e.g. for another project) can't hijack our
# ingress and route traffic to the wrong port.

set -euo pipefail

TUNNEL_NAME="${TUNNEL_NAME:-flipagent-dev}"
API_HOSTNAME="${API_HOSTNAME:-${TUNNEL_HOSTNAME:-api-dev.flipagent.dev}}"
DASHBOARD_HOSTNAME="${DASHBOARD_HOSTNAME:-dev.flipagent.dev}"
PORT="${PORT:-4000}"
# DASHBOARD_PORT empty = skip dashboard ingress (api-only tunnel).
DASHBOARD_PORT="${DASHBOARD_PORT:-}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOCAL_CONFIG="${SCRIPT_DIR}/.cloudflared.yml"

# 1. Verify cloudflared installed.
if ! command -v cloudflared >/dev/null 2>&1; then
	echo "❌ cloudflared not found."
	echo "   Install:  brew install cloudflared    (macOS)"
	echo "             https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/   (other platforms)"
	exit 1
fi

# 2. Verify authenticated. The cert lives in ~/.cloudflared/cert.pem after
#    `cloudflared tunnel login`. Run interactively if missing.
CERT_PATH="${HOME}/.cloudflared/cert.pem"
if [ ! -f "$CERT_PATH" ]; then
	echo "🔐 No Cloudflare cert found. Opening browser to authenticate…"
	cloudflared tunnel login
fi

# 3. Create the tunnel if it doesn't exist. The CLI prints the tunnel id +
#    writes credentials to ~/.cloudflared/<id>.json.
if ! cloudflared tunnel list 2>/dev/null | awk 'NR>1 {print $2}' | grep -qx "$TUNNEL_NAME"; then
	echo "🚇 Creating tunnel '$TUNNEL_NAME'…"
	cloudflared tunnel create "$TUNNEL_NAME"
else
	echo "✅ Tunnel '$TUNNEL_NAME' already exists."
fi

# 4. Look up the tunnel id + credentials file (needed for the local config).
TUNNEL_ID="$(cloudflared tunnel list 2>/dev/null | awk -v name="$TUNNEL_NAME" 'NR>1 && $2==name {print $1}')"
if [ -z "$TUNNEL_ID" ]; then
	echo "❌ Could not resolve tunnel id for '$TUNNEL_NAME'."
	exit 1
fi
CREDS_FILE="${HOME}/.cloudflared/${TUNNEL_ID}.json"
if [ ! -f "$CREDS_FILE" ]; then
	echo "❌ Tunnel credentials missing: $CREDS_FILE"
	exit 1
fi

# 5. Route DNS hostnames to the tunnel. Use UUID rather than name — when
#    multiple tunnels share a name (e.g. across CF accounts/zones), the
#    name-based lookup can resolve to the wrong one. UUID is unambiguous.
#    Idempotent: if the CNAME exists but points to a different tunnel, force
#    overwrite via `--overwrite-dns`.
echo "🌐 Routing $API_HOSTNAME → $TUNNEL_NAME ($TUNNEL_ID)"
cloudflared tunnel route dns --overwrite-dns "$TUNNEL_ID" "$API_HOSTNAME" 2>&1 | grep -v "already exists" || true
if [ -n "$DASHBOARD_PORT" ]; then
	echo "🌐 Routing $DASHBOARD_HOSTNAME → $TUNNEL_NAME ($TUNNEL_ID)"
	cloudflared tunnel route dns --overwrite-dns "$TUNNEL_ID" "$DASHBOARD_HOSTNAME" 2>&1 | grep -v "already exists" || true
fi

# 6. Write a project-local config so the global ~/.cloudflared/config.yml
#    can't intercept our ingress (e.g. when another project has its own
#    config.yml mapping a different hostname to a different port).
{
	echo "tunnel: ${TUNNEL_ID}"
	echo "credentials-file: ${CREDS_FILE}"
	echo "protocol: http2"
	echo ""
	echo "ingress:"
	echo "  - hostname: ${API_HOSTNAME}"
	echo "    service: http://localhost:${PORT}"
	if [ -n "$DASHBOARD_PORT" ]; then
		echo "  - hostname: ${DASHBOARD_HOSTNAME}"
		echo "    service: http://localhost:${DASHBOARD_PORT}"
	fi
	echo "  - service: http_status:404"
} > "$LOCAL_CONFIG"

# 7. Run the tunnel using our local config (overrides ~/.cloudflared/config.yml).
echo ""
echo "────────────────────────────────────────────────────────────"
echo "  https://$API_HOSTNAME → http://localhost:$PORT  (API)"
if [ -n "$DASHBOARD_PORT" ]; then
	echo "  https://$DASHBOARD_HOSTNAME → http://localhost:$DASHBOARD_PORT  (Dashboard)"
fi
echo "  Tunnel: $TUNNEL_NAME ($TUNNEL_ID)"
echo "  Config: $LOCAL_CONFIG"
echo "  Ctrl+C to stop."
echo "────────────────────────────────────────────────────────────"
echo ""
exec cloudflared tunnel --config "$LOCAL_CONFIG" run "$TUNNEL_NAME"
