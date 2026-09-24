import { expect, test } from "@playwright/test";

/**
 * The subject as a layer, driven the way a visitor drives it.
 *
 * A drag is a real pointer drag on the frame; size, cut and overflow go through the controls; and after
 * each one the *stored* arrangement is read back, because "the interface moved" and "the arrangement was
 * kept" are different claims. The pixels are checked too: the preview is the exporter, so a change in the
 * preview is a change in the file.
 */

test("the subject is a layer: drag it, size it, cut it, let it run off the edge", async ({ page }) => {
  test.setTimeout(240_000);

  await page.goto("/");
  await page.getByTestId("photo-input").setInputFiles("public/art/demo/s1-marisol-keyart.jpg");
  await expect(page.getByTestId("printed-fork")).toBeVisible({ timeout: 150_000 });
  await page.getByTestId("take-to-city").click();
  await expect(page.getByTestId("launch")).toBeVisible();

  const surface = page.getByTestId("layer-surface");
  await expect(surface).toBeVisible();

  const stored = () =>
    page.evaluate(() =>
      JSON.parse(window.localStorage.getItem("bahia-rosa.payoff.v1") ?? "{}"),
    ) as Promise<{ layers?: Record<string, { dx: number; dy: number; scale: number; cropBottom: number; overflow: boolean }> }>;
  const selectedId = await page.evaluate(
    () =>
      document
        .querySelector("[data-testid^='place-'][aria-pressed='true']")
        ?.getAttribute("data-testid")
        ?.replace("place-", "") ?? "",
  );
  expect(selectedId).not.toBe("");

  const previewPixels = async () =>
    page
      .getByTestId(`place-${selectedId}`)
      .locator("canvas")
      .evaluate((node) => (node as HTMLCanvasElement).toDataURL().length);

  const before = await previewPixels();

  // 1. Drag: a real pointer drag across the frame, then read the arrangement back.
  const box = await surface.boundingBox();
  if (!box) throw new Error("the surface has no box to drag on");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(
    box.x + box.width / 2 + box.width * 0.2,
    box.y + box.height / 2 - box.height * 0.1,
    { steps: 8 },
  );
  await page.mouse.up();

  const dragged = (await stored()).layers?.[selectedId];
  expect(dragged, "the drag was not remembered").toBeTruthy();
  expect(dragged?.dx).toBeGreaterThan(0.1);
  expect(dragged?.dy).toBeLessThan(-0.05);

  // The pixels changed, so the drag reached the drawing and not just the state.
  expect(await previewPixels()).not.toBe(before);

  // 2. Size.
  await page.getByTestId("layer-scale").fill("1.6");
  expect((await stored()).layers?.[selectedId]?.scale).toBeCloseTo(1.6, 2);

  // 3. Cut from the bottom — "I don't want the full body".
  await page.getByTestId("layer-crop-bottom").fill("0.3");
  expect((await stored()).layers?.[selectedId]?.cropBottom).toBeCloseTo(0.3, 2);

  // 4. Overflow — let it run off the edge.
  await page.getByTestId("layer-overflow").click();
  await expect(page.getByTestId("layer-overflow")).toHaveAttribute("aria-checked", "true");
  expect((await stored()).layers?.[selectedId]?.overflow).toBe(true);

  // 5. And the export runs with all of it, producing a real file.
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByTestId(`download-${selectedId}`).click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/\.png$/);

  // 6. Reset returns the layer to the arrangement the press made, not to some other default.
  await page.getByTestId("layer-reset").click();
  const reset = (await stored()).layers?.[selectedId];
  expect(reset?.dx).toBe(0);
  expect(reset?.scale).toBe(1);
  expect(reset?.cropBottom).toBe(0);
  expect(reset?.overflow).toBe(false);
});
