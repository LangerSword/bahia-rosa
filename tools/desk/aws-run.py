#!/usr/bin/env python3
"""Send one command to the desk instance and wait for it, however long it takes."""
import json
import subprocess
import sys
import time

REGION = "ap-south-1"
INSTANCE = "i-059ae54739750fbae"
cmd = sys.argv[1]
minutes = int(sys.argv[2]) if len(sys.argv) > 2 else 25

command_id = subprocess.run(
    ["aws", "ssm", "send-command", "--region", REGION, "--instance-ids", INSTANCE,
     "--document-name", "AWS-RunShellScript",
     "--timeout-seconds", str(minutes * 60),
     "--parameters", json.dumps({"commands": [cmd], "executionTimeout": [str(minutes * 60)]}),
     "--query", "Command.CommandId", "--output", "text"],
    capture_output=True, text=True,
).stdout.strip()
print("command", command_id, flush=True)

deadline = time.time() + minutes * 60
while time.time() < deadline:
    time.sleep(20)
    raw = subprocess.run(
        ["aws", "ssm", "get-command-invocation", "--region", REGION, "--command-id", command_id,
         "--instance-id", INSTANCE, "--query", "[Status,StandardOutputContent,StandardErrorContent]",
         "--output", "json"],
        capture_output=True, text=True,
    ).stdout
    try:
        state, out, err = json.loads(raw)
    except Exception:
        continue
    if state in ("Pending", "InProgress", "Delayed"):
        last = (out or "").strip().splitlines()[-1:] or [""]
        print(f"  [{state}] {last[0][:140]}", flush=True)
        continue
    print(f"\n=== {state} ===")
    print((out or "").strip()[-2000:])
    if (err or "").strip():
        print("--- stderr ---")
        print(err.strip()[-800:])
    break
