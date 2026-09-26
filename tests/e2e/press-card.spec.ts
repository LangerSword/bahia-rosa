import { expect, test } from "@playwright/test";

/**
 * The loading screen's card, and where it is **not**.
 *
 * Two properties, and the second is the one that was wrong first: the card turns over while the press runs
 * — fast, on the compositor — and it is gone from the output. What the visitor keeps is the art, not the
 * card.
 *
 * The reading is done in **one in-page call** on purpose. The press hogs the main thread, so every
 * `evaluate` and every auto-waiting assertion queues behind it and can land *after* the stage it was
 * asking about has been replaced — which is exactly how this spec first failed, three times, in three
 * different places. One question, asked while the card is up, answered as soon as the browser has a free
 * slot, cannot race it.
 */

test("the card spins while the press runs, and is gone once the art is ready", async ({ page }) => {
  test.setTimeout(300_000);

  await page.goto("/");
  // The fine finish: the card lives exactly as long as the press does, and a warm fast press can be over in
  // a couple of seconds. What is being tested is that the art replaces the card, not how quick the press is.
  await page.getByTestId("finish-fine").click();
  await page.getByTestId("photo-input").setInputFiles("public/art/demo/s1-marisol-keyart.jpg");

  const facts = await page
    .waitForFunction(
      () => {
        const spin = document.querySelector('[data-testid="press-card-spin"]');
        const tip = document.querySelector('[data-testid="press-tip"]');
        if (!spin || !tip) return null;
        const style = getComputedStyle(spin);
        if (style.animationName !== "press-spin") return null;
        return {
          name: style.animationName,
          duration: style.animationDuration,
          iterations: style.animationIterationCount,
          motion: spin.getAttribute("data-motion"),
          tipLength: (tip.textContent ?? "").trim().length,
        };
      },
      undefined,
      { timeout: 120_000, polling: 200 },
    )
    .then((handle) => {
      // The condition only resolves with a value, so this is non-null by construction; the cast is for the
      // type system, which cannot see inside the page.
      const value = handle.jsonValue() as Promise<unknown>;
      return value as Promise<{
        name: string;
        duration: string;
        iterations: string;
        motion: string;
        tipLength: number;
      }>;
    });

  expect(facts.motion, "the spin is only stilled for reduced motion").toBe("spin");
  expect(facts.name, "the spin is a CSS animation, not a JavaScript loop").toBe("press-spin");
  expect(facts.iterations).toBe("infinite");
  expect(parseFloat(facts.duration), "rapidly fast: a turn a second or faster").toBeLessThanOrEqual(1.2);
  expect(facts.tipLength, "and something true to read while you wait").toBeGreaterThan(20);

  // The art arrives — and the card does not come with it.
  await expect(page.getByTestId("printed-fork")).toBeVisible({ timeout: 180_000 });
  await expect(page.getByTestId("printed-plate")).toBeVisible();
  await expect(page.getByTestId("press-card")).toHaveCount(0);
});