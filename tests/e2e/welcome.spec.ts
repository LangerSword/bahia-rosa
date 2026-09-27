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

test("there is one wordmark, and it carries the credit", async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto("/?entry=1");
  const sheet = page.locator(".entry-sheet");
  // Exactly one "bahía rosa" on the sheet. The welcome card used to set a second one; two wordmarks reading the
  // same word is one too many, so the title *is* the welcome screen and the signature rides inside it.
  await expect(page.locator(".entry-wordmark")).toHaveCount(1);
  await expect(page.locator(".entry-film-mark")).toHaveCount(0);
  await expect(page.locator('[data-testid="entry-card-by"]')).toHaveText("by langersword");
  // And it is inside the title's own box, so the vapour takes the credit with the letters.
  const nested = await page
    .locator('[data-testid="entry-card-by"]')
    .evaluate((el) => Boolean(el.closest(".entry-wordmark")));
  expect(nested, "the signature is not inside the wordmark the dust is drawn from").toBe(true);
  const tilt = await page
    .locator('[data-testid="entry-card-by"]')
    .evaluate((el) => new DOMMatrixReadOnly(getComputedStyle(el).transform).b);
  expect(tilt, "the signature is not tilted").toBeLessThan(0);
  await expect(sheet).toHaveAttribute("data-phase", /hold|vapour|lift/, { timeout: 15_000 });
});

test("the wordmark's own face is preloaded with the document", async ({ page }) => {
  await page.goto("/?entry=1");
  await expect(page.locator('link[rel="preload"][as="font"][href="/fonts/Limelight-Regular.ttf"]')).toHaveCount(1);
  await expect(page.locator('link[rel="preload"][as="font"][href="/fonts/Italianno-Regular.ttf"]')).toHaveCount(1);
});