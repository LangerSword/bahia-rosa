import { expect, test } from "@playwright/test";

/**
 * "As it is" — the ground is the visitor's own photograph.
 *
 * The claim being tested is not "it ran": it is that the background carries the *photograph's own light*
 * rather than the city's. So the printed frame's average colour is compared against the photograph's and
 * against the beach plate's — closer to the first than to the second, or the ground is not what it says.
 *
 * The average is read through a 1×1 canvas: the cheapest honest way to ask "what colour is this picture".
 */

test("the as-it-is ground is the photograph's own light, repainted", async ({ page }) => {
  test.setTimeout(240_000);

  await page.goto("/");
  await expect(page.getByTestId("choose-photo")).toBeVisible();

  // Choose the ground before the photograph: the picker is where a visitor chooses it.
  await page.getByTestId("scene-asis").click();
  await page.getByTestId("photo-input").setInputFiles("public/art/demo/s1-marisol-keyart.jpg");
  await expect(page.getByTestId("printed-fork")).toBeVisible({ timeout: 150_000 });

  const averageOf = async (source: string) =>
    page.evaluate(async (src) => {
      const image = new Image();
      image.crossOrigin = "anonymous";
      image.src = src;
      await image.decode();
      const canvas = document.createElement("canvas");
      canvas.width = 1;
      canvas.height = 1;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("no 2d context");
      ctx.drawImage(image, 0, 0, 1, 1);
      const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
      return [r, g, b];
    }, source);

  const plate = await page.getByTestId("printed-plate").getAttribute("src");
  expect(plate?.startsWith("data:image")).toBe(true);
  const printed = await averageOf(plate ?? "");
  const photograph = await averageOf("/art/demo/s1-marisol-keyart.jpg");
  const beach = await averageOf("/art/scenes/beach.jpg");

  const distance = (a: number[], b: number[]) =>
    Math.sqrt((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2);

  const toPhotograph = distance(printed, photograph);
  const toBeach = distance(printed, beach);
  console.log(
    `as-it-is ground: average colour distance to the photograph ${toPhotograph.toFixed(1)}, to the beach plate ${toBeach.toFixed(1)}`,
  );

  expect(toPhotograph).toBeLessThan(toBeach);
  // And it is still a print of the city, not a copy: the paint and the grade move it.
  expect(toPhotograph).toBeGreaterThan(2);

  // "As it is" is their own room: they stand where they stood. So there is no drag surface and no layer
  // panel here — offering to arrange somebody inside their own photograph only adds ways for it to look
  // wrong, and the arrangement belongs to the city's own plates.
  await page.getByTestId("take-to-city").click();
  await expect(page.getByTestId("launch")).toBeVisible();
  await expect(page.getByTestId("layer-surface")).toHaveCount(0);
  await expect(page.getByTestId("layer-scale")).toHaveCount(0);
});
