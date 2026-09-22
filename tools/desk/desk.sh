#!/usr/bin/env bash
# The desk runner — one command to bring the whole local stack up, and one to take it down.
#
#   tools/desk/desk.sh start     ComfyUI (the print desk) + the app, waiting until both answer
#   tools/desk/desk.sh stop      stop whatever this script started
#   tools/desk/desk.sh status    ports, pids, GPU, and whether each service actually responds
#   tools/desk/desk.sh logs desk|app
#
# Nothing here is exotic: it starts two processes, keeps their pids in ~/.local/state/fifteen-minutes,
# waits for a real health check instead of sleeping a fixed number of seconds, and refuses to start a
# second copy of anything that is already listening.

set -euo pipefail

PROJECT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
STATE="${XDG_STATE_HOME:-$HOME/.local/state}/fifteen-minutes"
COMFY_DIR="${COMFY_DIR:-$HOME/comfy/ComfyUI}"
PYTHON="${PRINT_DESK_PYTHON:-$HOME/.venv/bin/python}"
DESK_PORT="${DESK_PORT:-8188}"
APP_PORT="${APP_PORT:-5178}"
RESTORE_PORT="${RESTORE_PORT:-8788}"
FRONT_PORT="${FRONT_PORT:-8790}"
# ComfyUI 403s a foreign Origin; the front door is the gate, so the desk itself allows any origin.
DESK_ORIGINS="${DESK_ORIGINS:-*}"

mkdir -p "$STATE"

log()  { printf '\033[38;5;218m▸\033[0m %s\n' "$*"; }
ok()   { printf '\033[38;5;85m✓\033[0m %s\n' "$*"; }
warn() { printf '\033[38;5;215m!\033[0m %s\n' "$*"; }
die()  { printf '\033[38;5;204m✗\033[0m %s\n' "$*" >&2; exit 1; }

listening() { ss -tln 2>/dev/null | grep -q ":$1 "; }
desk_up()   { curl -fsS --max-time 2 "http://127.0.0.1:$DESK_PORT/system_stats" >/dev/null 2>&1; }
# Vite binds the IPv6 loopback ([::1]) — checking only 127.0.0.1 reports a healthy app as down.
app_up()    { curl -fsS --max-time 2 "http://localhost:$APP_PORT/" >/dev/null 2>&1 || curl -fsS --max-time 2 "http://127.0.0.1:$APP_PORT/" >/dev/null 2>&1; }
restore_up() { curl -fsS --max-time 2 "http://127.0.0.1:$RESTORE_PORT/health" >/dev/null 2>&1; }
front_up()  { curl -fsS --max-time 2 "http://127.0.0.1:$FRONT_PORT/health" >/dev/null 2>&1; }
alive()     { [[ -f "$1" ]] && kill -0 "$(cat "$1")" 2>/dev/null; }

wait_for() { # wait_for <label> <check-cmd> <seconds>
  local label="$1" check="$2" limit="$3" elapsed=0
  while (( elapsed < limit )); do
    if eval "$check"; then ok "$label ready (${elapsed}s)"; return 0; fi
    sleep 2; elapsed=$((elapsed + 2))
    (( elapsed % 10 == 0 )) && log "waiting for $label… ${elapsed}s"
  done
  return 1
}

reclaim_port() { # reclaim_port <port> <label> <expected-substring>
  local port="$1" label="$2" pattern="$3" pid cmd
  for pid in $(ss -tlnp 2>/dev/null | grep ":$port " | grep -o 'pid=[0-9]*' | cut -d= -f2 | sort -u); do
    cmd="$(tr '\0' ' ' < "/proc/$pid/cmdline" 2>/dev/null || true)"
    if [[ "$cmd" == *"$pattern"* ]]; then
      warn "$label: port $port is held by a stale pid $pid — stopping it"
      kill "$pid" 2>/dev/null || true
      for _ in $(seq 1 10); do kill -0 "$pid" 2>/dev/null || break; sleep 1; done
      if kill -0 "$pid" 2>/dev/null; then kill -9 "$pid" 2>/dev/null || true; sleep 1; fi
    else
      die "port $port is held by pid $pid, which does not look like $label: $cmd"
    fi
  done
}

