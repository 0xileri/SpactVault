/**
 * Writes public/favicon.svg and renders the brand PNGs from HTML with Chromium, all from src/brandMark.ts.
 * Run after changing the mark, the colors or the share card:
 *   node --experimental-strip-types dev/render-brand.ts
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { chromium } from "@playwright/test";

import { BRAND, tileSvg } from "../src/brandMark.ts";

const WEB = resolve(import.meta.dirname, "..");
const PUBLIC = join(WEB, "public");
/** Files for use outside the site: avatars, social previews, the logo (brand/README.md). */
const KIT = resolve(WEB, "../../brand");
const PAPER = "#f7f7fb";
const PAID = "#10b981";
const WAITS = "#f59e0b";
const BLOCKED = "#f43f5e";

const font = readFileSync(join(WEB, "node_modules/@fontsource-variable/space-grotesk/files/space-grotesk-latin-wght-normal.woff2"));
const fontFace = `@font-face { font-family: "Space Grotesk"; font-weight: 300 700; src: url(data:font/woff2;base64,${font.toString("base64")}) format("woff2"); }`;

const pill = (color: string, label: string) =>
  `<span class="pill"><span class="dot" style="background:${color}"></span>${label}</span>`;

const card = (width = 1200, height = 630) => `<!doctype html><html><head><style>
  ${fontFace}
  * { margin: 0; box-sizing: border-box; }
  body { width: ${width}px; height: ${height}px; background: ${PAPER}; color: ${BRAND.ink}; font-family: "Space Grotesk", sans-serif; position: relative; overflow: hidden; }
  .left { position: absolute; left: 80px; top: 64px; width: 700px; }
  .brand { display: flex; align-items: center; gap: 18px; }
  .word { font-size: 44px; font-weight: 700; letter-spacing: -0.03em; }
  .word b { color: ${BRAND.violet}; font-weight: 700; }
  h1 { margin-top: 56px; font-size: 70px; line-height: 1.04; font-weight: 700; letter-spacing: -0.02em;
       background: linear-gradient(90deg, ${BRAND.ink}, ${BRAND.violet}); -webkit-background-clip: text; background-clip: text; color: transparent; }
  p { margin-top: 24px; font-size: 28px; color: #52525b; font-weight: 400; }
  .pills { position: absolute; left: 80px; bottom: 60px; display: flex; gap: 14px; }
  .pill { display: inline-flex; align-items: center; gap: 12px; padding: 12px 22px; border-radius: 999px; background: #fff; border: 2px solid ${BRAND.line}; font-size: 24px; font-weight: 500; }
  .dot { width: 16px; height: 16px; border-radius: 50%; }
  .big { position: absolute; right: 96px; top: 150px; filter: drop-shadow(0 24px 48px rgba(20, 15, 43, 0.12)); }
  .note { position: absolute; right: 96px; top: 72px; font-size: 18px; color: #71717a; }
</style></head><body>
  <div class="left">
    <div class="brand">${tileSvg(64)}<span class="word">Spact<b>Vault</b></span></div>
    <h1>Autonomous spending.<br>Human rules.</h1>
    <p>Give your AI agent a budget, not your wallet.</p>
  </div>
  <div class="big">${tileSvg(300)}</div>
  <div class="pills">${pill(PAID, "Paid instantly")}${pill(WAITS, "Needs your OK")}${pill(BLOCKED, "Refused")}</div>
  <div class="note">Live on NEAR mainnet · unaudited prototype</div>
</body></html>`;

const icon = (size: number, square: boolean) =>
  `<!doctype html><html><body style="margin:0;background:transparent">${tileSvg(size, square)}</body></html>`;

/** The lockup: mark tile and wordmark on white, for documents and slides. */
const lockup = `<!doctype html><html><head><style>
  ${fontFace}
  body { margin: 0; width: 2400px; height: 640px; background: ${BRAND.white}; display: flex; align-items: center; justify-content: center; gap: 72px; font-family: "Space Grotesk", sans-serif; }
  .word { font-size: 260px; font-weight: 700; letter-spacing: -0.03em; color: ${BRAND.ink}; }
  .word b { color: ${BRAND.violet}; font-weight: 700; }
</style></head><body>${tileSvg(400)}<span class="word">Spact<b>Vault</b></span></body></html>`;

writeFileSync(join(PUBLIC, "favicon.svg"), tileSvg() + "\n");
writeFileSync(join(KIT, "spactvault-icon.svg"), tileSvg() + "\n");
console.log("wrote public/favicon.svg and brand/spactvault-icon.svg");

const browser = await chromium.launch();
try {
  const shots: [string, string, number, number, boolean][] = [
    [join(PUBLIC, "og-image.png"), card(), 1200, 630, false],
    [join(PUBLIC, "favicon-32.png"), icon(32, false), 32, 32, true],
    [join(PUBLIC, "apple-touch-icon.png"), icon(180, true), 180, 180, false],
    [join(KIT, "spactvault-avatar-1024.png"), icon(1024, true), 1024, 1024, false],
    [join(KIT, "spactvault-logo.png"), lockup, 2400, 640, false],
    [join(KIT, "github-social-preview.png"), card(1280, 640), 1280, 640, false],
  ];
  for (const [path, html, width, height, transparent] of shots) {
    const page = await browser.newPage({ viewport: { width, height } });
    await page.setContent(html);
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path, omitBackground: transparent });
    await page.close();
    console.log(`wrote ${path.replace(resolve(WEB, "../.."), "").slice(1)}`);
  }
} finally {
  await browser.close();
}
