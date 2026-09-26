import { expect, test } from "@playwright/test";

/**
 * The card at the end of the press.
 *
 * It is asserted on the *wrapper* rather than on the canvas on purpose: when WebGL is unavailable the
 * component draws the same card as a flat print instead, and that fallback is the property that matters
 * most here — a ceremony must never be able to take the fork down with it. What the serial proves is the
 * other half: the card is minted from the plate, so the same plate mints the same serial and a reload
 * does not re-mint a different one.
 */

test("the press finishes onto a card with a serial, a stamp and a tip", async ({ page }) => {
  test.setTimeout(240_000);

  await page.goto("/");
  await page.getByTestId("finish-fast").click();
  await page.getByTestId("photo-input").setInputFiles("public/art/demo/s1-marisol-keyart.jpg");
  await expect(page.getByTestId("printed-fork")).toBeVisible({ timeout: 180_000 });

  const card = page.getByTestId("steel-card");
  await expect(card).toBeVisible();

  const serial = await card.getAttribute("data-serial");
  expect(serial).toMatch(/^№ \d{3}-\d{5}$/);
  await expect(card.locator(".steel-serial")).toHaveText(serial ?? "");
  await expect(card.locator(".steel-when")).toHaveText(/pressed \d{2}:\d{2}/);
  await expect(page.getByTestId("steel-tip")).toBeVisible();

  // Let the turn settle before the shot: a screenshot of a card mid-flip is not a record of the card.
  await card.scrollIntoViewIfNeeded();
  await page.waitForTimeout(2500);
  await card.screenshot({ path: "docs/shots/steel-card.png" });
});