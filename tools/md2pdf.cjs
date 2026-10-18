// Render a Markdown file to PDF with headless Chromium (Playwright). Mermaid blocks become diagrams.
//   report mode: node md2pdf.cjs in.md out.pdf            A4, page numbers
//   slides mode: node md2pdf.cjs in.md out.pdf --slides   16:9, one slide per section separated by a line of ---, PNG previews next to the PDF
const fs = require("fs");
const path = require("path");
const { marked } = require("marked");
const { chromium } = require("playwright");

const [input, output, flag] = process.argv.slice(2);
const slides = flag === "--slides";
const dir = path.dirname(path.resolve(input));
let md = fs.readFileSync(input, "utf8");
const renderer = new marked.Renderer();
renderer.code = ({ text, lang }) => (lang === "mermaid" ? `<pre class="mermaid">${text}</pre>` : `<pre><code>${text.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</code></pre>`);
const html = (m) => marked.parse(m, { renderer, gfm: true });

const css = `
@import url('https://fonts.googleapis.com/css2?family=Barlow:wght@400;500;600;700&family=Barlow+Semi+Condensed:wght@500;600&display=swap');
:root { --ink:#12202c; --ink2:#45586a; --muted:#596b7c; --rule:#cbd5dd; --route:#b0136f; --paper:#fff; }
* { box-sizing: border-box; }
body { font-family: Barlow, Arial, sans-serif; color: var(--ink); margin: 0; font-size: ${slides ? 26 : 11.5}px; line-height: ${slides ? 1.35 : 1.5}; }
h1, h2, h3 { font-family: 'Barlow Semi Condensed', Barlow, Arial, sans-serif; font-weight: 600; letter-spacing: -0.01em; }
a { color: var(--route); text-decoration: none; }
code { font-family: ui-monospace, Menlo, Consolas, monospace; font-size: 0.88em; background: #eef2f5; padding: 0.05em 0.3em; border-radius: 3px; }
pre { background: #f4f7f9; border: 1px solid var(--rule); border-radius: 4px; padding: 0.7em 0.9em; overflow: hidden; white-space: pre-wrap; font-size: 0.85em; }
pre code { background: none; padding: 0; }
pre.mermaid { background: none; border: none; text-align: center; padding: 0; }
table { border-collapse: collapse; margin: 0.6em 0; width: 100%; font-size: 0.92em; }
th { text-align: left; color: var(--muted); font-weight: 500; border-bottom: 1px solid var(--rule); padding: 0.3em 0.6em 0.3em 0; }
td { border-bottom: 1px solid #e3e9ee; padding: 0.3em 0.6em 0.3em 0; vertical-align: top; }
img { max-width: 100%; }
blockquote { margin: 0.6em 0; padding: 0.1em 1em; border-left: 3px solid var(--route); color: var(--ink2); }
${slides ? `
@page { size: 1280px 720px; margin: 0; }
section.slide { width: 1280px; height: 720px; padding: 56px 72px; page-break-after: always; overflow: hidden; display: flex; flex-direction: column; justify-content: center; }
section.slide h1 { font-size: 64px; margin: 0 0 16px; line-height: 1.05; }
section.slide h2 { font-size: 44px; margin: 0 0 18px; line-height: 1.1; }
section.slide ul { margin: 0.2em 0; padding-left: 1.1em; } section.slide li { margin: 0.28em 0; }
section.slide .cols { display: grid; grid-template-columns: 1fr 1fr; gap: 40px; align-items: start; }
section.slide .big { font-size: 96px; font-weight: 700; font-family: 'Barlow Semi Condensed', Barlow, sans-serif; line-height: 1; }
section.slide .note { color: var(--muted); font-size: 20px; margin-top: 14px; }
section.slide img { max-height: 470px; border: 1px solid var(--rule); }
section.slide table { font-size: 24px; }
section.slide.title { background: #12202c; color: #fff; } section.slide.title h1, section.slide.title h2 { color: #fff; } section.slide.title .note, section.slide.title a { color: #e9a6cf; }
` : `
@page { size: A4; margin: 20mm 18mm 20mm 18mm; }
h1 { font-size: 24px; margin: 0 0 4px; } h2 { font-size: 17px; margin: 1.5em 0 0.4em; border-bottom: 1px solid var(--rule); padding-bottom: 0.15em; } h3 { font-size: 13.5px; }
p, li { orphans: 3; widows: 3; } h2, h3 { break-after: avoid; } pre, table, img, .mermaid { break-inside: avoid; }
`}
`;

(async () => {
  let body;
  if (slides) {
    const parts = md.split(/\n---\s*\n/);
    body = parts.map((p, i) => `<section class="slide${i === 0 ? " title" : ""}">${html(p)}</section>`).join("\n");
  } else body = html(md);
  const page_html = `<!doctype html><html><head><meta charset="utf-8"><style>${css}</style></head><body>${body}
<script src="https://cdn.jsdelivr.net/npm/mermaid@10.9.1/dist/mermaid.min.js"></script></body></html>`;
  const tmp = path.join(dir, `.render-${process.pid}.html`);
  fs.writeFileSync(tmp, page_html);
  const browser = await chromium.launch();
  const page = await (await browser.newContext({ locale: "en-US", viewport: { width: slides ? 1280 : 900, height: slides ? 720 : 1200 } })).newPage();
  const problems = [];
  page.on("pageerror", (e) => problems.push(e.message));
  await page.goto("file://" + tmp, { waitUntil: "networkidle", timeout: 60000 });
  await page.evaluate(async () => {
    if (window.mermaid && document.querySelector(".mermaid")) { window.mermaid.initialize({ startOnLoad: false, theme: "neutral", flowchart: { useMaxWidth: true }, themeVariables: { fontFamily: "Barlow, Arial" } }); await window.mermaid.run({ querySelector: ".mermaid" }); }
    await document.fonts.ready;
  });
  await page.waitForTimeout(500);
  if (slides) {
    const n = await page.locator("section.slide").count();
    const base = output.replace(/\.pdf$/, "");
    for (let i = 0; i < n; i++) await page.locator("section.slide").nth(i).screenshot({ path: `${base}-${String(i + 1).padStart(2, "0")}.png` });
    console.log(`${n} slides`);
  }
  await page.pdf({ path: output, printBackground: true, width: slides ? "1280px" : undefined, height: slides ? "720px" : undefined, format: slides ? undefined : "A4",
    displayHeaderFooter: !slides, headerTemplate: "<span></span>", footerTemplate: `<div style="font-size:8px;color:#596b7c;width:100%;text-align:center"><span class="pageNumber"></span> / <span class="totalPages"></span></div>`,
    margin: slides ? { top: "0", right: "0", bottom: "0", left: "0" } : { top: "20mm", bottom: "20mm", left: "18mm", right: "18mm" } });
  fs.unlinkSync(tmp);
  console.log(problems.length ? "page errors: " + problems.join(" | ") : "rendered without page errors");
  await browser.close();
})();
