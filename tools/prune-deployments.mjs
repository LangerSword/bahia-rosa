#!/usr/bin/env node
/**
 * One deployment, always.
 *
 * Every push to main adds a GitHub Pages deployment, and the repo's Environments page fills up with history
 * nobody asked for. This keeps exactly one: the newest, the one that is actually serving.
 *
 * GitHub refuses to delete an "active" deployment — the error is `We cannot delete an active deployment` — so
 * each older one is first marked inactive with a status POST, then deleted. Both steps are needed; deleting
 * straight away always fails.
 *
 *   node tools/prune-deployments.mjs            # prune this repo
 *   node tools/prune-deployments.mjs --dry-run  # say what it would do
 *
 * Run it after a push once CI and pages are green. It is safe to run when there is nothing to prune: it says
 * so and exits 0.
 */

import { execFileSync } from "node:child_process";

const REPO = "LangerSword/bahia-rosa";
const dryRun = process.argv.includes("--dry-run");

/** `gh api` with the repo's own auth; JSON on stdout, or throws with the API's message. */
function gh(args) {
  return execFileSync("gh", args, { encoding: "utf8" }).trim();
}

function deployments() {
  const raw = gh(["api", `repos/${REPO}/deployments`, "--paginate", "--jq", ".[] | {id, sha, created_at}"]);
  if (!raw) return [];
  // `--paginate` concatenates one JSON object per line when --jq is used.
  return raw
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

const all = deployments();
if (all.length === 0) {
  console.log("no deployments at all — nothing to prune");
  process.exit(0);
}

// The API returns newest first.
const [keep, ...rest] = all;
console.log(`keeping ${keep.id} (${keep.sha.slice(0, 7)}, ${keep.created_at})`);

if (rest.length === 0) {
  console.log("nothing to prune — one deployment, as it should be");
  process.exit(0);
}

for (const d of rest) {
  if (dryRun) {
    console.log(`would delete ${d.id} (${d.sha.slice(0, 7)})`);
    continue;
  }
  try {
    gh(["api", "-X", "POST", `repos/${REPO}/deployments/${d.id}/statuses`, "-f", "state=inactive"]);
    gh(["api", "-X", "DELETE", `repos/${REPO}/deployments/${d.id}`]);
    console.log(`deleted ${d.id} (${d.sha.slice(0, 7)})`);
  } catch (error) {
    const message = String(error.stderr || error.message).slice(0, 160);
    console.error(`could not delete ${d.id}: ${message}`);
  }
}

const left = deployments();
console.log(`deployments now: ${left.length}`);
process.exit(left.length === 1 ? 0 : 1);
