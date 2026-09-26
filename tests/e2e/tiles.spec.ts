import { expect, test } from "@playwright/test";

/**
 * The picker, as one object.
 *
 * The hour, the place and the finish are the same act, so they are the same tile: a mat, a caption in the
 * open, one travelling mark for the chosen state — and each tile is a magnet for the ring. Three assertions
 * carry the weight: exactly one chosen tile per group, the finish row keeping radiogroup semantics while
 * looking like its neighbours, and the gallery sitting *below* the choices it is evidence for.
 */

test.describe("the choices", () => {
  test("three groups, one chosen tile each", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector('[data-testid="look-dusk"]');

    await expect(page.locator('[data-testid^="look-"]')).toHaveCount(4);
    await expect(page.locator('[data-testid^="scene-"]')).toHaveCount(5);
    await expect(page.locator('[data-testid^="finish-"]')).toHaveCount(2);

    for (const group of ["look-", "scene-", "finish-"] as const) {
      await expect(page.locator(`[data-testid^="${group}"][data-active="yes"]`)).toHaveCount(1);
      await expect(page.locator(`[data-testid^="${group}"]`).first()).toHaveClass(/tile/);
    }
  });

  test("choosing a finish keeps radiogroup semantics", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector('[data-testid="finish-fast"]');
    const fast = page.locator('[data-testid="finish-fast"]');
    const fine = page.locator('[data-testid="finish-fine"]');
    await expect(fast).toHaveAttribute("aria-checked", "true");
    await expect(fine).toHaveAttribute("aria-checked", "false");
    await fine.click();
    await expect(fine).toHaveAttribute("aria-checked", "true");
    await expect(fast).toHaveAttribute("aria-checked", "false");
    await expect(fine).toHaveAttribute("data-active", "yes");
    // The finish tiles say what they print, in pixels.
    await expect(fine.locator(".tile-scale-label")).toHaveText("1900px frame");
    await expect(fast.locator(".tile-scale-label")).toHaveText("1280px frame");
  });

  test("the gallery is below the choices it proves", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector(".plate-gallery");
    // Document-relative, not viewport-relative: two boxes measured at two scroll positions are not comparable.
    const top = async (selector: string): Promise<number> =>
      page
        .locator(selector)
        .first()
        .evaluate((el) => el.getBoundingClientRect().top + window.scrollY);
    await page.locator("#finish-heading").scrollIntoViewIfNeeded();
    const finishTop = await top("#finish-heading");
    const galleryTop = await top(".plate-gallery");
    expect(galleryTop).toBeGreaterThan(finishTop);
    // And the gallery is its own section, below the whole intake, not sandwiched between two headings.
    const hourTop = await top("#hour-heading");
    expect(galleryTop).toBeGreaterThan(hourTop);
  });

  test("the tiles are touch-sized on a phone", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/");
    await page.waitForSelector('[data-testid="look-dusk"]');
    const tiles = page.locator('[data-testid^="look-"]');
    const count = await tiles.count();
    expect(count).toBe(4);
    for (let i = 0; i < count; i += 1) {
      const box = await tiles.nth(i).boundingBox();
      expect(box).not.toBeNull();
      if (!box) continue;
      expect(box.height).toBeGreaterThanOrEqual(44);
      expect(box.x + box.width).toBeLessThanOrEqual(391);
    }
  });
});