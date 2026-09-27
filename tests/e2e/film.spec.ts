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

    // And it is drawn one-to-one: the canvas's backing store is exactly its CSS size, so the ink lines the
    // build shows are the lines in the sprite rather than a resample of them.
    const pixels = await film.evaluate((el) => {
      const canvas = el as HTMLCanvasElement;
      return {
        w: canvas.width,
        h: canvas.height,
        cw: Math.round(canvas.clientWidth),
        ch: Math.round(canvas.clientHeight),
      };
    });
    expect(pixels.w, "the backing store is not the CSS width").toBe(pixels.cw);
    expect(pixels.h, "the backing store is not the CSS height").toBe(pixels.ch);

    // The city signs its own film first: the card carries the wordmark in the display face the title arrives
    // in, with its hairline drawn under it. Type is DOM, so this is a real font check and not a picture of one.
    const card = page.locator('[data-testid="entry-film-card"]');
    await expect(card).toBeVisible();
    await expect(card.locator(".entry-film-mark")).toHaveText("bahía rosa");
    const markFont = await card
      .locator(".entry-film-mark")
      .evaluate((el) => getComputedStyle(el).fontFamily);
    expect(markFont, "the card is not set in the city's display face").toContain("Limelight");
    // And its hairline draws itself in — the one motion the card has. Reading the transform's X scale: it
    // starts at 0 and the transition carries it to 1, so a stylesheet that lost the rule times this poll out.
    await expect
      .poll(
        async () =>
          await card
            .locator(".entry-film-rule")
            .evaluate((el) => new DOMMatrixReadOnly(getComputedStyle(el).transform).a),
        { timeout: 3000 },
      )
      .toBeGreaterThan(0.95);

    // The first step names itself, and the counter is the film's own: how a plate is generated, step by step.
    const label = page.locator(".entry-film-label");
    await expect(label).not.toHaveText("");
    await expect(page.locator(".entry-film-step")).toHaveText(/^\d\d \/ 13$/);

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

    /**
     * And the print head is real. One row of pixels across the canvas is cheap to read; the head is the only
     * tight gold in the frame, and — the part that matters — it *travels*. A single reading could be a warm
     * pixel in the sunset; a handful of different columns can only be the head moving, which is the whole
     * claim: a seam without a travelling head is the stitching artifact this was reported as.
     */
    const headX = async (): Promise<number> =>
      film.evaluate((el) => {
        const canvas = el as HTMLCanvasElement;
        const ctx = canvas.getContext("2d");
        if (!ctx) return -1;
        const row = ctx.getImageData(0, Math.round(canvas.height / 2), canvas.width, 1).data;
        for (let x = 0; x < canvas.width; x += 1) {
          const i = x * 4;
          if (row[i] > 240 && row[i + 1] > 165 && row[i + 1] < 215 && row[i + 2] < 70) return x;
        }
        return -1;
      });
    const columns = new Set<number>();
    await expect
      .poll(
        async () => {
          const x = await headX();
          if (x >= 0) columns.add(x);
          return columns.size;
        },
        { timeout: 20_000, intervals: [60] },
      )
      .toBeGreaterThan(1);

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