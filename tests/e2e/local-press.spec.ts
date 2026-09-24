import { expect, test } from "@playwright/test";

/**
 * The press: no upload, no key — and now a real segmentation model, served from this site's own
 * origin, deciding where the person ends and the room begins. That decision is the difference between
 * a cut-out placed into a city and a recolour of a photograph, so it is what this spec defends.
 *
 * It also defends the second thing the brief asked for: the press stops at a fork — download the plate
 * raw, or take it into the editor — instead of dumping the visitor straight into a tool.
 */

test("a photo is pressed into a plate, then the fork offers it raw or in the editor", async ({ page }) => {
  test.setTimeout(240_000);
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

  await expect(page.getByTestId("printed-fork")).toBeVisible({ timeout: 150_000 });
  const seconds = (Date.now() - started) / 1000;
  console.log(`the press produced a plate in ${seconds.toFixed(1)}s (a cold run pays for the model)`);
  await expect(page.getByTestId("print-desk")).toHaveCount(0);

  // The plate is a fresh image, not the file that went in: a data URL the canvas produced.
  const plate = await page.getByTestId("printed-plate").getAttribute("src");
  expect(plate?.startsWith("data:image")).toBe(true);

  // Door one: the plate itself, as a download, under a real filename — clean, with no text on it.
  const raw = page.getByTestId("download-raw");
  await expect(raw).toBeVisible();
  expect(await raw.getAttribute("download")).toMatch(/\.png$/);
  expect(await raw.getAttribute("href")).toMatch(/^data:image/);

  // The cut reports itself — and it has to be the model that did the work. A run where the classic
  // fallback answered for a clean single-subject portrait is a run where the segmenter never loaded,
  // which is precisely the regression that let a recolour pass for a cut-out.
  await expect(page.getByTestId("cut-line")).toContainText(/segmenter found you/i);

  // And the third door: straight into the city, with no editor in the way at all.
  await expect(page.getByTestId("take-to-city")).toBeVisible();

  // Door two: into the editor, where the plate is editable and downloadable again.
  await page.getByTestId("edit-in-editor").click();
  await expect(page.locator(".editor-shell")).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId("download-frame")).toBeVisible();

  expect(problems, `console errors: ${problems.join(" | ")}`).toEqual([]);
});