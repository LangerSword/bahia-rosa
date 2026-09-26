import { expect, test } from "@playwright/test";

/**
 * The hero as a camera.
 *
 * Three things are worth asserting, and only three: that the depths exist as three separate layers, that a
 * pointer writes the variables the CSS reads (and that leaving settles them), and that none of it moves the
 * layout — a parallax that shifts the page is a bug, not an effect. Under reduced motion the whole thing must
 * be inert, including the breath on the scene.
 */

test.describe("hero parallax", () => {
  test("the hero is three depths and a breath", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector('[data-testid="hero"]');
    const hero = page.locator('[data-testid="hero"]');
    await expect(hero.locator("[data-parallax]")).toHaveAttribute("data-parallax", "on");
    await expect(hero.locator(".hero-depth-far")).toHaveCount(1);
    await expect(hero.locator(".hero-depth-mid")).toHaveCount(1);
    await expect(hero.locator(".hero-depth-near")).toHaveCount(1);
    // The scene breathes on a long loop — the animation is declared, not faked with a transition.
    const animation = await hero
      .locator(".hero-depth-far")
      .evaluate((el) => getComputedStyle(el).animationName);
    expect(animation).toContain("hero-breathe");
  });

  test("a pointer writes the depths, and leaving settles them", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector('[data-testid="hero"]');
    const stage = page.locator("[data-testid='hero'] [data-parallax]");
    const box = await stage.boundingBox();
    expect(box).not.toBeNull();
    if (!box) return;

    // Cross the hero from one corner to the other: the far layer must go negative, the near positive.
    await page.mouse.move(box.x + box.width * 0.15, box.y + box.height * 0.3);
    await page.mouse.move(box.x + box.width * 0.85, box.y + box.height * 0.6, { steps: 8 });

    await expect
      .poll(async () => Number(await stage.evaluate((el) => el.style.getPropertyValue("--hx") || "0")))
      .toBeGreaterThan(0.4);

    const far = await page
      .locator(".hero-depth-far")
      .evaluate((el) => getComputedStyle(el).transform);
    const near = await page
      .locator(".hero-depth-near")
      .evaluate((el) => getComputedStyle(el).transform);
    // Both are matrices once computed; the far layer's X translation is negative, the near layer's positive.
    const xOf = (matrix: string): number => Number(matrix.split(",")[4] ?? "0");
    expect(xOf(far)).toBeLessThan(0);
    expect(xOf(near)).toBeGreaterThan(0);

    // Off the hero: the camera settles.
    await page.mouse.move(10, 10);
    await expect
      .poll(async () => Math.abs(Number(await stage.evaluate((el) => el.style.getPropertyValue("--hx") || "0"))))
      .toBeLessThan(0.05);
  });

  test("nothing about the hero's layout moves", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector('[data-testid="hero"]');
    const hero = page.locator('[data-testid="hero"]');
    // The reveal animation moves the box; wait until two samples agree before calling it the layout.
    await expect
      .poll(
        async () => {
          const a = await hero.boundingBox();
          await page.waitForTimeout(150);
          const b = await hero.boundingBox();
          return a && b && Math.abs(a.y - b.y) < 0.5 && Math.abs(a.x - b.x) < 0.5;
        },
        { timeout: 8000 },
      )
      .toBe(true);

    const before = await hero.boundingBox();
    expect(before).not.toBeNull();
    if (!before) return;
    // The honest claim: the parallax moves pixels on screen, never the page. So the test measures what a
    // layout change would actually disturb — the hero's own box and the height of the document. The CTA
    // inside a depth layer is *supposed* to move; that is the effect.
    const docBefore = await page.evaluate(() => document.documentElement.scrollHeight);
    await page.mouse.move(before.x + before.width * 0.2, before.y + before.height * 0.4);
    await page.mouse.move(before.x + before.width * 0.8, before.y + before.height * 0.5, { steps: 6 });
    // Let the ease run out, then measure.
    await page.waitForTimeout(700);
    const after = await hero.boundingBox();
    expect(after?.x).toBeCloseTo(before.x, 1);
    expect(after?.y).toBeCloseTo(before.y, 1);
    expect(after?.width).toBeCloseTo(before.width, 1);
    expect(after?.height).toBeCloseTo(before.height, 1);
    const docAfter = await page.evaluate(() => document.documentElement.scrollHeight);
    expect(docAfter).toBe(docBefore);
  });

  test("reduced motion leaves the hero a still", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/");
    await page.waitForSelector('[data-testid="hero"]');
    const hero = page.locator('[data-testid="hero"]');
    await expect(hero.locator("[data-parallax]")).toHaveAttribute("data-parallax", "off");
    const box = await hero.boundingBox();
    if (!box) return;
    await page.mouse.move(box.x + box.width * 0.8, box.y + box.height * 0.5, { steps: 4 });
    // Nothing is written, and the depths are switched off by the stylesheet as well.
    const hx = await hero.evaluate(
      (el) =>
        (el.querySelector("[data-parallax]") as HTMLElement | null)?.style.getPropertyValue("--hx") ?? "",
    );
    expect(hx).toBe("");
    const transform = await hero
      .locator(".hero-depth-far")
      .evaluate((el) => getComputedStyle(el).transform);
    expect(transform).toBe("none");
    const animation = await hero
      .locator(".hero-depth-far")
      .evaluate((el) => getComputedStyle(el).animationName);
    expect(animation).toBe("none");
  });
});