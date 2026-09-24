import { expect, test } from "@playwright/test";

/**
 * The subject as a layer — driven the way a visitor drives it, in the phase where the picture is made.
 *
 * The arrangement used to live beside the four downloads, which asked the same question twice: an
 * arrangement judged inside a billboard's 8:3 mount and again inside a venue card's 3:4 looks different in
 * each, and "it was right in one of them" is not an arrangement. It sits with the editor now — above the
 * editor — and the city receives a decision already made.
 *
 * A drag is a real pointer drag on the frame; size, cut and overflow go through the controls; after each one
 * the *stored* arrangement is read back, because "the interface moved" and "the arrangement was kept" are
 * different claims. The pixels are checked too: the preview is the exporter, so a change in the preview is a
 * change in the file.
 */

test("the subject is a layer: drag it, size it, cut it, let it run off the edge", async ({ page }) => {
  test.setTimeout(240_000);

  await page.goto("/");
  await page.getByTestId("photo-input").setInputFiles("public/art/demo/s1-marisol-keyart.jpg");
  await expect(page.getByTestId("printed-fork")).toBeVisible({ timeout: 150_000 });

  // The editing phase — where the arrangement belongs, and where it is the first thing on screen.
  await page.getByTestId("edit-in-editor").click();
  const arrange = page.getByTestId("arrange");
  await expect(arrange).toBeVisible();
  // Embedded, not parked above the editor: one shell holds the frame and the editor, so it reads as one
  // surface rather than as a section followed by a widget.
  await expect(page.getByTestId("editor-shell").locator('[data-testid="arrange"]')).toHaveCount(1);

  const surface = page.getByTestId("layer-surface");
  await expect(surface).toBeVisible();

  const stored = () =>
    page.evaluate(() =>
      JSON.parse(window.localStorage.getItem("bahia-rosa.payoff.v1") ?? "{}"),
    ) as Promise<{ layer?: { dx: number; dy: number; scale: number; cropTop: number; cropBottom: number; cropLeft: number; cropRight: number; overflow: boolean } }>;

  const previewPixels = async () =>
    surface.locator("canvas").evaluate((node) => (node as HTMLCanvasElement).toDataURL().length);

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

  const dragged = (await stored()).layer;
  expect(dragged, "the drag was not remembered").toBeTruthy();
  expect(dragged?.dx).toBeGreaterThan(0.1);
  expect(dragged?.dy).toBeLessThan(-0.05);

  // The pixels changed, so the drag reached the drawing and not just the state.
  expect(await previewPixels()).not.toBe(before);

  // 2. Size.
  await page.getByTestId("layer-scale").fill("1.6");
  expect((await stored()).layer?.scale).toBeCloseTo(1.6, 2);

  // 3. Crop — "I don't want the full body". The crop button opens the mode, and the cut lines sit on the
  //    person where the cut will land.
  await page.getByTestId("arrange-crop").click();
  await expect(page.getByTestId("arrange-crop")).toHaveAttribute("aria-checked", "true");
  await expect(page.getByTestId("crop-handle-top")).toBeVisible();
  await expect(page.getByTestId("crop-handle-bottom")).toBeVisible();

  // Directly, with the pointer: drag the top cut line down the person, then read the arrangement back.
  //   `hover` rather than a bounding box read: a box captured while the phase is still laying out is a box
  //   from the past, and the drag then lands next to the line instead of on it — which is exactly how this
  //   test failed the first time, with the arrangement unchanged and a screenshot of a click in empty space.
  const cutLine = page.getByTestId("crop-handle-top");
  await cutLine.hover();
  const line = await cutLine.boundingBox();
  if (!line) throw new Error("the crop has no line to drag");
  await page.mouse.down();
  await page.mouse.move(line.x + line.width / 2, line.y + line.height / 2 + 60, { steps: 6 });
  await page.mouse.up();
  expect((await stored()).layer?.cropTop).toBeGreaterThan(0.05);
  await expect(page.getByTestId("crop-shade-top")).toBeVisible();

  // Dragging the line must not have moved the person: crop mode is a crop, not a second drag surface.
  expect((await stored()).layer?.dx).toBeCloseTo(dragged?.dx ?? 0, 5);

  // And the slider is the same number, for anyone who would rather type.
  await page.getByTestId("layer-crop-bottom").fill("0.3");
  expect((await stored()).layer?.cropBottom).toBeCloseTo(0.3, 2);

  // The sides too: the left line drags across the way the top one drags down.
  const leftLine = page.getByTestId("crop-handle-left");
  await leftLine.hover();
  const across = await leftLine.boundingBox();
  if (!across) throw new Error("the crop has no left line to drag");
  await page.mouse.down();
  await page.mouse.move(across.x + across.width / 2 + 50, across.y + across.height / 2, { steps: 6 });
  await page.mouse.up();
  expect((await stored()).layer?.cropLeft).toBeGreaterThan(0.02);
  await expect(page.getByTestId("crop-shade-left")).toBeVisible();

  // Done cropping puts the controls away again — they are a mode, not permanent furniture.
  await page.getByTestId("arrange-crop").click();
  await expect(page.getByTestId("layer-crop-bottom")).toHaveCount(0);
  await expect(page.getByTestId("crop-handle-top")).toHaveCount(0);

  // 4. Overflow — let it run off the edge.
  await page.getByTestId("layer-overflow").click();
  await expect(page.getByTestId("layer-overflow")).toHaveAttribute("aria-checked", "true");
  expect((await stored()).layer?.overflow).toBe(true);

  // 5. Reset returns the layer to the arrangement the press made, not to some other default.
  await page.getByTestId("layer-reset").click();
  const reset = (await stored()).layer;
  expect(reset?.dx).toBe(0);
  expect(reset?.scale).toBe(1);
  expect(reset?.cropBottom).toBe(0);
  expect(reset?.cropTop).toBe(0);
  expect(reset?.cropLeft).toBe(0);
  expect(reset?.cropRight).toBe(0);
  expect(reset?.overflow).toBe(false);

  // 6. The outline: their actual box in the frame, drawn from the same geometry the exporter uses — and
  //    its corners size them.
  const outline = page.getByTestId("layer-outline");
  await expect(outline).toBeVisible();
  const wasBox = await outline.boundingBox();
  const corner = await page.getByTestId("layer-handle-se").boundingBox();
  if (!wasBox || !corner) throw new Error("the outline has no box to drag");
  await page.mouse.move(corner.x + corner.width / 2, corner.y + corner.height / 2);
  await page.mouse.down();
  await page.mouse.move(corner.x + corner.width / 2 + 70, corner.y + corner.height / 2 + 50, { steps: 6 });
  await page.mouse.up();
  // Outward from the centre is bigger, and the arrangement says so.
  expect((await stored()).layer?.scale).toBeGreaterThan(1.05);
  const isBox = await outline.boundingBox();
  expect(isBox && wasBox && isBox.width > wasBox.width).toBe(true);
});

