// Screenshot a page of the running web app and print console errors. Used via ./bin/shot (runs in Docker).
const { chromium } = require("playwright");
const [url, out, scheme = "light", width = "1280", height = "900"] = process.argv.slice(2);
const waitFor = process.env.WAIT_SEL || "";
(async () => {
  const browser = await chromium.launch();
  const page = await (await browser.newContext({ viewport: { width: +width, height: +height }, colorScheme: scheme, locale: "en-US" })).newPage();
  const problems = [];
  page.on("console", (m) => m.type() === "error" && problems.push(`console: ${m.text()}`));
  page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));
  page.on("requestfailed", (r) => problems.push(`request failed: ${r.url()}`));
  await page.goto(url, { waitUntil: "networkidle", timeout: 60000 });
  if (waitFor) await page.waitForSelector(waitFor, { timeout: 30000 }).catch(() => problems.push(`selector not found: ${waitFor}`));
  await page.waitForFunction(() => !document.body.innerText.includes("updating") && !document.querySelector("[aria-busy]"), null, { timeout: 30000 }).catch(() => problems.push("page still busy"));
  await page.waitForTimeout(800);
  await page.screenshot({ path: out, fullPage: true });
  console.log(problems.length ? problems.join("\n") : "no console errors");
  await browser.close();
})();
