#!/usr/bin/env python3
"""Keep one deployment: the newest. Retire and delete every older one.

GitHub Pages creates a deployment record per publish, so a repository that ships often accumulates dozens of
them — the activity log fills with entries nobody reads, and the only one that matters is the last. This keeps
that one.

Two things the REST API requires, both learned by failing:

- a deployment's state lives on its *statuses*; there is no `PATCH /deployments/{id}`, so a deployment is
  retired by **posting an `inactive` status** to it. `PATCH` answers 404, which reads like a permissions
  problem and is not one;
- only then will `DELETE /deployments/{id}` accept it.

Run it after a deploy that mattered, or on a schedule:

    python3 tools/prune-deployments.py             # this repository, keep the newest
    python3 tools/prune-deployments.py --dry-run   # print what would go
    python3 tools/prune-deployments.py --keep 3    # keep the three newest

Needs an authenticated `gh` with `repo` scope (it is what `gh auth login` gives you).
"""
from __future__ import annotations

import argparse
import json
import subprocess
import sys
import time


def gh(args: list[str]) -> tuple[int, str, str]:
    result = subprocess.run(["gh", *args], capture_output=True, text=True)
    return result.returncode, result.stdout.strip(), result.stderr.strip()


def this_repo() -> str:
    code, out, err = gh(["repo", "view", "--json", "nameWithOwner", "-q", ".nameWithOwner"])
    if code != 0:
        sys.exit(f"could not read the repository from gh: {err}")
    return out


def deployments(repo: str) -> list[dict]:
    code, out, err = gh(["api", f"repos/{repo}/deployments?per_page=100", "--paginate"])
    if code != 0:
        sys.exit(f"could not list deployments: {err}")
    return sorted(json.loads(out or "[]"), key=lambda d: d["id"], reverse=True)


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Keep the newest GitHub Pages deployment; retire and delete every older one."
    )
    parser.add_argument("--repo", default=None, help="owner/name (default: the repository you are in)")
    parser.add_argument("--keep", type=int, default=1, help="how many of the newest to keep (default 1)")
    parser.add_argument("--dry-run", action="store_true", help="print the plan, change nothing")
    args = parser.parse_args()

    repo = args.repo or this_repo()
    everything = deployments(repo)
    keep, doomed = everything[: args.keep], everything[args.keep :]

    print(f"repository : {repo}")
    print(f"deployments: {len(everything)}")
    for d in keep:
        print(f"  KEEP   {d['id']}  {d['created_at']}  {d['sha'][:7]}  {d['environment']}")
    if doomed:
        print(f"  DELETE {len(doomed)}, from {doomed[0]['id']} ({doomed[0]['created_at']}) "
              f"to {doomed[-1]['id']} ({doomed[-1]['created_at']})")
    if args.dry_run or not doomed:
        print("dry run — nothing changed" if args.dry_run else "nothing to do")
        return

    failures: list[tuple[int, str, str]] = []
    for index, d in enumerate(doomed, 1):
        did = d["id"]
        code, _, err = gh(["api", "-X", "POST", f"repos/{repo}/deployments/{did}/statuses", "-f", "state=inactive"])
        if code != 0:
            failures.append((did, "mark inactive", err.splitlines()[0] if err else ""))
            continue
        code, _, err = gh(["api", "-X", "DELETE", f"repos/{repo}/deployments/{did}"])
        if code != 0:
            failures.append((did, "delete", err.splitlines()[0] if err else ""))
        if index % 10 == 0:
            print(f"  {index}/{len(doomed)} processed")
        time.sleep(0.05)

    print(f"failures: {len(failures)}")
    for failure in failures[:15]:
        print("   ", failure)

    remaining = deployments(repo)
    print(f"deployments remaining: {len(remaining)}")
    for d in remaining:
        print(f"   {d['id']}  {d['created_at']}  {d['sha'][:7]}  {d['environment']}")


if __name__ == "__main__":
    main()
