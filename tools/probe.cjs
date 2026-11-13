// Debug helper: open a page, print every console message and some DOM facts. node tools/probe.cjs URL
const { chromium } = require("playwright");
(async () => {
  const b = await chromium.launch(); const p = await (await b.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  p.on("console", (m) => console.log(`[${m.type()}] ${m.text().slice(0, 300)}`));
  p.on("pageerror", (e) => console.log("[pageerror] " + e.message.slice(0, 300)));
  p.on("requestfailed", (r) => !r.url().includes("tile.openstreetmap") && console.log("[requestfailed] " + r.url() + " " + (r.failure() || {}).errorText));
  await p.goto(process.argv[2], { waitUntil: "load" }); await p.waitForTimeout(8000);
  console.log(JSON.stringify(await p.evaluate(() => { const m = window.__map; const c = document.querySelector(".maplibregl-canvas"); return m ? { loaded: m.loaded(), styleLoaded: m.isStyleLoaded(), layers: m.getStyle().layers.map((l) => l.id), src: !!m.getSource("flights"), zoom: m.getZoom(), center: m.getCenter(), w: c && c.width, h: c && c.height, cssW: c && c.clientWidth, cssH: c && c.clientHeight } : "no map"; })));
  console.log("canvas:", await p.locator("canvas").count(), "webgl:", await p.evaluate(() => !!document.createElement("canvas").getContext("webgl")));
  if (process.argv[3]) await p.screenshot({ path: process.argv[3], fullPage: true });
  await b.close();
})();
