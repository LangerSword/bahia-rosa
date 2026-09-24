import { expect, test } from "@playwright/test";
import { readFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";

/**
 * The payoff, verified: the launch stage draws all four surfaces, survives three viewports without
 * spilling sideways, and the download is a real PNG of the spec's own size.
 *
 * Driven through the `?demo=launch` deep link so it needs no GPU — the same components and the same
 * exporter the live path uses, which is what makes it worth asserting against.
 */

const WIDTHS = [1440, 768, 375] as const;
const SHOTS = resolve(process.cwd(), "docs/shots");

/** PNG header: the IHDR chunk carries width/height at bytes 16..24. */
function pngSize(bytes: Buffer): { width: number; height: number } {
  expect(bytes.subarray(1, 4).toString("ascii")).toBe("PNG");
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

test("the launch stage draws every surface and exports the postcard at spec size", async ({ page }) => {
  test.setTimeout(120_000);
  const problems: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") problems.push(message.text());
  });
  page.on("pageerror", (error) => problems.push(String(error)));

  await page.goto("/?demo=launch");
  const launch = page.getByTestId("launch");
  await expect(launch).toBeVisible();
  await expect(launch).toContainText("the city runs it");

  // All four surfaces are offered, and the one on screen is drawn — a blank canvas would still be a
  // canvas, so count the colours the exporter actually put down.
  for (const id of ["billboard", "venue", "feed", "postcard"]) {
    await expect(page.getByTestId(`place-${id}`)).toBeVisible();
  }
  const painted = await page.evaluate(() => {
    const canvas = document.querySelector('[data-testid="launch"] canvas') as HTMLCanvasElement;
    const ctx = canvas.getContext("2d")!;
    const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const seen = new Set<number>();
    for (let i = 0; i < data.length; i += 4 * 97) seen.add((data[i] << 16) | (data[i + 1] << 8) | data[i + 2]);
    return { colours: seen.size, width: canvas.width, height: canvas.height };
  });
  expect(painted.width).toBeGreaterThan(300);
  expect(painted.colours, "the placement canvas is blank").toBeGreaterThan(40);

  // Switching surfaces redraws: the venue is portrait, the billboard is not.
  await page.getByTestId("place-venue").click();
  const venueBox = await page.locator('[data-testid="launch"] .plate-inset canvas').boundingBox();
  await page.getByTestId("place-billboard").click();
  const billboardBox = await page.locator('[data-testid="launch"] .plate-inset canvas').boundingBox();
  expect(venueBox!.height).toBeGreaterThan(billboardBox!.height);

  mkdirSync(SHOTS, { recursive: true });
  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: 1000 });
    await page.waitForTimeout(350);
    const overflow = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));
    expect(overflow.scrollWidth, `horizontal overflow at ${width}px`).toBeLessThanOrEqual(overflow.clientWidth + 1);
    await page.screenshot({ path: resolve(SHOTS, `launch-${width}.png`), fullPage: true });
  }

  // The download: a real PNG, at the postcard's own spec size (1500x1000 in placements.ts).
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByTestId("place-postcard").click();
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByTestId("download-postcard").click()]);
  const path = resolve(SHOTS, "postcard-export.png");
  await download.saveAs(path);
  const size = pngSize(readFileSync(path));
  expect(size, "the exported postcard is not 1500x1000").toEqual({ width: 1500, height: 1000 });
  expect(download.suggestedFilename()).toContain("postcard");

  // The copy on it is the user's copy, not a default: retype the handle and the file still exports.
  await page.getByTestId("copy-handle").fill("@late-edition");
  const [second] = await Promise.all([page.waitForEvent("download"), page.getByTestId("download-postcard").click()]);
  await second.saveAs(resolve(SHOTS, "postcard-export-2.png"));
  expect(pngSize(readFileSync(resolve(SHOTS, "postcard-export-2.png")))).toEqual({ width: 1500, height: 1000 });

  expect(problems, `console errors: ${problems.join(" | ")}`).toEqual([]);
});