start_desk() {
  if desk_up; then ok "print desk already answering on :$DESK_PORT"; return 0; fi
  [[ -f "$COMFY_DIR/main.py" ]] || die "no main.py in $COMFY_DIR — set COMFY_DIR to your ComfyUI checkout"
  [[ -x "$PYTHON" ]] || die "no python at $PYTHON — set PRINT_DESK_PYTHON"
  # A desk that is mid-load listens but does not answer: give it a moment before calling it stale.
  listening "$DESK_PORT" && { wait_for "print desk (already booting)" "desk_up" 60 && return 0; }
  listening "$DESK_PORT" && reclaim_port "$DESK_PORT" "the print desk" "main.py"

  log "starting ComfyUI from $COMFY_DIR (log: $STATE/desk.log)"
  # --fast: fp16 accumulate on the matmuls. --preview-method none: no preview frames, less overhead.
  # --enable-cors-header: ComfyUI answers a foreign Origin with 403, which is exactly what the
  # deployed app is — the front door (front.mjs) is what gates who may print, not this header.
  ( cd "$COMFY_DIR" && setsid nohup "$PYTHON" main.py \
      --listen 127.0.0.1 --port "$DESK_PORT" --disable-auto-launch \
      --enable-cors-header "$DESK_ORIGINS" \
      --fast --preview-method none \
      >>"$STATE/desk.log" 2>&1 & echo $! >"$STATE/desk.pid" )
  # First boot loads CUDA and the node registry; on a cold cache this is the slow part.
  wait_for "print desk" "desk_up" 240 || die "the desk did not come up — see $STATE/desk.log"
}

start_app() {
  if app_up; then ok "app already answering on :$APP_PORT"; return 0; fi
  listening "$APP_PORT" && reclaim_port "$APP_PORT" "the app" "node"
  log "starting the app (log: $STATE/app.log)"
  ( cd "$PROJECT" && setsid nohup npm run dev -- --port "$APP_PORT" --strictPort \
      >>"$STATE/app.log" 2>&1 & echo $! >"$STATE/app.pid" )
  wait_for "app" "app_up" 90 || die "the app did not come up — see $STATE/app.log"
}

# The finishing service: framing + face restore, the two steps the browser cannot run itself.
start_restore() {
  if restore_up; then ok "restore service already answering on :$RESTORE_PORT"; return 0; fi
  log "starting the restore service (log: $STATE/restore.log)"
  ( cd "$PROJECT" && setsid nohup node tools/desk/restore.mjs >>"$STATE/restore.log" 2>&1 & echo $! >"$STATE/restore.pid" )
  wait_for "restore service" "restore_up" 30 || warn "the restore service did not come up — prints will skip face framing and restore"
}

# The single origin the app talks to, local or tunnelled (front.mjs): /print-desk, /restore-desk, /health.
start_front() {
  if front_up; then ok "desk front already answering on :$FRONT_PORT"; return 0; fi
  listening "$FRONT_PORT" && reclaim_port "$FRONT_PORT" "the desk front" "front.mjs"
  log "starting the desk front (log: $STATE/front.log)"
  ( cd "$PROJECT" && setsid nohup node tools/desk/front.mjs >>"$STATE/front.log" 2>&1 & echo $! >"$STATE/front.pid" )
  wait_for "desk front" "front_up" 30 || warn "the desk front did not come up — see $STATE/front.log"
}

stop_one() { # stop_one <name> <pidfile> <port> <expected-substring>
  local name="$1" pidfile="$2" port="$3" pattern="$4"
  if alive "$pidfile"; then
    local pid; pid="$(cat "$pidfile")"
    log "stopping $name (pid $pid)"
    kill -- "-$pid" 2>/dev/null || kill "$pid" 2>/dev/null || true
    for _ in $(seq 1 15); do alive "$pidfile" || break; sleep 1; done
    if alive "$pidfile"; then kill -9 "$pid" 2>/dev/null || true; fi
    rm -f "$pidfile"
  elif listening "$port"; then
    warn "$name has no live pid file but :$port is up — stopping it by port"
  else
    warn "$name was not running"
  fi
  # A launcher process can exit while its child keeps the socket, so the port is the real proof.
  sleep 1
  if listening "$port"; then
    warn "$name: :$port is still held — sweeping"
    reclaim_port "$port" "$name" "$pattern"
    sleep 1
  fi
  listening "$port" && die "$name still holds :$port"
  ok "$name down"
}