test("the city has no arrangement of its own — and it prints the one that was made", async ({ page }) => {
  test.setTimeout(240_000);

  await page.goto("/");
  await page.getByTestId("photo-input").setInputFiles("public/art/demo/s1-marisol-keyart.jpg");
  await expect(page.getByTestId("printed-fork")).toBeVisible({ timeout: 150_000 });

  // Arrange something, then leave for the city through the arrangement's own door.
  await page.getByTestId("edit-in-editor").click();
  await expect(page.getByTestId("arrange")).toBeVisible();
  await page.getByTestId("layer-scale").fill("1.7");
  await page.getByTestId("layer-overflow").click();
  await page.getByTestId("arrange-to-city").click();

  await expect(page.getByTestId("launch")).toBeVisible();
  // No drag surface and no layer controls on a downloading stage: the decision was made upstairs.
  await expect(page.getByTestId("layer-surface")).toHaveCount(0);
  await expect(page.getByTestId("layer-scale")).toHaveCount(0);
  await expect(page.getByTestId("layer-crop-bottom")).toHaveCount(0);
  await expect(page.getByTestId("arrangement-note")).toContainText("arranged in the editing phase");

  // And the picture on its own: no surface, no mount, no words — the frame they made, downloadable.
  const [plain] = await Promise.all([
    page.waitForEvent("download"),
    page.getByTestId("download-plain").click(),
  ]);
  expect(plain.suggestedFilename()).toMatch(/\.png$/);
});