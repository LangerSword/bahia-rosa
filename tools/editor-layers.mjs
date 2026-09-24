#!/usr/bin/env node
/**
 * The layers button in the editor's chrome: does it exist, and what does it do?
 *
 * The visitor reported a layer button in the React Image Editor that cannot be interacted with. The
 * editor's tool *rail* has no layers tool — Unlayer's own demo lists eight (crop, resize, filter, draw,
 * text, shapes, stickers, frame) — but the editor has *chrome* as well: undo, redo, zoom, and a
 * stacked-squares control beside them. This enumerates that chrome for real, clicks anything layer-ish in
 * every frame, and reports whether a panel opened, nothing happened, or an error was raised.
 *
 * `?demo=editor` opens the editor directly, so this needs no press and no model download.
 *
 * Usage: node tools/editor-layers.mjs <url>
 */
import { chromium } from "playwright";

const url = process.argv[2] ?? "http://localhost:4180";

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 950 } });
const errors = [];
page.on("console", (message) => {
  if (message.type() === "error") errors.push(message.text());
});
page.on("pageerror", (error) => errors.push(String(error)));

await page.goto(`${url.replace(/\/$/, "")}/?demo=editor`, { waitUntil: "domcontentloaded" });

// Note on the `$$eval` calls below: they are Playwright's documented DOM-query API (a function run in the
// page against a selector), not `eval` of externally-supplied code. The function is ours and the data is
// the editor's own labels.
//
// The editor runtime comes from cdn.unlayer.com; give it the same window the suite gives it.
const deadline = Date.now() + 90_000;
let chrome = [];
while (Date.now() < deadline) {
  chrome = [];
  for (const frame of page.frames()) {
    try {
      const labels = await frame.$$eval("button, [role=button], [role=tab], [aria-label], [title]", (els) =>
        els
          .map((el) =>
            (
              el.getAttribute("aria-label") ??
              el.getAttribute("title") ??
              el.textContent ??
              ""
            )
              .trim()
              .replace(/\s+/g, " ")
              .slice(0, 44),
          )
          .filter(Boolean),
      );
      chrome.push({ frame: frame === page.mainFrame() ? "main" : frame.url().slice(0, 44), labels: [...new Set(labels)] });
    } catch {
      // A frame that navigated mid-read is fine; the next pass sees it.
    }
  }
  const total = chrome.reduce((sum, entry) => sum + entry.labels.length, 0);
  if (total > 8) break;
  await page.waitForTimeout(2000);
}

for (const entry of chrome) {
  console.log(`frame ${entry.frame}: ${entry.labels.length} controls`);
  console.log(`  ${entry.labels.join(" · ")}`);
}

// Every control whose name mentions a layer, in every frame, and what happens when it is clicked.
const layerish = /layer|stack|arrange|order|z-?index|bring|send/i;
let clicked = 0;
for (const frame of page.frames()) {
  let handles = [];
  try {
    handles = await frame.$$eval("button, [role=button], [aria-label], [title]", (els) =>
      els
        .map((el, index) => ({
          index,
          label: (el.getAttribute("aria-label") ?? el.getAttribute("title") ?? el.textContent ?? "").trim(),
        }))
        .filter((entry) => entry.label),
    );
  } catch {
    continue;
  }
  for (const handle of handles) {
    if (!layerish.test(handle.label)) continue;
    const before = await frame.evaluate(() => document.body.innerHTML.length).catch(() => 0);
    const target = frame.locator("button, [role=button], [aria-label], [title]").nth(handle.index);
    const clickedOk = await target
      .click({ timeout: 4000 })
      .then(() => true)
      .catch((error) => {
        console.log(`  "${handle.label}" would not be clicked: ${error.message.split("\n")[0]}`);
        return false;
      });
    const after = await frame.evaluate(() => document.body.innerHTML.length).catch(() => 0);
    console.log(
      `  "${handle.label}" in ${frame === page.mainFrame() ? "main" : frame.url().slice(0, 30)}: ${
        clickedOk ? "clicked" : "not clicked"
      }, DOM ${before} → ${after} (${before === after ? "unchanged" : "changed"})`,
    );
    if (clickedOk) clicked += 1;
    await page.waitForTimeout(800);
  }
}

