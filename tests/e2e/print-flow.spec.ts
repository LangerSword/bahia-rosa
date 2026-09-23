import { expect, test } from "@playwright/test";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

/**
 * The live path, end to end: pick a style and a location in the intake, hand over a photo, watch the
 * desk print it, and land in the editor with the printed plate.
 *
 * Skipped where no desk is running (CI has no GPU): this test is about the wiring between the UI, the
 * client and a real ComfyUI, so a fake would prove nothing.
 */

const deskUp = await (async () => {
  try {
    const response = await fetch("http://127.0.0.1:8188/system_stats", { signal: AbortSignal.timeout(2000) });
    return response.ok;
  } catch {
    return false;
  }
})();

test.skip(!deskUp, "no print desk on this machine");

test("intake choices reach the desk and the plate lands in the editor", async ({ page }) => {
  test.setTimeout(240_000);

  // The desk is opt-in now (the browser press is the default), so this suite asks for it explicitly:
  // ?desk= this origin routes the same requests through the dev proxy to ComfyUI.
  await page.goto("/?desk=http://localhost:5178");
  await page.getByTestId("choose-style").selectOption("loadingscreen");
  await page.getByTestId("choose-location").selectOption("marina");

  const photo = resolve(process.cwd(), "public/art/demo/s1-marisol-keyart.jpg");
  expect(existsSync(photo)).toBe(true);
  await page.getByTestId("photo-input").setInputFiles(photo);

  // The printing screen must say what it is printing — that text comes from the choice, not a default.
  const desk = page.getByTestId("print-desk");
  await expect(desk).toBeVisible();
  await expect(desk).toContainText("loadingscreen");
  await expect(desk).toContainText("marina");

  // And the plate must actually come back: the editor mounts only after the desk answers.
  await expect(page.locator(".editor-shell")).toBeVisible({ timeout: 200_000 });
  await expect(page.getByTestId("start-over")).toBeVisible();
});
