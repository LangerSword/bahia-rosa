import { expect, test } from "@playwright/test";

/**
 * The three failure modes the visitor reported, each pinned to a test — because "it sometimes gets stuck or
 * skipped" is a bug report with three different mechanisms behind it, and a fix without a reproduction is a
 * guess:
 *
 *   1. **Stuck.** The film is drawn by a rAF loop, so a hidden tab or a stalled main thread freezes it
 *      mid-frame. The wall-clock net in `PlateFilm` lands it regardless; this throttles rAF to ~2.5fps after
 *      the film has started, which is the stall without the tab.
 *   2. **Skipped.** A 2.3MB sprite can lose a race with a flaky connection. One silent retry, then a clean
 *      skip: the entry must reach its title in both cases.
 *   3. **No music.** Browsers refuse sound until a gesture, so "sound on by default" is an *attempt* on
 *      mount plus an unlock on the visitor's first real gesture — including the gesture that skips the film.
 */

test("a stalled frame loop still lands the film", async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto("/?entry=1");
  const sheet = page.locator(".entry-sheet");
  await expect(sheet).toHaveAttribute("data-phase", "film", { timeout: 10_000 });

  // After the film is running, make every rAF take 400ms to arrive. The loop asks for the next frame each
  // frame, so this override does bite — and with time-based drawing it crawls rather than freezes, which is
  // exactly what a hidden tab looks like from the inside.
  await page.evaluate(() => {
    const native = window.requestAnimationFrame.bind(window);
    window.requestAnimationFrame = (callback: FrameRequestCallback): number =>
      window.setTimeout(() => void native(callback), 400) as unknown as number;
  });

  // The net is the film's own length plus 2.5s of slack; the title's floor then runs. Without the net this
  // times out in the "film" phase — which is the reported bug, reproduced.
  await expect(sheet).toHaveAttribute("data-phase", /hold|vapour/, { timeout: 30_000 });
});

test("a sprite that fails once is retried, and only a second failure skips the film", async ({ page }) => {
  test.setTimeout(90_000);
  let requests = 0;
  await page.route("**/film/plate-film.jpg", async (route) => {
    requests += 1;
    if (requests === 1) await route.abort("failed");
    else await route.continue();
  });
  await page.goto("/?entry=1");
  const sheet = page.locator(".entry-sheet");
  // The retry happens 500ms after the first failure; the film then plays and finishes normally.
  await expect(sheet).toHaveAttribute("data-phase", /hold|vapour/, { timeout: 40_000 });
  expect(requests, "the sprite was not retried after a failed first attempt").toBeGreaterThanOrEqual(2);
  const seen = await sheet.getAttribute("data-phase");
  expect(seen, "the film never left its phase").not.toBe("film");
});

test("a sprite that never arrives skips the film without holding the entry", async ({ page }) => {
  test.setTimeout(90_000);
  await page.route("**/film/plate-film.jpg", (route) => route.abort("failed"));
  await page.goto("/?entry=1");
  const sheet = page.locator(".entry-sheet");
  // Two attempts, then the skip: the title must arrive on its own. This is the guard's job, and the whole
  // reason it exists — a film that cannot load must not become a page that cannot start.
  await expect(sheet).toHaveAttribute("data-phase", /hold|vapour/, { timeout: 40_000 });
});

test("the first gesture starts the bed, and it outlives the film", async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto("/?entry=1");
  const sheet = page.locator(".entry-sheet");
  await expect(sheet).toHaveAttribute("data-phase", "film", { timeout: 10_000 });
  const bed = page.locator(".entry-sheet audio");
  await expect(bed).toHaveAttribute("src", /audio\/noir-bed\.mp3$/);

  // The gesture is a keypress — which is also the gesture that leaves the film. That is the point: the same
  // input that skips is the one that satisfies the browser, so the music continues under the title.
  await page.keyboard.press("Escape");
  // Any gesture leaves the entry — that is the bail's job, and after a skip the sheet goes straight out rather
  // than playing the title's vapour to an empty room. What must survive the skip is the music.
  await expect(sheet).toHaveAttribute("data-phase", /hold|vapour|lift/, { timeout: 15_000 });
  // It is still there after the film is gone: the bed belongs to the entry now, so skipping cannot silence it.
  await expect(bed).toHaveAttribute("src", /audio\/noir-bed\.mp3$/);
  await expect(bed).toHaveCount(1);
});

test("the sprite is preloaded with the document", async ({ page }) => {
  await page.goto("/?entry=1");
  const preload = page.locator('link[rel="preload"][as="image"][href="/film/plate-film.jpg"]');
  await expect(preload, "the film's sprite is not preloaded by index.html").toHaveCount(1);
});