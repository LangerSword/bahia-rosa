import { expect, test, type Page } from "@playwright/test";

/**
 * The story, on the city stage: the visitor's own three artefacts, walked by scroll.
 *
 * Reaching it costs a real press (~10-15s warm, longer cold — the model pays for itself), which is the
 * honest way to test it: the story is built out of the visitor's photograph, their plate and the place, so
 * a fixture would be testing a different component.
 */

const DEMO = "public/art/demo/s1-marisol-keyart.jpg";

interface StoryReading {
  present: boolean;
  motion: string | null;
  active: string | null;
  moments: string[];
  panels: number;
  loaded: number;
  captionsShown: number;
  goldDot: string | null;
  dimDot: string | null;
  overflow: number;
}

const storyProbe = `(() => {
  const section = document.querySelector(".story");
  if (!section) return { present: false };
  const panels = [...section.querySelectorAll(".story-panel")];
  const images = panels.map((panel) => panel.querySelector("img")).filter(Boolean);
  const labels = panels.map((panel) => panel.querySelector(".story-note")?.textContent || "");
  const dots = [...section.querySelectorAll(".story-rail-name")];
  const active = section.getAttribute("data-active-moment");
  const activeDot = dots.find((dot) => dot.getAttribute("data-moment") === active)?.querySelector(".story-rail-dot");
  const otherDot = dots.find((dot) => dot.getAttribute("data-moment") !== active)?.querySelector(".story-rail-dot");
  return {
    present: true,
    motion: section.getAttribute("data-motion"),
    active,
    moments: dots.map((dot) => dot.getAttribute("data-moment") || ""),
    panels: panels.length,
    loaded: images.filter((img) => img.naturalWidth > 0 && img.complete).length,
    captionsShown: labels.filter((text) => text.trim().length > 30).length,
    goldDot: activeDot ? getComputedStyle(activeDot).backgroundColor : null,
    dimDot: otherDot ? getComputedStyle(otherDot).backgroundColor : null,
    overflow: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - window.innerWidth,
  };
})()`;

const readStory = async (page: Page): Promise<StoryReading> =>
  (await page.evaluate(storyProbe)) as StoryReading;

async function pressToCity(page: Page): Promise<void> {
  await page.goto("/");
  await expect(page.getByTestId("hero")).toBeVisible();
  await page.getByTestId("photo-input").setInputFiles(DEMO);
  await expect(page.getByTestId("printed-fork")).toBeVisible({ timeout: 200_000 });
  await page.getByTestId("take-to-city").click();
  await expect(page.getByTestId("launch")).toBeVisible({ timeout: 30_000 });
  await expect(page.locator(".story")).toBeVisible({ timeout: 15_000 });
}

test("the story walks photograph → plate → city as the visitor scrolls", async ({ page }) => {
  test.setTimeout(260_000);
  await page.setViewportSize({ width: 1280, height: 800 });
  await pressToCity(page);

  await page.locator(".story").scrollIntoViewIfNeeded();
  const opening = await readStory(page);

  expect(opening.present).toBe(true);
  expect(opening.motion, "the story walks when motion is allowed").toBe("walk");
  expect(opening.moments, "three moments on the rail, in order").toEqual(["photograph", "plate", "city"]);
  expect(opening.panels, "three panels").toBe(3);
  expect(opening.captionsShown, "each moment has its write-up in the open").toBe(3);
  expect(opening.active, "the story opens on the photograph").toBe("photograph");

  // The visitor's own three artefacts have to be real pixels before any of the rest means anything: walk
  // the section so the lazy panels load, then count.
  await page.evaluate(`document.querySelector(".story").scrollIntoView({ block: "end" })`);
  await expect.poll(async () => (await readStory(page)).loaded, { timeout: 30_000 }).toBe(3);

  // The walk, in three deliberate steps: each moment is polled where it is supposed to be, rather than
  // asserting one reading and comparing it to another that may have been taken during a layout shift.
  await page.evaluate(
    `(() => { const s = document.querySelector(".story"); const r = s.getBoundingClientRect(); window.scrollTo(0, window.scrollY + r.top - window.innerHeight * 0.35); })()`,
  );
  await expect.poll(async () => (await readStory(page)).active, { timeout: 10_000 }).toBe("photograph");

  // One panel opacity per step, read while that moment is the one the section reports — because a story
  // whose active moment is invisible is the exact bug this asserts against.
  const opacityOf = (page: Page, moment: string) =>
    page.evaluate(
      `Number(getComputedStyle(document.querySelector('.story-panel[data-moment="${moment}"]')).opacity)`,
    ) as Promise<number>;

  await page.evaluate(
    `(() => { const s = document.querySelector(".story"); const r = s.getBoundingClientRect(); window.scrollTo(0, window.scrollY + r.top + window.innerHeight * 0.26); })()`,
  );
  await expect.poll(async () => (await readStory(page)).active, { timeout: 10_000 }).toBe("photograph");
  await expect.poll(() => opacityOf(page, "photograph"), { timeout: 5_000 }).toBeGreaterThan(0.9);

  await page.evaluate(
    `(() => { const s = document.querySelector(".story"); const r = s.getBoundingClientRect(); window.scrollTo(0, window.scrollY + r.top + window.innerHeight * 0.95); })()`,
  );
  await expect.poll(async () => (await readStory(page)).active, { timeout: 10_000 }).toBe("plate");
  await expect.poll(() => opacityOf(page, "plate"), { timeout: 5_000 }).toBeGreaterThan(0.9);

  await page.evaluate(`document.querySelector(".story").scrollIntoView({ block: "end" })`);
  await expect.poll(async () => (await readStory(page)).active, { timeout: 10_000 }).toBe("city");
  await expect.poll(() => opacityOf(page, "city"), { timeout: 5_000 }).toBeGreaterThan(0.9);

  // The rail's lit dot follows the reported moment — one fact, two consumers.
  const lit = await readStory(page);
  expect(lit.goldDot, "the active moment's dot is the city's ink").not.toBe(lit.dimDot);
  expect(lit.overflow, "the story never opens a sideways scroll").toBeLessThanOrEqual(1);
});

test("with less motion asked for, the story is three stacked figures", async ({ page }) => {
  test.setTimeout(260_000);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: 1280, height: 800 });
  await pressToCity(page);

  await page.locator(".story").scrollIntoViewIfNeeded();
  const still = await readStory(page);

  expect(still.motion, "no walk").toBe("still");
  const allVisible = (await page.evaluate(
    `[...document.querySelectorAll(".story-panel")].every((panel) => Number(getComputedStyle(panel).opacity) > 0.9 && getComputedStyle(panel).position === "static")`,
  )) as boolean;
  expect(allVisible, "every moment is visible at once, none hidden behind a scroll").toBe(true);
});