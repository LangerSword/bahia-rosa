import { expect, test, type Page } from "@playwright/test";

/**
 * The plates on a real screen: nine real frames, actually fetched, on a wall that moves with the scroll —
 * and that behaves itself when the visitor has asked for less motion or is on a phone.
 *
 * Reads go through one in-page call each, per the suite's rule: a sequence of separate evaluates on a page
 * that is animating can each answer about a different moment.
 */

interface WallReading {
  present: boolean;
  motion: string | null;
  columns: string | null;
  transform: string | null;
  frames: number;
  loaded: number;
  captionsShown: number;
  heading: string | null;
}

const wallProbe = `(() => {
  const section = document.querySelector(".plate-gallery");
  const wall = document.querySelector(".plate-gallery-wall");
  const frames = [...document.querySelectorAll(".plate-frame img")];
  const loaded = frames.filter((img) => img.naturalWidth > 0 && img.complete).length;
  const captions = [...document.querySelectorAll(".plate-frame-caption")].map((node) => node.textContent || "");
  return {
    present: Boolean(section && wall),
    motion: section?.getAttribute("data-motion") || null,
    columns: section?.getAttribute("data-columns") || null,
    transform: wall ? getComputedStyle(wall).transform : null,
    frames: frames.length,
    loaded,
    captionsShown: captions.filter((text) => text.trim().length > 24).length,
    heading: document.getElementById("plates-heading")?.textContent?.trim() || null,
  };
})()`;

const readWall = async (page: Page): Promise<WallReading> =>
  (await page.evaluate(wallProbe)) as WallReading;

test("nine plates unfurl as you scroll past them", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/");
  await expect(page.getByTestId("hero")).toBeVisible();

  await page.locator(".plate-gallery").scrollIntoViewIfNeeded();
  const first = await readWall(page);

  expect(first.present, "the gallery is on the page").toBe(true);
  expect(first.motion, "the wall unfurls when motion is allowed").toBe("unfurl");
  expect(first.columns, "three columns on a desk screen").toBe("3");
  expect(first.heading, "the section names itself").toBe("the plates");
  expect(first.frames, "nine frames").toBe(9);
  expect(first.captionsShown, "every frame carries its own caption in the DOM, not a hover secret").toBe(9);

  // The frames must be real pixels, not broken images behind the wall. Lazy frames load as the wall passes
  // the viewport, so walk the whole wall before counting.
  await page.evaluate(`document.querySelector(".plate-gallery").scrollIntoView({ block: "end" })`);
  await expect.poll(async () => (await readWall(page)).loaded, { timeout: 20_000 }).toBe(9);

  // And the wall must actually move with the scroll — the unfurl is the point of the section.
  const before = (await readWall(page)).transform;
  await page.mouse.wheel(0, 420);
  await expect.poll(async () => (await readWall(page)).transform, { timeout: 6_000 }).not.toBe(before);
  const after = (await readWall(page)).transform;
  expect(after, "a transform, not none").not.toBe("none");

  // A tilted wall must not open a sideways scroll: the near edge grows, and if it is not contained the page
  // gains a horizontal scrollbar behind the visitor's back.
  const slide = (await page.evaluate(
    `Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - window.innerWidth`,
  )) as number;
  expect(slide, "the wall stays inside the glass on a desk screen").toBeLessThanOrEqual(1);

  // And the outer frames must stay inside the stage while the wall is tilted — the difference between a
  // leaning wall and a broken one, and the thing the design gate caught that the scroll test could not.
  const edges = (await page.evaluate(`(() => {
    const stage = document.querySelector(".plate-gallery-stage").getBoundingClientRect();
    const frames = [...document.querySelectorAll(".plate-frame")].map((n) => n.getBoundingClientRect());
    return {
      leftGap: Math.round(Math.min(...frames.map((r) => r.left)) - stage.left),
      rightGap: Math.round(stage.right - Math.max(...frames.map((r) => r.right))),
    };
  })()`)) as { leftGap: number; rightGap: number };
  expect(edges.leftGap, "the left column is inside the stage, not cut off by it").toBeGreaterThanOrEqual(-1);
  expect(edges.rightGap, "and so is the right column").toBeGreaterThanOrEqual(-1);

  // The captions are the frames' evidence, so they have to be readable: contrast measured on the rendered
  // colours, not asserted from the stylesheet's intentions.
  const contrast = (await page.evaluate(`(() => {
    const caption = document.querySelector(".plate-frame-caption");
    const frame = document.querySelector(".plate-frame");
    const parse = (value) => {
      const parts = value.match(/[\\d.]+/g).map(Number);
      return { r: parts[0], g: parts[1], b: parts[2], a: parts[3] ?? 1 };
    };
    const paper = parse(getComputedStyle(caption).color);
    // Computed colour does not carry the element's opacity — fold it in, or the measurement flatters itself.
    paper.a = paper.a * Number(getComputedStyle(caption).opacity);
    const mat = parse(getComputedStyle(frame).backgroundColor || "rgb(16,16,20)");
    // Flatten the caption's alpha over the mat, then measure against the mat.
    const flat = ["r", "g", "b"].reduce((acc, key) => {
      acc[key] = paper[key] * paper.a + mat[key] * (1 - paper.a);
      return acc;
    }, {});
    const lum = (c) => {
      const channel = (v) => {
        const s = v / 255;
        return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
      };
      return 0.2126 * channel(c.r) + 0.7152 * channel(c.g) + 0.0722 * channel(c.b);
    };
    const a = lum(flat);
    const b = lum(mat);
    return Math.round(((Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)) * 10) / 10;
  })()`)) as number;
  expect(contrast, "the caption is readable against the mat").toBeGreaterThanOrEqual(4.5);
});

test("with less motion asked for, the wall is a plain grid", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/");
  await page.locator(".plate-gallery").scrollIntoViewIfNeeded();

  const still = await readWall(page);
  expect(still.present).toBe(true);
  expect(still.motion, "no unfurl").toBe("still");
  expect(still.transform, "no transform at all").toBe("none");

  const captionsVisible = (await page.evaluate(
    `[...document.querySelectorAll(".plate-frame-caption")].every((node) => Number(getComputedStyle(node).opacity) > 0.9)`,
  )) as boolean;
  expect(captionsVisible, "every caption is visible without a hover").toBe(true);
});

test("on a phone the wall deals into two columns and stays inside the screen", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.locator(".plate-gallery").scrollIntoViewIfNeeded();
  await page.evaluate(`document.querySelector(".plate-gallery").scrollIntoView({ block: "end" })`);
  await expect.poll(async () => (await readWall(page)).loaded, { timeout: 20_000 }).toBe(9);

  const phone = await readWall(page);
  expect(phone.columns, "two columns on a phone").toBe("2");

  const overflow = (await page.evaluate(
    `Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - window.innerWidth`,
  )) as number;
  expect(overflow, "the wall never opens a sideways scroll").toBeLessThanOrEqual(1);
});