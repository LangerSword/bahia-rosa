// where does the deployed print stall against the AWS desk?
import { resolve } from "node:path";
import { chromium } from "playwright";

const DESK = process.env.DESK_URL ?? "https://websites-perspectives-government-beef.trycloudflare.com";
const LIVE = "https://langersword.github.io/late-edition/";

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
page.on("pageerror", (e) => console.log("  pageerror:", String(e).slice(0, 200)));
page.on("requestfailed", (r) => console.log(`  FAILED ${r.method()} ${r.url().replace(DESK, "DESK").slice(0, 110)} — ${r.failure()?.errorText}`));
page.on("websocket", (ws) => {
  console.log(`  ws: ${ws.url().replace(DESK, "DESK").slice(0, 90)}`);
  ws.on("close", () => console.log("  ws closed"));
});
page.on("response", (r) => {
  const url = r.url();
  if (url.includes("trycloudflare.com")) {
    const path = url.split("trycloudflare.com")[1]?.split("?")[0];
    if (!path?.includes("/history/")) console.log(`  ← ${r.status()} ${r.request().method()} ${path?.slice(0, 70)}`);
  }
});

await page.goto(`${LIVE}?desk=${encodeURIComponent(DESK)}`);
await page.waitForSelector("[data-testid='photo-input']", { state: "attached", timeout: 30_000 });
const cdp = await page.context().newCDPSession(page);
const { root } = await cdp.send("DOM.getDocument");
const { nodeId } = await cdp.send("DOM.querySelector", { nodeId: root.nodeId, selector: "[data-testid='photo-input']" });
await cdp.send("DOM.setFileInputFiles", { files: [resolve("public/art/demo/s1-marisol-keyart.jpg")], nodeId });
console.log("photo handed over; watching…\n");

for (let i = 0; i < 12; i += 1) {
  await page.waitForTimeout(15_000);
  const state = await page.evaluate(() => ({
    desk: document.querySelector("[data-testid='print-desk']")?.innerText.replace(/\s+/g, " ").slice(0, 260) ?? null,
    editor: Boolean(document.querySelector(".editor-shell")),
  }));
  console.log(`t+${(i + 1) * 15}s editor=${state.editor} ${state.desk ?? "no desk panel"}`);
  if (state.editor) break;
}
await page.screenshot({ path: "docs/shots/aws-desk-stall.png" });
await browser.close();
