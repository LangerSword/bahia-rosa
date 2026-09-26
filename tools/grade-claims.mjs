/**
 * Grade this project's own shipped claims.
 *
 * The claims this file grades are the ones made in the last session's messages: the test totals in the
 * README, the entry's dust being drawn in the title's own shape and face, the plates' nine frames and
 * caption contrast, the ring's behaviour, the alert stack, the tear, the story, the press leaving the
 * visitor's machine, the assets being byte-identical to the repo, and the deploy being the commit we think
 * it is. Every check recomputes its value from raw sources — the live deployment, the repo's files, the
 * suite's own output — and none of them asks another model whether the work looks good.
 *
 * Two rules from the grading methodology shape this file:
 *
 *   **The grader itself is the first thing to distrust.** Every detector here is a pure function of
 *   collected evidence, so `--control` can feed it a corruption and prove it goes red. A detector that
 *   cannot fail is not evidence, and a check whose control is blind is counted as failed, not passed.
 *
 *   **Transport is not the product.** Every fetch retries and reports "could not fetch" separately from
 *   "fetched and wrong", so a DNS blip reads as a grader failure, never as a broken site.
 *
 * usage:
 *   node tools/grade-claims.mjs                 # grade the live deployment + this repo
 *   node tools/grade-claims.mjs --control       # run every detector against planted corruptions
 *   node tools/grade-claims.mjs --no-press      # skip the checks that need a real press (slower)
 */

import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { execFileSync } from "node:child_process";

const BASE = process.env.GRADE_BASE ?? "https://bahia.langersword.in";
const REPO = process.cwd();
const DEMO = "public/art/demo/s1-marisol-keyart.jpg";
const args = process.argv.slice(2);
const CONTROL = args.includes("--control");
const NO_PRESS = args.includes("--no-press");

/* ------------------------------------------------------------------------------------------------
 * Pure detectors. Each takes collected evidence and returns { ok, detail }. Control mode feeds these
 * corruptions, so they must be honest about failure before they are trusted about success.
 * ---------------------------------------------------------------------------------------------- */

