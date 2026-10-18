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
  if (process.env.FILL) { const [sel, text] = process.env.FILL.split("|"); await page.fill(sel, text); }
  if (process.env.CLICK) await page.click(process.env.CLICK);
  if (process.env.CLICK2) { await page.waitForTimeout(6000); await page.click(process.env.CLICK2); }
  if (waitFor) await page.waitForSelector(waitFor, { timeout: 30000 }).catch(() => problems.push(`selector not found: ${waitFor}`));
  await page.waitForFunction(() => !document.body.innerText.includes("updating") && !document.querySelector("[aria-busy]"), null, { timeout: 30000 }).catch(() => problems.push("page still busy"));
  await page.waitForTimeout(+(process.env.WAIT_MS || 800));
  if (process.env.ELEMENT) await page.locator(process.env.ELEMENT).first().screenshot({ path: out });
  else await page.screenshot({ path: out, fullPage: true });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  if (overflow > 0) {
    const culprits = await page.evaluate(() => [...document.querySelectorAll("body *")]
      .filter((e) => e.getBoundingClientRect().right > window.innerWidth + 1 && !e.closest("[class*=overflow-x-auto],[class*=overflow-auto]"))
      .slice(0, 6).map((e) => `${e.tagName.toLowerCase()}${e.className && typeof e.className === "string" ? "." + e.className.split(" ").slice(0, 3).join(".") : ""} "${(e.textContent || "").trim().slice(0, 40)}"`));
    problems.push(`horizontal overflow: page is ${overflow}px wider than the viewport. Elements past the edge: ${culprits.join(" | ")}`);
  }
  console.log(problems.length ? problems.join("\n") : "no console errors");
  await browser.close();
})();
