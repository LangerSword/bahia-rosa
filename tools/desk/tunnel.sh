#!/usr/bin/env bash
# Host the desk for nothing.
#
# The desk already runs on this machine; a Cloudflare tunnel gives it a public HTTPS address without
# opening a port, without a certificate, and without an account. The deployed app then points at it
# with ?desk=<url> — the print runs here, on the GPU that is already paid for.
#
#   tools/desk/tunnel.sh start      bring up the front door + the tunnel, print the app URL
#   tools/desk/tunnel.sh url        just the URL
#   tools/desk/tunnel.sh stop       take the tunnel down (the desk keeps running)
#
# Caveats, plainly: this machine has to stay awake, and the quick-tunnel hostname changes every time
# it starts. For a stable address on your own domain, see the named-tunnel note at the bottom.
set -euo pipefail

PROJECT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
STATE="${XDG_STATE_HOME:-$HOME/.local/state}/fifteen-minutes"
FRONT_PORT="${FRONT_PORT:-8790}"
APP_URL="${APP_URL:-https://langersword.github.io/late-edition/}"
BIN="${CLOUDFLARED_BIN:-$HOME/.local/bin/cloudflared}"
mkdir -p "$STATE"

log()  { printf '\033[38;5;218m▸\033[0m %s\n' "$*"; }
ok()   { printf '\033[38;5;85m✓\033[0m %s\n' "$*"; }
warn() { printf '\033[38;5;215m!\033[0m %s\n' "$*"; }
die()  { printf '\033[38;5;204m✗\033[0m %s\n' "$*" >&2; exit 1; }

front_up() { curl -fsS --max-time 3 "http://127.0.0.1:$FRONT_PORT/health" >/dev/null 2>&1; }

ensure_cloudflared() {
  [[ -x "$BIN" ]] && return 0
  if command -v cloudflared >/dev/null; then BIN="$(command -v cloudflared)"; return 0; fi
  log "no cloudflared yet — fetching the static binary to $BIN (no root needed)"
  mkdir -p "$(dirname "$BIN")"
  local arch; arch="$(uname -m)"
  local asset="cloudflared-linux-amd64"
  [[ "$arch" == "aarch64" ]] && asset="cloudflared-linux-arm64"
  curl -fsSL "https://github.com/cloudflare/cloudflared/releases/latest/download/$asset" -o "$BIN" \
    || die "could not download cloudflared — install it with your package manager instead"
  chmod +x "$BIN"
  ok "cloudflared at $BIN"
}

tunnel_url() {
  # cloudflared prints the assigned hostname once, on stderr, as it connects.
  grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' "$STATE/tunnel.log" 2>/dev/null | head -1
}

start() {
  front_up || { log "the front door is not up — starting it"; bash "$PROJECT/tools/desk/desk.sh" start >/dev/null; }
  front_up || die "the front door never came up (tools/desk/front.mjs) — run tools/desk/desk.sh start and look at $STATE/front.log"
  ensure_cloudflared

  if [[ -n "$(tunnel_url)" ]] && [[ -f "$STATE/tunnel.pid" ]] && kill -0 "$(cat "$STATE/tunnel.pid")" 2>/dev/null; then
    ok "tunnel already up"; url
    return 0
  fi

  log "opening the tunnel to the front door on :$FRONT_PORT"
  : >"$STATE/tunnel.log"
  setsid nohup "$BIN" tunnel --url "http://127.0.0.1:$FRONT_PORT" --no-autoupdate \
    >>"$STATE/tunnel.log" 2>&1 &
  echo $! >"$STATE/tunnel.pid"

  for _ in $(seq 1 30); do
    sleep 2
    [[ -n "$(tunnel_url)" ]] && break
  done
  [[ -n "$(tunnel_url)" ]] || die "the tunnel did not report a hostname — see $STATE/tunnel.log"
  url
}

url() {
  local host; host="$(tunnel_url)"
  [[ -n "$host" ]] || die "no tunnel URL yet — run: tools/desk/tunnel.sh start"
  ok "desk is public at  $host"
  echo
  echo "  Point the deployed app at it:"
  echo "    ${APP_URL}?desk=${host}"
  echo
  echo "  Or bake it in for the submission build:"
  echo "    VITE_PRINT_DESK_URL=${host} npm run build"
  echo
  warn "quick tunnels change hostname on every restart — re-run the ?desk= link after one."
}

stop() {
  if [[ -f "$STATE/tunnel.pid" ]] && kill -0 "$(cat "$STATE/tunnel.pid")" 2>/dev/null; then
    kill "$(cat "$STATE/tunnel.pid")" 2>/dev/null || true
    rm -f "$STATE/tunnel.pid"
    ok "tunnel closed (the desk itself is still running)"
  else
    warn "no tunnel was running"
  fi
}

case "${1:-start}" in
  start) start ;;
  url)   url ;;
  stop)  stop ;;
  *) die "unknown argument: $1 — try start | url | stop" ;;
esac

# A stable address on your own domain (recommended once you have tried the quick one):
#
#   cloudflared tunnel login                       # opens a browser, pick langersword.in
#   cloudflared tunnel create late-edition-desk
#   cloudflared tunnel route dns late-edition-desk desk.langersword.in
#   cloudflared tunnel run --url http://127.0.0.1:8790 late-edition-desk
#
# Then the desk is always https://desk.langersword.in, and the submission build can default to it.
