import { expect, test } from "@playwright/test";

/**
 * The deployed build, checked where it actually runs. A 200 on the root proves the host is up and
 * nothing else: this asserts the payoff stage draws, the download exports, and the page stays clean —
 * against the live URL, on the machine's own browser.
 */

const LIVE = process.env.LIVE_URL ?? "https://langersword.github.io/late-edition";

test("the deployed build serves the launch stage", async ({ page }) => {
  test.setTimeout(90_000);
  const problems: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") problems.push(message.text());
  });
  page.on("pageerror", (error) => problems.push(String(error)));

  await page.goto(`${LIVE}/?demo=launch`);
  await expect(page.getByTestId("launch")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("launch")).toContainText("Take the city");

  // The paint is async (fonts + artwork), so poll rather than assert on a canvas that may still be
  // empty: on a cold load the first frame is legitimately blank for a moment.
  const colours = () =>
    page.evaluate(() => {
      const canvas = document.querySelector('[data-testid="launch"] canvas') as HTMLCanvasElement;
      const ctx = canvas.getContext("2d")!;
      const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const seen = new Set<number>();
      for (let i = 0; i < data.length; i += 4 * 97) seen.add((data[i] << 16) | (data[i + 1] << 8) | data[i + 2]);
      return seen.size;
    });
  await expect.poll(colours, { timeout: 20_000, message: "the deployed launch canvas never painted" }).toBeGreaterThan(40);

  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByTestId("place-postcard").click().then(() => page.getByTestId("download-postcard").click()),
  ]);
  expect(download.suggestedFilename()).toContain("postcard");

  // The desk is not on this host: the intake must still render, with the file input wired up behind
  // the dropzone (it is deliberately hidden, so assert attachment, not visibility) — and the page
  // must say so, with the local route and the demos, instead of failing later.
  await page.goto(LIVE);
  await expect(page.getByTestId("photo-input")).toBeAttached();
  await expect(page.getByTestId("choose-style")).toBeVisible();
  await expect(page.getByTestId("desk-absent")).toBeVisible();
  await expect(page.getByTestId("desk-absent")).toContainText("npm run desk");

  // The city layer has to be on the deployed page too — a missing plate here is the difference
  // between a designed page and type on a flat field.
  const hero = await page.evaluate(async () => {
    const layer = document.querySelector(".city-art") as HTMLElement | null;
    if (!layer) return { present: false } as const;
    const url = getComputedStyle(layer).backgroundImage.replace(/^url\(["']?/, "").replace(/["']?\)$/, "");
    const img = new Image();
    img.src = url;
    await img.decode();
    const box = layer.getBoundingClientRect();
    return { present: true, url, size: `${img.naturalWidth}x${img.naturalHeight}`, painted: box.width > 200 && box.height > 100 } as const;
  });
  expect(hero.present, "no city layer on the deployed hero").toBe(true);
  expect(hero.url).toContain("art/city/boulevard.jpg");
  expect(hero.size).toBe("1344x768");
  expect(hero.painted).toBe(true);

  // The desk probe is designed to fail on a host without a desk, and Chromium logs the 404 as a
  // console error. Filter exactly that resource; anything else is a real problem.
  const real = problems.filter((text) => !/print-desk\/system_stats/.test(text));
  expect(real, `console errors: ${real.join(" | ")}`).toEqual([]);
});
