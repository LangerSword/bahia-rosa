import { expect, test } from "@playwright/test";

/**
 * The welcome screen, checked for what it actually is now: a card, a bed, and a title.
 *
 * The montage is gone — the brief said it looked wrong and it was right — so there is no film to hang tests
 * on and none of its machinery remains. What must still hold: the card is the first thing on screen with the
 * wordmark and the signature on it, the music reads **on** by default and the control toggles it off and back,
 * and the satisfy-the-browser rule still holds — the visitor's first gesture is what unlocks sound, and the
 * control's own tap must not be the gesture that ends the sheet.
 */

test("the welcome card is the first thing on screen, and the title follows it", async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto("/?entry=1");
  const sheet = page.locator(".entry-sheet");
  const card = page.locator('[data-testid="entry-card"]');
  await expect(card).toHaveAttribute("data-shown", "yes", { timeout: 10_000 });
  await expect(card.locator(".entry-film-mark")).toHaveText("bahía rosa");
  await expect(page.locator('[data-testid="entry-card-by"]')).toHaveText("by langersword");
  // The title waits for the card rather than rising behind it.
  const buried = await page
    .locator(".entry-letter")
    .first()
    .evaluate((el) => new DOMMatrixReadOnly(getComputedStyle(el).transform).f);
  expect(buried, "a letter rose while the card was still on stage").toBeGreaterThan(40);
  // …and the card leaves of its own accord: the title is the next thing, not a second thing.
  await expect(card).toHaveAttribute("data-shown", "no", { timeout: 12_000 });
  await expect(sheet).toHaveAttribute("data-phase", /hold|vapour|lift/, { timeout: 12_000 });
});

test("sound reads on by default, toggles off and back, and its tap never ends the sheet", async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto("/?entry=1");
  const sheet = page.locator(".entry-sheet");
  await expect(sheet).toHaveAttribute("data-phase", /hold|vapour/, { timeout: 10_000 });
  const bed = page.locator(".entry-sheet audio");
  await expect(bed).toHaveAttribute("src", /audio\/noir-bed\.mp3$/);
  await expect(bed).toHaveAttribute("preload", "auto");
  const sound = page.locator('[data-testid="entry-sound"]');
  // On by default, as asked: the control reads "on" from the first frame. A browser's autoplay block is
  // policy, not the visitor's preference, and the first real gesture is what satisfies it.
  await expect(sound).toHaveAttribute("data-sound", "on");
  await sound.click();
  await expect(sound).toHaveAttribute("data-sound", "off");
  expect(await bed.evaluate((el) => (el as HTMLAudioElement).paused), "the tap did not pause the bed").toBe(true);
  await sound.click();
  await expect(sound).toHaveAttribute("data-sound", "on");
  // And the sheet is still here: the control's own gesture is not the one that leaves.
  await expect(sheet).toHaveAttribute("data-phase", /hold|vapour/);
});

test("a gesture anywhere unlocks the bed", async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto("/?entry=1");
  const sheet = page.locator(".entry-sheet");
  await expect(sheet).toHaveAttribute("data-phase", /hold|vapour/, { timeout: 10_000 });
  const bed = page.locator(".entry-sheet audio");
  await page.keyboard.press("Escape");
  await expect(sheet).toHaveAttribute("data-phase", /hold|vapour|lift/, { timeout: 15_000 });
  await expect(bed).toHaveCount(1);
  const playing = await bed.evaluate((el) => !(el as HTMLAudioElement).paused);
  expect(playing, "the gesture left the bed silent").toBe(true);
});

test("the wordmark's own face is preloaded with the document", async ({ page }) => {
  await page.goto("/?entry=1");
  await expect(page.locator('link[rel="preload"][as="font"][href="/fonts/Limelight-Regular.ttf"]')).toHaveCount(1);
  await expect(page.locator('link[rel="preload"][as="font"][href="/fonts/Italianno-Regular.ttf"]')).toHaveCount(1);
});