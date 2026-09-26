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