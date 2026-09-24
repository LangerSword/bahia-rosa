import { expect, test, type Page } from "@playwright/test";

/**
 * Every way a photograph gets in.
 *
 * The picker was the only door, which asks a visitor to find a file dialog before they can make anything.
 * The other two doors are the ones people actually use: dragging a file out of a file manager and letting
 * go over the page, and pasting a screenshot straight off the clipboard. Both are tested against the real
 * press, because "the file arrived" and "the file was pressed" are different claims.
 */

/** Build a file in the page from a fixture this site already serves, and dispatch a drop with it. */
const dropFile = (page: Page, name: string, type: string) =>
  page.evaluate(
    async ({ name, type }) => {
      const blob = await (await fetch("/art/demo/s1-marisol-keyart.jpg")).blob();
      const data = new DataTransfer();
      data.items.add(new File([blob], name, { type }));
      window.dispatchEvent(new DragEvent("drop", { dataTransfer: data, bubbles: true, cancelable: true }));
    },
    { name, type },
  );

/** The same file, arriving as a paste from the clipboard. */
const pasteFile = (page: Page, name: string, type: string) =>
  page.evaluate(
    async ({ name, type }) => {
      const blob = await (await fetch("/art/demo/s1-marisol-keyart.jpg")).blob();
      const data = new DataTransfer();
      data.items.add(new File([blob], name, { type }));
      window.dispatchEvent(
        new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }),
      );
    },
    { name, type },
  );

test("a drag makes the whole page the target, and the overlay says so", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("choose-photo")).toBeVisible();
  await expect(page.getByTestId("photo-drop")).toHaveCount(0);

  await page.evaluate(() => {
    const data = new DataTransfer();
    data.items.add(new File([new Uint8Array([1, 2, 3])], "a.png", { type: "image/png" }));
    window.dispatchEvent(new DragEvent("dragenter", { dataTransfer: data, bubbles: true }));
  });
  await expect(page.getByTestId("photo-drop")).toBeVisible();

  await page.evaluate(() => {
    const data = new DataTransfer();
    window.dispatchEvent(new DragEvent("dragleave", { dataTransfer: data, bubbles: true }));
  });
  await expect(page.getByTestId("photo-drop")).toHaveCount(0);
});

test("a photo dropped anywhere on the page is pressed", async ({ page }) => {
  test.setTimeout(240_000);
  const problems: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") problems.push(message.text());
  });
  page.on("pageerror", (error) => problems.push(String(error)));

  await page.goto("/");
  await expect(page.getByTestId("choose-photo")).toBeVisible();

  // Dropped on the page — not on the intake's box, which is the point: nobody aims at a rectangle.
  await dropFile(page, "dropped-on-the-page.jpg", "image/jpeg");

  await expect(page.getByTestId("printed-fork")).toBeVisible({ timeout: 150_000 });
  const plate = await page.getByTestId("printed-plate").getAttribute("src");
  expect(plate?.startsWith("data:image")).toBe(true);
  expect(problems).toEqual([]);
});

test("a screenshot pasted from the clipboard is pressed", async ({ page }) => {
  test.setTimeout(240_000);
  await page.goto("/");
  await expect(page.getByTestId("choose-photo")).toBeVisible();

  await pasteFile(page, "pasted.png", "image/png");

  await expect(page.getByTestId("printed-fork")).toBeVisible({ timeout: 150_000 });
  expect(await page.getByTestId("cut-line").textContent()).toMatch(/found you in the frame/);
});

test("a photo dropped on the city is pressed — a drop works wherever the visitor is", async ({ page }) => {
  test.setTimeout(300_000);
  await page.goto("/");
  await expect(page.getByTestId("choose-photo")).toBeVisible();
  await page.getByTestId("photo-input").setInputFiles("public/art/demo/s1-marisol-keyart.jpg");
  await expect(page.getByTestId("printed-fork")).toBeVisible({ timeout: 150_000 });

  // Into the city, which is where someone with an arrangement in front of them tries to drop the next
  // photograph — and where the drop used to do nothing at all, because it was only enabled on two stages.
  await page.getByTestId("take-to-city").click();
  await expect(page.getByTestId("launch")).toBeVisible();

  await dropFile(page, "another-one.jpg", "image/jpeg");
  // A new press, and the fork again: dropping is a way to start over with a different photograph.
  await expect(page.getByTestId("printed-fork")).toBeVisible({ timeout: 150_000 });
});

test("a paste that carried only words is answered, not ignored", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("choose-photo")).toBeVisible();

  await page.evaluate(() => {
    const data = new DataTransfer();
    data.setData("text/plain", "just some words");
    window.dispatchEvent(
      new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }),
    );
  });

  await expect(page.getByTestId("intake-problem")).toContainText("that was text, not a photo");
  // And it did not start a press on the strength of a paragraph.
  await expect(page.getByTestId("printed-fork")).toHaveCount(0);
});
