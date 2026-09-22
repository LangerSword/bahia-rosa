#!/usr/bin/env python3
"""Where can a GPU actually be launched, and what is already running? Read-only."""
import json
import subprocess

REGIONS = ["us-east-1", "us-east-2", "us-west-2", "ap-south-1", "ap-southeast-1", "eu-central-1", "eu-west-1"]
QUOTA_G_VT = "L-DB2E81BA"          # Running On-Demand G and VT instances
QUOTA_ALL_STANDARD = "L-1216C47A"  # Running On-Demand Standard (A, C, D, H, I, M, R, T, Z)

def aws(*args):
    return subprocess.run(["aws", *args], capture_output=True, text=True).stdout

print(f"{'region':<16} {'G/VT vCPUs':>11} {'standard vCPUs':>15}   running instances")
for region in REGIONS:
    g = json.loads(aws("service-quotas", "get-service-quota", "--region", region,
                       "--service-code", "ec2", "--quota-code", QUOTA_G_VT, "--output", "json") or "{}")
    std = json.loads(aws("service-quotas", "get-service-quota", "--region", region,
                         "--service-code", "ec2", "--quota-code", QUOTA_ALL_STANDARD, "--output", "json") or "{}")
    instances = aws("ec2", "describe-instances", "--region", region,
                    "--query", "Reservations[].Instances[].[InstanceType,State.Name,LaunchTime]",
                    "--output", "json").strip()
    running = json.loads(instances or "[]")
    g_value = g.get("Quota", {}).get("Value")
    std_value = std.get("Quota", {}).get("Value")
    print(f"{region:<16} {str(g_value):>11} {str(std_value):>15}   {running if running else '—'}")

print()
print("=== g5.xlarge on-demand price where quota exists (if any) ===")
for region in REGIONS:
    out = aws("ec2", "describe-spot-price-history", "--region", region,
              "--instance-types", "g5.xlarge", "--product-descriptions", "Linux/UNIX",
              "--max-items", "1", "--output", "json")
    try:
        price = json.loads(out)["SpotPriceHistory"][0]["SpotPrice"]
        print(f"  {region:<16} g5.xlarge spot ${price}/hr")
    except Exception as error:  # noqa: BLE001
        print(f"  {region:<16} spot lookup failed: {error}")
