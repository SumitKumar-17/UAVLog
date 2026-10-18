// Render code excerpts and captured terminal output as syntax-highlighted PNG "screenshots" (headless Chromium via Playwright).
//   node code2png.cjs spec.json
// spec.json: [{ "id": "guard", "file": "backend/app/nlsql/guard.py", "start": "def check(", "lines": 40, "title": "optional", "lang": "python" },
//             { "id": "plan", "text_file": "docs/figures/text/plan.txt", "lang": "plaintext", "title": "EXPLAIN (ANALYZE, BUFFERS)" }]
// "start" is a substring of the first line to show (so excerpts survive edits); "lines" is how many lines to show.
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

const spec = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const root = process.cwd();
const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const page_css = `
@import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500&display=swap');
body { margin: 0; background: transparent; }
.card { display: inline-block; min-width: 760px; max-width: 1200px; background: #0d1b2a; border-radius: 10px; overflow: hidden; box-shadow: 0 2px 10px rgba(0,0,0,.25); }
.bar { background: #162b40; color: #aebdcb; font: 500 14px 'JetBrains Mono', Menlo, Consolas, monospace; padding: 10px 16px; display: flex; gap: 14px; align-items: center; }
.dots span { display:inline-block; width:11px; height:11px; border-radius:50%; margin-right:6px; background:#3a5068; }
pre { margin: 0; padding: 14px 18px 16px; font: 400 15px/1.5 'JetBrains Mono', Menlo, Consolas, monospace; color: #e6edf3; white-space: pre; overflow: hidden; }
.ln { color: #52687d; user-select: none; display: inline-block; width: 3.2em; text-align: right; margin-right: 1.2em; }
.hljs-keyword, .hljs-built_in, .hljs-literal { color: #ff8fb1; } .hljs-string { color: #a5d6a7; } .hljs-number { color: #ffcc80; }
.hljs-comment { color: #6b8299; font-style: italic; } .hljs-title, .hljs-title.function_, .hljs-function .hljs-title { color: #8ecbff; }
.hljs-attr, .hljs-attribute, .hljs-variable, .hljs-params { color: #e6edf3; } .hljs-type, .hljs-class .hljs-title { color: #ffd479; } .hljs-meta { color: #c8a2f0; }
`;

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1300, height: 900 }, deviceScaleFactor: 2, locale: "en-US" });
  const outDir = path.join(root, "docs", "figures");
  fs.mkdirSync(outDir, { recursive: true });
  for (const item of spec) {
    let text, title;
    if (item.text_file) { text = fs.readFileSync(path.join(root, item.text_file), "utf8").replace(/\s+$/, ""); title = item.title || path.basename(item.text_file); }
    else {
      const all = fs.readFileSync(path.join(root, item.file), "utf8").split("\n");
      const i = all.findIndex((l) => l.includes(item.start));
      if (i < 0) { console.log(`!! ${item.id}: start text not found in ${item.file}`); continue; }
      const chunk = all.slice(i, i + item.lines);
      while (chunk.length && !chunk[chunk.length - 1].trim()) chunk.pop();
      text = chunk.join("\n");
      title = item.title || `${item.file}  (lines ${i + 1} to ${i + chunk.length})`;
      item.first = i + 1;
    }
    const lines = text.split("\n");
    const numbered = item.first && item.numbers !== false;
    const page = await ctx.newPage();
    const html = `<!doctype html><html><head><meta charset="utf-8"><style>${page_css}</style>
      <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/styles/github-dark.min.css">
      <script src="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/highlight.min.js"></script></head>
      <body><div class="card" id="c"><div class="bar"><span class="dots"><span></span><span></span><span></span></span><span>${esc(title)}</span></div>
      <pre><code id="code" class="language-${item.lang || "plaintext"}">${esc(text)}</code></pre></div></body></html>`;
    await page.setContent(html, { waitUntil: "networkidle" });
    await page.evaluate((n) => {
      const el = document.getElementById("code");
      if (window.hljs && el.className.indexOf("plaintext") < 0) window.hljs.highlightElement(el);
      if (n.numbered) {
        const parts = el.innerHTML.split("\n");
        el.innerHTML = parts.map((l, k) => `<span class="ln">${n.first + k}</span>${l}`).join("\n");
      }
    }, { numbered, first: item.first || 1 });
    await page.evaluate(() => document.fonts.ready);
    await page.locator("#c").screenshot({ path: path.join(outDir, `${item.id}.png`), omitBackground: true });
    await page.close();
    console.log(`${item.id}.png  (${lines.length} lines)`);
  }
  await browser.close();
})();
