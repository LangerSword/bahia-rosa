import { expect, test } from "@playwright/test";

/**
 * The film on the title sheet.
 *
 * Two claims, and they are different claims. First: the film plays, the letters wait for it, and the title
 * takes over by itself — the sheet never waits on a picture. Second: `?film=0` means no film at all, which is
 * what the other entry specs use, and what a probe that wants the title without two seconds of press uses.
 */

test.describe("the film on the title sheet", () => {
  test("the press runs, then the title is set — and the letters wait for it", async ({ page }) => {
    await page.goto("/?entry=1");
    const sheet = page.locator(".entry-sheet");
    // The film is the first thing on the sheet, and its canvas draws cells as it goes.
    await expect(sheet).toHaveAttribute("data-phase", "film", { timeout: 10_000 });
    const film = page.locator('[data-testid="entry-film"]');
    await expect(film).toBeVisible();
    await expect(page.locator(".entry-film-wrap figcaption")).toHaveText("the press, at work");
    // While the film runs the title block is not there yet.
    const blockOpacity = await page
      .locator(".entry-block")
      .evaluate((el) => Number(getComputedStyle(el).opacity));
    expect(blockOpacity).toBeLessThan(0.1);
    // A letter is still buried in its mask: the transform carries it below the baseline.
    const buriedY = await page
      .locator(".entry-letter")
      .first()
      .evaluate((el) => new DOMMatrixReadOnly(getComputedStyle(el).transform).m42);
    expect(buriedY).toBeGreaterThan(80);
    // The film hands over on its own — no interaction — and then the letters rise.
    await expect(sheet).toHaveAttribute("data-phase", "hold", { timeout: 10_000 });
    await expect
      .poll(
        async () =>
          await page
            .locator(".entry-letter")
            .first()
            .evaluate((el) => Math.abs(new DOMMatrixReadOnly(getComputedStyle(el).transform).m42)),
        { timeout: 10_000 },
      )
      .toBeLessThan(4);
    await expect(page.locator('[data-testid="entry-film"]')).toHaveCount(0);
  });

  test("?film=0 gets the title without the film", async ({ page }) => {
    await page.goto("/?entry=1&film=0");
    const sheet = page.locator(".entry-sheet");
    await expect(sheet).toHaveAttribute("data-phase", "hold", { timeout: 10_000 });
    await expect(page.locator('[data-testid="entry-film"]')).toHaveCount(0);
    await expect(page.locator(".entry-film-wrap")).toHaveCount(0);
  });
});