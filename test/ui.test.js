// Clicks through every screen in demo mode and with the test backend. Run with the test server up.
const { chromium, devices } = require("playwright");
const links = require("./.links.json"), OUT = "/tmp/claude-0/-home-claude/6647f075-e63a-5e5e-a642-61d34bf7d70e/scratchpad/shots/";
const T = s => (s || "").replace(/\s+/g, " ").trim();
(async () => {
  const browser = await chromium.launch();
  const errs = [];
  const newPage = async (date) => {
    const ctx = await browser.newContext({...devices["Pixel 7"], locale: "en-GB", timezoneId: "Europe/London", serviceWorkers: "block"});
    const page = await ctx.newPage();
    page.on("pageerror", e => errs.push("pageerror: " + e.message));
    page.on("console", m => { if (m.type() === "error" && !/fonts\.g/.test(m.text())) errs.push("console: " + m.text()); });
    await page.clock.install({time: new Date((date || "2026-10-26") + "T19:30:00")});
    return page;
  };
  const shot = (page, n, full) => page.screenshot({path: OUT + n + ".png", fullPage: !!full});
  const visitAll = async (page, tag) => {
    for (const tab of ["today", "money", "add", "partner", "more"]) { await page.click(`nav [data-v="${tab}"]`); await page.waitForTimeout(80); const t = T(await page.textContent("main")); if (/Something went wrong/.test(t)) errs.push(tag + " " + tab + ": " + t.slice(0, 200)); }
    await page.click('nav [data-v="money"]'); await page.click('[data-a="moneyview"][data-v="year"]'); await page.waitForTimeout(50); await page.click('[data-a="moneyview"][data-v="month"]');
    for (const s of ["payday", "pots", "bills", "goals", "lisa", "house", "networth", "debts", "insights", "gifts", "settings"]) {
      await page.click('nav [data-v="more"]'); await page.click(`main [data-a="go"][data-v="${s}"]`); await page.waitForTimeout(60);
      const t = T(await page.textContent("main")); if (/Something went wrong/.test(t)) errs.push(tag + " " + s + ": " + t.slice(0, 300));
    }
    for (const s of ["list:income", "list:budgets", "list:accounts", "list:splits", "list:transfers", "sharing", "themes", "sync", "importcsv", "account"]) {
      await page.click('nav [data-v="more"]'); await page.click('main [data-a="go"][data-v="settings"]'); await page.click(`main [data-a="go"][data-v="${s}"]`); await page.waitForTimeout(60);
      const t = T(await page.textContent("main")); if (/Something went wrong/.test(t)) errs.push(tag + " " + s + ": " + t.slice(0, 300));
    }
  };

  // 1. Show and tell
  let page = await newPage("2026-10-26");
  await page.goto("http://localhost:8790/"); await page.waitForSelector("main");
  await shot(page, "01-connect");
  await page.click('[data-a="demo"][data-v="on"]'); await page.waitForTimeout(150);
  await shot(page, "02-demo-today", true);
  await visitAll(page, "demo");
  await page.click('nav [data-v="partner"]'); await shot(page, "03-demo-partner", true);
  await page.click('nav [data-v="more"]'); await page.click('main [data-v="house"]'); await shot(page, "04-demo-house", true);
  await page.click('nav [data-v="more"]'); await page.click('main [data-v="lisa"]'); await shot(page, "05-demo-lisa", true);
  await page.click('nav [data-v="more"]'); await page.click('main [data-v="bills"]'); await shot(page, "06-demo-bills", true);
  await page.click('.cal button.has'); await page.waitForTimeout(100); await shot(page, "07-demo-calday");
  await page.click('[data-a="sheetclose"]');
  // Sam in easy read
  await page.click('[data-a="demoinfo"]'); await page.click('[data-a="demoas"][data-v="sam"]'); await page.waitForTimeout(100); await shot(page, "08-demo-sam", true);
  console.log("sam easy:", await page.evaluate(() => document.body.classList.contains("easy")));
  // themes
  await page.click('nav [data-v="more"]'); await page.click('main [data-v="settings"]'); await page.click('main [data-v="themes"]');
  for (const t of ["dreamland", "hunter", "dragon"]) { await page.click(`[data-a="tspecial"][data-v="${t}"]`); await page.click('nav [data-v="today"]'); await page.waitForTimeout(150); await shot(page, "09-theme-" + t); await page.click('nav [data-v="more"]'); await page.click('main [data-v="settings"]'); await page.click('main [data-v="themes"]'); }
  await page.click('[data-a="tspecial"][data-v=""]'); await page.click('[data-a="tmode"][data-v="dark"]'); await page.click('nav [data-v="today"]'); await shot(page, "10-dark");
  await page.click('nav [data-v="more"]'); await page.click('main [data-v="settings"]'); await page.click('main [data-v="themes"]'); await page.click('[data-a="tmode"][data-v="system"]');
  await page.context().close();

  // 2. Ethan connected to the test backend, on 2 Nov (just after payday)
  page = await newPage("2026-11-02");
  await page.goto(links.ethan); await page.waitForFunction(() => /Hi Ethan/.test(document.querySelector("#top").textContent), null, {timeout: 8000});
  await shot(page, "20-ethan-today", true);
  console.log("ethan today:", T(await page.textContent("main")).slice(0, 600));
  await visitAll(page, "ethan");
  // log a payment from the main account for fuel
  await page.click('nav [data-v="add"]');
  await page.click('[data-a="addbud"][data-v="e-fuel"]'); await page.click('[data-a="addfrom"]'); await page.click('#sheets [data-a="addfrom2"][data-v="e-main"]');
  await page.fill("#addAmt", "35");
  await page.click('[data-a="addsave"]'); await page.waitForTimeout(1200);
  console.log("after log:", T(await page.textContent("#toast")), "|", T(await page.textContent("main")).slice(0, 400));
  const tx = await (await page.request.get("http://localhost:8790/dump?transactions")).json();
  console.log("saved to sheet:", tx.map(r => r.amount + " " + r.budget + " " + r.account));
  // tick the fuel move
  if (await page.$('input[data-c="tick"]')) { await page.click('input[data-c="tick"]', {noWaitAfter: true}).catch(() => {}); await page.waitForTimeout(1200); }
  const mv = await (await page.request.get("http://localhost:8790/dump?moves")).json(); console.log("moves in sheet:", mv.map(r => r.from + ">" + r.to + " " + r.amount + " " + r.key));
  // payday: change the pay
  await page.click('nav [data-v="more"]'); await page.click('main [data-v="payday"]'); await shot(page, "21-payday", true);
  await page.click('[data-a="payedit"]'); await page.fill("#payAmt", "2900"); await page.click('[data-a="paysave"]'); await page.waitForTimeout(1200);
  console.log("payday after:", T(await page.textContent("main")).slice(0, 300));
  // change the phone bill from 20 to 24 from today
  await page.click('nav [data-v="more"]'); await page.click('main [data-v="bills"]'); await page.click('[data-a="edit"][data-v="bills:e-phone"]');
  await page.fill('[data-f="amount"]', "24"); await page.click('[data-a="editsave"]'); await page.waitForTimeout(100); await page.click('[data-a="amtwhen"][data-v="today"]'); await page.waitForTimeout(1200);
  const am = await (await page.request.get("http://localhost:8790/dump?amounts")).json(); console.log("amounts:", am.map(r => r.item + " " + r.amount + " from " + r.start));
  const phone = (await (await page.request.get("http://localhost:8790/dump?bills")).json()).find(r => r.id === "e-phone"); console.log("phone base amount still", phone.amount);
  // Coming up: mark one as didn't happen
  await page.click('nav [data-v="today"]'); const occ = await page.$('.swipe .face'); if (occ) { await occ.click(); await page.waitForTimeout(100); await shot(page, "22-occ-sheet"); await page.click('[data-a="occdo"][data-v^="skip"]'); await page.waitForTimeout(1200); }
  const ex = await (await page.request.get("http://localhost:8790/dump?exceptions")).json(); console.log("exceptions:", ex.map(r => r.item + " " + r.action + " " + r.date));
  await page.click('nav [data-v="partner"]'); await shot(page, "23-ethan-partner", true);
  console.log("partner:", T(await page.textContent("main")).slice(0, 500));
  // new bill through the editor
  await page.click('nav [data-v="more"]'); await page.click('main [data-v="bills"]'); await page.click('[data-a="new"][data-v="bills"]');
  await page.fill('[data-f="name"]', "Netflix"); await page.fill('[data-f="amount"]', "5.99"); await page.selectOption('[data-f="category"]', "subscription"); await page.selectOption('[data-f="on"]', "22");
  await shot(page, "24-new-bill", true); await page.click('[data-a="editsave"]'); await page.waitForTimeout(1200);
  const nb = (await (await page.request.get("http://localhost:8790/dump?bills")).json()).find(r => r.name === "Netflix"); console.log("new bill:", nb && [nb.amount, nb.unit, nb.on, nb.start, nb.person, nb.category]);
  await page.context().close();

  // 3. Sophie sees the split, not Ethan's private payment
  page = await newPage("2026-11-02");
  await page.goto(links.sophie); await page.waitForFunction(() => /Hi Sophie/.test(document.querySelector("#top").textContent), null, {timeout: 8000});
  console.log("sophie easy:", await page.evaluate(() => document.body.classList.contains("easy")));
  await shot(page, "30-sophie-today", true);
  await visitAll(page, "sophie");
  await page.click('nav [data-v="partner"]'); await shot(page, "31-sophie-partner", true);
  // offline: log a payment, then come back online
  await page.context().setOffline(true);
  await page.click('nav [data-v="add"]'); await page.fill("#addAmt", "4"); await page.click('[data-a="addsave"]'); await page.waitForTimeout(600);
  console.log("offline header:", T(await page.textContent("#top")));
  await page.context().setOffline(false); await page.evaluate(() => window.BudgieApp.sync(false)); await page.waitForTimeout(1500);
  console.log("back online header:", T(await page.textContent("#top")));
  const tx2 = await (await page.request.get("http://localhost:8790/dump?transactions")).json(); console.log("sophie's offline payment reached the sheet:", tx2.some(r => r.person === "sophie" && +r.amount === 4));
  await page.context().close();

  console.log(errs.length ? "ERRORS:\n" + errs.join("\n") : "No errors");
  await browser.close();
})();
