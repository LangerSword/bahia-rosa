import { expect, test } from "@playwright/test";

/**
 * The reveal.
 *
 * The press finishes and the card turns over — *after* the press, not during it — and then the art is what is
 * left. Three properties; the first is the correction that produced this spec.
 *
 * All three are read by a **recorder installed before the page loads**, and that is not gold-plating: the
 * press saturates the main thread, so Playwright's own polling runs late — measured, this spec's first
 * attempt started watching the reveal 1.4 seconds after it had begun, and its first assertion timed out
 * because `waitForFunction` only resolves on a *truthy* result, which `0` is not. A small in-page interval
 * records what actually happened, whenever the browser has a slot to run it, and the test reads the record
 * afterwards. A transient animation is not something to interrogate in passing; it is something to witness.
 */

test("the card spins after the press finishes, and the art is what stays", async ({ page }) => {
  test.setTimeout(300_000);

  await page.addInitScript(() => {
    const record = {
      cardSeen: false,
      cardDuringPress: false,
      phases: [] as string[],
      moved: false,
      lastTransform: "",
    };
    (window as unknown as { __reveal: typeof record }).__reveal = record;
    window.setInterval(() => {
      const card = document.querySelector('[data-testid="card-reveal"]');
      const pressing = document.querySelector('[data-testid="converting"]');
      if (!card) return;
      record.cardSeen = true;
      if (pressing) record.cardDuringPress = true;
      const phase = card.getAttribute("data-phase") ?? "";
      if (!record.phases.includes(phase)) record.phases.push(phase);
      const transform = (card as HTMLElement).style.transform;
      if (record.lastTransform && transform !== record.lastTransform) record.moved = true;
      record.lastTransform = transform;
    }, 60);
  });

  await page.goto("/");
  await page.getByTestId("finish-fast").click();
  await page.getByTestId("photo-input").setInputFiles("public/art/demo/s1-marisol-keyart.jpg");

  // The press is over: the fork is up, and the card is turning on the plate's own spot — and then the art is
  // what stays. The plate only mounts once the card has landed, so waiting for it is waiting for the reveal.
  await expect(page.getByTestId("printed-fork")).toBeVisible({ timeout: 180_000 });
  await expect(page.getByTestId("printed-plate")).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId("card-reveal")).toHaveCount(0);

  const recorded = await page.evaluate(() => {
    const record = (window as unknown as { __reveal: { cardSeen: boolean; cardDuringPress: boolean; phases: string[]; moved: boolean } }).__reveal;
    return { ...record };
  });

  expect(recorded.cardSeen, "the card turns over when the press finishes").toBe(true);
  expect(recorded.cardDuringPress, "and not while the press runs").toBe(false);
  expect(recorded.phases, "it starts in the spin, not mid-landing").toContain("spin");
  expect(recorded.moved, "and it really is moving").toBe(true);
});