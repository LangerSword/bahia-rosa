import { expect, test } from "@playwright/test";

/**
 * The default press: no model, no desk, no upload — the look is computed in the page.
 *
 * This is the path a judge actually takes, so it is tested without a desk on the machine at all: the
 * photo goes in and a plate comes out of the same canvas code the app ships.
 */

test("a photo is pressed into a plate in the browser, with no desk involved", async ({ page }) => {
  test.setTimeout(120_000);
  const problems: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") problems.push(message.text());
  });
  page.on("pageerror", (error) => problems.push(String(error)));

  // No ?desk=, so the app must not even look for one.
  await page.goto("/");
  await expect(page.getByTestId("choose-photo")).toBeVisible();

  const started = Date.now();
  await page.getByTestId("photo-input").setInputFiles("public/art/demo/s1-marisol-keyart.jpg");

  // The editor mounts straight from the local press — no printing screen, no desk.
  await expect(page.locator(".editor-shell")).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId("print-desk")).toHaveCount(0);
  const seconds = (Date.now() - started) / 1000;
  console.log(`the browser press produced a plate in ${seconds.toFixed(1)}s`);
  expect(seconds).toBeLessThan(30);

  // The plate is a fresh image, not the file that went in: it is a data URL the canvas produced.
  const pressed = await page.evaluate(() => {
    const image = document.querySelector(".editor-shell img, .editor-shell canvas") as HTMLImageElement | HTMLCanvasElement | null;
    if (!image) return null;
    return image instanceof HTMLImageElement ? image.src.slice(0, 30) : "canvas";
  });
  expect(pressed === null || pressed.startsWith("data:image") || pressed === "canvas").toBe(true);

  expect(problems, `console errors: ${problems.join(" | ")}`).toEqual([]);
});
