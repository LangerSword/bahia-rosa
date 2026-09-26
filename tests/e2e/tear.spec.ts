import { expect, test, type Page } from "@playwright/test";

/**
 * The tear, on a real plate: the seam between a photograph and what the press made of it.
 *
 * It has to be a tear — a path that actually leaves the straight line — and it has to move with the handle,
 * because it *is* the handle's position made visible.
 */

const tearProbe = `(() => {
  const edge = document.querySelector('[data-testid="tear-edge"]');
  const path = edge ? edge.querySelector("path") : null;
  const rect = edge ? edge.getBoundingClientRect() : null;
  const frame = document.querySelector('[data-testid="before-after"]');
  const frameRect = frame ? frame.getBoundingClientRect() : null;
  return {
    present: Boolean(edge && path && rect && frameRect),
    left: rect ? Math.round(rect.left) : null,
    corners: path ? (path.getAttribute("d") || "").split("L").length - 1 : 0,
    stroke: path ? getComputedStyle(path).stroke : null,
    share: rect && frameRect ? Math.round(((rect.left + rect.width / 2 - frameRect.left) / frameRect.width) * 100) : null,
  };
})()`;

interface TearReading {
  present: boolean;
  left: number | null;
  corners: number;
  stroke: string | null;
  share: number | null;
}

const readTear = async (page: Page): Promise<TearReading> => (await page.evaluate(tearProbe)) as TearReading;

test("the seam between the photo and the plate is a tear that follows the handle", async ({ page }) => {
  test.setTimeout(260_000);
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/");
  await page.getByTestId("photo-input").setInputFiles("public/art/demo/s1-marisol-keyart.jpg");
  await expect(page.getByTestId("printed-fork")).toBeVisible({ timeout: 200_000 });

  const opening = await readTear(page);
  expect(opening.present, "the tear is drawn over the comparison").toBe(true);
  expect(opening.corners, "a tear, not a rule: the path has many corners").toBeGreaterThan(8);

  // The seam wears the city's gold — read from the token the page actually resolves, not hard-coded, so a
  // palette change moves the test with it.
  const gold = (await page.evaluate(`(() => {
    const probe = document.createElement("span");
    probe.style.color = "var(--color-gold)";
    document.body.appendChild(probe);
    const resolved = getComputedStyle(probe).color;
    probe.remove();
    return resolved;
  })()`)) as string;
  expect(opening.stroke, `the tear is the city's gold (${gold})`).toBe(gold);

  expect(opening.share, "it opens where the handle says").toBeGreaterThan(35);
  expect(opening.share).toBeLessThan(70);

  await page.getByTestId("before-after-handle").fill("82");
  await expect.poll(async () => (await readTear(page)).share, { timeout: 5_000 }).toBeGreaterThan(75);
  expect((await readTear(page)).corners, "and it does not straighten out when it moves").toBeGreaterThan(8);

  await page.getByTestId("before-after-handle").fill("18");
  await expect.poll(async () => (await readTear(page)).share, { timeout: 5_000 }).toBeLessThan(35);
});