/**
 * Throwaway: fresh renders of the plates section for the design-quality gate — desktop mid-unfurl and
 * settled, a phone, and the reduced-motion grid. Run from the repo so `playwright` resolves.
 *
 *   node tmp-gallery-shots.mjs
 */
import { chromium } from "playwright";

const BASE = process.env.SHOT_BASE ?? "http://localhost:5178";
const out = "docs/shots";

const browser = await chromium.launch();

async function shot(name, { width, height, reduce = false, scroll = "mid", after = 900 }) {
  const context = await browser.newContext({
    viewport: { width, height },
    reducedMotion: reduce ? "reduce" : "no-preference",
    deviceScaleFactor: 2,
  });
  const page = await context.newPage();
  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".plate-gallery");

  // Walk the wall so lazy frames load, then settle where the shot wants to be taken.
  await page.evaluate(`document.querySelector(".plate-gallery").scrollIntoView({ block: "end" })`);
  await page.waitForFunction(
    `[...document.querySelectorAll(".plate-frame img")].filter((i) => i.naturalWidth > 0 && i.complete).length >= 9`,
    null,
    { timeout: 20000 },
  );
  await page.evaluate(
    scroll === "settled"
      ? `(() => { const s = document.querySelector(".plate-gallery"); const r = s.getBoundingClientRect(); window.scrollTo(0, window.scrollY + r.top - 60); })()`
      : `(() => { const s = document.querySelector(".plate-gallery"); const r = s.getBoundingClientRect(); window.scrollTo(0, window.scrollY + r.top - window.innerHeight * 0.55); })()`,
  );
  await page.waitForTimeout(after);
  await page.screenshot({ path: `${out}/${name}.png` });
  const where = await page.evaluate(
    `(() => { const s = document.querySelector(".plate-gallery"); return { top: Math.round(s.getBoundingClientRect().top), vh: window.innerHeight }; })()`,
  );
  // The decisive reading: do the outermost frames stay inside the stage's box while the wall is tilted?
  const edges = await page.evaluate(`(() => {
    const stage = document.querySelector(".plate-gallery-stage").getBoundingClientRect();
    const frames = [...document.querySelectorAll(".plate-frame")].map((n) => n.getBoundingClientRect());
    const left = Math.min(...frames.map((r) => r.left));
    const right = Math.max(...frames.map((r) => r.right));
    return { leftGap: Math.round(left - stage.left), rightGap: Math.round(stage.right - right) };
  })()`);
  console.log(
    `${name}: section top ${where.top}px of ${where.vh} — outer frames inside the stage: ` +
      `${edges.leftGap}px from the left edge, ${edges.rightGap}px from the right (negative = clipped)`,
  );
  await context.close();
}

await shot("gallery-desktop-mid", { width: 1440, height: 900, scroll: "mid" });
await shot("gallery-desktop", { width: 1440, height: 900, scroll: "settled" });
await shot("gallery-phone", { width: 390, height: 844, scroll: "settled", after: 1200 });
await shot("gallery-still", { width: 1440, height: 900, reduce: true, scroll: "settled" });

await browser.close();
console.log("done");