#!/usr/bin/env python3
"""Run the desk setup on the instance over SSM, where it can be watched step by step."""
import json
import subprocess
import sys
import time

REGION = "ap-south-1"
INSTANCE = sys.argv[1] if len(sys.argv) > 1 else "i-059ae54739750fbae"

COMMANDS = [
    "set -euxo pipefail",
    # SSM runs this as root with a bare environment: HOME is not set, and `set -u` would kill the run.
    "export HOME=/root",
    "export PATH=$HOME/.local/bin:/usr/local/bin:/usr/bin:$PATH",
    "dnf install -y git nodejs npm jq",
    "curl -LsSf https://astral.sh/uv/install.sh | sh",
    'git clone --depth 1 https://github.com/comfyanonymous/ComfyUI.git "$HOME/comfy/ComfyUI" || true',
    "git clone --depth 1 https://github.com/LangerSword/late-edition.git /opt/late-edition || true",
    "cd /opt/late-edition && git pull --ff-only || true",
    "cd /opt/late-edition && bash tools/desk/desk.sh setup",
    'uv pip install --python "$HOME/.venv/bin/python" "huggingface_hub[cli]"',
    "cd /opt/late-edition && bash tools/print-desk/fetch-models.sh",
    "cd /opt/late-edition && bash tools/desk/desk.sh server",
    "cd /opt/late-edition && bash tools/desk/tunnel.sh start",
    "echo DESK READY",
]


def aws(*args):
    return subprocess.run(["aws", *args], capture_output=True, text=True).stdout


print("→ sending the setup to", INSTANCE)
command_id = aws(
    "ssm", "send-command", "--region", REGION, "--instance-ids", INSTANCE,
    "--document-name", "AWS-RunShellScript",
    "--timeout-seconds", "3600",
    "--parameters", json.dumps({"commands": COMMANDS, "executionTimeout": ["3600"]}),
    "--query", "Command.CommandId", "--output", "text",
).strip()
print("  command", command_id)

for _ in range(90):
    time.sleep(20)
    status = aws(
        "ssm", "get-command-invocation", "--region", REGION,
        "--command-id", command_id, "--instance-id", INSTANCE,
        "--query", "[Status,StandardOutputContent,StandardErrorContent]", "--output", "json",
    )
    try:
        state, out, err = json.loads(status)
    except Exception:
        continue
    if state in ("Pending", "InProgress", "Delayed"):
        tail = (out or "").strip().splitlines()[-1:] or [""]
        print(f"  [{state}] {tail[0][:150]}")
        continue
    print(f"\n=== {state} ===")
    print((out or "").strip()[-2500:])
    if err:
        print("--- stderr ---")
        print(err.strip()[-1200:])
    break
