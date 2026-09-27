import { expect, test } from "@playwright/test";

/**
 * The way in, tested from both sides.
 *
 * Three properties, and they pull against each other. It has to play — wordmark, a counter reading real
 * work, and a sheet that lifts — when it is asked for. It has to *not* play by default, because every
 * other spec in this directory navigates to the root and starts clicking: a title card covering the page
 * there would cost each of them seconds and add a class of flaky failures. And it has to end on its own,
 * because the ceiling is what makes a title a title instead of a hostage situation.
 *
 * `?entry=1` is the one way to overrule the skip, so these are the only tests that see the theatre.
 */

test("the entry plays, holds the hero back, and ends on its own", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });

  /**
   * A recorder, because the fault it catches is transient: the wordmark is hidden while it turns to dust, and
   * the first cut of that hid it only *during* the vapour — so the moment the dust finished and the sheet
   * began to lift, the full wordmark reappeared. A flash of the title coming back after it just vaporised.
   * Sampling is the only way to see a thing that exists for a tenth of a second.
   */
  await page.addInitScript(() => {
    const record = { vapourSeen: false, litWhileDusting: 0 };
    (window as unknown as { __exit: typeof record }).__exit = record;
    window.setInterval(() => {
      const h1 = document.querySelector(".entry-wordmark");
      const letters = [...document.querySelectorAll(".entry-letter")];
      if (!h1 || !letters.length) return;
      if (h1.getAttribute("data-vapour") === "on") {
        record.vapourSeen = true;
        const lit = letters.filter((el) => Number(getComputedStyle(el).opacity) > 0.05).length;
        record.litWhileDusting = Math.max(record.litWhileDusting, lit);
      }
    }, 50);
  });

  await page.goto("/?entry=1&film=0");

  const sheet = page.getByTestId("entry");
  await expect(sheet).toBeVisible();
  // The counter is a reading, not a decoration: the number of warm-up units that actually finished.
  await expect(page.getByTestId("entry-count")).toHaveText(/^\d{3}/);

  // The hero must not have revealed itself behind the sheet — that is the whole reason `entered` exists.
  const held = await page.getByTestId("hero").evaluate((node) => Number(getComputedStyle(node).opacity));
  expect(held).toBeLessThan(0.5);

  // Nobody touches it: the sheet lifts by itself, and the hero arrives behind it.
  await expect(sheet).toHaveCount(0, { timeout: 15_000 });
  await expect
    .poll(async () => page.getByTestId("hero").evaluate((node) => Number(getComputedStyle(node).opacity)), {
      timeout: 10_000,
    })
    .toBeGreaterThan(0.9);

  // …and the wordmark does not come back while the sheet leaves: hidden for the dust means hidden for good.
  const exit = await page.evaluate(
    () => ({ ...(window as unknown as { __exit: { vapourSeen: boolean; litWhileDusting: number } }).__exit }),
  );
  expect(exit.vapourSeen, "the wordmark turned to dust on the way out").toBe(true);
  expect(exit.litWhileDusting, "and stayed gone while the sheet lifted").toBe(0);

  expect(errors.filter((error) => !/favicon/i.test(error))).toEqual([]);
});

test("a click skips the entry early, not just at the end", async ({ page }) => {
  await page.goto("/?entry=1&film=0");
  const sheet = page.getByTestId("entry");
  await expect(sheet).toBeVisible();

  // Click while the sheet is still early in its run. The sheet's own ceiling is four seconds plus the
  // lift, so a sheet that is gone within two and a half seconds of an *early* click can only have gone
  // because of that click — a click that silently did nothing would still be looking at it here.
  await page.getByTestId("entry-skip").click();
  await expect(sheet).toHaveCount(0, { timeout: 2500 });
});

test("the entry stays out of the way unless it is asked for", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("entry")).toHaveCount(0);
  await expect(page.getByTestId("hero")).toBeVisible();
});

test("the entry plays again on a second visit, not only for a stranger", async ({ page }) => {
  // Mask the automation flag for this one: the test is about what a *person* gets, and a person's browser
  // does not announce itself as a test runner.
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "webdriver", { get: () => false, configurable: true });
  });

  await page.goto("/");
  await expect(page.getByTestId("entry")).toBeVisible();
  await page.getByTestId("entry-skip").click();
  await expect(page.getByTestId("entry")).toHaveCount(0, { timeout: 15_000 });

  // The same tab, a second arrival: the title plays again. There is no "seen it already" state left for it
  // to consult — the requirement, encoded. A *reload* is a fresh visit; the play-once rule is per page load.
  await page.reload();
  await expect(page.getByTestId("entry")).toBeVisible();
});

