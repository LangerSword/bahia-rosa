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

  test("the preview is the place at the hour, and it answers the hour", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector('[data-testid="pick-preview-canvas"]');
    // The station's own plate: a real canvas the press graded, not a static image. Changing the hour must
    // change its pixels — that is the whole claim of a preview.
    const mean = async (): Promise<number> =>
      page.locator('[data-testid="pick-preview-canvas"]').evaluate((el) => {
        const canvas = el as HTMLCanvasElement;
        const ctx = canvas.getContext("2d");
        if (!ctx) return 0;
        const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
        let sum = 0;
        for (let i = 0; i < data.length; i += 4) {
          sum += data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;
        }
        return sum / (data.length / 4);
      });
    const dusk = await mean();
    expect(dusk).toBeGreaterThan(0);
    await page.locator('[data-testid="look-night"]').click();
    await expect
      .poll(async () => Math.abs((await mean()) - dusk), { timeout: 10_000 })
      .toBeGreaterThan(4);
    // And the caption names both choices, in the site's own words.
    const caption = await page.locator('[data-testid="pick-preview"]').innerText();
    expect(caption.toLowerCase()).toContain("night");
  });

  test("the rows hold still: the hour strip does not re-render when the place changes", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector('[data-testid="look-dusk"]');
    // Each hour tile's own drawing, as bytes. A strip whose thumbnails re-render when the *other* row
    // changes cannot be compared, because the thing being compared moves.
    const hourStrip = async (): Promise<string> =>
      page.evaluate(() =>
        Array.from(document.querySelectorAll('[data-testid^="look-"]'))
          .map((tile) => {
            const canvas = tile.querySelector("canvas") as HTMLCanvasElement | null;
            return canvas ? canvas.toDataURL().slice(-28) : "none";
          })
          .join("|"),
      );
    const previewOf = async (): Promise<string> =>
      page
        .locator('[data-testid="pick-preview-canvas"]')
        .evaluate((el) => (el as HTMLCanvasElement).toDataURL().slice(-28));

    const hoursBefore = await hourStrip();
    const previewBefore = await previewOf();
    expect(previewBefore).not.toBe("none");

    await page.locator('[data-testid="scene-marina"]').click();
    await expect(page.locator('[data-testid="scene-marina"]')).toHaveAttribute("aria-pressed", "true");
    // The strip holds still through the change...
    await page.waitForTimeout(1200);
    expect(await hourStrip(), "the hour strip re-drew when the place changed").toBe(hoursBefore);
    // ...and the preview follows it, so the stillness is the strip's design and not a dead page.
    await expect.poll(previewOf, { timeout: 10_000 }).not.toBe(previewBefore);
  });

  test("the place strip follows the hour: choosing a light brings every place to it", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector('[data-testid="look-dusk"]');
    const placeStrip = async (): Promise<string> =>
      page.evaluate(() =>
        Array.from(document.querySelectorAll('[data-testid^="scene-"]'))
          .map((tile) => {
            const canvas = tile.querySelector("canvas") as HTMLCanvasElement | null;
            return canvas ? canvas.toDataURL().slice(-28) : "none";
          })
          .join("|"),
      );

    const before = await placeStrip();
    // Four real places have a scene to draw; "as it is" has none by design.
    expect(before.split("|").filter((v) => v !== "none").length).toBe(4);
    expect(before).not.toBe("none|none|none|none|none");

    await page.locator('[data-testid="look-night"]').click();
    // Every place comes to the chosen light — the comparison moves with the choice.
    await expect.poll(placeStrip, { timeout: 15_000 }).not.toBe(before);
    const after = await placeStrip();
    expect(after.split("|").filter((v) => v !== "none").length).toBe(4);
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