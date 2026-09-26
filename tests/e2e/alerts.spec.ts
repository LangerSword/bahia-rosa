import { expect, test, type Page } from "@playwright/test";

/**
 * The alert stack, through a real failure: a file that is not a photograph, dropped on the press.
 *
 * The point of the stack over the toasts is that a *condition* waits — so the tests here are that it
 * appears, that it says what happened and why, that it can be dismissed, and that it does not evaporate on
 * a timer the way a toast does.
 */

const stackProbe = `(() => {
  const stack = document.querySelector('[data-testid="alert-stack"]');
  const alerts = stack ? [...stack.querySelectorAll(".alert")] : [];
  return {
    present: Boolean(stack),
    count: alerts.length,
    titles: alerts.map((node) => node.querySelector(".alert-title")?.textContent?.trim() || ""),
    details: alerts.map((node) => node.querySelector(".alert-detail")?.textContent?.trim() || ""),
    roles: alerts.map((node) => node.getAttribute("role") || ""),
    tones: alerts.map((node) => node.getAttribute("data-tone") || ""),
    pressError: document.querySelector('[data-testid="press-error"]')?.textContent?.trim() || null,
  };
})()`;

interface StackReading {
  present: boolean;
  count: number;
  titles: string[];
  details: string[];
  roles: string[];
  tones: string[];
  pressError: string | null;
}

const readStack = async (page: Page): Promise<StackReading> =>
  (await page.evaluate(stackProbe)) as StackReading;

test("a photograph that cannot be pressed waits in the stack until it is dismissed", async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/");
  await expect(page.getByTestId("hero")).toBeVisible();

  // A file that claims to be a photograph and is not: the press has to refuse it, and refusal is the thing
  // the stack is for.
  await page.getByTestId("photo-input").setInputFiles({
    name: "broken.png",
    mimeType: "image/png",
    buffer: Buffer.from("PNG that is not a PNG: no header, no pixels, nothing to press"),
  });

  await expect.poll(async () => (await readStack(page)).count, { timeout: 30_000 }).toBeGreaterThan(0);
  const shown = await readStack(page);
  expect(shown.titles.join(" ").toLowerCase(), "it says what happened").toContain("could not be pressed");
  expect(shown.tones, "a refusal is a stop, not a nudge").toContain("stop");
  expect(shown.roles, "and it interrupts, because the work stopped").toContain("alert");
  expect(shown.details.join(" ").length, "with the reason attached").toBeGreaterThan(0);

  // The inline error at the intake is still there: two layers, one fact, no contradiction.
  expect(shown.pressError, "the intake says the same thing").not.toBeNull();

  // It waits. A toast would be gone by now; this must still be here.
  await page.waitForTimeout(6_500);
  expect((await readStack(page)).count, "conditions do not evaporate on a timer").toBeGreaterThan(0);

  await page.getByTestId("dismiss-press-failure").click();
  await expect.poll(async () => (await readStack(page)).count, { timeout: 5_000 }).toBe(0);
});

test("a successful press clears the failure it replaces", async ({ page }) => {
  test.setTimeout(260_000);
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/");
  await page.getByTestId("photo-input").setInputFiles({
    name: "broken.png",
    mimeType: "image/png",
    buffer: Buffer.from("still not a photograph"),
  });
  await expect.poll(async () => (await readStack(page)).count, { timeout: 30_000 }).toBeGreaterThan(0);

  await page.getByTestId("photo-input").setInputFiles("public/art/demo/s1-marisol-keyart.jpg");
  await expect(page.getByTestId("printed-fork")).toBeVisible({ timeout: 200_000 });
  expect(
    (await readStack(page)).count,
    "the condition is gone once the thing it described is fixed",
  ).toBe(0);
});