status() {
  printf '\n'
  if desk_up; then ok "print desk   http://127.0.0.1:$DESK_PORT  pid $(desk_pid)"
  elif listening "$DESK_PORT"; then warn "print desk   port $DESK_PORT listening but not answering"
  else warn "print desk   not running"; fi

  if app_up; then ok "app          http://localhost:$APP_PORT  pid $(app_pid)"
  elif listening "$APP_PORT"; then warn "app          port $APP_PORT listening but not answering"
  else warn "app          not running"; fi

  if restore_up; then ok "restore      http://127.0.0.1:$RESTORE_PORT  pid $(restore_pid)"
  else warn "restore      not running (prints will skip framing and face restore)"; fi

  if front_up; then ok "front        http://127.0.0.1:$FRONT_PORT  pid $(front_pid)  ← the app talks to this"
  else warn "front        not running (the app falls back to the /print-desk dev proxy)"; fi

  local models; models="$(ls "$COMFY_DIR/models/diffusion_models" 2>/dev/null | grep -c safetensors || true)"
  log "models       $models diffusion checkpoint(s) in $COMFY_DIR/models"
  command -v nvidia-smi >/dev/null && nvidia-smi --query-gpu=name,memory.used,memory.total,utilization.gpu \
    --format=csv,noheader | sed 's/^/             /'
  printf '\n'
}

desk_pid() { alive "$STATE/desk.pid" && cat "$STATE/desk.pid" || echo "external"; }
app_pid()  { alive "$STATE/app.pid"  && cat "$STATE/app.pid"  || echo "external"; }
restore_pid() { alive "$STATE/restore.pid" && cat "$STATE/restore.pid" || echo "external"; }
front_pid() { alive "$STATE/front.pid" && cat "$STATE/front.pid" || echo "external"; }

warm() { # load the weights before the first real print; on 8 GB that cold load is the long wait
  if ! desk_up; then warn "print desk is not up — warming skipped"; return 0; fi
  log "warming the desk (one tiny pass, so the first real print is not the slow one)"
  if node "$PROJECT/tools/print-desk/print.mjs" --warmup --server "http://127.0.0.1:$DESK_PORT" 2>&1 | tail -2; then
    ok "desk warm"
  else
    warn "warm-up failed — the desk still works, the first print will just be slower"
  fi
}

setup() { # one-time machine prep: the venv ComfyUI runs in, plus the print desk's own tools
  local venv; venv="$(dirname "$(dirname "$PYTHON")")"
  command -v uv >/dev/null || die "uv is required to manage the venv (curl -LsSf https://astral.sh/uv/install.sh | sh)"
  [[ -x "$PYTHON" ]] || { log "creating a venv at $venv"; uv venv "$venv"; }
  log "installing ComfyUI's requirements (existing torch is left in place)"
  uv pip install --python "$PYTHON" -r "$COMFY_DIR/requirements.txt" 2>&1 | tail -3
  log "installing the print desk's own tools — opencv for face framing"
  uv pip install --python "$PYTHON" opencv-python-headless pillow 2>&1 | tail -2
  ok "python side ready"
  cat <<EOF

Model files live under $COMFY_DIR/models:
  diffusion_models/flux-2-klein-4b-fp8.safetensors   (fast, distilled, 4 steps)
  diffusion_models/flux-2-klein-base-4b-fp8.safetensors   (better, 26 steps)
  text_encoders/  qwen3-4b fp4  ·  vae/ flux2
Fetch them with:  bash tools/print-desk/fetch-models.sh
Then:             bash tools/desk/desk.sh start
EOF
}

case "${1:-start}" in
  start)  start_desk; start_restore; start_front; start_app; warm ;;
  stop)   stop_one app "$STATE/app.pid" "$APP_PORT" "node"; stop_one front "$STATE/front.pid" "$FRONT_PORT" "front.mjs"; stop_one restore "$STATE/restore.pid" "$RESTORE_PORT" "restore.mjs"; stop_one desk "$STATE/desk.pid" "$DESK_PORT" "main.py"; status ;;
  restart) stop_one app "$STATE/app.pid" "$APP_PORT" "node"; stop_one front "$STATE/front.pid" "$FRONT_PORT" "front.mjs"; stop_one restore "$STATE/restore.pid" "$RESTORE_PORT" "restore.mjs"; stop_one desk "$STATE/desk.pid" "$DESK_PORT" "main.py"; start_desk; start_restore; start_front; start_app; warm ;;
  warm)   warm ;;
  status) status ;;
  logs)   tail -n "${2:-40}" -f "$STATE/${3:-desk}.log" ;;
  setup)  setup ;;
  *)      die "usage: desk.sh {start|stop|restart|warm|status|logs [lines] [desk|app|restore]|setup}" ;;
esac