test("the wordmark hands over to its dust, with no frame where neither is there", async ({ page }) => {
  /**
   * The fault: the DOM letters were cut the instant the vapour began, while the canvas had not painted its
   * first frame — so for a beat the un-dusted side of the wordmark simply was not there. The fix is an
   * overlap: the letters stay for a few frames while the canvas takes over.
   *
   * That is a window of about sixty milliseconds, so it is sampled, not asserted once.
   */
  await page.addInitScript(() => {
    const record = { overlapFrames: 0, holes: 0, dustWithLetters: 0, canvasSeen: false };
    (window as unknown as { __handoff: typeof record }).__handoff = record;
    window.setInterval(() => {
      const sheet = document.querySelector('[data-testid="entry"]');
      const h1 = document.querySelector(".entry-wordmark");
      const canvas = document.querySelector(".vapour-host canvas");
      const letters = [...document.querySelectorAll(".entry-letter")];
      if (!h1 || !letters.length) return;
      // Only while the dissolve is the thing on stage: through the *lift* the letters are hidden and the
      // canvas is gone by design, which is the sheet leaving, not a hole.
      const phase = sheet ? sheet.getAttribute("data-phase") : null;
      const playing = phase === "vapour";
      const dusting = h1.getAttribute("data-vapour") === "on";
      if (canvas) record.canvasSeen = true;
      if (playing && canvas && !dusting) record.overlapFrames += 1;
      // A hole: the DOM copy hidden with no canvas in its place, while the dust is supposed to be playing.
      if (playing && dusting && !canvas) record.holes += 1;
      if (playing && dusting) {
        record.dustWithLetters = Math.max(
          record.dustWithLetters,
          letters.filter((el) => Number(getComputedStyle(el).opacity) > 0.05).length,
        );
      }
    }, 15);
  });

  await page.goto("/?entry=1&film=0");
  const sheet = page.getByTestId("entry");
  await expect(sheet).toBeVisible();
  await expect(sheet).toHaveCount(0, { timeout: 20_000 });

  const handoff = await page.evaluate(
    () =>
      ({
        ...(window as unknown as {
          __handoff: { overlapFrames: number; holes: number; dustWithLetters: number; canvasSeen: boolean };
        }).__handoff,
      }),
  );
  expect(handoff.canvasSeen, "the dust was drawn").toBe(true);
  expect(handoff.overlapFrames, "the letters and the canvas overlapped for at least a frame").toBeGreaterThan(0);
  expect(handoff.holes, "and the wordmark was never hidden with nothing in its place").toBe(0);
  expect(handoff.dustWithLetters, "the letters stayed gone once the dust had it").toBe(0);
});

test("a slow face is waited out, and a missing one is not a hostage", async ({ page }) => {
  // A hostile network for the display faces: the font files take six seconds. The title must wait inside its
  // masks rather than assembling in the fallback — that assembly-then-swap is the glitch this exists for.
  // The faces are `.ttf` (self-hosted binaries, not woff2), so the pattern names them exactly.
  await page.route("**/fonts/*.ttf", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 6000));
    await route.continue();
  });
  await page.goto("/?entry=1&film=0");

  const sheet = page.getByTestId("entry");
  await expect(sheet).toBeVisible();
  await expect(page.getByTestId("entry-count")).toHaveText(/^\d{3}/);

  await page.waitForTimeout(5200);
  // The gate waits on the two faces the title needs and no longer than 2.5s, so with the display faces six
  // seconds out the letters come up anyway — a show that begins is worth more than a face that arrives. The
  // claim is therefore the bound: the title assembles, and the sheet ends itself, without waiting out the
  // network. (Before the cap, this read "waiting" at 2.5s and a cold hero could hold the wordmark for 15.)
  const risen = await page.evaluate(
    `[...document.querySelectorAll(".entry-letter")].every((el) => {
       const t = getComputedStyle(el).transform;
       return t === "none" || /matrix\\(1, 0, 0, 1, 0, [0-9]/.test(t);
     })`,
  );
  expect(risen, "the title never assembled behind a slow face").toBe(true);

  // The gate resolves on its own — and its bound is what this test now asserts, not an unbounded wait.
  await expect(sheet).toHaveAttribute("data-face", "ready", { timeout: 6000 });
  // The face lands, the title is assembled, and the sheet lifts on its own.
  await expect(sheet).toHaveCount(0, { timeout: 20_000 });
});

