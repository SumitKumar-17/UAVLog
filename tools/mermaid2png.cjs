// Render Mermaid sources (.mmd) to crisp PNGs with headless Chromium: node mermaid2png.cjs docs/diagrams/*.mmd  ->  docs/figures/diagram-<name>.png
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 }, deviceScaleFactor: 2, locale: "en-US" });
  fs.mkdirSync("docs/figures", { recursive: true });
  for (const f of process.argv.slice(2)) {
    const src = fs.readFileSync(f, "utf8");
    const page = await ctx.newPage();
    await page.setContent(`<!doctype html><html><head><meta charset="utf-8"><style>body{margin:0;background:#fff;font-family:Arial,sans-serif} #w{display:inline-block;padding:20px;background:#fff}</style>
      <script src="https://cdn.jsdelivr.net/npm/mermaid@10.9.1/dist/mermaid.min.js"></script></head><body><div id="w"><pre class="mermaid">${src.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</pre></div></body></html>`, { waitUntil: "networkidle" });
    await page.evaluate(async () => {
      window.mermaid.initialize({ startOnLoad: false, theme: "neutral", securityLevel: "loose", flowchart: { useMaxWidth: false, htmlLabels: true, curve: "basis" }, er: { useMaxWidth: false }, state: { useMaxWidth: false },
        themeVariables: { fontFamily: "Arial, sans-serif", fontSize: "15px" } });
      await window.mermaid.run({ querySelector: ".mermaid" });
    });
    const out = path.join("docs/figures", `diagram-${path.basename(f, ".mmd")}.png`);
    await page.locator("#w").screenshot({ path: out });
    const err = await page.locator(".mermaid[data-processed] svg text:has-text('Syntax error')").count();
    console.log(out + (err ? "  !! syntax error in diagram" : ""));
    await page.close();
  }
  await browser.close();
})();
