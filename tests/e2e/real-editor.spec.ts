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
