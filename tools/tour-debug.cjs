// ./tools/tour-debug.cjs URL TEXT: open the page, wait, and report whether the text is present plus console errors (debugging hosted differences).
const { chromium } = require("playwright");
(async () => {
  const b = await chromium.launch(); const p = await (await b.newContext({ viewport: { width: 1440, height: 810 }, locale: "en-US" })).newPage();
  const log = []; p.on("console", (m) => m.type() === "error" && log.push(m.text().slice(0, 200))); p.on("pageerror", (e) => log.push("pageerror: " + e.message.slice(0, 300)));
  p.on("response", (r) => r.status() >= 400 && log.push(r.status() + " " + r.url().slice(0, 150)));
  await p.goto(process.argv[2], { waitUntil: "networkidle" }); await p.waitForTimeout(8000);
  const t = process.argv[3];
  console.log(await p.evaluate((t) => JSON.stringify({ has: document.body.innerText.includes(t), idx: document.body.innerText.indexOf("Behaviour"), around: document.body.innerText.slice(document.body.innerText.indexOf("Behaviour"), document.body.innerText.indexOf("Behaviour") + 260) }), t));
  console.log(log.join("\n")); await b.close();
})();