test("a face that never arrives costs seconds, not the page", async ({ page }) => {
  // Failed, not slow: a face that cannot load is a face to stop waiting for — the letters come up in
  // whatever the stack gives, and the sheet still ends itself.
  await page.route("**/fonts/*.ttf", (route) => route.abort());
  await page.goto("/?entry=1&film=0");

  const sheet = page.getByTestId("entry");
  await expect(sheet).toBeVisible();
  await expect(sheet).toHaveAttribute("data-face", "ready", { timeout: 6_000 });
  await expect(sheet).toHaveCount(0, { timeout: 15_000 });
});

test("the dust is drawn in the title's own shape — line for line", async ({ page }) => {
  /**
   * The fault a reader caught: the wordmark wraps onto two lines in its box, and the canvas drew it as one
   * long line — wider than the canvas, so it clipped, and at a different size and shape from the type it
   * replaced. Same face, different typography, which reads as the font changing as the title vaporises.
   *
   * So the dust's geometry is held against the DOM's letters: the same width, two lines deep, in the face it
   * was asked for.
   */
  await page.goto("/?entry=1&film=0");
  const sheet = page.getByTestId("entry");
  await expect(sheet).toBeVisible();

  const host = page.getByTestId("vapour-host");
  await expect(host).toHaveCount(1, { timeout: 20_000 });
  await expect.poll(async () => host.getAttribute("data-ink"), { timeout: 10_000 }).not.toBe("");

  const shape = (await page.evaluate(`(() => {
    const host = document.querySelector('[data-testid="vapour-host"]');
    const h1 = document.querySelector(".entry-wordmark");
    const nodes = h1 ? [...h1.querySelectorAll(".entry-letter")] : [];
    const hostRect = host.getBoundingClientRect();
    const boxes = nodes.map((el) => el.getBoundingClientRect()).filter((box) => box.width > 0.5);
    const tops = [...new Set(boxes.map((box) => Math.round(box.top)))];
    const ink = (host.getAttribute("data-ink") || "").split(",").map(Number);
    const lines = boxes.length
      ? [...new Set(boxes.map((box) => Math.round(box.top / 8)))].length
      : 0;
    void tops;
    return {
      letters: boxes.length,
      domLines: lines,
      domLeft: boxes.length ? Math.round(Math.min(...boxes.map((b) => b.left)) - hostRect.left) : null,
      domRight: boxes.length ? Math.round(Math.max(...boxes.map((b) => b.right)) - hostRect.left) : null,
      lineHeight: boxes.length ? Math.round(Math.max(...boxes.map((b) => b.height))) : 0,
      ink: ink.length === 4 ? { left: ink[0], top: ink[1], right: ink[2], bottom: ink[3] } : null,
      drawnLines: Number(host.getAttribute("data-lines") || 0),
      font: host.getAttribute("data-font"),
      limelight: document.fonts.check('20px "Limelight"'),
    };
  })()`)) as {
    letters: number;
    domLines: number;
    domLeft: number | null;
    domRight: number | null;
    lineHeight: number;
    ink: { left: number; top: number; right: number; bottom: number } | null;
    drawnLines: number;
    font: string | null;
    limelight: boolean;
  };

  expect(shape.limelight, "the face is loaded when the dust is drawn").toBe(true);
  expect(shape.font, "and it is the face the title is set in").toBe("Limelight");
  expect(shape.ink, "the dust reported its own shape").not.toBeNull();
  expect(shape.domLeft, "the letters are measurable").not.toBeNull();

  // The dust spans the letters, edge to edge. The ink is the *glyphs* while the DOM's boxes are advance
  // widths — side bearings and the letter-spacing a canvas cannot carry — so a few percent either side is
  // the honest allowance at this size. What it guards against was off by hundreds and clipped.
  const slack = Math.max(Math.round(shape.lineHeight * 0.12), Math.round((shape.domRight ?? 0) * 0.08));
  expect(Math.abs((shape.ink?.left ?? 0) - (shape.domLeft ?? 0)), "left edge").toBeLessThanOrEqual(slack);
  expect(Math.abs((shape.ink?.right ?? 0) - (shape.domRight ?? 0)), "right edge").toBeLessThanOrEqual(slack);

  // Two lines of type make ink taller than one line: the wrapped title was drawn wrapped.
  expect(shape.drawnLines, "the canvas drew the title's lines").toBeGreaterThanOrEqual(2);
  const inkHeight = (shape.ink?.bottom ?? 0) - (shape.ink?.top ?? 0);
  expect(inkHeight, "and the dust is as tall as two lines, not one").toBeGreaterThan(shape.lineHeight * 1.4);
});