/**
 * Throwaway: fresh renders of this round's four surfaces for the design-quality gate — the story at rest,
 * the tear on a real plate, the alert stack with a real failure, and the magnet ring over a real button.
 * Run from the repo so `playwright` resolves.
 *
 *   node tmp-feature-shots.mjs
 */
import { chromium } from "playwright";

const BASE = process.env.SHOT_BASE ?? "http://localhost:5178";
const out = "docs/shots";
const DEMO = "public/art/demo/s1-marisol-keyart.jpg";

const browser = await chromium.launch();

async function contextOf(options = {}) {
  return browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, ...options });
}

/** One press, reused: the story and the tear both live on the far side of it. */
async function press(page) {
  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-testid="hero"]');
  await page.setInputFiles('[data-testid="photo-input"]', DEMO);
  await page.waitForSelector('[data-testid="printed-fork"]', { timeout: 220000 });
}

async function shoot(page, name, settle = 900) {
  await page.waitForTimeout(settle);
  await page.screenshot({ path: `${out}/${name}.png` });
  console.log(`${name}: shot`);
}

// 1. The tear, on the visitor's own plate.
{
  const context = await contextOf();
  const page = await context.newPage();
  await press(page);
  const tear = await page.$('[data-testid="before-after"]');
  await tear.scrollIntoViewIfNeeded();
  await page.evaluate(`document.querySelector('[data-testid="before-after-handle"]').value = 58; document.querySelector('[data-testid="before-after-handle"]').dispatchEvent(new Event('input', { bubbles: true }))`);
  await shoot(page, "tear-comparison", 700);
  await context.close();
}

// 2. The story, on the city stage.
{
  const context = await contextOf();
  const page = await context.newPage();
  await press(page);
  await page.click('[data-testid="take-to-city"]');
  await page.waitForSelector(".story");
  await page.evaluate(`document.querySelector(".story").scrollIntoView({ block: "end" })`);
  await page.waitForFunction(
    `[...document.querySelectorAll(".story-panel img")].filter((i) => i.naturalWidth > 0).length === 3`,
    null,
    { timeout: 30000 },
  );
  await page.evaluate(
    `(() => { const s = document.querySelector(".story"); const r = s.getBoundingClientRect(); window.scrollTo(0, window.scrollY + r.top + window.innerHeight * 0.45); })()`,
  );
  // The panels cross-fade on a spring, and at this scroll position two of them may be sharing the room. Wait
// for the section to *say* the plate moment is active and for the leading panel to be plainly visible, then
// shoot — a shot taken during the crossover reads as a void.
  await page.waitForFunction(
    `document.querySelector(".story") && document.querySelector(".story").getAttribute("data-active-moment") === "plate"`,
    null,
    { timeout: 15000 },
  );
  // The named panel's own opacity — not the max across panels, which an outgoing one can satisfy while the
  // arriving one is still invisible.
  await page.waitForFunction(
    `Number(getComputedStyle(document.querySelector('.story-panel[data-moment="plate"]')).opacity) > 0.9`,
    null,
    { timeout: 15000 },
  );
  await shoot(page, "story-plate-moment", 900);
  await context.close();
}

// 3. The alert stack, with a real refusal behind it.
{
  const context = await contextOf();
  const page = await context.newPage();
  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-testid="hero"]');
  await page.setInputFiles('[data-testid="photo-input"]', {
    name: "broken.png",
    mimeType: "image/png",
    buffer: Buffer.from("PNG that is not a PNG"),
  });
  await page.waitForSelector(".alert", { timeout: 30000 });
  await shoot(page, "alert-refusal", 900);
  await context.close();
}

// 4. The magnet ring, parked beside a real button.
{
  const context = await contextOf();
  const page = await context.newPage();
  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-testid="hero"]');
  const target = await page.evaluate(`(() => {
    const magnet = document.querySelector('[data-magnet="hero-door"]') || document.querySelector(".btn");
    if (!magnet) return { x: 700, y: 500 };
    const rect = magnet.getBoundingClientRect();
    return { x: Math.round(rect.right + 70), y: Math.round(rect.top + rect.height / 2) };
  })()`);
  await page.mouse.move(target.x, target.y);
  await page.waitForTimeout(900);
  await shoot(page, "magnet-ring", 300);
  await context.close();
}

await browser.close();
console.log("done");