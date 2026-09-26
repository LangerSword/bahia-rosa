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

  await page.goto("/?entry=1");

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
  await page.goto("/?entry=1");
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
  // to consult — the requirement, encoded.
  await page.reload();
  await expect(page.getByTestId("entry")).toBeVisible();
});