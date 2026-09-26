import { expect, test } from "@playwright/test";

/**
 * The film on the title sheet: the city plate being generated.
 *
 * Three claims, and they are different claims. First: the film fills the screen — it is the title sheet's
 * whole surface while it runs, not a picture in a mat. Second: it *steps* — the cell changes and the step's own
 * name changes with it, because the point of the film is how a plate is generated. Third: it hands over to the
 * title by itself, and the letters wait for it. Plus the escape hatch: `?film=0` gets the title with no film,
 * which is what the other entry specs use.
 */

test.describe("the film on the title sheet", () => {
  test("the city plate is generated on the full screen, step by step, then the title is set", async ({
    page,
  }) => {
    await page.goto("/?entry=1");
    const sheet = page.locator(".entry-sheet");
    await expect(sheet).toHaveAttribute("data-phase", "film", { timeout: 10_000 });

    const film = page.locator('[data-testid="entry-film"]');
    await expect(film).toBeVisible();

    // Full-bleed: the film covers the viewport, edge to edge.
    const cover = await film.evaluate((el) => {
      const rect = el.getBoundingClientRect();
      return {
        left: rect.left,
        top: rect.top,
        right: window.innerWidth - rect.right,
        bottom: window.innerHeight - rect.bottom,
      };
    });
    expect(Math.abs(cover.left), "the film starts at the left edge").toBeLessThan(4);
    expect(Math.abs(cover.top), "and at the top").toBeLessThan(4);
    expect(Math.abs(cover.right), "and reaches the right edge").toBeLessThan(4);
    expect(Math.abs(cover.bottom), "and the bottom").toBeLessThan(4);

    // The first step names itself, and the counter is the film's own: how a plate is generated, step by step.
    const label = page.locator(".entry-film-label");
    await expect(label).not.toHaveText("");
    await expect(page.locator(".entry-film-step")).toHaveText(/^\d\d \/ 15$/);

    // While the film runs the title block is not there yet, and a letter is still buried in its mask.
    const blockOpacity = await page
      .locator(".entry-block")
      .evaluate((el) => Number(getComputedStyle(el).opacity));
    expect(blockOpacity).toBeLessThan(0.1);
    const buriedY = await page
      .locator(".entry-letter")
      .first()
      .evaluate((el) => new DOMMatrixReadOnly(getComputedStyle(el).transform).m42);
    expect(buriedY).toBeGreaterThan(80);

    // It steps: the cell advances and the name of the step changes with it.
    await expect
      .poll(async () => Number(await film.getAttribute("data-cell")), { timeout: 20_000 })
      .toBeGreaterThan(0);
    await expect(label).not.toHaveText("the city's own drawing", { timeout: 20_000 });

    // The film hands over on its own — no interaction — and then the letters rise.
    await expect(sheet).toHaveAttribute("data-phase", "hold", { timeout: 30_000 });
    await expect
      .poll(
        async () =>
          await page
            .locator(".entry-letter")
            .first()
            .evaluate((el) => Math.abs(new DOMMatrixReadOnly(getComputedStyle(el).transform).m42)),
        { timeout: 15_000 },
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