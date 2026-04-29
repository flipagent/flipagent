#!/usr/bin/env bash
# Spin up a Cloudflare tunnel from $TUNNEL_HOSTNAME → http://localhost:$PORT.
#
# Idempotent: creates the tunnel + DNS route on first run, just runs the
# tunnel after. Used for dev work that needs an HTTPS-reachable URL —
# eBay OAuth callback (RuName redirect lives at dev.flipagent.dev),
# eBay event notifications, Stripe webhooks, etc.
#
# Usage:  npm run tunnel                       (from packages/api/)
#         PORT=4001 npm run tunnel             (override port)
#         TUNNEL_HOSTNAME=other.example.dev npm run tunnel  (override hostname)
#
# Note: variable is TUNNEL_HOSTNAME, not HOSTNAME — macOS auto-sets HOSTNAME
# to the machine name in interactive shells, which would override our default.
#
# We write a project-local cloudflared config so an existing global
# ~/.cloudflared/config.yml (e.g. for another project) can't hijack our
# ingress and route traffic to the wrong port.

set -euo pipefail

TUNNEL_NAME="${TUNNEL_NAME:-flipagent-dev}"
TUNNEL_HOSTNAME="${TUNNEL_HOSTNAME:-dev.flipagent.dev}"
PORT="${PORT:-4000}"

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

# 5. Route DNS hostname to the tunnel. Use UUID rather than name — when
#    multiple tunnels share a name (e.g. across CF accounts/zones), the
#    name-based lookup can resolve to the wrong one. UUID is unambiguous.
#    Idempotent: if the CNAME exists but points to a different tunnel, force
#    overwrite via `--overwrite-dns`.
echo "🌐 Routing $TUNNEL_HOSTNAME → $TUNNEL_NAME ($TUNNEL_ID)"
cloudflared tunnel route dns --overwrite-dns "$TUNNEL_ID" "$TUNNEL_HOSTNAME" 2>&1 | grep -v "already exists" || true

# 6. Write a project-local config so the global ~/.cloudflared/config.yml
#    can't intercept our ingress (e.g. when another project has its own
#    config.yml mapping a different hostname to a different port).
cat > "$LOCAL_CONFIG" <<EOF
tunnel: ${TUNNEL_ID}
credentials-file: ${CREDS_FILE}
protocol: http2

ingress:
  - hostname: ${TUNNEL_HOSTNAME}
    service: http://localhost:${PORT}
  - service: http_status:404
EOF

# 7. Run the tunnel using our local config (overrides ~/.cloudflared/config.yml).
echo ""
echo "────────────────────────────────────────────────────────────"
echo "  https://$TUNNEL_HOSTNAME → http://localhost:$PORT"
echo "  Tunnel: $TUNNEL_NAME ($TUNNEL_ID)"
echo "  Config: $LOCAL_CONFIG"
echo "  Ctrl+C to stop."
echo "────────────────────────────────────────────────────────────"
echo ""
exec cloudflared tunnel --config "$LOCAL_CONFIG" run "$TUNNEL_NAME"
