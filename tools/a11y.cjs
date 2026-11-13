// Accessibility audit with axe-core in headless Chromium: node tools/a11y.cjs http://localhost:3000 / /flights /map ...
const { chromium } = require("playwright");
const fs = require("fs");
const axe = fs.readFileSync(require.resolve("axe-core/axe.min.js"), "utf8");
(async () => {
  const [base, ...paths] = process.argv.slice(2);
  const browser = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
  const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  for (const p of paths) {
    await page.goto(base + p, { waitUntil: "load", timeout: 60000 });
    await page.waitForTimeout(3500);
    await page.evaluate(axe);
    const r = await page.evaluate(async () => (await window.axe.run(document, { runOnly: ["wcag2a", "wcag2aa", "wcag21aa"] })).violations.map((v) => ({ id: v.id, impact: v.impact, n: v.nodes.length, help: v.help, sample: v.nodes[0].target.join(" ") + " :: " + (v.nodes[0].failureSummary || "").split("\n").slice(1, 3).join(" ") })));
    console.log(`\n${p}: ${r.length} violation types`);
    for (const v of r) console.log(`  [${v.impact}] ${v.id} x${v.n}: ${v.help}\n      e.g. ${v.sample.slice(0, 230)}`);
  }
  await browser.close();
})();