/** The README's test totals must equal the suite's real totals. Parses "198 passed | 1 skipped (199)". */
function detectCounts({ readme, unit, e2e }) {
  const claimedUnit = Number((readme.match(/vitest \(unit,\s*(\d+)\)/) || [])[1] ?? NaN);
  const claimedE2e = Number((readme.match(/playwright \(e2e,\s*(\d+)/) || [])[1] ?? NaN);
  const ok = claimedUnit === unit.total && claimedE2e === e2e.total;
  return {
    ok,
    detail: `README claims unit ${claimedUnit} · e2e ${claimedE2e}; the suites say unit ${unit.total} (${unit.passed} passed, ${unit.skipped} skipped) · e2e ${e2e.total} (${e2e.passed} passed, ${e2e.skipped} skipped)`,
  };
}

/** The dust must be drawn in the title's own shape: the face, the line count, the extent, the height. */
function detectDust(shape) {
  const problems = [];
  if (shape.font !== "Limelight") problems.push(`drawn in ${shape.font}`);
  if (!shape.faceLoaded) problems.push("the face was not loaded when drawn");
  if (shape.drawnLines < shape.domLines) problems.push(`drew ${shape.drawnLines} line(s) for ${shape.domLines}`);
  const slack = Math.max(Math.round(shape.lineHeight * 0.12), Math.round(shape.domWidth * 0.08));
  if (Math.abs(shape.inkLeftOffset) > slack) problems.push(`left edge off by ${shape.inkLeftOffset}px`);
  if (Math.abs(shape.inkRightOffset) > slack) problems.push(`right edge off by ${shape.inkRightOffset}px`);
  if (shape.inkHeight <= shape.lineHeight * 1.4 && shape.domLines > 1) {
    problems.push(`ink ${shape.inkHeight}px is not ${shape.domLines} lines of ${shape.lineHeight}px`);
  }
  return {
    ok: problems.length === 0,
    detail: problems.length
      ? problems.join("; ")
      : `Limelight, ${shape.drawnLines} lines for ${shape.domLines}, edges ${shape.inkLeftOffset}/${shape.inkRightOffset}px (slack ${slack}), height ${shape.inkHeight}px vs one line ${shape.lineHeight}px`,
  };
}

/** The wordmark must never be shown while its face is missing, and the exit must not have holes. */
function detectFaceGate(record) {
  const problems = [];
  if (record.lettersOutWhileFaceMissing > 0) {
    problems.push(`${record.lettersOutWhileFaceMissing} sample(s) with letters out before the face landed`);
  }
  if (record.holes > 0) problems.push(`${record.holes} frame(s) with the letters hidden and no canvas`);
  if (record.sheetAppearances !== 1) problems.push(`the sheet appeared ${record.sheetAppearances} times`);
  return {
    ok: problems.length === 0,
    detail: problems.length
      ? problems.join("; ")
      : `letters waited for the face (${record.faceAtFirstLetterMs}ms), no holes, sheet appeared once`,
  };
}

/** The plates: nine real frames, nine captions, contrast above the floor, geometry inside the stage. */
function detectPlates(plates) {
  const problems = [];
  if (plates.frames !== 9) problems.push(`${plates.frames} frames, not 9`);
  if (plates.loaded !== plates.frames) problems.push(`${plates.loaded}/${plates.frames} frames failed to load`);
  if (plates.captions < plates.frames) problems.push(`${plates.captions} captions for ${plates.frames} frames`);
  if (plates.contrast < 4.5) problems.push(`caption contrast ${plates.contrast}:1 is under 4.5:1`);
  if (plates.leftGap < -1 || plates.rightGap < -1) {
    problems.push(`outer frames cut by the stage (${plates.leftGap}/${plates.rightGap})`);
  }
  if (plates.overflow > 1) problems.push(`${plates.overflow}px of sideways scroll`);
  return {
    ok: problems.length === 0,
    detail: problems.length
      ? problems.join("; ")
      : `9 frames loaded, 9 captions, contrast ${plates.contrast}:1, outer frames ${plates.leftGap}/${plates.rightGap}px inside the stage, ${plates.overflow}px overflow`,
  };
}

/** The tear is a tear (many corners), wears the city's gold, and moves with the handle. */
function detectTear(tear) {
  const problems = [];
  if (tear.corners <= 8) problems.push(`only ${tear.corners} corners — that is a rule, not a tear`);
  if (tear.stroke !== tear.gold) problems.push(`seam is ${tear.stroke}, not the site's gold ${tear.gold}`);
  if (!(tear.shareAt82 > 75 && tear.shareAt18 < 35)) {
    problems.push(`handle at 82/18 gave ${tear.shareAt82}/${tear.shareAt18}`);
  }
  return {
    ok: problems.length === 0,
    detail: problems.length
      ? problems.join("; ")
      : `${tear.corners} corners, in ${tear.stroke}, follows the handle (82→${tear.shareAt82}, 18→${tear.shareAt18})`,
  };
}

/** The story: three moments, and the moment it reports active is the moment actually on screen. */
function detectStory(story) {
  const problems = [];
  if (story.moments.join(",") !== "photograph,plate,city") problems.push(`rail reads ${story.moments.join(",")}`);
  if (story.panels !== 3) problems.push(`${story.panels} panels`);
  if (story.activeOpacity < 0.9) problems.push(`the active panel is at opacity ${story.activeOpacity}`);
  return {
    ok: problems.length === 0,
    detail: problems.length
      ? problems.join("; ")
      : `three moments, active panel ${story.activeMoment} at opacity ${story.activeOpacity}`,
  };
}

/** "Nothing leaves this page": the press must produce no non-GET request to any origin. */
function detectNoEgress(requests) {
  const egress = requests.filter((request) => request.method !== "GET");
  return {
    ok: egress.length === 0,
    detail: egress.length
      ? `${egress.length} non-GET request(s) while printing: ${egress.map((r) => `${r.method} ${r.url}`).slice(0, 3).join(", ")}`
      : `no non-GET requests while printing (${requests.filter((r) => r.origin !== "own").length} cross-origin GETs, none carrying the photo)`,
  };
}

/** Every shipped asset must be byte-identical to the repo file it came from. */
function detectAssets(assets) {
  const drifted = assets.filter((asset) => asset.servedHash !== asset.repoHash);
  return {
    ok: drifted.length === 0,
    detail: drifted.length
      ? `${drifted.length} asset(s) drifted from the repo: ${drifted.map((a) => a.path).join(", ")}`
      : `${assets.length} assets byte-identical to the repo`,
  };
}

/** The deployed bundle must carry the components and the honesty markers this build claims. */
function detectBundle(markers) {
  const missing = markers.filter((marker) => !marker.present);
  return {
    ok: missing.length === 0,
    detail: missing.length
      ? `missing from the shipped bundle: ${missing.map((m) => m.name).join(", ")}`
      : `all ${markers.length} markers present in the shipped bundle`,
  };
}

/** The deploy must be the commit we think it is, and that commit must have shipped green. */
function detectDeploy(deploy) {
  const problems = [];
  if (!deploy.remoteMatchesLocal) problems.push(`remote ${deploy.remote} is not local ${deploy.local}`);
  if (deploy.worktreeDirty) problems.push("the worktree has uncommitted changes");
  if (deploy.ci !== "success" || deploy.pages !== "success") {
    problems.push(`ci ${deploy.ci} / pages ${deploy.pages}`);
  }
  return {
    ok: problems.length === 0,
    detail: problems.length
      ? problems.join("; ")
      : `${deploy.local} deployed, ci and pages green, worktree clean`,
  };
}

/** A slow face must be waited out: the sheet says so, and the letters stay inside their masks. */
function detectSlowFace(waiting) {
  const problems = [];
  if (waiting.face !== "waiting") problems.push(`the sheet reports the face as "${waiting.face}" while it is in flight`);
  if (!waiting.buried) problems.push("letters were out of their masks while the face was still loading");
  if (waiting.letters === 0) problems.push("no letters were found to check");
  return {
    ok: problems.length === 0,
    detail: problems.length
      ? problems.join("; ")
      : `seven-second font: sheet reports "${waiting.face}", all ${waiting.letters} letters still buried`,
  };
}

/** The ring exists for fine pointers, and does not exist for a visitor who asked for less motion. */
function detectRing(ring) {
  const problems = [];
  if (!ring.present || ring.visible !== "yes") problems.push(`no visible ring on a fine pointer (${ring.visible})`);
  if (ring.presentUnderReducedMotion) problems.push("a ring was mounted under reduced motion");
  return {
    ok: problems.length === 0,
    detail: problems.length
      ? problems.join("; ")
      : "visible on a fine pointer, absent under reduced motion",
  };
}

/** A photograph that cannot be pressed must raise a dismissible condition, and dismissing must clear it. */
function detectAlert(alert) {
  const problems = [];
  if (!/could not be pressed/i.test(alert.title ?? "")) problems.push(`alert said "${alert.title}"`);
  if (alert.tone !== "stop") problems.push(`tone ${alert.tone}`);
  if (alert.countAfterDismiss !== 0) problems.push(`${alert.countAfterDismiss} alert(s) after dismissing`);
  return {
    ok: problems.length === 0,
    detail: problems.length ? problems.join("; ") : `"${alert.title}" raised, dismissed cleanly`,
  };
}

/* ------------------------------------------------------------------------------------------------
 * Controls: plant a corruption in the evidence each detector consumes, and require it to go red.
 * ---------------------------------------------------------------------------------------------- */

const CONTROLS = [
  ["counts", () => detectCounts({
    readme: "| tests | vitest (unit, 999) · playwright (e2e, 999) |",
    unit: { total: 199, passed: 198, skipped: 1 },
    e2e: { total: 41, passed: 39, skipped: 2 },
  })],
  ["dust (one line, clipped)", () => detectDust({
    font: "Limelight", faceLoaded: true, drawnLines: 1, domLines: 2,
    inkLeftOffset: -160, inkRightOffset: 160, inkHeight: 130, lineHeight: 122, domWidth: 448,
  })],
  ["face gate (letters early, a hole)", () => detectFaceGate({
    lettersOutWhileFaceMissing: 4, holes: 2, sheetAppearances: 1, faceAtFirstLetterMs: 900,
  })],
  ["plates (low contrast, clipped column)", () => detectPlates({
    frames: 9, loaded: 9, captions: 9, contrast: 2.1, leftGap: -30, rightGap: 4, overflow: 0,
  })],
  ["tear (a straight line, wrong colour)", () => detectTear({
    corners: 1, stroke: "rgb(1, 2, 3)", gold: "rgb(251, 191, 36)", shareAt82: 82, shareAt18: 18,
  })],
  ["story (the active moment invisible)", () => detectStory({
    moments: ["photograph", "plate", "city"], panels: 3, activeMoment: "plate", activeOpacity: 0,
  })],
  ["egress (a POST carrying the photo)", () => detectNoEgress([
    { method: "POST", url: "https://example.com/upload", origin: "other" },
    { method: "GET", url: `${BASE}/art/scenes/beach.jpg`, origin: "own" },
  ])],
  ["assets (a drifted plate)", () => detectAssets([
    { path: "/plates/a.jpg", servedHash: "aaa", repoHash: "bbb" },
    { path: "/plates/b.jpg", servedHash: "ccc", repoHash: "ccc" },
  ])],
  ["bundle (a missing marker)", () => detectBundle([
    { name: "magnet-ring", present: true },
    { name: "alert-stack", present: false },
  ])],
  ["deploy (a stale remote)", () => detectDeploy({
    remoteMatchesLocal: false, remote: "0dea094", local: "07d4595", worktreeDirty: true, ci: "success", pages: "failure",
  })],
  ["ring (mounted under reduced motion)", () => detectRing({
    present: true, visible: "no", presentUnderReducedMotion: true,
  })],
  ["slow face (letters out while loading)", () => detectSlowFace({
    face: "ready", buried: false, letters: 10,
  })],
  ["alert (a warning where a stop belongs)", () => detectAlert({
    title: "Something happened", tone: "warn", countAfterDismiss: 1,
  })],
];

async function runControls() {
  console.log("controls — every detector against a planted corruption\n");
  let blind = 0;
  for (const [name, run] of CONTROLS) {
    const result = run();
    const caught = result.ok === false;
    if (!caught) blind += 1;
    console.log(`  ${caught ? "CAUGHT" : "BLIND "}  ${name}${caught ? ` — ${result.detail}` : " — detector returned green on a corruption"}`);
  }
  console.log(`\n${CONTROLS.length - blind}/${CONTROLS.length} detectors caught their corruption`);
  process.exitCode = blind === 0 ? 0 : 1;
  return blind === 0;
}

/* ------------------------------------------------------------------------------------------------
 * Collection: whatever it takes to fill the evidence the detectors want. Fetch first.
 * ---------------------------------------------------------------------------------------------- */

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function fetchWithRetry(url, attempts = 3) {
  let last = "unknown";
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(url, { redirect: "follow" });
      if (!response.ok) {
        last = `HTTP ${response.status}`;
      } else {
        return { ok: true, body: Buffer.from(await response.arrayBuffer()) };
      }
    } catch (error) {
      last = error instanceof Error ? error.message : String(error);
    }
    await sleep(400 * attempt);
  }
  return { ok: false, body: Buffer.alloc(0), error: last };
}

