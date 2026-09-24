#!/usr/bin/env node
/**
 * The evidence a human would gather by looking, gathered by a machine that cannot look.
 *
 * The design rewrite made claims that are countable — no eyebrow labels rendered as caps, no gradient
 * panels, one type family, one accent, nothing overflowing sideways, the hero actually painting — so
 * this measures them at the three widths the contract names, and writes a full-page screenshot beside
 * each measurement for a person to read. It does not judge taste; it reports what is there.
 *
 *   node tools/design-check.mjs http://localhost:4180
 */

import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const url = process.argv[2] ?? "http://localhost:4180";
const outDir = "docs/shots";
mkdirSync(outDir, { recursive: true });

const viewports = [
  { name: "1440", width: 1440, height: 900 },
  { name: "768", width: 768, height: 1024 },
  { name: "375", width: 375, height: 812 },
];

/**
 * Relative luminance and contrast, WCAG's own arithmetic — defined inside the page rather than passed
 * in as a string to eval(): this script never evaluates anything it did not write itself.
 */
const CONTRAST_HELPERS = `
  const lumOf = (rgb) => {
    const [r, g, b] = rgb.map((v) => {
      const c = v / 255;
      return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const parseRgb = (value) => (value.match(/[\\d.]+/g) || []).slice(0, 3).map(Number);
  const contrast = (a, b) => {
    const [x, y] = [lumOf(parseRgb(a)), lumOf(parseRgb(b))].sort((p, q) => q - p);
    return (x + 0.05) / (y + 0.05);
  };
`;

const browser = await chromium.launch();
const report = [];

for (const viewport of viewports) {
  const page = await browser.newPage({ viewport: { width: viewport.width, height: viewport.height } });
  const errors = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(String(error)));

  await page.goto(url, { waitUntil: "networkidle" });
  await page.waitForTimeout(2500);

  const measured = await page.evaluate((helpers) => {
    // Defined here, in the page, from a string this script wrote itself.
    const compute = new Function(`${helpers}; return { contrast };`);
    const { contrast } = compute();
    const all = [...document.querySelectorAll("*")];
    const visible = (node) => {
      const box = node.getBoundingClientRect();
      const style = getComputedStyle(node);
      return box.width > 0 && box.height > 0 && style.visibility !== "hidden" && style.opacity !== "0";
    };

    // Eyebrows: the pattern that made it look generated. Count any element whose class says kicker and
    // which still renders as tracked-out capitals.
    const kickers = all.filter(
      (node) =>
        node.classList?.contains("kicker") &&
        visible(node) &&
        (getComputedStyle(node).textTransform === "uppercase" || parseFloat(getComputedStyle(node).letterSpacing) > 1),
    ).length;

    // Panels: any visible element still painting a gradient as its background.
    const gradients = all.filter((node) => {
      const style = getComputedStyle(node);
      return visible(node) && style.backgroundImage.includes("gradient") && !node.className?.toString().includes("fx-");
    }).length;

    const families = [...new Set(all.filter(visible).map((node) => getComputedStyle(node).fontFamily))];
    const heading = document.querySelector("h1.display");
    const body = getComputedStyle(document.body);

    const accents = [
      ...new Set(
        all
          .filter(visible)
          .map((node) => getComputedStyle(node).color)
          .filter((color) => {
            const [r, g, b] = (color.match(/[\d.]+/g) || []).slice(0, 3).map(Number);
            const spread = Math.max(r, g, b) - Math.min(r, g, b);
            return spread > 40; // a saturated colour, i.e. doing work as an accent
          }),
      ),
    ];

    const hero = document.querySelector('[data-testid="hero-3d"]');
    const heroCanvas = document.querySelector('[data-testid="hero"] canvas');
    const heroImage = document.querySelector('[data-testid="hero"] img');

    const text = document.querySelector(".deck");
    return {
      overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      kickers,
      gradients,
      families,
      bodyFamily: body.fontFamily,
      headingSize: heading ? getComputedStyle(heading).fontSize : null,
      headingTransform: heading ? getComputedStyle(heading).textTransform : null,
      accents,
      contrastBody: text ? contrast(getComputedStyle(text).color, body.backgroundColor) : null,
      hero: {
        host: Boolean(hero),
        canvas: Boolean(heroCanvas),
        image: Boolean(heroImage),
        canvasSize: heroCanvas ? `${heroCanvas.width}x${heroCanvas.height}` : null,
      },
      sections: document.querySelectorAll("main section").length,
      buttons: document.querySelectorAll("button, a[href]").length,
    };
  }, CONTRAST_HELPERS);

  await page.screenshot({ path: `${outDir}/revamp-${viewport.name}.png`, fullPage: true });
  report.push({ viewport: viewport.name, ...measured, consoleErrors: errors });
  console.log(
    `${viewport.name}px  overflow ${measured.overflowX}px · kickers-as-caps ${measured.kickers} · gradients ${measured.gradients} · families ${measured.families.length} · accents ${measured.accents.length} · hero ${measured.hero.canvas ? "webgl" : measured.hero.image ? "image" : "NOTHING"} · errors ${errors.length}`,
  );
  await page.close();
}

await browser.close();
console.log("\nfull report:");
console.log(JSON.stringify(report, null, 2));