// The stacked-squares control in the chrome is named "Flatten layers", and a click on it times out — which
// is how a *disabled* button behaves. So ask it directly, then give the document a second layer and ask
// again: if flattening is enabled by having something to flatten, that is the whole story.
const flattenState = async (frame) =>
  frame.evaluate(() => {
    const nodes = [...document.querySelectorAll("button, [role=button], [aria-label], [title]")];
    const node = nodes.find((el) =>
      `${el.getAttribute("aria-label") ?? ""} ${el.getAttribute("title") ?? ""} ${el.textContent ?? ""}`
        .toLowerCase()
        .includes("flatten"),
    );
    if (!node) return null;
    return {
      label: node.getAttribute("aria-label") ?? node.getAttribute("title") ?? node.textContent ?? "",
      disabled: node.hasAttribute("disabled") || node.getAttribute("aria-disabled") === "true",
      className: (node.getAttribute("class") ?? "").slice(0, 80),
      opacity: getComputedStyle(node).opacity,
      pointerEvents: getComputedStyle(node).pointerEvents,
    };
  });

const main = page.mainFrame();
console.log(`flatten control, before any edit: ${JSON.stringify(await flattenState(main))}`);

// Add a layer the way a visitor would: the Text tool, then whatever it offers to add.
const textTool = main.locator("button, [role=button], [aria-label], [title]").filter({ hasText: /^Text$/i }).first();
await textTool.click({ timeout: 8000 }).catch((error) => console.log(`  the Text tool: ${error.message.split("\n")[0]}`));
await page.waitForTimeout(1500);

// Read the Text panel the way a visitor would see it: every visible control, in order, with its words.
const panel = await main
  .evaluate(() => {
    const visible = (el) => {
      const rect = el.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0 && getComputedStyle(el).visibility !== "hidden";
    };
    return [...document.querySelectorAll("button, [role=button], [aria-label], [title]")]
      .filter(visible)
      .map((el) => ({
        label: (el.getAttribute("aria-label") ?? el.getAttribute("title") ?? el.textContent ?? "").trim().replace(/\s+/g, " "),
        disabled: el.hasAttribute("disabled") || el.getAttribute("aria-disabled") === "true",
      }))
      .filter((entry) => entry.label && entry.label.length < 44);
  })
  .catch(() => []);
const addButtons = panel
  .filter((entry) => /add|heading|subhead|paragraph|insert|apply/i.test(entry.label))
  .map((entry) => entry.label);
console.log(`  visible controls now: ${panel.map((entry) => entry.label).join(" · ").slice(0, 600)}`);
console.log(`  of those, the ones that would add something: ${addButtons.join(" · ") || "none found"}`);

for (const label of addButtons.slice(0, 3)) {
  const button = main.locator("button, [role=button]").filter({ hasText: new RegExp(`^${label}$`, "i") }).first();
  const done = await button.click({ timeout: 6000 }).then(() => true).catch(() => false);
  console.log(`  clicked "${label}": ${done}`);
  if (done) break;
}
await page.waitForTimeout(2500);
console.log(`flatten control, after adding a layer: ${JSON.stringify(await flattenState(main))}`);

console.log(clicked ? `clicked ${clicked} layer-ish control(s)` : "no layer-ish control found in any frame");
console.log(errors.length ? `console errors: ${errors.slice(0, 4).join(" | ")}` : "no console errors");
await page.screenshot({ path: "/tmp/editor-layers.png" });
console.log("screenshot → /tmp/editor-layers.png");
await browser.close();