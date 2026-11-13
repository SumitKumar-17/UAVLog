// Walk the whole guided tour in headless Chromium: for every step report whether its target was found and spotlighted,
// run "Do it" actions, and save screenshots of chosen steps. Used via ./bin/tour-check URL [outdir].
const { chromium } = require("playwright");
const [url, outdir = "/tmp/tour"] = process.argv.slice(2);
const shots = new Set((process.env.SHOTS || "").split(",").filter(Boolean).map(Number));
const doActions = process.env.NOACT ? false : true;
(async () => {
  const browser = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 810 }, colorScheme: "light", locale: "en-US" });
  await ctx.addInitScript((m) => { try { localStorage.setItem("theme", "light"); localStorage.removeItem("uavlog.tour.step"); localStorage.setItem("uavlog.tour.mode", m); } catch {} }, process.env.TOURMODE || "full");
  if (process.env.BYPASS) await ctx.route(/\.vercel\.app\//, (route) => route.continue({ headers: { ...route.request().headers(), "x-vercel-protection-bypass": process.env.BYPASS } }));  // protected preview: only our own host gets the header
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  await page.goto(url, { waitUntil: "networkidle", timeout: 60000 });
  await page.click('button[aria-label="Start the guided tour"]');
  await page.waitForSelector("[data-tour-card]");
  const problems = [];
  let n = 0;
  for (;;) {
    n++;
    await page.waitForTimeout(1200);
    await page.waitForSelector("[data-tour-spot]", { timeout: 25000 }).catch(() => {});
    const info = await page.evaluate(() => {
      const card = document.querySelector("[data-tour-card]");
      const title = card?.querySelector(".font-dense")?.textContent;
      const head = card?.querySelector("button[aria-expanded]")?.textContent;
      return { title, head, spot: !!document.querySelector("[data-tour-spot]"), looking: /Looking for the element/.test(card?.textContent || ""), path: location.pathname + location.search, doit: [...card.querySelectorAll("button")].some((b) => b.textContent === "Do it"), last: [...card.querySelectorAll("button")].some((b) => b.textContent === "Finish") };
    });
    const needsTarget = await page.evaluate(() => !!document.querySelector("[data-tour-card]"));
    if (!info.spot) problems.push(`step ${n} "${info.title}" (${info.head}) on ${info.path}: no spotlight${info.looking ? " (target not found)" : ""}`);
    if (n === 3) {  // drag the card by its header and check that it moved, then double-click to put it back
      const h = await page.locator("[data-tour-card] .font-dense").boundingBox(); const before = await page.locator("[data-tour-card]").boundingBox();
      await page.mouse.move(h.x + 20, h.y + 8); await page.mouse.down(); await page.mouse.move(h.x - 300, h.y + 160, { steps: 8 }); await page.mouse.up();
      const after = await page.locator("[data-tour-card]").boundingBox();
      console.log(Math.abs(after.x - before.x) > 100 ? `drag ok (moved ${Math.round(after.x - before.x)}px, ${Math.round(after.y - before.y)}px)` : "DRAG FAILED");
      await page.mouse.dblclick(after.x + 20, after.y + 8); await page.waitForTimeout(300);
    }
    if (doActions && info.doit) { await page.click('[data-tour-card] button:text-is("Do it")').catch((e) => problems.push(`step ${n}: Do it failed: ${e.message.split("\n")[0]}`)); await page.waitForTimeout(1500); }
    if (process.env.DEBUG && shots.has(n)) console.log(await page.evaluate(() => JSON.stringify({ sy: scrollY, bodyTop: document.body.getBoundingClientRect().top, htmlTop: document.documentElement.getBoundingClientRect().top, sh: document.documentElement.scrollHeight, ih: innerHeight, header: document.querySelector('header')?.getBoundingClientRect().top, scrollers: [...document.querySelectorAll('*')].filter((e) => e.scrollTop > 0).map((e) => e.tagName + '.' + String(e.className).slice(0, 30) + '=' + e.scrollTop) })));
    if (shots.has(n)) { await page.waitForTimeout(1500); await page.screenshot({ path: `${outdir}/step-${String(n).padStart(2, "0")}.png` }); }
    console.log(`${String(n).padStart(2)} ${info.spot ? "ok  " : "MISS"} ${info.head} | ${info.title}`);
    if (info.last) break;
    await page.click('[data-tour-card] button:text-is("Next")');
  }
  console.log(problems.length ? "\nPROBLEMS\n" + problems.join("\n") : "\nall steps spotlighted");
  if (errors.length) console.log("\nERRORS\n" + errors.join("\n"));
  await browser.close();
})();
