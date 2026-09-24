import { expect, test, type Page } from "@playwright/test";

/**
 * The site on a phone — not a narrow desktop window.
 *
 * "Optimise for mobile" is three separate claims and this spec treats them as such:
 *
 *   1. **nothing overflows sideways.** One element wider than the viewport and every page scrolls left and
 *      right under a thumb, which reads as broken rather than as tight. Asserted on each stage, because the
 *      arrangement and the crop are the ones that could do it and the launch stage is the one that would
 *      never show it.
 *   2. **the drag controls are finger-sized.** A 14px corner is a cursor target; under a coarse pointer the
 *      handles grow (see the `--hit` / `--hit-line` variables). Measured, not assumed.
 *   3. **a touch drag is a drag.** The frame carries `touch-action: none` and the handles carry it too, or the
 *      browser takes the gesture away and scrolls instead — the failure that only ever appears on a real
 *      device. So the drags here are dispatched as **real touch events**, through CDP, not as mouse events
 *      dressed up as pointers.
 */

const PHONE = { width: 390, height: 844 };

/** A press-and-drag with actual fingers: touchStart, a few touchMoves, touchEnd. */
async function touchDrag(page: Page, from: { x: number; y: number }, to: { x: number; y: number }): Promise<void> {
  const cdp = await page.context().newCDPSession(page);
  const steps = 6;
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: from.x, y: from.y }] });
  for (let step = 1; step <= steps; step += 1) {
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [
        {
          x: from.x + ((to.x - from.x) * step) / steps,
          y: from.y + ((to.y - from.y) * step) / steps,
        },
      ],
    });
  }
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await cdp.detach();
}

test.use({ viewport: PHONE, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });

const overflows = (page: Page) =>
  page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
  }));

const expectNoSidewaysScroll = async (page: Page, where: string) => {
  const { scrollWidth, innerWidth } = await overflows(page);
  // A pixel of tolerance: rounding at a device pixel ratio is not an overflow.
  expect(scrollWidth, `${where} is wider than the phone`).toBeLessThanOrEqual(innerWidth + 1);
};

test("the phone: no sideways scroll, finger-sized controls, and touch drags that drag", async ({ page }) => {
  test.setTimeout(240_000);

  await page.goto("/");
  await expectNoSidewaysScroll(page, "the launch stage");

  // The intake is a tap on a file input, and the press runs in a phone-sized viewport.
  await page.getByTestId("photo-input").setInputFiles("public/art/demo/s1-marisol-keyart.jpg");
  await expect(page.getByTestId("printed-fork")).toBeVisible({ timeout: 180_000 });
  await expectNoSidewaysScroll(page, "the fork");

  await page.getByTestId("edit-in-editor").click();
  await expect(page.getByTestId("arrange")).toBeVisible();
  await expectNoSidewaysScroll(page, "the editing phase");

  const stored = () =>
    page.evaluate(() => JSON.parse(window.localStorage.getItem("bahia-rosa.payoff.v1") ?? "{}")) as Promise<{
      layer?: { dx: number; dy: number; cropTop: number; cropLeft: number };
    }>;

  // 1. The handles are sized for a finger, not a cursor.
  const corner = await page.getByTestId("layer-handle-se").boundingBox();
  expect(corner, "no corner handle to measure").toBeTruthy();
  expect(corner && Math.min(corner.width, corner.height), "the corner handle is smaller than a fingertip").toBeGreaterThanOrEqual(24);

  // 2. A touch drag moves the person, and the drag is not stolen by the page scrolling.
  const surface = await page.getByTestId("layer-surface").boundingBox();
  if (!surface) throw new Error("no surface on a phone, which would itself be the bug");
  const scrollBefore = await page.evaluate(() => window.scrollY);
  await touchDrag(
    page,
    { x: surface.x + surface.width / 2, y: surface.y + surface.height / 2 },
    { x: surface.x + surface.width / 2 + 40, y: surface.y + surface.height / 2 - 30 },
  );
  await expect
    .poll(async () => (await stored()).layer?.dx ?? 0, { message: "the touch drag did not move the person" })
    .toBeGreaterThan(0.02);
  expect(await page.evaluate(() => window.scrollY), "the page scrolled during the drag").toBe(scrollBefore);

  // 3. And a touch drag on a cut line crops, with the line big enough to hit.
  await page.getByTestId("arrange-crop").click();
  await expect(page.getByTestId("crop-handle-top")).toBeVisible();
  // (No shade yet, by design: at zero crop there is nothing to shade.)
  // Layout settles before the line is measured — a box read while the phase is still laying out is a box
  // from the past, and on a contended CPU the store write can lag the gesture that made it.
  await page.waitForTimeout(300);
  const line = await page.getByTestId("crop-handle-top").boundingBox();
  expect(line, "no cut line to measure").toBeTruthy();
  expect(line && Math.min(line.width, line.height), "the cut line is thinner than a fingertip").toBeGreaterThanOrEqual(24);
  expectNoSidewaysScroll(page, "the crop");

  await touchDrag(
    page,
    { x: line!.x + line!.width / 2, y: line!.y + line!.height / 2 },
    { x: line!.x + line!.width / 2, y: line!.y + line!.height / 2 + 80 },
  );
  await expect
    .poll(async () => (await stored()).layer?.cropTop ?? 0, {
      message: "the touch drag on the cut line did not crop",
    })
    .toBeGreaterThan(0.02);

  await page.getByTestId("arrange-crop").click();
  await expectNoSidewaysScroll(page, "after cropping");
});