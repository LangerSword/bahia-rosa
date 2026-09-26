import { expect, test, type Page } from "@playwright/test";

/**
 * The ring.
 *
 * It is decoration over normal input, so the things worth defending are: it exists where a pointer exists,
 * it actually leans toward the things that ask to be magnetic, and it does not exist at all for a visitor
 * on a touch screen or one who asked for less motion.
 */

const ringState = `(() => {
  const ring = document.querySelector('[data-testid="magnet-ring"]');
  if (!ring) return { present: false };
  const rect = ring.getBoundingClientRect();
  const style = getComputedStyle(ring);
  return {
    present: true,
    visible: ring.getAttribute("data-visible"),
    pulled: ring.getAttribute("data-pulled"),
    opacity: Number(style.opacity),
    centre: { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 },
    size: Math.round(rect.width),
  };
})()`;

interface RingReading {
  present: boolean;
  visible?: string | null;
  pulled?: string | null;
  opacity?: number;
  centre?: { x: number; y: number };
  size?: number;
}

const readRing = async (page: Page): Promise<RingReading> =>
  (await page.evaluate(ringState)) as RingReading;

test("the ring follows the pointer and leans toward magnetic things", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/");
  await expect(page.getByTestId("hero")).toBeVisible();
  // The ring mounts on its own tick — the effect that decides a fine pointer exists runs after hydration —
  // so the spec waits for the ring itself before moving, rather than racing it.
  await expect(page.getByTestId("magnet-ring")).toHaveCount(1);
  await page.waitForTimeout(250);

  await page.mouse.move(500, 400, { steps: 6 });
  await expect.poll(async () => (await readRing(page)).visible, { timeout: 5_000 }).toBe("yes");
  // The ring fades in over a third of a second, so the opacity is polled, not read once at the moment the
  // attribute flips.
  await expect.poll(async () => (await readRing(page)).opacity ?? 0, { timeout: 5_000 }).toBeGreaterThan(0.3);
  const first = await readRing(page);

  await page.mouse.move(900, 520, { steps: 8 });
  await expect
    .poll(async () => (await readRing(page)).centre?.x ?? 0, { timeout: 5_000 })
    .toBeGreaterThan((first.centre?.x ?? 0) + 120);

  // Somewhere magnetic, but off it: the ring must be pulled *toward* the thing, i.e. it sits left of the
  // pointer when the magnetic thing is to its left. That offset is the whole trick. The target has to be a
  // magnet that is actually on screen — the page's first `.btn` sits far below the fold, and a mouse move
  // to its coordinates lands outside the viewport entirely.
  const target = (await page.evaluate(`(() => {
    const magnet = document.querySelector('[data-magnet="hero-door"]');
    if (!magnet) return null;
    const rect = magnet.getBoundingClientRect();
    if (rect.width === 0 || rect.bottom < 0 || rect.top > window.innerHeight) return null;
    return { x: Math.round(rect.right + 70), y: Math.round(rect.top + rect.height / 2), cx: rect.left + rect.width / 2 };
  })()`)) as { x: number; y: number; cx: number } | null;
  expect(target, "the hero's door is a magnet, and it is on screen").not.toBeNull();

  await page.mouse.move(target!.x, target!.y, { steps: 6 });
  await expect.poll(async () => (await readRing(page)).pulled, { timeout: 5_000 }).toBe("yes");
  // The opening is a transition too — 20px to 44px over a fifth of a second — so the size is polled rather
  // than read the instant the attribute flips.
  await expect.poll(async () => (await readRing(page)).size ?? 0, { timeout: 5_000 }).toBeGreaterThan(30);
  const pulled = await readRing(page);
  expect(pulled.size, "the ring opens up over a magnetic thing").toBeGreaterThan(first.size ?? 0);
  await expect
    .poll(async () => (await readRing(page)).centre?.x ?? 0, { timeout: 5_000 })
    .toBeLessThan(target!.x - 5);
});

test("no ring for a visitor who asked for less motion", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await page.mouse.move(600, 400);
  await page.waitForTimeout(400);
  expect((await readRing(page)).present, "the ring is not even mounted").toBe(false);
});

test("no ring on a touch screen", async ({ browser }) => {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  const page = await context.newPage();
  await page.goto("/");
  await page.waitForSelector("[data-testid='hero']");

  const fine = (await page.evaluate(`matchMedia("(pointer: fine)").matches`)) as boolean;
  expect(fine, "this context really does present a coarse pointer").toBe(false);
  expect((await readRing(page)).present, "and so there is no ring").toBe(false);
  await context.close();
});