import { expect, test, type Page } from "@playwright/test";

/**
 * Proves the real Unlayer editor mounts in this app and that per-surface tool gating
 * (`features.imageEditor.tools`) actually removes tools from the rail.
 *
 * Network required: the wrapper injects the editor script from cdn.unlayer.com.
 * This is the only suite that may not run offline; everything else uses the mock editor.
 */

const TOOL_WORDS = ["crop", "resize", "filter", "draw", "text", "shapes", "stickers", "frame"];
const TOOL_RE = new RegExp(`^(${TOOL_WORDS.join("|")})$`, "i");

async function visibleToolNames(page: Page): Promise<string[]> {
  const names = new Set<string>();
  for (const frame of page.frames()) {
    try {
      const labels = await frame.$$eval('[aria-label], [title], button, [role="tab"]', (els) =>
        els
          .map((el) => el.getAttribute("aria-label") ?? el.getAttribute("title") ?? el.textContent ?? "")
          .map((t) => t.trim())
          .filter(Boolean),
      );
      for (const label of labels) {
        if (TOOL_RE.test(label)) names.add(label.toLowerCase());
      }
    } catch {
      // detached frame mid-evaluation — ignore, the assertion below still has to hold
    }
  }
  return [...names].sort();
}

test("editor mounts with loading-screen gating", async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });

  await page.goto("/?demo=editor");

  // The stand-in artwork has to actually load: a broken path would ship an empty editor.
  // Fetched from the runner, not from the page — the editor mounts and re-navigates the frame, so an
  // in-page evaluate here races it.
  const plate = await page.request.get("/art/city/downtown.jpg");
  expect(plate.status()).toBe(200);
  expect(plate.headers()["content-type"]).toContain("image/jpeg");
  expect((await plate.body()).byteLength).toBeGreaterThan(100_000);

  // Straight into the editor: this suite never touches the network for a plate.
  await expect(page.getByTestId("editor-surface-loading")).toBeAttached();

  // The editor script + canvas need to come up from the CDN before tools exist.
  await expect
    .poll(async () => (await visibleToolNames(page)).length, { timeout: 60_000, intervals: [1000] })
    .toBeGreaterThan(0);

  const tools = await visibleToolNames(page);
  console.log("tools visible:", tools.join(", "));

  // Gating contract for surface 1 — see docs/editor-contract.md
  expect(tools).toContain("crop");
  expect(tools).not.toContain("stickers");
  expect(tools).not.toContain("filter");

  await page.screenshot({ path: "docs/boot-build.png" });
  expect(consoleErrors.filter((e) => !/favicon/i.test(e))).toEqual([]);
});

/**
 * The editor's chrome, in the city's colours.
 *
 * Unlayer's editor is themed by re-declaring shadcn's variables on its own root (`div.image-editor-root`),
 * in **hsl triplets** — measured from its DOM, because the first attempt (hex, declared one level further up
 * the tree) silently lost: a custom property declared on an element beats anything inherited into it.
 * This pins the result down, so a future version bump that renames its root is caught here rather than
 * discovered by eye.
 */
test("the editor wears the city's colours", async ({ page }) => {
  test.setTimeout(240_000);

  await page.goto("/");
  await page.getByTestId("photo-input").setInputFiles("public/art/demo/s1-marisol-keyart.jpg");
  await expect(page.getByTestId("printed-fork")).toBeVisible({ timeout: 180_000 });
  await page.getByTestId("edit-in-editor").click();
  await page.getByTestId("arrange").waitFor({ state: "visible", timeout: 60_000 });
  // Wait for the editor's *own* root rather than a node count: the count was a guess, and a wrong one — the
  // threshold sat exactly where the real editor landed, so the test timed out on a good editor.
  await page.waitForSelector(".image-editor-root", { timeout: 90_000 });

  const resolved = await page.evaluate(() => {
    const root = document.querySelector(".image-editor-root");
    if (!root) return null;
    const cs = getComputedStyle(root);
    return {
      background: cs.getPropertyValue("--background").trim(),
      primary: cs.getPropertyValue("--primary").trim(),
      radius: cs.getPropertyValue("--radius").trim(),
    };
  });

  expect(resolved, "the editor's root was not found — its internals changed").not.toBeNull();
  // The site's own ink (#07070a) and its single gold accent (#fcaf17), as hsl triplets.
  expect(resolved?.background).toBe("240 18% 3%");
  expect(resolved?.primary).toBe("40 97% 54%");
  expect(resolved?.radius).toBe("2px");
});
