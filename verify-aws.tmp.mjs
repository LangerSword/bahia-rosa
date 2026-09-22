// the judge's path: the deployed page, printing on the rented GPU.
import { resolve } from "node:path";
import { chromium } from "playwright";

const DESK = process.env.DESK_URL ?? "https://websites-perspectives-government-beef.trycloudflare.com";
const LIVE = "https://langersword.github.io/late-edition/";

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const problems = [];
page.on("pageerror", (e) => problems.push(String(e).slice(0, 160)));

const started = Date.now();
await page.goto(`${LIVE}?desk=${encodeURIComponent(DESK)}`);
await page.waitForSelector("[data-testid='photo-input']", { state: "attached", timeout: 30_000 });

// The input is display:none behind the dropzone by design, and Playwright will not drive a hidden
// input — so the file is handed to the element over CDP, the way a real drop would.
const cdp = await page.context().newCDPSession(page);
const { root } = await cdp.send("DOM.getDocument");
const { nodeId } = await cdp.send("DOM.querySelector", { nodeId: root.nodeId, selector: "[data-testid='photo-input']" });
await cdp.send("DOM.setFileInputFiles", { files: [resolve("public/art/demo/s1-marisol-keyart.jpg")], nodeId });

await page.waitForSelector(".editor-shell", { timeout: 300_000 });
const seconds = ((Date.now() - started) / 1000).toFixed(1);

await page.screenshot({ path: "docs/shots/deployed-print-on-aws.png" });
console.log(`deployed page + AWS desk: plate landed in the editor in ${seconds}s`);
console.log("screenshot: docs/shots/deployed-print-on-aws.png");
console.log("page errors:", problems.length ? problems.join(" | ") : "none");
await browser.close();
