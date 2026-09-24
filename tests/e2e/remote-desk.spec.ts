import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";

/**
 * The desk somewhere else.
 *
 * The deployed app cannot print on its own host, so the print has to work across origins: the page
 * points at a desk elsewhere (`?desk=…`), the front door (tools/desk/front.mjs) answers with CORS,
 * and the same print lands in the same editor. This runs against the front door on this machine —
 * the identical path a tunnel or a rented GPU would take.
 */

const DESK = process.env.DESK_URL ?? "http://127.0.0.1:8790";

const reachable = await (async () => {
  try {
    const response = await fetch(`${DESK}/health`, { signal: AbortSignal.timeout(3000) });
    return response.ok;
  } catch {
    return false;
  }
})();

test.skip(!reachable, `no desk front at ${DESK} — start it with tools/desk/desk.sh start`);

test("a desk at another origin prints through the front door", async ({ page }) => {
  test.setTimeout(300_000);
  const problems: string[] = [];
  page.on("pageerror", (error) => problems.push(String(error)));

  await page.goto(`/?desk=${encodeURIComponent(DESK)}`);

  // The intake must name where the photo is going — it is not this machine any more.
  await expect(page.getByTestId("photo-input")).toBeAttached();
  await expect(page.getByText(new RegExp(`answering at ${new URL(DESK).host}`))).toBeVisible();

  await page.getByTestId("choose-style").selectOption("loadingscreen");
  const photo = resolve(process.cwd(), "public/art/demo/s1-marisol-keyart.jpg");
  expect(existsSync(photo)).toBe(true);
  await page.getByTestId("photo-input").setInputFiles(photo);

  await expect(page.getByTestId("print-desk")).toBeVisible();
  // The whole print crosses origins: upload, prompt, progress socket, then the face restore — and it
  // lands at the fork, where the plate is offered raw or into the editor.
  await expect(page.getByTestId("printed-fork")).toBeVisible({ timeout: 280_000 });
  await page.getByTestId("edit-in-editor").click();
  await expect(page.locator(".editor-shell")).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId("start-over")).toBeVisible();

  // The address is remembered: a reload without the query still talks to that desk.
  await page.goto("/");
  await expect(page.getByText(new RegExp(`answering at ${new URL(DESK).host}`))).toBeVisible();

  expect(problems, `page errors: ${problems.join(" | ")}`).toEqual([]);
});
