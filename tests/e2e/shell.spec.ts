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

  // Wordmark, kicker and display type all come from the self-hosted faces.
  await expect(page.locator(".wordmark").first()).toHaveText(/late edition/i);
  await expect(page.locator("h1.display")).toBeVisible();
  await expect(page.locator(".ticker")).toContainText("Marina pier");

  // The self-hosted fonts must actually load (a 404 here would silently fall back to system type).
  const fonts = await page.evaluate(() => document.fonts.check('16px "Limelight"') && document.fonts.check('16px "Pinyon Script"'));
  expect(fonts).toBe(true);

  // The app talks to nothing but its own origin (the desk is proxied through it).
  expect(external).toEqual([]);
  expect(errors).toEqual([]);
});

test("the intake says when no desk is on this host, and offers the way in", async ({ page }) => {
  // The deployed build has no GPU and no desk. A visitor must learn that from the intake rather than
  // from a failure after choosing a photo — and be handed the local route and the two demos.
  await page.route("**/print-desk/system_stats", (route) => route.fulfill({ status: 404, body: "" }));
  await page.goto("/");

  const notice = page.getByTestId("desk-absent");
  await expect(notice).toBeVisible();
  await expect(notice).toContainText("npm run desk");
  await expect(page.getByTestId("demo-launch-from-gate")).toHaveAttribute("href", "?demo=launch");
  // The dropzone stays: the app does print, just not here.
  await expect(page.getByTestId("photo-input")).toBeAttached();
});

test("reduced motion turns the reveals off", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await expect(page.locator("h1.display")).toBeVisible();
  // With reduced motion the hero has no transform applied by the reveal.
  const transform = await page.getByTestId("hero").evaluate((node) => getComputedStyle(node).transform);
  expect(["none", "matrix(1, 0, 0, 1, 0, 0)"]).toContain(transform);
  // The city layer is decoration: it must be hidden from the accessibility tree.
  await expect(page.locator(".city-art")).toHaveAttribute("aria-hidden", "true");
});
