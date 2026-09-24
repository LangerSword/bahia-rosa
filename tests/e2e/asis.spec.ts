import { expect, test } from "@playwright/test";

/**
 * "As it is" — the ground is the visitor's own photograph.
 *
 * The claim being tested is not "it ran": it is that the background carries the *photograph's own layout and
 * light* rather than the city's. Two earlier versions of this test measured colour, and colour cannot answer
 * it: at 1×1 the comparison was really measuring how desaturated the ground was (and passed for months
 * because it was over-desaturated), and at 4×4 it measured how city-toned the frame was — a recoloured picture
 * is further from the original in colour than from another recoloured picture, so the beach plate "won".
 *
 * What survives the grade is *shape*: sixteen cells with each image's own mean removed. The printed frame has
 * to line up with the photograph — person where the person was, wall where the wall was — and to miss the
 * beach plate, whose grid is sky, sea and sand. No amount of grading turns one layout into the other.
 */

test("the as-it-is ground is the photograph's own frame, repainted", async ({ page }) => {
  test.setTimeout(240_000);

  await page.goto("/");
  await expect(page.getByTestId("choose-photo")).toBeVisible();

  // Choose the ground before the photograph: the picker is where a visitor chooses it.
  await page.getByTestId("scene-asis").click();
  await page.getByTestId("photo-input").setInputFiles("public/art/demo/s1-marisol-keyart.jpg");
  await expect(page.getByTestId("printed-fork")).toBeVisible({ timeout: 150_000 });

  /** A 4×4 grid of cell averages: sixteen numbers that describe where things are, not just what colour it
   *  averages out to. */
  const gridOf = async (source: string) =>
    page.evaluate(async (src) => {
      const image = new Image();
      image.crossOrigin = "anonymous";
      image.src = src;
      await image.decode();
      const canvas = document.createElement("canvas");
      canvas.width = 8;
      canvas.height = 8;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("no 2d context");
      ctx.drawImage(image, 0, 0, 8, 8);
      const data = ctx.getImageData(0, 0, 8, 8).data;
      const cells: number[][] = [];
      for (let i = 0; i < 64; i += 1) cells.push([data[i * 4], data[i * 4 + 1], data[i * 4 + 2]]);
      return cells;
    }, source);

  const plate = await page.getByTestId("printed-plate").getAttribute("src");
  expect(plate?.startsWith("data:image")).toBe(true);
  const printed = await gridOf(plate ?? "");
  const photograph = await gridOf("/art/demo/s1-marisol-keyart.jpg");
  const beach = await gridOf("/art/scenes/beach.jpg");

  /**
   * Grade-invariant shape: each image's sixteen cells with *its own* mean removed.
   *
   * Colour distance cannot answer this question, and twice now it has answered something else: at 1×1 it
   * measured how desaturated the ground was, and at 4×4 it measures how city-toned the frame is — because the
   * plate is the photograph *recoloured*, not the photograph, and a recoloured picture is still further from
   * the original in colour than from another recoloured picture. Subtracting each image's own mean asks the
   * question that survives the grade: does the *layout* line up — person where the person was, wall where the
   * wall was — because a beach plate's layout is sky, sea and sand, and no amount of grading turns one into
   * the other.
   */
  const luma = (cells: number[][]) => cells.map(([r, g, b]) => 0.2126 * r + 0.7152 * g + 0.0722 * b);

  /** Pearson correlation of two layouts: 1 is the same picture, 0 is unrelated, and a grade cannot change it. */
  const correlation = (a: number[][], b: number[][]) => {
    const ca = luma(a);
    const cb = luma(b);
    const n = Math.min(ca.length, cb.length);
    const meanA = ca.slice(0, n).reduce((sum, value) => sum + value, 0) / n;
    const meanB = cb.slice(0, n).reduce((sum, value) => sum + value, 0) / n;
    let cov = 0;
    let varA = 0;
    let varB = 0;
    for (let i = 0; i < n; i += 1) {
      const da = ca[i] - meanA;
      const db = cb[i] - meanB;
      cov += da * db;
      varA += da * da;
      varB += db * db;
    }
    return cov / Math.max(1e-6, Math.sqrt(varA * varB));
  };

  const sameAsPhotograph = correlation(printed, photograph);
  const sameAsBeach = correlation(printed, beach);
  console.log(
    `as-it-is ground: layout correlation with the photograph ${sameAsPhotograph.toFixed(2)}, with the beach plate ${sameAsBeach.toFixed(2)}`,
  );

  // A margin, not a hair: a near-tie is a metric that cannot tell the two apart, and it should fail loudly
  // rather than pass by luck.
  expect(sameAsPhotograph).toBeGreaterThan(sameAsBeach + 0.15);
  expect(sameAsPhotograph).toBeGreaterThan(0.25);

  // "As it is" is their own room: they stand where they stood. So there is no arrangement to make — not on
  // the plate's own door and not in the editing phase — because offering to drag somebody around their own
  // photograph only adds ways for the frame to look wrong.
  await page.getByTestId("take-to-city").click();
  await expect(page.getByTestId("launch")).toBeVisible();
  await expect(page.getByTestId("layer-surface")).toHaveCount(0);
  await expect(page.getByTestId("layer-scale")).toHaveCount(0);
  await expect(page.getByTestId("arrangement-note")).toContainText("your own room");
});