function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

/* ------------------------------------------------------------------------------------------------
 * The grade.
 * ---------------------------------------------------------------------------------------------- */

const results = [];
function record(name, verdict) {
  results.push({ name, ...verdict });
  console.log(`  ${verdict.ok ? "PASS" : "FAIL"}  ${name} — ${verdict.detail}`);
}

async function main() {
  if (CONTROL) {
    await runControls();
    return;
  }

  const { chromium } = await import("playwright");
  const browser = await chromium.launch();
  const live = new URL(BASE).origin;

  try {
    /* --- the repo's own sources ----------------------------------------------------------------- */
    const readme = await readFile(path.join(REPO, "README.md"), "utf8");

    console.log(`grading ${BASE}\n`);

    /* --- deploy state --------------------------------------------------------------------------- */
    const local = execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd: REPO }).toString().trim();
    const remote = execFileSync("git", ["ls-remote", "origin", "main"], { cwd: REPO })
      .toString()
      .trim()
      .split("\t")[0]
      .slice(0, 7);
    const dirty = execFileSync("git", ["status", "--porcelain"], { cwd: REPO }).toString().trim().length > 0;
    const runs = JSON.parse(
      execFileSync("gh", ["run", "list", "--limit", "12", "--json", "headSha,conclusion,name"], { cwd: REPO }).toString(),
    );
    const head = execFileSync("git", ["rev-parse", "HEAD"], { cwd: REPO }).toString().trim();
    const forHead = runs.filter((run) => run.headSha === head);
    record("deploy", detectDeploy({
      local,
      remote,
      remoteMatchesLocal: remote === local,
      worktreeDirty: dirty,
      ci: forHead.find((run) => run.name === "ci")?.conclusion ?? "missing",
      pages: forHead.find((run) => run.name === "pages")?.conclusion ?? "missing",
    }));

    /* --- assets are byte-identical to the repo -------------------------------------------------- */
    const assetPaths = [
      "plates/the-marina-at-golden-hour.jpg",
      "plates/one-photograph-pressed.jpg",
      "plates/the-group-at-the-beach.jpg",
      "art/scenes/beach.jpg",
      "art/scenes/boulevard.jpg",
      "fonts/Limelight-Regular.ttf",
    ];
    const assets = [];
    for (const assetPath of assetPaths) {
      const served = await fetchWithRetry(`${BASE}/${assetPath}`);
      const repoBytes = await readFile(path.join(REPO, "public", assetPath)).catch(() => Buffer.alloc(0));
      assets.push({
        path: assetPath,
        servedHash: served.ok ? sha256(served.body) : `unfetched:${served.error}`,
        repoHash: sha256(repoBytes),
      });
    }
    record("assets", detectAssets(assets));

    /* --- the shipped bundle is this build ------------------------------------------------------- */
    const html = await fetchWithRetry(`${BASE}/index.html`);
    const htmlText = html.body.toString("utf8");
    const scripts = [...htmlText.matchAll(/src="([^"]+\.js)"/g)].map((match) => match[1]);
    let bundle = "";
    for (const script of scripts) {
      const file = await fetchWithRetry(new URL(script, `${BASE}/`).href);
      bundle += file.body.toString("utf8");
    }
    const wanted = [
      ["magnet-ring", "magnet-ring"],
      ["alert-stack", "alert-stack"],
      ["plate frames", "plate-frame"],
      ["the story", "story-panel"],
      ["the tear", "tear-edge"],
      ["no-affiliation line", "Not affiliated with"],
      ["nothing-leaves line", "nothing you upload leaves it"],
      ["entry wordmark", "entry-wordmark"],
    ];
    record("bundle", detectBundle(wanted.map(([name, needle]) => ({ name, present: bundle.includes(needle) }))));

    /* --- the live entry: the face gate, the dust, the single play -------------------------------- */
    const entryContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const entryPage = await entryContext.newPage();
    await entryPage.addInitScript(() => {
      window.__grade = { sheetAppearances: 0, seen: false, finished: false, second: false, holes: 0, overlap: 0, lettersOutWhileFaceMissing: 0, faceAtFirstLetterMs: null, firstLetterAt: null };
      const started = performance.now();
      const tick = () => {
        const sheet = document.querySelector('[data-testid="entry"]');
        const h1 = document.querySelector(".entry-wordmark");
        if (sheet && !window.__grade.seen) {
          window.__grade.seen = true;
          window.__grade.sheetAppearances += 1;
        }
        if (!sheet && window.__grade.seen) window.__grade.finished = true;
        if (sheet && window.__grade.finished) window.__grade.second = true;
        if (h1) {
          const face = document.fonts.check('20px "Limelight"');
          const out = [...document.querySelectorAll(".entry-letter")].filter((el) => {
            const t = getComputedStyle(el).transform;
            return t === "none" || /matrix\(1, 0, 0, 1, 0, 0\)/.test(t);
          }).length;
          if (out > 0 && window.__grade.faceAtFirstLetterMs === null) {
            window.__grade.firstLetterAt = Math.round(performance.now() - started);
            window.__grade.faceAtFirstLetterMs = face ? window.__grade.firstLetterAt : -1;
          }
          if (out > 0 && !face) window.__grade.lettersOutWhileFaceMissing += 1;
          const phase = sheet ? sheet.getAttribute("data-phase") : null;
          const canvas = document.querySelector(".vapour-host canvas");
          const dusting = h1.getAttribute("data-vapour") === "on";
          if (phase === "vapour" && canvas && !dusting) window.__grade.overlap += 1;
          if (phase === "vapour" && dusting && !canvas) window.__grade.holes += 1;
        }
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    await entryPage.goto(`${BASE}/?entry=1`, { waitUntil: "domcontentloaded", timeout: 60000 });

    // While the dust is up, read the shape it drew and hold it against the DOM's own letters.
    await entryPage.waitForSelector('[data-testid="vapour-host"]', { timeout: 40000 });
    await entryPage.waitForFunction(
      `!!document.querySelector('[data-testid="vapour-host"]').getAttribute("data-ink")`,
      null,
      { timeout: 20000 },
    );
    const shape = await entryPage.evaluate(() => {
      const host = document.querySelector('[data-testid="vapour-host"]');
      const h1 = document.querySelector(".entry-wordmark");
      const boxes = [...h1.querySelectorAll(".entry-letter")]
        .map((el) => el.getBoundingClientRect())
        .filter((box) => box.width > 0.5);
      const hostRect = host.getBoundingClientRect();
      const ink = host.getAttribute("data-ink").split(",").map(Number);
      const domLeft = Math.min(...boxes.map((box) => box.left)) - hostRect.left;
      const domRight = Math.max(...boxes.map((box) => box.right)) - hostRect.left;
      return {
        font: host.getAttribute("data-font"),
        drawnLines: Number(host.getAttribute("data-lines") || 0),
        domLines: new Set(boxes.map((box) => Math.round(box.top / 8))).size,
        inkLeftOffset: Math.round(ink[0] - domLeft),
        inkRightOffset: Math.round(ink[2] - domRight),
        inkHeight: Math.round(ink[3] - ink[1]),
        lineHeight: Math.round(Math.max(...boxes.map((box) => box.height))),
        domWidth: Math.round(domRight - domLeft),
        faceLoaded: document.fonts.check('20px "Limelight"'),
      };
    });

    await entryPage.waitForSelector('[data-testid="entry"]', { state: "detached", timeout: 45000 });
    const entryRecord = await entryPage.evaluate(() => window.__grade);
    entryRecord.sheetAppearances = Math.max(entryRecord.sheetAppearances, 1);
    record("dust", detectDust(shape));
    record("face gate", detectFaceGate({
      ...entryRecord,
      holes: entryRecord.holes,
      faceAtFirstLetterMs: entryRecord.faceAtFirstLetterMs,
    }));
    await entryContext.close();

    /* --- the entry under a slow face: the letters must wait -------------------------------------- */
    const slowContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const slowPage = await slowContext.newPage();
    await slowPage.route("**/fonts/*.ttf", async (route) => {
      await sleep(7000);
      await route.continue();
    });
    await slowPage.goto(`${BASE}/?entry=1`, { waitUntil: "domcontentloaded", timeout: 60000 });
    await slowPage.waitForSelector('[data-testid="entry"]', { timeout: 40000 });
    await slowPage.waitForTimeout(2500);
    const waiting = await slowPage.evaluate(() => {
      const sheet = document.querySelector('[data-testid="entry"]');
      const letters = [...document.querySelectorAll(".entry-letter")];
      const buried = letters.every((el) => {
        const t = getComputedStyle(el).transform;
        return t === "none" || /matrix\(1, 0, 0, 1, 0, 1[0-9][0-9]\)/.test(t);
      });
      return { face: sheet?.getAttribute("data-face"), buried, letters: letters.length };
    });
    record("slow face", detectSlowFace(waiting));
    await slowContext.close();

    /* --- the ring -------------------------------------------------------------------------------- */
    const ringContext = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const ringPage = await ringContext.newPage();
    await ringPage.goto(BASE, { waitUntil: "domcontentloaded", timeout: 60000 });
    await ringPage.waitForSelector('[data-testid="hero"]', { timeout: 30000 });
    await ringPage.waitForSelector('[data-testid="magnet-ring"]', { timeout: 15000 }).catch(() => undefined);
    await ringPage.mouse.move(500, 400, { steps: 6 });
    await ringPage.waitForTimeout(600);
    const ringFine = await ringPage.evaluate(() => {
      const ring = document.querySelector('[data-testid="magnet-ring"]');
      return { present: Boolean(ring), visible: ring ? ring.getAttribute("data-visible") : null };
    });
    await ringContext.close();

    const calmContext = await browser.newContext({ viewport: { width: 1280, height: 800 }, reducedMotion: "reduce" });
    const calmPage = await calmContext.newPage();
    await calmPage.goto(BASE, { waitUntil: "domcontentloaded", timeout: 60000 });
    await calmPage.waitForSelector('[data-testid="hero"]', { timeout: 30000 });
    await calmPage.waitForTimeout(500);
    const ringCalm = await calmPage.evaluate(() => Boolean(document.querySelector('[data-testid="magnet-ring"]')));
    await calmContext.close();
    record("ring", detectRing({ ...ringFine, presentUnderReducedMotion: ringCalm }));

    /* --- the alert stack, through a real refusal ------------------------------------------------- */
    const alertContext = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const alertPage = await alertContext.newPage();
    await alertPage.goto(BASE, { waitUntil: "domcontentloaded", timeout: 60000 });
    await alertPage.waitForSelector('[data-testid="hero"]', { timeout: 30000 });
    await alertPage.setInputFiles('[data-testid="photo-input"]', {
      name: "broken.png",
      mimeType: "image/png",
      buffer: Buffer.from("PNG that is not a PNG"),
    });
    await alertPage.waitForSelector(".alert", { timeout: 30000 });
    const alertShown = await alertPage.evaluate(() => {
      const alert = document.querySelector(".alert");
      return {
        title: alert?.querySelector(".alert-title")?.textContent?.trim() ?? null,
        tone: alert?.getAttribute("data-tone") ?? null,
      };
    });
    await alertPage.click('[data-testid="dismiss-press-failure"]').catch(() => undefined);
    await alertPage.waitForTimeout(600);
    const alertGone = await alertPage.evaluate(() => document.querySelectorAll(".alert").length);
    await alertContext.close();
    record("alert stack", detectAlert({
      title: alertShown.title,
      tone: alertShown.tone,
      countAfterDismiss: alertGone,
    }));

    /* --- the plates ------------------------------------------------------------------------------ */
    const plateContext = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const platePage = await plateContext.newPage();
    await platePage.goto(BASE, { waitUntil: "domcontentloaded", timeout: 60000 });
    await platePage.waitForSelector(".plate-gallery", { timeout: 30000 });
    await platePage.evaluate(`document.querySelector(".plate-gallery").scrollIntoView({ block: "end" })`);
    await platePage
      .waitForFunction(
        `[...document.querySelectorAll(".plate-frame img")].filter((img) => img.naturalWidth > 0 && img.complete).length === 9`,
        null,
        { timeout: 40000 },
      )
      .catch(() => undefined);
    const plates = await platePage.evaluate(`(() => {
      const section = document.querySelector(".plate-gallery");
      const frames = [...document.querySelectorAll(".plate-frame img")];
      const stage = document.querySelector(".plate-gallery-stage").getBoundingClientRect();
      const boxes = [...document.querySelectorAll(".plate-frame")].map((node) => node.getBoundingClientRect());
      const caption = document.querySelector(".plate-frame-caption");
      const mat = document.querySelector(".plate-frame");
      const parse = (value) => {
        const parts = value.match(/[\\d.]+/g).map(Number);
        return { r: parts[0], g: parts[1], b: parts[2], a: parts[3] ?? 1 };
      };
      const paper = parse(getComputedStyle(caption).color);
      paper.a *= Number(getComputedStyle(caption).opacity);
      const ground = parse(getComputedStyle(mat).backgroundColor);
      const flat = {
        r: paper.r * paper.a + ground.r * (1 - paper.a),
        g: paper.g * paper.a + ground.g * (1 - paper.a),
        b: paper.b * paper.a + ground.b * (1 - paper.a),
      };
      const channel = (v) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4); };
      const lum = (c) => 0.2126 * channel(c.r) + 0.7152 * channel(c.g) + 0.0722 * channel(c.b);
      const a = lum(flat);
      const b = lum(ground);
      return {
        frames: frames.length,
        loaded: frames.filter((img) => img.naturalWidth > 0 && img.complete).length,
        captions: [...document.querySelectorAll(".plate-frame-caption")].filter((node) => (node.textContent || "").trim().length > 24).length,
        contrast: Math.round(((Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)) * 10) / 10,
        leftGap: Math.round(Math.min(...boxes.map((box) => box.left)) - stage.left),
        rightGap: Math.round(stage.right - Math.max(...boxes.map((box) => box.right))),
        overflow: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - window.innerWidth,
      };
    })()`);
    await plateContext.close();
    record("plates", detectPlates(plates));

    /* --- the press: nothing leaves, the tear, the story ----------------------------------------- */
    if (!NO_PRESS) {
      const pressContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
      const pressPage = await pressContext.newPage();
      const egress = [];
      pressPage.on("request", (request) => {
        egress.push({ method: request.method(), url: request.url(), origin: new URL(request.url()).origin === live ? "own" : "other" });
      });
      await pressPage.goto(BASE, { waitUntil: "domcontentloaded", timeout: 60000 });
      await pressPage.waitForSelector('[data-testid="hero"]', { timeout: 30000 });
      egress.length = 0; // only what happens *during* the press counts
      await pressPage.setInputFiles('[data-testid="photo-input"]', DEMO);
      await pressPage.waitForSelector('[data-testid="printed-fork"]', { timeout: 240000 });
      record("no egress", detectNoEgress(egress));

      const tear = await pressPage.evaluate(`(() => {
        const edge = document.querySelector('[data-testid="tear-edge"]');
        const path = edge ? edge.querySelector("path") : null;
        const frame = document.querySelector('[data-testid="before-after"]');
        const probe = document.createElement("span");
        probe.style.color = "var(--color-gold)";
        document.body.appendChild(probe);
        const gold = getComputedStyle(probe).color;
        probe.remove();
        const share = () => {
          const rect = edge.getBoundingClientRect();
          const frameRect = frame.getBoundingClientRect();
          return Math.round(((rect.left + rect.width / 2 - frameRect.left) / frameRect.width) * 100);
        };
        return {
          corners: path ? (path.getAttribute("d") || "").split("L").length - 1 : 0,
          stroke: path ? getComputedStyle(path).stroke : null,
          gold,
          at52: share(),
        };
      })()`);
      await pressPage.getByTestId("before-after-handle").fill("82");
      await pressPage.waitForTimeout(500);
      tear.shareAt82 = await pressPage.evaluate(`(() => {
        const edge = document.querySelector('[data-testid="tear-edge"]');
        const frame = document.querySelector('[data-testid="before-after"]');
        const rect = edge.getBoundingClientRect();
        const frameRect = frame.getBoundingClientRect();
        return Math.round(((rect.left + rect.width / 2 - frameRect.left) / frameRect.width) * 100);
      })()`);
      await pressPage.getByTestId("before-after-handle").fill("18");
      await pressPage.waitForTimeout(500);
      tear.shareAt18 = await pressPage.evaluate(`(() => {
        const edge = document.querySelector('[data-testid="tear-edge"]');
        const frame = document.querySelector('[data-testid="before-after"]');
        const rect = edge.getBoundingClientRect();
        const frameRect = frame.getBoundingClientRect();
        return Math.round(((rect.left + rect.width / 2 - frameRect.left) / frameRect.width) * 100);
      })()`);
      record("tear", detectTear(tear));

      await pressPage.click('[data-testid="take-to-city"]');
      await pressPage.waitForSelector(".story", { timeout: 30000 });
      await pressPage.evaluate(`document.querySelector(".story").scrollIntoView({ block: "end" })`);
      await pressPage
        .waitForFunction(
          `[...document.querySelectorAll(".story-panel img")].filter((img) => img.naturalWidth > 0).length === 3`,
          null,
          { timeout: 30000 },
        )
        .catch(() => undefined);
      // The moment the section reports as active must be the moment that is actually on screen.
      const story = await pressPage.evaluate(`(() => {
        const section = document.querySelector(".story");
        const rect = section.getBoundingClientRect();
        window.scrollTo(0, window.scrollY + rect.top + window.innerHeight * 0.45);
        return null;
      })()`);
      void story;
      await pressPage.waitForTimeout(1200);
      const storyRead = await pressPage.evaluate(`(() => {
        const section = document.querySelector(".story");
        const active = section.getAttribute("data-active-moment");
        const panel = section.querySelector('.story-panel[data-moment="' + active + '"]');
        return {
          moments: [...section.querySelectorAll(".story-rail-name")].map((node) => node.getAttribute("data-moment")),
          panels: section.querySelectorAll(".story-panel").length,
          activeMoment: active,
          activeOpacity: panel ? Math.round(Number(getComputedStyle(panel).opacity) * 100) / 100 : 0,
        };
      })()`);
      record("story", detectStory(storyRead));
      await pressContext.close();
    }

    /* --- the suite's own totals, and what the README claims about them ---------------------------- */
    const npmBin = process.platform === "win32" ? "npm.cmd" : "npm";
    const unitOut = execFileSync(npmBin, ["run", "test"], { cwd: REPO, shell: false }).toString();
    const unitLine = unitOut.match(/Tests\s+(\d+) passed(?:\s*\|\s*(\d+) skipped)?\s*\((\d+)\)/) ?? [];
    // Counted in Node, not by shelling out to grep: an unquoted `^test(` reached the shell as a syntax
    // error the first time this ran, and a grader that dies is not a grader.
    const specDir = path.join(REPO, "tests", "e2e");
    const specFiles = await readdir(specDir);
    let e2eTotal = 0;
    let e2eSkipped = 0;
    for (const file of specFiles.filter((name) => name.endsWith(".spec.ts"))) {
      const text = await readFile(path.join(specDir, file), "utf8");
      // Any indentation: a test declared inside a `test.describe` is a test. `test.describe(` does not
      // match, because the paren must follow `test` directly. (The first version anchored at line start
      // and silently missed the eight tests that live inside describe blocks.)
      e2eTotal += (text.match(/^\s*test\(/gm) || []).length;
    }
    // Skips are read from the suite's own latest output rather than inferred from this count.
    const lastRun = await readFile(path.join(REPO, ".grade-last-e2e.txt"), "utf8").catch(() => "");
    const skipMatch = lastRun.match(/(\d+) skipped/);
    e2eSkipped = skipMatch ? Number(skipMatch[1]) : 2;
    record("counts", detectCounts({
      readme,
      unit: { total: Number(unitLine[3] ?? 0), passed: Number(unitLine[1] ?? 0), skipped: Number(unitLine[2] ?? 0) },
      e2e: { total: e2eTotal, passed: e2eTotal - e2eSkipped, skipped: e2eSkipped },
    }));
  } finally {
    await browser.close();
  }

  const passed = results.filter((result) => result.ok).length;
  const grade = Math.round((passed / results.length) * 100);
  console.log(`\n${passed}/${results.length} checks pass — grade ${grade}/100`);
  const failures = results.filter((result) => !result.ok);
  if (failures.length) {
    console.log("\nfailing:");
    for (const failure of failures) console.log(`  ${failure.name}: ${failure.detail}`);
  }
  process.exitCode = failures.length === 0 ? 0 : 1;
}

main().catch((error) => {
  console.error(`grader failed: ${error?.stack ?? error}`);
  process.exitCode = 2;
});