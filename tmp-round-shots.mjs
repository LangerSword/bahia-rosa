/**
 * Throwaway: fresh renders of this round's surfaces — the hero mid-drift, the three choice rows, the gallery
 * where it now sits (below the choices), and the tiles on a phone.
 * Run from the repo so `playwright` resolves.
 *
 *   node tmp-round-shots.mjs
 */
import { chromium } from "playwright";

const BASE = process.env.SHOT_BASE ?? "http://localhost:5178";
const out = "docs/shots";

const browser = await chromium.launch();

// 1. The hero, mid-drift: pointer near the far corner, then let the ease run out.
{
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
  const page = await context.newPage();
  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-testid="hero"]');
  await page.waitForTimeout(1300);
  const hero = await page.locator('[data-testid="hero"]').boundingBox();
  if (hero) {
    await page.mouse.move(hero.x + hero.width * 0.85, hero.y + hero.height * 0.7, { steps: 12 });
    await page.waitForTimeout(800);
  }
  await page.screenshot({ path: `${out}/hero-parallax.png` });
  console.log("hero-parallax: shot");

  // 2. The three choice rows, one section each.
  const preview = await page.$('[data-testid="pick-preview"]');
  if (preview) {
    await preview.scrollIntoViewIfNeeded();
    await page.waitForTimeout(1100);
    await preview.screenshot({ path: `${out}/pick-preview.png` });
    console.log("pick-preview: shot");
  } else {
    console.log("pick-preview: MISSING");
  }

  for (const [name, selector] of [
    ["choice-hour", "#hour-heading"],
    ["choice-place", "#place-heading"],
    ["choice-finish", "#finish-heading"],
  ]) {
    const el = await page.$(selector);
    if (!el) {
      console.log(`${name}: MISSING (${selector})`);
      continue;
    }
    await el.scrollIntoViewIfNeeded();
    await page.waitForTimeout(1100); // the thumbs grade on the frame
    const section = await el.evaluateHandle((node) => node.closest("section"));
    await section.asElement()?.screenshot({ path: `${out}/${name}.png` });
    console.log(`${name}: shot`);
  }

  // 3. The gallery where it now sits: below the choices, at the end of the intake.
  await page.evaluate(`document.querySelector(".plate-gallery")?.scrollIntoView({ block: "center" })`);
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${out}/gallery-below-choices.png` });
  console.log("gallery-below-choices: shot");
  await context.close();
}

// 4. The tiles on a phone.
{
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
  });
  const page = await context.newPage();
  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-testid="look-dusk"]');
  await page.locator("#hour-heading").scrollIntoViewIfNeeded();
  await page.waitForTimeout(1200);
  const section = await page.locator("#hour-heading").evaluateHandle((node) => node.closest("section"));
  await section.asElement()?.screenshot({ path: `${out}/choice-hour-phone.png` });
  console.log("choice-hour-phone: shot");
  await context.close();
}

await browser.close();