#!/usr/bin/env python3
"""What would a hosted desk cost? Real prices, from AWS, right now."""
import json
import subprocess

TYPES = ["g4dn.xlarge", "g5.xlarge", "g6.xlarge", "g6e.xlarge"]
REGION = "us-east-1"

def run(args):
    return subprocess.run(args, capture_output=True, text=True).stdout

print("=== on-demand (us-east-1, Linux, shared) ===")
filters = [
    {"Type": "TERM_MATCH", "Field": "instanceType", "Value": "PLACEHOLDER"},
    {"Type": "TERM_MATCH", "Field": "location", "Value": "US East (N. Virginia)"},
    {"Type": "TERM_MATCH", "Field": "operatingSystem", "Value": "Linux"},
    {"Type": "TERM_MATCH", "Field": "tenancy", "Value": "Shared"},
    {"Type": "TERM_MATCH", "Field": "preInstalledSw", "Value": "NA"},
    {"Type": "TERM_MATCH", "Field": "capacitystatus", "Value": "Used"},
]
for instance in TYPES:
    filters[0]["Value"] = instance
    out = run([
        "aws", "pricing", "get-products", "--service-code", "AmazonEC2",
        "--region", "us-east-1", "--output", "json",
        "--filters", json.dumps(filters),
    ])
    try:
        products = json.loads(out)["PriceList"]
        price = None
        for blob in products:
            product = json.loads(blob)
            for term in product.get("terms", {}).get("OnDemand", {}).values():
                for dim in term.get("priceDimensions", {}).values():
                    price = dim["pricePerUnit"]["USD"]
        if price is None:
            raise ValueError("no on-demand dimension in the response")
        hourly = float(price)
        print(f"  {instance:<14} ${price}/hr  →  24h ${hourly*24:.2f}  ·  72h ${hourly*72:.2f}")
    except Exception as error:  # noqa: BLE001
        print(f"  {instance:<14} pricing lookup failed: {error} {out[:120]}")

print()
print("=== spot (last 3 samples, Linux/UNIX) ===")
out = run([
    "aws", "ec2", "describe-spot-price-history", "--region", REGION,
    "--instance-types", *TYPES, "--product-descriptions", "Linux/UNIX",
    "--max-items", "12", "--output", "json",
])
try:
    history = json.loads(out)["SpotPriceHistory"]
    latest = {}
    for row in history:
        latest.setdefault(row["InstanceType"], row["SpotPrice"])
    for instance, price in sorted(latest.items()):
        print(f"  {instance:<14} ${price}/hr  →  24h ${float(price)*24:.2f}")
except Exception as error:  # noqa: BLE001
    print(f"  spot lookup failed: {error} {out[:160]}")

print()
print("=== quota: running on-demand G/VT instances (vCPUs) ===")
out = run([
    "aws", "service-quotas", "get-service-quota", "--region", REGION,
    "--service-code", "ec2", "--quota-code", "L-DB2E81BA", "--output", "json",
])
try:
    quota = json.loads(out)["Quota"]
    print(f"  {quota['Value']} vCPUs allowed  (g5.xlarge needs 4, g4dn.xlarge 4, g6.xlarge 4)")
except Exception as error:  # noqa: BLE001
    print(f"  quota lookup failed: {error} {out[:160]}")

print()
print("=== anything already running / costing money? ===")
out = run([
    "aws", "ec2", "describe-instances", "--region", REGION,
    "--query", "Reservations[].Instances[].[InstanceType,State.Name,PublicIpAddress,LaunchTime]",
    "--output", "json",
])
print(f"  {out.strip()[:400] or 'none'}")
