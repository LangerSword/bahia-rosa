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
    if (message.type() !== "error") return;
    // The desk probe is designed to fail on a host without a desk; the URL lives in the location,
    // not in the text, so the filter has to read it there.
    const url = message.location()?.url ?? "";
    if (url.includes("/print-desk/system_stats")) return;
    problems.push(`${message.text()} (${url})`);
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
  await expect(page.getByTestId("desk-absent")).toBeVisible();
  await expect(page.getByTestId("desk-absent")).toContainText("nothing to install");

  // The place has to be on the deployed page too — and it is a 3D scene now, so this accepts either
  // shape: a WebGL canvas when the browser has one, the plain plate when it does not.
  const hero = await page.evaluate(() => {
    const host = document.querySelector('[data-testid="hero-3d"]');
    const canvas = document.querySelector('[data-testid="hero"] canvas') as HTMLCanvasElement | null;
    const img = document.querySelector('[data-testid="hero"] img') as HTMLImageElement | null;
    const box = (canvas ?? img)?.getBoundingClientRect();
    return {
      host: Boolean(host),
      canvas: Boolean(canvas),
      img: Boolean(img),
      painted: canvas ? canvas.width > 0 && canvas.height > 0 : Boolean(img && img.naturalWidth > 0),
      sized: Boolean(box && box.width > 200 && box.height > 100),
    };
  });
  expect(hero.canvas || hero.img, "the hero shows nothing at all").toBe(true);
  expect(hero.painted, "the hero layer is empty").toBe(true);
  expect(hero.sized, "the hero layer has no size").toBe(true);

  expect(problems, `console errors: ${problems.join(" | ")}`).toEqual([]);
});
