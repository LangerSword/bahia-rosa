import { expect, test } from "@playwright/test";

/**
 * The shell, checked the way a reviewer would: does it render the new design language, does it keep
 * its promises (no runtime fetches, no console errors), and does the motion stay out of the way when
 * the user asks for reduced motion.
 */

test("the shell renders the city's design language and stays clean", async ({ page }) => {
  const errors: string[] = [];
  const external: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("request", (request) => {
    const url = request.url();
    if (!url.startsWith("http://localhost:5178") && !url.startsWith("data:") && !url.startsWith("blob:")) external.push(url);
  });

  await page.goto("/");

  // One voice. The decorative faces were retired with the template language they belonged to: the
  // wordmark is the same monospaced family as the running text, and hierarchy is size and space.
  await expect(page.locator(".wordmark").first()).toHaveText(/late edition/i);
  await expect(page.locator("h1.display")).toBeVisible();
  const type = await page.evaluate(() => {
    const style = getComputedStyle(document.body);
    const heading = document.querySelector("h1.display");
    return {
      family: style.fontFamily,
      weight: heading ? getComputedStyle(heading).fontWeight : "",
    };
  });
  expect(type.family, `body is not monospaced: ${type.family}`).toMatch(/mono/i);

  await expect(page.locator(".fx-marquee")).toContainText("Marina pier");

  // The app talks to nothing but its own origin (the desk is proxied through it).
  expect(external).toEqual([]);
  expect(errors).toEqual([]);
});

test("the intake explains what the press does, with nothing to install", async ({ page }) => {
  // The press runs in the page now, so a visitor with no GPU must read what happens — and must not be
  // told to install or run anything.
  await page.route("**/print-desk/system_stats", (route) => route.fulfill({ status: 404, body: "" }));
  await page.goto("/");

  const notice = page.getByTestId("desk-absent");
  await expect(notice).toBeVisible();
  await expect(notice).toContainText("stays in this page");
  await expect(notice).toContainText("nothing to install");
  await expect(notice).not.toContainText("npm");
  // The dropzone stays: the app does print, it just does it here.
  await expect(page.getByTestId("photo-input")).toBeAttached();
});

test("reduced motion turns the reveals off", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await expect(page.locator("h1.display")).toBeVisible();
  // With reduced motion the hero has no transform applied by the reveal.
  const transform = await page.getByTestId("hero").evaluate((node) => getComputedStyle(node).transform);
  expect(["none", "matrix(1, 0, 0, 1, 0, 0)"]).toContain(transform);
  // The hero is a 3D scene now. Either it renders (a WebGL canvas) or the component falls back to the
  // plate itself — both are the place, neither is a flat field, and decoration stays out of the
  // accessibility tree either way.
  await expect(page.locator('[data-testid="hero"] [aria-hidden="true"]').first()).toBeAttached();
  await expect(page.getByTestId("scene-beach")).toBeVisible();
});
