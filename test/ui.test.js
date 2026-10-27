// Clicks through every screen in demo mode and with the test backend. Run with the test server up.
const { chromium, devices } = require("playwright");
const PORT = process.env.PORT || 8790;
const links = require("./.links.json"), OUT = "/tmp/claude-0/-home-claude/6647f075-e63a-5e5e-a642-61d34bf7d70e/scratchpad/shots/";
const T = s => (s || "").replace(/\s+/g, " ").trim();
const fails = [], check = (name, cond, extra) => { if (cond) console.log("ok", name); else fails.push(name + (extra !== undefined ? " :: " + JSON.stringify(extra).slice(0, 300) : "")); };
(async () => {
  const browser = await chromium.launch();
  const errs = [];
  const newPage = async (date) => {
    const ctx = await browser.newContext({...devices["Pixel 7"], locale: "en-GB", timezoneId: "Europe/London", serviceWorkers: "block"});
    // (the once-a-day "things to check" pop-up is marked as seen, so it can't land on top of a tap half a second in)
    await ctx.addInitScript(d => { try { localStorage.setItem("budgie.checkSeen", JSON.stringify(d)); } catch (e) {} }, date || "2026-10-26");
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
  await page.goto("http://localhost:" + PORT + "/"); await page.waitForSelector("main");
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

  // ===== review 2026-10-27e (1.4.11), first, while the test household is as it starts =====
  // Christmas pay on the 24th, Sophie's sofa repayment on the 28th: the payday screen says that part of the Cash ISA
  // waits for it
  {
    page = await newPage("2026-12-24");
    await page.goto(links.ethan); await page.waitForFunction(() => /Hi Ethan/.test(document.querySelector("#top").textContent), null, {timeout: 8000});
    await page.evaluate(() => { document.querySelector("#sheets").innerHTML = ""; window.BudgieApp.go("payday"); }); await page.waitForTimeout(100);
    const pdText = T(await page.textContent("main"));
    check("the payday screen says what waits for money that comes in after payday", /£200\.00 more goes to your Cash ISA once Sophie's Sofa repayment has come in, after payday/.test(pdText), pdText.slice(0, 400));
    await page.context().close();
  }

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
  const tx = await (await page.request.get("http://localhost:" + PORT + "/dump?transactions")).json();
  console.log("saved to sheet:", tx.map(r => r.amount + " " + r.budget + " " + r.account));
  // tick the fuel move
  if (await page.$('input[data-c="tick"]')) { await page.click('input[data-c="tick"]', {noWaitAfter: true}).catch(() => {}); await page.waitForTimeout(1200); }
  const mv = await (await page.request.get("http://localhost:" + PORT + "/dump?moves")).json(); console.log("moves in sheet:", mv.map(r => r.from + ">" + r.to + " " + r.amount + " " + r.key));
  // payday: change the pay
  await page.click('nav [data-v="more"]'); await page.click('main [data-v="payday"]'); await shot(page, "21-payday", true);
  await page.click('[data-a="payedit"]'); await page.fill("#payAmt", "2900"); await page.click('[data-a="paysave"]'); await page.waitForTimeout(1200);
  console.log("payday after:", T(await page.textContent("main")).slice(0, 300));
  // change the phone bill from 20 to 24 from today
  await page.click('nav [data-v="more"]'); await page.click('main [data-v="bills"]'); await page.click('[data-a="edit"][data-v="bills:e-phone"]');
  await page.fill('[data-f="amount"]', "24"); await page.click('[data-a="editsave"]'); await page.waitForTimeout(100); await page.click('[data-a="amtwhen"][data-v="today"]'); await page.waitForTimeout(1200);
  const am = await (await page.request.get("http://localhost:" + PORT + "/dump?amounts")).json(); console.log("amounts:", am.map(r => r.item + " " + r.amount + " from " + r.start));
  const phone = (await (await page.request.get("http://localhost:" + PORT + "/dump?bills")).json()).find(r => r.id === "e-phone"); console.log("phone base amount still", phone.amount);
  // Coming up: mark one as didn't happen
  await page.click('nav [data-v="today"]'); const occ = await page.$('.swipe .face'); if (occ) { await occ.click(); await page.waitForTimeout(100); await shot(page, "22-occ-sheet"); await page.click('[data-a="occdo"][data-v^="skip"]'); await page.waitForTimeout(1200); }
  const ex = await (await page.request.get("http://localhost:" + PORT + "/dump?exceptions")).json(); console.log("exceptions:", ex.map(r => r.item + " " + r.action + " " + r.date));
  await page.click('nav [data-v="partner"]'); await shot(page, "23-ethan-partner", true);
  console.log("partner:", T(await page.textContent("main")).slice(0, 500));
  // new bill through the editor
  await page.click('nav [data-v="more"]'); await page.click('main [data-v="bills"]'); await page.click('[data-a="new"][data-v="bills"]');
  await page.fill('[data-f="name"]', "Netflix"); await page.fill('[data-f="amount"]', "5.99"); await page.selectOption('[data-f="category"]', "subscription"); await page.selectOption('[data-f="on"]', "22");
  await shot(page, "24-new-bill", true); await page.click('[data-a="editsave"]'); await page.waitForTimeout(1200);
  const nb = (await (await page.request.get("http://localhost:" + PORT + "/dump?bills")).json()).find(r => r.name === "Netflix"); console.log("new bill:", nb && [nb.amount, nb.unit, nb.on, nb.start, nb.person, nb.category]);
  check("a new bill keeps the day you picked", nb && String(nb.on) === "22" && nb.unit === "month", nb);
  // "How often" brings up the right questions, and a yearly bill follows its start date, not a day picked for monthly
  await page.click('nav [data-v="more"]'); await page.click('main [data-v="bills"]'); await page.click('[data-a="new"][data-v="bills"]');
  await page.fill('[data-f="name"]', "Car tax"); await page.fill('[data-f="amount"]', "190"); await page.selectOption('[data-f="on"]', "9");
  await page.selectOption('[data-f="how"]', "week"); await page.waitForTimeout(100);
  check("every few weeks asks how many weeks", !!(await page.$('[data-f="every"]')) && !(await page.$('[data-f="on"]')));
  await page.selectOption('[data-f="how"]', "dates"); await page.waitForTimeout(100);
  check("on set dates asks for the dates", !!(await page.$('textarea[data-f="dates"]')));
  await page.selectOption('[data-f="how"]', "year"); await page.waitForTimeout(100);
  check("what was typed is kept when the form changes", (await page.inputValue('[data-f="name"]')) === "Car tax");
  await page.fill('[data-f="start"]', "2027-03-14"); await page.click('[data-a="editsave"]'); await page.waitForTimeout(1200);
  const ct = (await (await page.request.get("http://localhost:" + PORT + "/dump?bills")).json()).find(r => r.name === "Car tax");
  check("a yearly bill is on its start date", ct && ct.unit === "year" && !ct.on && ct.start === "2027-03-14", ct);
  // a new monthly bill's day follows its start date until you pick one
  await page.click('[data-a="new"][data-v="bills"]'); await page.fill('[data-f="name"]', "Window cleaner"); await page.fill('[data-f="amount"]', "12");
  await page.fill('[data-f="start"]', "2026-11-17"); await page.waitForTimeout(100);
  check("the day follows the start date", (await page.inputValue('[data-f="on"]')) === "17");
  await page.context().close();

  // 2b. a week after payday with the pots still to sort: Payday still shows this payday, and it can be ticked
  page = await newPage("2026-11-09");
  await page.goto(links.ethan); await page.waitForFunction(() => /Hi Ethan/.test(document.querySelector("#top").textContent), null, {timeout: 8000});
  check("Today still asks to sort the pay", /Sort your pay into pots/.test(T(await page.textContent("main"))));
  await page.click('nav [data-v="more"]'); await page.click('main [data-v="payday"]');
  const pdText = T(await page.textContent("main")), ticks = await page.$$eval('input[data-c="paytick"]', els => els.map(e => e.disabled));
  check("Payday shows the payday still to sort", /^Payday: Thu 29 Oct/.test(pdText) && ticks.length > 0 && ticks.every(x => !x), {pdText: pdText.slice(0, 80), ticks});
  // stopping a budget mid-month keeps it for this pay period (its money was sorted on payday)
  await page.click('nav [data-v="more"]'); await page.click('main [data-a="go"][data-v="settings"]'); await page.click('main [data-a="go"][data-v="list:budgets"]');
  await page.click('[data-a="edit"][data-v="budgets:e-fun"]'); check("a budget says when it stops", /Stop at next payday/.test(T(await page.textContent("main"))));
  await page.click('[data-a="editstop"]'); await page.waitForTimeout(1200);
  const fun = (await (await page.request.get("http://localhost:" + PORT + "/dump?budgets")).json()).find(r => r.id === "e-fun");
  await page.click('nav [data-v="today"]');
  check("a stopped budget ends with this pay period, and is still on Today", fun && fun.end === "2026-11-25" && /Fun/.test(T(await page.textContent(".grid2"))), fun);
  await page.context().close();
  // Coming up: a loan repayment can't be swiped to "didn't happen"; tapping it asks if it's been paid
  page = await newPage("2026-12-20");
  await page.goto(links.ethan); await page.waitForFunction(() => /Hi Ethan/.test(document.querySelector("#top").textContent), null, {timeout: 8000});
  const loanRow = await page.$('.swipe:has(.face[data-v="loan:sofa:2026-12-28"])');
  check("a loan repayment is in Coming up without swipe buttons", loanRow && !(await loanRow.$(".acts")));
  if (loanRow) { await page.click('.face[data-v="loan:sofa:2026-12-28"]'); await page.waitForTimeout(100); check("and tapping it asks if it's been paid", /It's been paid to me/.test(T(await page.textContent("#sheets")))); }
  await page.context().close();
  // Christmas pay comes early (moved to 24 Dec) after a pay rise: changing it starts from the new pay
  const kE = JSON.parse(Buffer.from(links.ethan.split("#connect=")[1], "base64url").toString()).k;
  page = await newPage("2026-12-26");
  await page.request.post("http://localhost:" + PORT + "/exec", {data: JSON.stringify({key: kE, ops: [{op: "put", table: "amounts", row: {id: "amt-rise", item: "e-pay", start: "2026-12-01", amount: 2600}}]})});
  await page.goto(links.ethan); await page.waitForFunction(() => /Hi Ethan/.test(document.querySelector("#top").textContent), null, {timeout: 8000});
  await page.click('nav [data-v="more"]'); await page.click('main [data-v="payday"]'); await page.click('[data-a="payedit"]'); await page.waitForTimeout(100);
  check("a moved payday's amount starts from the pay rise", (await page.inputValue("#payAmt")) === "2600", await page.inputValue("#payAmt"));
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
  const tx2 = await (await page.request.get("http://localhost:" + PORT + "/dump?transactions")).json(); console.log("sophie's offline payment reached the sheet:", tx2.some(r => r.person === "sophie" && +r.amount === 4));
  check("an offline payment reaches the sheet", tx2.some(r => r.person === "sophie" && +r.amount === 4));
  // a sync that never gets an answer gives up, and the next one goes through
  let held = null; await page.route("**/exec", r => { held = r; });
  await page.evaluate(() => { window.BudgieApp.sync(false); }); await page.waitForTimeout(300);
  const stuck = await page.evaluate(() => window.BudgieApp.S.syncing);
  await page.clock.fastForward(91000); await page.waitForTimeout(300);
  check("a sync with no answer stops after a while and says so", stuck && !(await page.evaluate(() => window.BudgieApp.S.syncing)) && /took too long/.test(await page.evaluate(() => window.BudgieApp.S.lastError)));
  await page.unroute("**/exec"); if (held) await held.abort().catch(() => {});
  await page.evaluate(() => window.BudgieApp.sync(false)); await page.waitForTimeout(1500);
  check("and the next sync works", await page.evaluate(() => !window.BudgieApp.S.lastError && !window.BudgieApp.S.syncing));
  await page.context().close();

  // 4. review fixes
  // the fingerprint lock still asks when Show and tell was left on (so turning it off can't get round the lock)
  page = await newPage("2026-11-02");
  await page.addInitScript(() => { if (!sessionStorage.getItem("seeded")) { sessionStorage.setItem("seeded", "1"); localStorage.setItem("budgie.lock", JSON.stringify({id: "AAAA", at: 1})); localStorage.setItem("budgie.prefs", JSON.stringify({demo: true})); } });
  await page.goto(links.ethan); await page.waitForTimeout(1500);
  check("Show and tell left on: Budgie is still locked", !!(await page.$("#lock")) && !/£/.test(T(await page.textContent("main"))) && !(await page.$("nav button")), T(await page.textContent("main")).slice(0, 80));
  await page.context().close();
  // a change the sheet couldn't save for a passing reason stays on the phone and goes up next time
  page = await newPage("2026-11-02");
  await page.goto(links.ethan); await page.waitForFunction(() => /Hi Ethan/.test(document.querySelector("#top").textContent), null, {timeout: 8000});
  let hiccup = true;
  await page.route("**/exec", async r => {
    const body = JSON.parse(r.request().postData() || "{}");
    if (!hiccup || !(body.ops || []).length) return r.continue();
    hiccup = false; const op = body.ops[0]; body.ops = [];
    const res = await r.fetch({postData: JSON.stringify(body)}), j = await res.json();
    j.rejected = [{i: 0, table: op.table, id: op.row ? op.row.id : op.id, error: "Service Spreadsheets timed out while accessing document", retry: true}];
    return r.fulfill({response: res, body: JSON.stringify(j)});
  });
  await page.click('nav [data-v="add"]'); await page.fill("#addAmt", "7.77"); await page.click('[data-a="addsave"]'); await page.waitForTimeout(1500);
  check("a hiccup keeps the payment waiting on the phone", await page.evaluate(() => window.BudgieApp.S.data.queue.length === 1) && !/turned down/.test(T(await page.textContent("#toast"))));
  await page.evaluate(() => window.BudgieApp.sync(false)); await page.waitForTimeout(1500);
  const tx7 = await (await page.request.get("http://localhost:" + PORT + "/dump?transactions")).json();
  check("and it reaches the sheet on the next sync", tx7.some(r => r.person === "ethan" && +r.amount === 7.77) && await page.evaluate(() => window.BudgieApp.S.data.queue.length === 0));
  await page.unroute("**/exec");
  // pennies: an amount typed with too many decimals is saved to the penny
  await page.click('nav [data-v="more"]'); await page.click('main [data-v="bills"]'); await page.click('[data-a="new"][data-v="bills"]');
  await page.fill('[data-f="name"]', "Climbing wall"); await page.fill('[data-f="amount"]', "12.345"); await page.click('[data-a="editsave"]'); await page.waitForTimeout(1200);
  const gym = (await (await page.request.get("http://localhost:" + PORT + "/dump?bills")).json()).find(r => r.name === "Climbing wall");
  check("a typed amount is kept to the penny", gym && +gym.amount === 12.35, gym && gym.amount);
  // a new link for the same person and sheet (a new key) keeps what's still waiting; someone else's doesn't take it
  await page.route("**/exec", r => r.abort());
  await page.click('nav [data-v="add"]'); await page.fill("#addAmt", "8.88"); await page.click('[data-a="addsave"]'); await page.waitForTimeout(800);
  check("(8.88 is waiting on the phone)", await page.evaluate(() => window.BudgieApp.S.data.queue.length === 1));
  await page.goto("about:blank"); await page.unroute("**/exec");
  const rk = await (await page.request.get("http://localhost:" + PORT + "/rekey?who=ethan")).json();
  await page.goto("about:blank"); await page.goto(rk.link); await page.waitForFunction(() => /Hi Ethan/.test(document.querySelector("#top").textContent), null, {timeout: 8000}); await page.waitForTimeout(1500);
  const tx8 = await (await page.request.get("http://localhost:" + PORT + "/dump?transactions")).json();
  check("a new key for the same person keeps the change made offline", tx8.some(r => r.person === "ethan" && +r.amount === 8.88), tx8.filter(r => r.person === "ethan").map(r => r.amount));
  await page.route("**/exec", r => r.abort());
  await page.click('nav [data-v="add"]'); await page.fill("#addAmt", "9.99"); await page.click('[data-a="addsave"]'); await page.waitForTimeout(800);
  check("(9.99 is waiting on the phone)", await page.evaluate(() => window.BudgieApp.S.data.queue.length === 1));
  await page.goto("about:blank"); await page.unroute("**/exec");
  await page.goto("about:blank"); await page.goto(links.sophie); await page.waitForFunction(() => /Hi Sophie/.test(document.querySelector("#top").textContent), null, {timeout: 8000}); await page.waitForTimeout(1500);
  const tx9 = await (await page.request.get("http://localhost:" + PORT + "/dump?transactions")).json();
  check("someone else's link doesn't send Ethan's change as them, and says so", !tx9.some(r => +r.amount === 9.99) && /1 change made as Ethan weren't sent/.test(T(await page.textContent("#toast"))), T(await page.textContent("#toast")));
  await page.evaluate(() => { window.BudgieApp.S.data.carry = {me: "x", name: "X", queue: [{op: "put", table: "transactions", row: {id: "t-c"}}]}; window.BudgieApp.go("sync"); });
  await page.click('[data-a="disconnect"]'); await page.waitForTimeout(100);
  check("Disconnect counts changes still carried over from an old link", /1 change hasn't reached your Google Sheet/.test(T(await page.textContent("#sheets"))));
  await page.request.get("http://localhost:" + PORT + "/rekey?who=ethan&k=" + rk.old);
  await page.context().close();

  // 5. review fixes (1.4.3)
  page = await newPage("2026-11-02");
  await page.goto(links.ethan); await page.waitForFunction(() => /Hi Ethan/.test(document.querySelector("#top").textContent), null, {timeout: 8000});
  // a loan is paid from the lender's account: the borrower isn't asked for one, and one picked before switching is dropped
  await page.evaluate(() => window.BudgieApp.go("debts")); await page.click('[data-a="new"][data-v="loans"]'); await page.waitForTimeout(100);
  const accIn = !!(await page.$('[data-f="account"]'));
  await page.fill('[data-f="name"]', "Bike"); await page.fill('[data-f="amount"]', "50"); await page.selectOption('[data-f="account"]', "e-food");
  await page.selectOption('[data-f="direction"]', "out"); await page.waitForTimeout(100);
  const accOut = !!(await page.$('[data-f="account"]')), keptName = await page.inputValue('[data-f="name"]');
  await page.click('[data-a="editsave"]'); await page.waitForTimeout(1500);
  const bike = (await (await page.request.get("http://localhost:" + PORT + "/dump?loans")).json()).find(r => r.name === "Bike");
  check("a loan you lent asks which account it came from; one you owe doesn't", accIn && !accOut && keptName === "Bike", {accIn, accOut, keptName});
  check("a loan you owe is saved without your account (it's the lender's to say)", bike && bike.lender === "sophie" && bike.borrower === "ethan" && !bike.account, bike);
  // a Full refresh tapped while a sync is on its way isn't lost: it runs once that one is done
  let heldR = null, fulls = 0;
  await page.route("**/exec", r => { const b = JSON.parse(r.request().postData() || "{}"); if (b.full) fulls++; if (!heldR && !b.action) { heldR = r; return; } return r.continue(); });
  await page.evaluate(() => { window.BudgieApp.sync(false); }); await page.waitForTimeout(200);
  await page.evaluate(() => { window.BudgieApp.sync(true); }); await page.waitForTimeout(200);
  const before = fulls; await heldR.continue(); await page.waitForTimeout(1500);
  check("a Full refresh asked for during a sync still happens", before === 0 && fulls === 1, {before, fulls});
  await page.unroute("**/exec");
  // whole pounds below zero read like pennies do: -£9,000, not £-9,000
  await page.evaluate(() => window.BudgieApp.go("pots")); await page.click('[data-a="potcheck"][data-v="e-main"]'); await page.fill("#potBal", "-20000"); await page.click('[data-a="potsave"]'); await page.waitForTimeout(300);
  await page.evaluate(() => window.BudgieApp.go("networth")); await page.waitForTimeout(200);
  const nwText = T(await page.textContent("main"));
  check("a negative net worth shows as -£…", /-£\d/.test(nwText) && !/£-/.test(nwText), nwText.slice(0, 160));
  await page.context().close();

  // 6. review fixes (1.4.4)
  page = await newPage("2026-11-02");
  await page.goto(links.ethan); await page.waitForFunction(() => /Hi Ethan/.test(document.querySelector("#top").textContent), null, {timeout: 8000});
  // a Google hiccup that lasts a while, with a few things logged during it, loses nothing
  let hiccups = 0;
  await page.route("**/exec", async r => {
    const body = JSON.parse(r.request().postData() || "{}");
    if (!(body.ops || []).length || hiccups >= 6) return r.continue();
    hiccups++; const sent = body.ops; body.ops = [];
    const res = await r.fetch({postData: JSON.stringify(body)}), j = await res.json();
    j.rejected = sent.map((op, i) => ({i, table: op.table, id: op.row ? op.row.id : op.id, error: i ? "Waiting for an earlier change" : "Service Spreadsheets timed out while accessing document", retry: true, notTried: i > 0}));
    return r.fulfill({response: res, body: JSON.stringify(j)});
  });
  for (const a of ["1.11", "2.22", "3.33", "4.44", "5.55"]) { await page.click('nav [data-v="add"]'); await page.fill("#addAmt", a); await page.click('[data-a="addsave"]'); await page.waitForTimeout(700); }
  await page.evaluate(() => window.BudgieApp.sync(false)); await page.waitForTimeout(1200);
  check("(the hiccup lasted six tries)", hiccups === 6, hiccups);
  await page.evaluate(() => window.BudgieApp.sync(false)); await page.waitForTimeout(1500);
  const txH = await (await page.request.get("http://localhost:" + PORT + "/dump?transactions")).json();
  check("a long hiccup with several payments logged during it loses none of them", ["1.11", "2.22", "3.33", "4.44", "5.55"].every(a => txH.some(r => r.person === "ethan" && +r.amount === +a)) && await page.evaluate(() => window.BudgieApp.S.data.queue.length === 0), txH.filter(r => r.person === "ethan").map(r => r.amount));
  await page.unroute("**/exec");
  // Hide amounts covers the amounts in To do's sentences too
  await page.evaluate(() => { const S = window.BudgieApp.S; S.prefs.hide = true; S.ui.reveal = false; window.BudgieApp.go("today"); });
  await page.waitForTimeout(200);
  const todoText = T(await page.textContent("main")), payText = await page.evaluate(() => { window.BudgieApp.go("payday"); return document.querySelector("main").textContent; });
  check("Hide amounts: no amounts anywhere on Today or Payday", !/£\d/.test(todoText) && !/£\d/.test(payText), {todoText: (todoText.match(/.{0,40}£\d.{0,10}/) || [""])[0], payText: (payText.match(/.{0,40}£\d.{0,10}/) || [""])[0]});
  // ...and the fixed amount in a split ("Sophie pays £500.00")
  const splitText = await page.evaluate(() => { window.BudgieApp.go("list", {table: "splits"}); return document.querySelector("main").textContent; });
  check("Hide amounts: a split's fixed amount is covered too", /pays £••••/.test(splitText) && !/£\d/.test(splitText), (splitText.match(/.{0,40}£.{0,10}/) || [""])[0]);
  // a peek (the eye) ends when Budgie goes into the background
  const away = (state) => page.evaluate(st => { Object.defineProperty(document, "visibilityState", {get: () => st, configurable: true}); document.dispatchEvent(new Event("visibilitychange")); }, state);
  await page.evaluate(() => window.BudgieApp.go("today")); await page.click('[data-a="reveal"]'); await page.waitForTimeout(100);
  const peeked = /£\d/.test(T(await page.textContent("main")));
  await away("hidden"); await page.waitForTimeout(100); await away("visible"); await page.waitForTimeout(300);
  check("Hide amounts: a peek ends when Budgie goes into the background", peeked && !/£\d/.test(T(await page.textContent("main"))) && await page.evaluate(() => window.BudgieApp.S.ui.reveal === false));
  await page.evaluate(() => { delete document.visibilityState; window.BudgieApp.S.prefs.hide = false; window.BudgieApp.go("today"); });
  // unticking a payday move only takes off your own moves
  const pk = "pay:2026-10-29:e-food";
  await page.evaluate(k => { const t = window.BudgieApp.S.data.tables; t.moves = (t.moves || []).concat([{id: "mv-hers", date: "2026-10-29", person: "sophie", from: "s-main", to: "s-lisa", amount: 1, key: k}]); window.BudgieApp.go("payday"); }, pk);
  await page.route("**/exec", r => r.abort());
  const box = await page.$(`[data-c="paytick"][data-v^="${pk}|"]`);
  const flip = (on) => page.evaluate(([k, on]) => { const el = document.querySelector('[data-c="paytick"][data-v^="' + k + '|"]'); el.checked = on; el.dispatchEvent(new Event("change", {bubbles: true})); }, [pk, on]);
  if (box) { await flip(true); await page.waitForTimeout(200); await flip(false); await page.waitForTimeout(300); }
  const dels = await page.evaluate(() => window.BudgieApp.S.data.queue.filter(o => o.op === "delete").map(o => o.id));
  check("unticking a payday move leaves the partner's move alone", !!box && dels.length === 1 && dels.indexOf("mv-hers") < 0, {box: !!box, dels});
  await page.unroute("**/exec");
  await page.context().close();
  // a phone left open past midnight (and offline) moves on to the new day
  page = await newPage("2026-11-02");
  await page.clock.install({time: new Date("2026-11-02T23:59:00")});
  await page.goto(links.ethan); await page.waitForFunction(() => /Hi Ethan/.test(document.querySelector("#top").textContent), null, {timeout: 8000});
  await page.route("**/exec", r => r.abort());
  const day0 = await page.evaluate(() => window.BudgieApp.db().today);
  await page.clock.fastForward(5 * 60000); await page.waitForTimeout(200);
  const day1 = await page.evaluate(() => window.BudgieApp.db().today);
  check("after midnight Budgie works from the new day", day0 === "2026-11-02" && day1 === "2026-11-03", {day0, day1});
  // the partner's summary from days ago doesn't say they're paid today
  await page.evaluate(() => { const S = window.BudgieApp.S; S.data.summary = Object.assign({}, S.data.summary, {nextPay: "2026-10-30"}); window.BudgieApp.go("partner"); });
  check("an old summary doesn't say the partner is paid today", !/Paid today/.test(T(await page.textContent("main"))), T(await page.textContent("main")).slice(0, 120));
  await page.unroute("**/exec");
  await page.context().close();

  // 7. review fixes (1.4.6)
  page = await newPage("2026-11-02");
  await page.goto(links.ethan); await page.waitForFunction(() => /Hi Ethan/.test(document.querySelector("#top").textContent), null, {timeout: 8000});
  await page.route("**/exec", r => r.abort());
  // a payment from the bank: its amount, date and account are the bank's, so only what it was for and the note can change
  await page.evaluate(() => { const t = window.BudgieApp.S.data.tables; t.transactions = (t.transactions || []).concat([{id: "bk-monzo-tx_ui", date: "2026-11-01", person: "ethan", amount: 9.99, budget: "e-fun", account: "e-main", note: "CINEMA", source: "monzo", bankId: "tx_ui", review: false}]); window.BudgieApp.setDemo(false); window.BudgieApp.go("payments", {start: "2026-10-29", budget: ""}); });
  await page.click('[data-a="payedit1"][data-v="bk-monzo-tx_ui"]'); await page.waitForTimeout(100);
  const locked = await page.evaluate(() => ["#peAmt", "#peAcc", "#peDate"].map(q => document.querySelector(q).disabled).concat([document.querySelector("#peBud").disabled, document.querySelector("#peNote").disabled]));
  check("a bank payment's amount, account and date can't be changed on the phone; what for and the note can", JSON.stringify(locked) === "[true,true,true,false,false]", locked);
  await page.fill("#peNote", "Cinema with Sophie"); await page.selectOption("#peBud", "e-food-b"); await page.click('[data-a="pesave"]'); await page.waitForTimeout(200);
  const sent = await page.evaluate(() => (window.BudgieApp.S.data.queue.filter(o => o.row && o.row.id === "bk-monzo-tx_ui").pop() || {}).row);
  check("and saving it sends what it was for and the note, with the bank's figures untouched", sent && sent.note === "Cinema with Sophie" && sent.budget === "e-food-b" && sent.amount === 9.99 && sent.date === "2026-11-01" && sent.account === "e-main", sent);
  // Hide amounts covers the things Budgie asks you to check
  await page.evaluate(() => { const S = window.BudgieApp.S; S.data.tables.settings.push({id: "ethan:check:ui", person: "ethan", key: "check:ui", value: JSON.stringify({t: "Is £50.00 right for Fun?", a: "go", v: "money"})}); S.prefs.hide = true; S.ui.reveal = false; window.BudgieApp.setDemo(false); window.BudgieApp.go("checks"); });
  const chk = T(await page.textContent("main"));
  check("Hide amounts: the things to check are covered too", /Is £•••• right for Fun/.test(chk) && !/£\d/.test(chk), chk.slice(0, 160));
  await page.evaluate(() => { window.BudgieApp.S.prefs.hide = false; });
  await page.unroute("**/exec");
  await page.context().close();

  // 8. review fixes (1.4.7)
  page = await newPage("2026-11-02");
  await page.goto(links.ethan); await page.waitForFunction(() => /Hi Ethan/.test(document.querySelector("#top").textContent), null, {timeout: 8000});
  // settings typed into the sheet without an id (the test sheet's start dates) are all kept, not one over the other
  check("settings without an id don't overwrite each other on the phone", await page.evaluate(() => window.BudgieApp.S.data.tables.settings.filter(r => !r.id && r.key === "start").map(r => r.person).sort().join()) === "ethan,sophie");
  // a peek ends in an open sheet too, not just on the screen behind it
  await page.evaluate(() => { const S = window.BudgieApp.S; S.prefs.hide = true; S.ui.reveal = true; window.BudgieApp.go("today"); });
  await page.click(".swipe .face"); await page.waitForTimeout(100);
  const sheetPeek = /£\d/.test(T(await page.textContent("#sheets")));
  const away2 = (state) => page.evaluate(st => { Object.defineProperty(document, "visibilityState", {get: () => st, configurable: true}); document.dispatchEvent(new Event("visibilitychange")); }, state);
  await away2("hidden"); await page.waitForTimeout(100);
  const sheetAfter = T(await page.textContent("#sheets")), labelAfter = await page.evaluate(() => (document.querySelector("#sheets [aria-label]") || {getAttribute: () => ""}).getAttribute("aria-label"));
  check("Hide amounts: a peek ends in an open sheet when Budgie goes into the background", sheetPeek && sheetAfter && !/£\d/.test(sheetAfter) && !/£\d/.test(labelAfter || ""), {sheetAfter: sheetAfter.slice(0, 80), labelAfter});
  await page.evaluate(() => { delete document.visibilityState; window.BudgieApp.S.prefs.hide = false; }); await page.keyboard.press("Escape");
  // the sheet not answering properly, or not being reached, is said in plain words
  await page.route("**/exec", r => r.fulfill({status: 200, contentType: "text/html", body: "<!DOCTYPE html><html><body>Sorry, unable to open the file at this time.</body></html>"}));
  await page.evaluate(() => window.BudgieApp.sync(false)); await page.waitForTimeout(400);
  const oddErr = await page.evaluate(() => window.BudgieApp.S.lastError);
  await page.unroute("**/exec"); await page.route("**/exec", r => r.abort("internetdisconnected"));
  await page.evaluate(() => window.BudgieApp.sync(false)); await page.waitForTimeout(400);
  const netErr = await page.evaluate(() => window.BudgieApp.S.lastError);
  check("a page from Google instead of an answer is said in plain words", /didn't answer properly/.test(oddErr) && !/token|JSON/i.test(oddErr), oddErr);
  check("not reaching the sheet is said in plain words", /Couldn't reach your Google Sheet/.test(netErr) && !/fetch/i.test(netErr), netErr);
  await page.unroute("**/exec");
  // a look that isn't one of Budgie's (typed into the sheet as "constructor") doesn't break the app
  const errN = errs.length;
  await page.evaluate(() => { const S = window.BudgieApp.S; S.prefs.special = "constructor"; S.prefs.colour = "toString"; window.BudgieApp.go("today"); });
  await page.waitForTimeout(150);
  check("an unknown look is just the standard one", errs.length === errN && /Hi Ethan/.test(T(await page.textContent("#top"))), errs.slice(errN));
  await page.evaluate(() => { const S = window.BudgieApp.S; S.prefs.special = ""; S.prefs.colour = ""; });
  await page.context().close();
  // long titles fit at 320px, and on the couple's own phones (384 and 412px wide): two lines at most, nothing cut off
  const cut = [];
  for (const width of [320, 384, 412]) {
    const ctx = await browser.newContext({viewport: {width, height: 640}, isMobile: true, hasTouch: true, locale: "en-GB", timezoneId: "Europe/London", serviceWorkers: "block"});
    page = await ctx.newPage(); await page.clock.install({time: new Date("2026-11-02T19:30:00")});
    await page.goto(links.ethan); await page.waitForFunction(() => /Hi Ethan/.test(document.querySelector("#top").textContent), null, {timeout: 8000});
    for (const [s, p] of [["sharing", null], ["bank", null], ["edit", "income"], ["edit", "transfers"], ["edit", "loans"]]) {
      await page.evaluate(([s, p]) => { if (p) { document.querySelector("#main").insertAdjacentHTML("beforeend", '<button id="zz" type="button" data-a="new" data-v="' + p + '">x</button>'); document.querySelector("#zz").click(); } else window.BudgieApp.go(s); }, [s, p]);
      await page.waitForTimeout(80);
      const r = await page.evaluate(() => { const h = document.querySelector("#top h1"); return {t: h.textContent, cut: h.scrollWidth > h.clientWidth + 1 || h.scrollHeight > h.clientHeight + 1}; });
      if (r.cut) cut.push(width + ": " + r.t);
    }
    await ctx.close();
  }
  check("long titles aren't cut off at 320px", !cut.some(x => /^320/.test(x)), cut);
  check("or at 384 and 412px", !cut.length, cut);
  // a LISA bonus that's late says it was due, rather than "by" a day that's gone
  page = await newPage("2026-11-02");
  await page.goto("http://localhost:" + PORT + "/"); await page.click('[data-a="demo"][data-v="on"]'); await page.waitForTimeout(150);
  await page.click('nav [data-v="more"]'); await page.click('main [data-v="lisa"]'); await page.waitForTimeout(100);
  const lisaT = T(await page.textContent("main"));
  check("a late LISA bonus says when it was due", /the first was due by/.test(lisaT) && !/the first by (Mon|Tue|Wed|Thu|Fri|Sat|Sun) \d+ (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct)\b/.test(lisaT), (lisaT.match(/Bonus on its way[^.]*\./) || [""])[0]);
  await page.context().close();

  // ===== review 2026-10-27b (1.4.8) =====
  // "Didn't happen", Undo, then "Didn't happen" again: the second one counts (its id is the same as the first's)
  {
    page = await newPage("2026-11-02");
    await page.goto(links.ethan); await page.waitForFunction(() => /Hi Ethan/.test(document.querySelector("#top").textContent), null, {timeout: 8000});
    // (the first of his own things in Coming up)
    const occKey = await page.evaluate(() => { const f = [...document.querySelectorAll(".swipe")].find(x => x.querySelector(".acts") && /@/.test(x.querySelector(".face").dataset.v)); return f ? f.querySelector(".face").dataset.v : ""; });
    const face = '.swipe .face[data-v="' + occKey + '"]', skip = '#sheets [data-a="occdo"][data-v="skip|' + occKey + '"]', exId = "x-" + occKey.replace("@", "-") + "-skip";
    const skipIt = async () => { await page.click(face); await page.waitForTimeout(80); await page.click(skip); await page.waitForTimeout(80); };
    await skipIt(); await page.click('#toast [data-a="undo"]'); await page.waitForTimeout(800);
    await skipIt(); await page.waitForTimeout(1200);
    const ex = (await (await page.request.get("http://localhost:" + PORT + "/dump?exceptions")).json()).filter(r => r.id === exId);
    check("Didn't happen again after an Undo counts, on the phone", !(await page.$(face)), T(await page.textContent("main")).slice(0, 200));
    check("and in the sheet", !!occKey && ex.length === 1 && ex[0].deleted !== true && ex[0].action === "skip", {occKey, ex});
    // a sharing setting that was taken off (in the sheet, say) can be turned on again from the app
    const kE2 = JSON.parse(Buffer.from(links.ethan.split("#connect=")[1], "base64url").toString()).k;
    await page.request.post("http://localhost:" + PORT + "/exec", {data: JSON.stringify({key: kE2, ops: [{op: "put", table: "settings", row: {id: "ethan:share.payments", person: "ethan", key: "share.payments", value: "false"}}, {op: "delete", table: "settings", id: "ethan:share.payments"}]})});
    await page.evaluate(() => window.BudgieApp.sync(true)); await page.waitForTimeout(800);
    await page.evaluate(() => window.BudgieApp.go("sharing")); await page.waitForTimeout(100);
    await page.click('input[data-c="share"][data-v="payments"]'); await page.waitForTimeout(1200);
    const sp = (await (await page.request.get("http://localhost:" + PORT + "/dump?settings")).json()).filter(r => r.id === "ethan:share.payments");
    check("a sharing setting taken off can be turned on again", sp.length === 1 && sp[0].deleted !== true && /^true$/i.test(String(sp[0].value)) && await page.isChecked('input[data-c="share"][data-v="payments"]'), sp);
    await page.click('input[data-c="share"][data-v="payments"]'); await page.waitForTimeout(800);
    // a phone whose key has been changed (a new one made after a lost phone) is told what to do, in plain words
    await page.route("**/exec", r => r.fulfill({status: 200, contentType: "application/json", body: JSON.stringify({ok: false, error: "Wrong app key"})}));
    await page.evaluate(() => window.BudgieApp.sync(false)); await page.waitForTimeout(400);
    const keyErr = await page.evaluate(() => window.BudgieApp.S.lastError);
    await page.unroute("**/exec");
    check("an old link's key is said in plain words", /connect link/.test(keyErr) && !/app key/i.test(keyErr), keyErr);
    await page.context().close();
  }

  // ===== review 2026-10-27c (1.4.9) =====
  // a Space that will run short before payday, with the money in the main account: ticking the move To do suggests saves it
  {
    page = await newPage("2026-11-02");
    await page.goto(links.sophie); await page.waitForFunction(() => /Hi Sophie/.test(document.querySelector("#top").textContent), null, {timeout: 8000});
    await page.evaluate(() => { document.querySelector("#sheets").innerHTML = ""; window.BudgieApp.go("pots"); });
    await page.click('[data-a="potcheck"][data-v="s-main"]'); await page.fill("#potBal", "2000"); await page.click('[data-a="potsave"]'); await page.waitForTimeout(1200);
    await page.click('nav [data-v="today"]'); await page.waitForTimeout(100);
    const fillText = T(await page.textContent("main")), n0 = errs.length;
    await page.click('input[data-c="tick"]'); await page.waitForTimeout(1500);
    const fm = (await (await page.request.get("http://localhost:" + PORT + "/dump?moves")).json()).filter(r => r.person === "sophie" && /^fill:s-rent:/.test(r.key));
    check("a move to fill a Space before a payment is in To do", /Move £640\.00 from Main account to Rent & bills Space/.test(fillText), fillText.slice(0, 200));
    check("and ticking it saves it", errs.length === n0 && fm.length === 1 && +fm[0].amount === 640 && fm[0].from === "s-main" && fm[0].to === "s-rent", {errs: errs.slice(n0), fm});
    check("and it leaves To do", !/Move £640\.00 from Main account/.test(T(await page.textContent("main"))));
    // the Bills calendar shows what's due on the last day of the month (her side income on the last working day)
    await page.evaluate(() => window.BudgieApp.go("bills")); await page.waitForTimeout(100);
    const lastDay = await page.$('[data-a="calday"][data-v="2026-11-30"]'), dot = lastDay ? await lastDay.evaluate(el => el.classList.contains("has")) : false;
    if (lastDay) { await lastDay.click(); await page.waitForTimeout(100); }
    check("the calendar shows what's due on the last day of the month", dot && /Side income/.test(T(await page.textContent("#sheets"))), T(await page.textContent("#sheets")).slice(0, 120));
    await page.context().close();
  }
  // an amount typed with too many decimals into a real pay, a bill's real amount, a balance or the LISA's paid-in is
  // kept to the penny, as everywhere else
  {
    page = await newPage("2026-11-20");
    await page.goto(links.ethan); await page.waitForFunction(() => /Hi Ethan/.test(document.querySelector("#top").textContent), null, {timeout: 8000});
    await page.evaluate(() => { document.querySelector("#sheets").innerHTML = ""; window.BudgieApp.go("payday"); });
    await page.click('[data-a="payedit"]'); await page.fill("#payAmt", "2412.345"); await page.click('[data-a="paysave"]'); await page.waitForTimeout(200);
    await page.evaluate(() => window.BudgieApp.go("today")); await page.waitForTimeout(100);
    const occ2 = await page.evaluate(() => { const f = [...document.querySelectorAll(".swipe")].find(x => x.querySelector(".acts")); return f ? f.querySelector(".face").dataset.v : ""; });
    await page.click('.swipe .face[data-v="' + occ2 + '"]'); await page.waitForTimeout(80); await page.click('#sheets [data-a="occdo"][data-v="amount|' + occ2 + '"]'); await page.waitForTimeout(80);
    await page.fill("#occAmt", "20.555"); await page.click('[data-a="occsave"][data-v="amount"]'); await page.waitForTimeout(200);
    await page.evaluate(() => window.BudgieApp.go("pots")); await page.click('[data-a="potcheck"][data-v="e-food"]'); await page.fill("#potBal", "40.125"); await page.click('[data-a="potsave"]'); await page.waitForTimeout(200);
    await page.evaluate(() => window.BudgieApp.go("lisa")); await page.click('[data-a="lisapaid"][data-v="e-lisa"]'); await page.fill("#lisaPaid", "1000.005"); await page.click('[data-a="lisapaidsave"]'); await page.waitForTimeout(1500);
    const dump = async t => (await (await page.request.get("http://localhost:" + PORT + "/dump?" + t)).json());
    const exs = await dump("exceptions"), vals = await dump("valuations"), sets = await dump("settings");
    const pay = exs.find(r => r.item === "e-pay" && r.action === "amount" && +r.amount > 2412 && +r.amount < 2413), bill = exs.find(r => r.id === "x-" + occ2.replace("@", "-") + "-amount"), food = vals.filter(r => r.account === "e-food").pop(), paid = sets.find(r => r.id === "ethan:lisa.paidBefore.e-lisa");
    check("typed amounts are kept to the penny", pay && +pay.amount === 2412.35 && bill && +bill.amount === 20.56 && food && +food.amount === 40.13 && paid && +paid.value === 1000.01, {pay: pay && pay.amount, bill: bill && bill.amount, food: food && food.amount, paid: paid && paid.value});
    await page.context().close();
  }

  // ===== review 2026-10-27d (1.4.10) =====
  // a bill's real amount is for the one that came in (not the next one due), and says which; one left empty isn't saved as £0
  {
    page = await newPage("2026-11-20");
    await page.goto(links.ethan); await page.waitForFunction(() => /Hi Ethan/.test(document.querySelector("#top").textContent), null, {timeout: 8000});
    await page.evaluate(() => { document.querySelector("#sheets").innerHTML = ""; window.BudgieApp.go("add"); });
    await page.click('[data-a="addmode"][data-v="bill"]'); await page.click('[data-a="addpick"][data-v="bill:e-flat"]');
    await page.fill("#addAmt", "431.20"); await page.click('[data-a="addsave"]'); await page.waitForTimeout(150);
    const said = T(await page.textContent("#toast"));
    check("a bill's real amount is for the one that came in, and says which", /Household bills on Sun 1 Nov saved as £431\.20/.test(said), said);
    await page.waitForTimeout(1500); const ex4 = (await (await page.request.get("http://localhost:" + PORT + "/dump?exceptions")).json()).filter(r => r.item === "e-flat" && r.action === "amount");
    check("(saved for 1 Nov, not 1 Dec)", ex4.length === 1 && ex4[0].date === "2026-11-01" && +ex4[0].amount === 431.2, ex4);
    await page.evaluate(() => window.BudgieApp.go("today")); await page.waitForTimeout(100);
    const occ3 = await page.evaluate(() => { const f = [...document.querySelectorAll(".swipe")].find(x => x.querySelector(".acts")); return f ? f.querySelector(".face").dataset.v : ""; });
    await page.click('.swipe .face[data-v="' + occ3 + '"]'); await page.waitForTimeout(80); await page.click('#sheets [data-a="occdo"][data-v="amount|' + occ3 + '"]'); await page.waitForTimeout(80);
    await page.fill("#occAmt", ""); await page.click('[data-a="occsave"][data-v="amount"]'); await page.waitForTimeout(1500);
    const ex3 = (await (await page.request.get("http://localhost:" + PORT + "/dump?exceptions")).json()).filter(r => r.id === "x-" + occ3.replace("@", "-") + "-amount");
    check("an empty real amount isn't saved as £0", !ex3.some(r => +r.amount === 0), ex3);
    await page.context().close();
  }

  // ===== review 2026-10-27 (1.4.12) =====
  const kE12 = JSON.parse(Buffer.from(links.ethan.split("#connect=")[1], "base64url").toString()).k;
  const hiE = p => p.waitForFunction(() => /Hi Ethan/.test(document.querySelector("#top").textContent), null, {timeout: 8000});
  // a payday move ticked after you've checked that pot's balance since payday is dated the day it's ticked, so it counts
  // on top of that balance (dated payday, it would count as already in it); one with no check since stays on payday
  {
    page = await newPage("2027-01-30");
    await page.goto(links.ethan); await hiE(page);
    await page.evaluate(() => { document.querySelector("#sheets").innerHTML = ""; window.BudgieApp.go("pots"); }); await page.waitForTimeout(100);
    await page.click('[data-a="potcheck"][data-v="e-bills"]'); await page.fill("#potBal", "12.34"); await page.click('[data-a="potsave"]'); await page.waitForTimeout(1500);
    await page.context().close();
    page = await newPage("2027-02-01");
    await page.goto(links.ethan); await hiE(page);
    await page.evaluate(() => { document.querySelector("#sheets").innerHTML = ""; window.BudgieApp.go("payday"); }); await page.waitForTimeout(150);
    for (const to of ["e-bills", "e-lisa"]) { const sel = 'input[data-c="paytick"][data-v^="pay:2027-01-28:' + to + '|"]'; if (await page.$(sel)) { await page.click(sel); await page.waitForTimeout(200); } }
    await page.waitForTimeout(1500);
    const mv = (await (await page.request.get("http://localhost:" + PORT + "/dump?moves")).json()).filter(r => r.person === "ethan" && /^pay:2027-01-28:e-(bills|lisa)$/.test(r.key)).map(r => [r.key, r.date]).sort();
    check("a payday move ticked after a balance check of that pot is dated the day it's ticked", JSON.stringify(mv) === JSON.stringify([["pay:2027-01-28:e-bills", "2027-02-01"], ["pay:2027-01-28:e-lisa", "2027-01-28"]]), mv);
    await page.context().close();
  }
  // payday before money that comes later in the month (Sophie's repayment on the 28th), in a month too tight to hold
  // it back from the Cash ISA: the Emergency pot covers Main until then, and the payday screen says how much is only that
  {
    page = await newPage("2026-12-24");
    await page.request.post("http://localhost:" + PORT + "/exec", {data: JSON.stringify({key: kE12, ops: [
      {op: "put", table: "budgets", row: {id: "e-bed12", person: "ethan", name: "Bed", amount: 2600, mode: "oneoff", account: "e-car", start: "2026-12-20", end: "2027-01-20"}},
      {op: "put", table: "transactions", row: {id: "t-fun12", date: "2026-12-20", person: "ethan", amount: 600, budget: "e-fun", account: "e-main"}}]})});
    await page.goto(links.ethan); await hiE(page);
    await page.evaluate(() => { document.querySelector("#sheets").innerHTML = ""; window.BudgieApp.go("payday"); }); await page.waitForTimeout(150);
    const t12 = T(await page.textContent("main"));
    check("the payday screen says how much of the gap is only until money comes in later", /of it is only until Sophie's Sofa repayment comes in on Mon 28 Dec\./.test(t12), t12.slice(0, 500));
    await page.context().close();
  }

  // what you owe your partner at payday stays in Main for settling up, and the payday screen says so
  {
    const kS12 = JSON.parse(Buffer.from(links.sophie.split("#connect=")[1], "base64url").toString()).k;
    page = await newPage("2027-02-25");
    await page.request.post("http://localhost:" + PORT + "/exec", {data: JSON.stringify({key: kS12, ops: [{op: "put", table: "transactions", row: {id: "t-owe12", date: "2027-02-20", person: "sophie", amount: 2000, budget: "s-food", account: "s-main", split: "half"}}]})});
    await page.goto(links.ethan); await hiE(page);
    await page.evaluate(() => { document.querySelector("#sheets").innerHTML = ""; window.BudgieApp.go("payday"); }); await page.waitForTimeout(150);
    const t13 = T(await page.textContent("main"));
    check("the payday screen says what you owe stays in Main for settling up", /£[\d,]+\.\d\d you owe Sophie stays in your Main account for settling up\./.test(t13), t13.slice(0, 600));
    await page.context().close();
  }

  // money owed both ways shows on the Debts screen for both of you, with what a loan is made of when its notes list it
  {
    const kS13 = JSON.parse(Buffer.from(links.sophie.split("#connect=")[1], "base64url").toString()).k;
    page = await newPage("2027-02-26");
    await page.request.post("http://localhost:" + PORT + "/exec", {data: JSON.stringify({key: kS13, ops: [{op: "put", table: "loans", row: {id: "l-dress12", lender: "sophie", borrower: "ethan", name: "Clothes", amount: 50, date: "2027-02-20", notes: "Dress £30; Shoes £20"}}]})});
    await page.goto(links.ethan); await hiE(page);
    await page.evaluate(() => { document.querySelector("#sheets").innerHTML = ""; window.BudgieApp.go("debts"); }); await page.waitForTimeout(150);
    const t14 = T(await page.textContent("main"));
    check("Ethan's Debts screen shows what Sophie lent him and what he lent her", /Clothes£50\.00You owe Sophie/.test(t14) && /Sofa£[\d,.]+Sophie owes you/.test(t14), t14.slice(0, 400));
    check("and the parts a loan's notes list", /Dress £30\s*Shoes £20/.test(await page.innerText('[data-v="loans:l-dress12"]')), await page.innerText('[data-v="loans:l-dress12"]'));
    await page.context().close();
  }

  // Between you two counts the loans too, from either side: what's left each way and the next repayment
  {
    page = await newPage("2026-11-02");
    await page.goto(links.ethan); await hiE(page);
    await page.evaluate(() => { document.querySelector("#sheets").innerHTML = ""; window.BudgieApp.go("partner"); }); await page.waitForTimeout(150);
    const t15 = T(await page.textContent("main"));
    check("Ethan's Between you two says what Sophie owes him in loans, and when the next repayment is", /Sophie owes you £600\.00 in loans ?Next £200\.00 on Mon 28 Dec/.test(t15) && /You owe Sophie £[\d,]+\.\d\d in loans/.test(t15) && !/You're all square/.test(t15), t15.slice(t15.indexOf("Between"), t15.indexOf("Between") + 300));
    check("and the shared bills line says it's only about those", /(All square on shared bills|owes you £[\d,.]+ for shared bills|You owe Sophie £[\d,.]+ for shared bills)/.test(t15), t15.slice(t15.indexOf("Between"), t15.indexOf("Between") + 200));
    if (await page.$('[data-a="info"][data-v="between"]')) { await page.click('[data-a="info"][data-v="between"]'); await page.waitForTimeout(100); } // (by selector: a sync can re-draw the screen in between)
    check("how it's worked out is behind the (i)", /Shared bills are split by your rules/.test(await page.textContent("#sheets")));
    await page.context().close();
    page = await newPage("2026-11-02");
    await page.goto(links.sophie); await page.waitForFunction(() => /Hi Sophie/.test(document.querySelector("#top").textContent), null, {timeout: 8000});
    await page.evaluate(() => { document.querySelector("#sheets").innerHTML = ""; window.BudgieApp.go("partner"); }); await page.waitForTimeout(150);
    const t16 = T(await page.textContent("main"));
    check("Sophie's says what she owes Ethan and when", /You owe Ethan £600\.00 in loans ?Next £200\.00 on Mon 28 Dec/.test(t16) && /Ethan owes you £[\d,]+\.\d\d in loans/.test(t16), t16.slice(t16.indexOf("Between"), t16.indexOf("Between") + 300));
    await page.context().close();
  }
  // Today in the short first month: it says so, and where Main's spare money goes on payday; tapping the hero opens
  // the pots, each one now against where it should be
  {
    page = await newPage("2026-10-28");
    await page.goto(links.ethan); await hiE(page);
    await page.evaluate(() => { document.querySelector("#sheets").innerHTML = ""; window.BudgieApp.go("today"); }); await page.waitForTimeout(150);
    await page.evaluate(() => { document.querySelector("#sheets").innerHTML = ""; });
    const hero = T(await page.textContent(".hero"));
    check("the hero says why it's a short month", /A short month: you started Budgie on Mon 26 Oct\./.test(hero), hero);
    check("and where the spare in Main goes", /£[\d,]+\.\d\d spare in your Main account goes to your Cash ISA on payday\./.test(hero), hero);
    check("the weekly note is behind an (i), not always on show", !/isn't counted as over/.test(T(await page.textContent("main"))) && !!(await page.$('[data-a="info"][data-v="pace"]')));
    await page.setViewportSize({width: 360, height: 800}); await page.waitForTimeout(100);
    const vals = await page.$$eval(".tile .v", els => els.map(v => [v.textContent, Math.round(v.getBoundingClientRect().height), parseFloat(getComputedStyle(v).fontSize)]));
    check("each Today tile's value is on one line", vals.length && vals.every(v => v[1] < v[2] * 1.6), vals);
    await page.click(".hero"); await page.waitForTimeout(150);
    const pots = T(await page.textContent("main"));
    check("tapping the hero opens the pots", /What should be where|Should be across/.test(T(await page.textContent("#top")) + pots), pots.slice(0, 120));
    check("each pot says how far it is from where it should be", /Should be £[\d,]+\.\d\d: £[\d,]+\.\d\d (below|above), see To do|Where it should be/.test(pots) && (await page.$$('[data-a="potcheck"]')).length === (pots.match(/Should be £[\d,]+\.\d\d: |Where it should be/g) || []).length, pots.slice(0, 600));
    await page.context().close();
  }
  // Money (1.4.17): it says what it's for, each section's title says what it answers, and each kind of money (coming
  // in, bills, spending, saving) has its own colour wherever it shows, in light and dark. A "what's left" saving with
  // nothing in the short first month says when it starts, and the savings show what they're worth, with an Update.
  {
    const kinds = () => { const cs = getComputedStyle(document.documentElement); return ["in", "bill", "spend", "save"].map(k => cs.getPropertyValue("--k-" + k).trim()); };
    const rgb = hex => { const n = parseInt(hex.slice(1), 16); return "rgb(" + (n >> 16) + ", " + (n >> 8 & 255) + ", " + (n & 255) + ")"; };
    const pounds = s => +String(s).replace(/[£,]/g, "");
    for (const scheme of ["light", "dark"]) {
      const ctx = await browser.newContext({...devices["Pixel 7"], locale: "en-GB", timezoneId: "Europe/London", serviceWorkers: "block", colorScheme: scheme});
      page = await ctx.newPage(); await page.clock.install({time: new Date("2026-10-28T19:30:00")});
      await page.goto(links.ethan); await hiE(page);
      // (once the first sync is done, so it can't re-draw the screen while it's being read)
      await page.waitForFunction(() => !window.BudgieApp.S.syncing && window.BudgieApp.S.lastSync, null, {timeout: 8000}); await page.waitForTimeout(300);
      await page.evaluate(() => { document.querySelector("#sheets").innerHTML = ""; window.BudgieApp.S.ui.monthOff = 0; window.BudgieApp.go("money"); }); await page.waitForTimeout(150);
      const t17 = T(await page.textContent("main"));
      const heads = await page.$$eval("main .card h2", hs => hs.map(h => h.textContent.trim()));
      check("Money says what it's for (" + scheme + ")", /Your plan, payday to payday/.test(T(await page.textContent("#top"))), T(await page.textContent("#top")));
      check("each section says what it answers (" + scheme + ")", ["Where it goes", "Coming in", "What you can spend", "What's saved"].every(h => heads.includes(h)), heads);
      check("the short first month's dates say why it's short", /Started Tue 27 Oct · ends Wed 28 Oct|Started Mon 26 Oct · ends Wed 28 Oct/.test(t17), t17.slice(0, 200));
      check("the Cash ISA's nothing this month says when it starts, and what it's worth", /Cash ISA ?Starts on payday: £[\d,]+\.\d\d ?£[\d,]+\.\d\d ?Update/.test(t17), t17.slice(t17.indexOf("What's saved"), t17.indexOf("What's saved") + 300));
      check("no short-first-month sentence to puzzle over", !/short first month/.test(t17));
      // the colours: four different ones, from the theme, the same on each section's chip and in the key
      const ks = await page.evaluate(kinds), want = scheme === "light" ? ["#1F7A4D", "#6B4FBB", "#2369A8", "#B07A12"] : ["#6FD39C", "#B8A3F2", "#7DB8EE", "#EBC064"];
      check("each kind of money has its own colour (" + scheme + ")", JSON.stringify(ks) === JSON.stringify(want), ks);
      const chips = await page.evaluate(() => [...document.querySelectorAll("main .kchip")].map(c => [c.className.replace("kchip ", ""), getComputedStyle(c).color]));
      check("each section's chip is its kind's colour (" + scheme + ")", chips.length >= 3 && chips.every(([k, c]) => c === ({"k-in": rgb(want[0]), "k-bill": rgb(want[1]), "k-spend": rgb(want[2]), "k-save": rgb(want[3])})[k]), chips);
      const dots = await page.evaluate(() => [...document.querySelectorAll("main .legend .kdot")].map(d => getComputedStyle(d).backgroundColor));
      check("the key uses the same colours (" + scheme + ")", JSON.stringify(dots) === JSON.stringify(want.map(rgb)), dots);
      const spendBars = await page.evaluate(() => [...document.querySelectorAll("main .card .bar > i")].map(i => getComputedStyle(i).backgroundColor));
      check("spending's bars are spending's colour (" + scheme + ")", spendBars.length >= 2 && spendBars.every(c => c === rgb(want[2])), spendBars);
      // the key adds up: what comes in is what goes out plus what's left over
      const leg = await page.$$eval("main .legend > div b", ns => ns.map(n => n.textContent)), left = (t17.match(/£([\d,]+\.\d\d) left over/) || [0, "0"])[1];
      check("where it goes adds up", Math.abs(pounds(leg[0]) - pounds(leg[1]) - pounds(leg[2]) - pounds(leg[3]) - pounds(left)) < 0.011, [leg, left]);
      if (scheme === "light") {
        // next month has bills, coloured as bills, and the year view jumps to a month
        await page.click('[data-a="month"][data-v="1"]'); await page.waitForTimeout(100);
        check("next month has its bills to pay", (await page.$$eval("main .card h2", hs => hs.map(h => h.textContent.trim()))).includes("Bills to pay"));
        await page.click('[data-a="moneyview"][data-v="year"]'); await page.waitForTimeout(100);
        check("the year view says what it's for", /Your plan for the year/.test(T(await page.textContent("#top"))));
        await page.click('[data-a="moneyjump"][data-v="2"]'); await page.waitForTimeout(100);
        check("tapping a month in the year opens it", /Dec 2026/.test(T(await page.textContent("main"))) && !!(await page.$('[data-a="moneyview"][data-v="month"][aria-pressed="true"]')));
        await page.evaluate(() => { window.BudgieApp.S.ui.monthOff = 0; window.BudgieApp.go("today"); }); await page.waitForTimeout(100);
        check("Today's spending bars are spending's colour", (await page.evaluate(() => [...document.querySelectorAll(".tile .bar > i")].map(i => getComputedStyle(i).backgroundColor))).every(c => c === rgb(want[2])));
        check("the hero says why the first month is short", /A short month: you started Budgie on Mon 26 Oct\./.test(T(await page.textContent(".hero"))), T(await page.textContent(".hero")));
      }
      await ctx.close();
    }
    // Sophie's too
    page = await newPage("2026-10-28");
    await page.goto(links.sophie); await page.waitForFunction(() => /Hi Sophie/.test(document.querySelector("#top").textContent), null, {timeout: 8000});
    await page.evaluate(() => { document.querySelector("#sheets").innerHTML = ""; window.BudgieApp.S.ui.monthOff = 0; window.BudgieApp.go("money"); }); await page.waitForTimeout(150);
    const hs = await page.$$eval("main .card h2", h => h.map(x => x.textContent.trim()));
    check("Sophie's Money has the same sections", ["Where it goes", "Coming in", "Bills to pay", "What you can spend", "What's saved"].every(h => hs.includes(h)), hs);
    await page.context().close();
    // the Cash ISA's Update asks what it's worth and shows it straight away (in Show and tell, so nothing is saved)
    page = await newPage("2026-10-28");
    await page.goto("http://localhost:" + PORT + "/"); await page.waitForSelector("main"); await page.click('[data-a="demo"][data-v="on"]'); await page.waitForTimeout(150);
    await page.evaluate(() => window.BudgieApp.go("money")); await page.waitForTimeout(100);
    await page.click('[data-a="potcheck"][data-v="a-isa"]'); await page.waitForTimeout(100);
    const sh = T(await page.textContent("#sheets"));
    check("the Cash ISA's Update asks what it's worth in the provider's app", /Cash ISA ?What's it worth in your provider's app today\?/.test(sh) && /Worth/.test(sh) && !!(await page.$("#potDate")), sh);
    await page.fill("#potBal", "4321.99"); await page.click('[data-a="potsave"]'); await page.waitForTimeout(150);
    check("and the new value shows in what's saved", /Cash ISA(?:(?!Update).)*£4,321\.99 ?Update/.test(T(await page.textContent("main"))), T(await page.textContent("main")).slice(-400));
    await page.context().close();
  }
  // going over a budget, once the move that covers it is ticked, isn't "Over budget" any more: it says what it was
  {
    page = await newPage("2026-10-27");
    await page.request.post("http://localhost:" + PORT + "/exec", {data: JSON.stringify({key: kE12, ops: [{op: "put", table: "transactions", row: {id: "t-over12", date: "2026-10-27", person: "ethan", amount: 40, budget: "e-fun", account: "e-main"}}]})});
    await page.goto(links.ethan); await hiE(page);
    await page.evaluate(() => { document.querySelector("#sheets").innerHTML = ""; window.BudgieApp.go("today"); }); await page.waitForTimeout(150);
    check("over a budget and not covered yet: Over budget", T(await page.textContent(".hero .pill")) === "Over budget", T(await page.textContent(".hero .pill")));
    const covSel = 'input[data-c="tick"][aria-label*="from Emergency pot to Main account"]'; // (by selector: a sync can re-draw To do in between)
    if (await page.$(covSel)) { await page.click(covSel); await page.waitForTimeout(400); }
    await page.evaluate(() => { document.querySelector("#sheets").innerHTML = ""; });
    check("once covered, it names what went over instead", T(await page.textContent(".hero .pill")) === "Fun covered", T(await page.textContent(".hero .pill")));
    await page.click(".hero"); await page.waitForTimeout(150);
    check("and the pots say what it was and what covered it", /You went £[\d,]+\.\d\d over your Fun budget\. Your Emergency pot covered it/.test(T(await page.textContent("main"))), T(await page.textContent("main")).slice(0, 300));
    await page.context().close();
  }
  // the category buttons on Add fit at 320px and 360px with Larger text, long names and all
  {
    const rq = await browser.newContext();
    await rq.request.post("http://localhost:" + PORT + "/exec", {data: JSON.stringify({key: kE12, ops: ["Eating out", "Subscriptions", "Christmas presents", "Haircuts & beauty", "Household bits"].map((n, i) => ({op: "put", table: "budgets", row: {id: "e-fit12" + i, person: "ethan", name: n, amount: 30, account: "e-main", start: "2027-02-01"}}))})});
    await rq.close();
    for (const width of [320, 360]) {
      const ctx = await browser.newContext({viewport: {width, height: 760}, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: "en-GB", timezoneId: "Europe/London", serviceWorkers: "block"});
      page = await ctx.newPage(); await page.clock.install({time: new Date("2027-03-02T19:30:00")});
      await page.goto(links.ethan); await hiE(page);
      await page.evaluate(() => window.BudgieApp.go("themes")); await page.waitForTimeout(80); await page.click('[data-a="tsize"][data-v="larger"]'); await page.waitForTimeout(100);
      await page.evaluate(() => { document.querySelector("#sheets").innerHTML = ""; window.BudgieApp.go("add"); }); await page.waitForTimeout(150);
      const off = await page.$$eval(".budtile", bs => bs.flatMap(b => { const bb = b.getBoundingClientRect(); return [...b.querySelectorAll("span,svg")].filter(s => { const r = s.getBoundingClientRect(); return r.left < bb.left + 1 || r.right > bb.right - 1 || s.scrollWidth > s.clientWidth + 1; }).map(s => s.textContent); }));
      const more = await page.evaluate(() => { const b = document.querySelector(".budtile.others"); return b ? getComputedStyle(b).display + " " + getComputedStyle(b).flexDirection : [...document.querySelectorAll(".budtile")].map(x => x.textContent).join(","); });
      check("Add's category buttons fit at " + width + "px with Larger text", off.length === 0 && (await page.$$(".budtile")).length >= 6, off);
      check("and the More button is laid out like the others at " + width + "px", more === "flex column", more);
      await ctx.close();
    }
  }

  // ===== polish 2026-10-27 (1.4.15): on every screen and sheet, at 320, 384 and 412px, with Larger text and with the
  // phone's text at 130%, no button's text runs past its edge, no one-line button wraps, no row of buttons is ragged
  // (all on one line, even lines, or one under another) and nothing is wider than the screen. Long names, big amounts.
  {
    const kS = JSON.parse(Buffer.from(links.sophie.split("#connect=")[1], "base64url").toString()).k, ex = (key, ops) => page.request.post("http://localhost:" + PORT + "/exec", {data: JSON.stringify({key, ops})});
    page = await newPage("2027-03-02");
    await ex(kE12, [{op: "put", table: "people", row: {id: "ethan", name: "Ethan Whitfield", bank: "Monzo", potWord: "pot", partner: "sophie"}},
      {op: "put", table: "accounts", row: {id: "e-pz1", owner: "ethan", name: "Gifts & birthdays pot", kind: "pot", order: 6, purpose: "Christmas, birthdays and anniversaries"}},
      {op: "put", table: "accounts", row: {id: "e-pz2", owner: "ethan", name: "Saving Challenge (2026)", kind: "saving", order: 7}},
      {op: "put", table: "accounts", row: {id: "e-pz3", owner: "ethan", name: "Moneybox cash ISA", kind: "isa", order: 10}},
      {op: "put", table: "valuations", row: {id: "v-pz3", account: "e-pz3", date: "2027-02-27", amount: 12653.14}},
      {op: "put", table: "budgets", row: {id: "e-pzb", person: "ethan", name: "Gifts & birthdays", amount: 60, mode: "oneoff", account: "e-pz1"}},
      {op: "put", table: "bills", row: {id: "e-pzi", person: "ethan", name: "Car insurance (MultiCar)", amount: 1265.31, account: "e-car", unit: "year", start: "2027-03-20", category: "insurance"}},
      {op: "put", table: "loans", row: {id: "l-pz", lender: "ethan", borrower: "sophie", name: "Saving Challenge (2026)", amount: 12653.14, date: "2027-02-01", repay: 450, repayFrom: "2027-03-28", repayDay: "28"}},
      {op: "put", table: "transactions", row: {id: "t-pzr", date: "2027-03-01", person: "ethan", amount: 12653.14, account: "e-main", note: "SAINSBURYS SUPERMARKETS LTD 0123", review: true, source: "monzo"}}]);
    await ex(kS, [{op: "put", table: "people", row: {id: "sophie", name: "Sophie Marchetti", bank: "Starling", potWord: "Space", partner: "ethan"}}]);
    await page.context().close();
    const bank = {provider: "monzo", connected: true, lastSync: Date.parse("2027-03-02T19:00:00Z"), accounts: [{extId: "a1", name: "Personal account", kind: "main", balance: 12653.14, mappedTo: "e-main"},
      {extId: "a2", name: "Gifts & birthdays pot", kind: "pot", balance: 212.5}, {extId: "a3", name: "Holiday to Lanzarote with Sophie", kind: "pot", balance: 0, mappedTo: ""}]};
    // the phone's text size (Android scales the text, not the page): every font size in the page, times z
    const textScale = z => { if (z === 1) return; const sc = v => String(v).replace(/(\d*\.?\d+)px/g, (m, n) => (n * z).toFixed(2) + "px"), sp = CSSStyleDeclaration.prototype.setProperty;
      CSSStyleDeclaration.prototype.setProperty = function (k, v, p) { return sp.call(this, k, k === "--fs" ? sc(v) : v, p); };
      const walk = r => { if (r.cssRules) [...r.cssRules].forEach(walk); if (r.style && r.style.fontSize) r.style.fontSize = sc(r.style.fontSize); };
      const inl = () => document.querySelectorAll('[style*="font-size"]').forEach(el => { if (el.__z !== el.getAttribute("style")) { el.style.fontSize = sc(el.style.fontSize); el.__z = el.getAttribute("style"); } });
      document.addEventListener("DOMContentLoaded", () => { [...document.styleSheets].forEach(walk); inl(); new MutationObserver(inl).observe(document.body, {childList: true, subtree: true}); }); };
    const problems = () => {
      const T = s => (s || "").replace(/\s+/g, " ").trim(), out = [], vw = document.documentElement.clientWidth;
      const shown = el => el.getClientRects().length > 0 && getComputedStyle(el).visibility !== "hidden" && !el.closest(".swipe:not(.open) .acts");
      const texts = el => { const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT), a = []; while (w.nextNode()) if (w.currentNode.data.trim()) a.push(w.currentNode); return a; };
      const rects = n => { const r = document.createRange(); r.selectNodeContents(n); return [...r.getClientRects()].filter(x => x.width > 0.5); };
      const where = el => (el.closest("#sheets") ? "sheet " : "") + T(el.getAttribute("aria-label") || el.textContent).slice(0, 50);
      if (document.documentElement.scrollWidth > vw + 1) out.push("wider than the screen");
      document.querySelectorAll("button, a.btn, .chip, .detail, .pill, select").forEach(el => {
        if (!shown(el)) return;
        const r = el.getBoundingClientRect(), cs = getComputedStyle(el);
        if (el.tagName === "SELECT") { const c = document.createElement("canvas").getContext("2d"); c.font = cs.fontWeight + " " + cs.fontSize + " " + cs.fontFamily; [...el.options].forEach(o => { if (c.measureText(o.text).width + parseFloat(cs.paddingLeft) + 22 > el.clientWidth + 1) out.push("cut off: " + o.text); }); return; }
        if (r.right > vw + 1 || r.left < -1) out.push("off the screen: " + where(el));
        // text past the edge (a few pixels into the padding is fine)
        const L = r.left + Math.max(0, parseFloat(cs.paddingLeft) - 4), R = r.right - Math.max(0, parseFloat(cs.paddingRight) - 4);
        if (el.scrollWidth > el.clientWidth + 1 || texts(el).some(n => rects(n).some(x => x.right > R + 0.5 || x.left < L - 0.5))) out.push("runs past its edge: " + where(el));
        // a one-line button on more than one line
        if (!el.matches(".li, .tile, .budtile, .hero, .more button, .theme-card, .banner, .card, .cal button, .face") && !el.closest(".li, .tile, .budtile, .hero, .theme-card, .more") && !el.querySelector("br, div, p, .what")) {
          const mids = []; texts(el).forEach(n => rects(n).forEach(x => { const m = (x.top + x.bottom) / 2; if (!mids.some(t => Math.abs(t - m) < x.height * 0.45)) mids.push(m); }));
          if (mids.length > 1) out.push("wraps: " + where(el));
        }
      });
      // a row of buttons: one line, lines that each have as many and fill the width, or the first alone above even lines
      const BTN = ".btn, a.btn, .chip, .detail, .seg > button, .linkbtn, .swatches > button, .budtile";
      new Set([...document.querySelectorAll(BTN)].filter(shown).map(e => e.parentElement)).forEach(P => {
        const kids = [...P.children].filter(k => shown(k) && k.matches(BTN) && getComputedStyle(k).position !== "absolute"); if (kids.length < 2) return;
        const rows = []; kids.forEach(k => { const r = k.getBoundingClientRect(), row = rows.find(x => Math.abs(x.top - r.top) < Math.min(r.height, x.h) / 2); if (row) row.n.push(r); else rows.push({top: r.top, h: r.height, n: [r]}); });
        if (rows.length < 2) return;
        const cs = getComputedStyle(P), pr = P.getBoundingClientRect(), L = pr.left + P.clientLeft + parseFloat(cs.paddingLeft), R = pr.left + P.clientLeft + P.clientWidth - parseFloat(cs.paddingRight);
        const full = rows.every(x => Math.abs(Math.min(...x.n.map(q => q.left)) - L) <= 2 && Math.abs(Math.max(...x.n.map(q => q.right)) - R) <= 2 && Math.max(...x.n.map(q => q.width)) - Math.min(...x.n.map(q => q.width)) < 2);
        const cnt = rows.map(x => x.n.length), rest = cnt.slice(1), even = cnt.every(c => c === cnt[0]) || (cnt[0] === 1 && rest.every(c => c === rest[0]));
        if (!full || (!even && !kids.every(k => k.matches(".budtile, .swatches > button")))) out.push("ragged: " + cnt.join("+") + " " + kids.map(k => T(k.textContent) || k.getAttribute("aria-label")).join(" | ").slice(0, 90));
      });
      return out;
    };
    const screens = ["today", "money", "add", "partner", "more", "payday", "pots", "bills", "goals", "lisa", "house", "networth", "debts", "insights", "gifts", "settings", "themes", "bank", "review", "linked", "emailset", "sharing", "sync", "importcsv", "list:income", "list:budgets", "list:accounts", "list:splits"];
    // [screen, what to tap for a sheet or form] (each tap is a data-a, and data-v if given)
    const taps = [["add", "adddatepick"], ["add", "addsplit2"], ["add", "addmode:bill"], ["today", "who"], ["payday", "payedit"], ["pots", "potcheck"], ["partner", "settle"], ["lisa", "lisapaid"], ["bank", "bankoff"], ["review", "revmore"], ["linked", "applink:peckish"],
      ["list:budgets", "edit"], ["list:income", "new:income"], ["bills", "new:bills"], ["bills", "edit"], ["list:accounts", "new:accounts"], ["list:splits", "new:splits"], ["list:transfers", "new:transfers"], ["debts", "new:loans"], ["goals", "new:goals"], ["gifts", "new:gifts"], ["list:budgets", "new:budgets"]];
    const found = {};
    for (const [w, size, z] of [[320, "normal", 1], [320, "larger", 1], [384, "normal", 1], [384, "larger", 1], [412, "normal", 1], [412, "larger", 1], [384, "normal", 1.3], [412, "normal", 1.3], [295, "normal", 1]]) {
      const tag = w + "px " + size + (z !== 1 ? " text " + z * 100 + "%" : "");
      for (const who of ["ethan", "sophie", "demo"]) {
        const ctx = await browser.newContext({viewport: {width: w, height: 760}, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: "en-GB", timezoneId: "Europe/London", serviceWorkers: "block"});
        await ctx.route("**/exec", r => /"bank\.status"/.test(r.request().postData() || "") ? r.fulfill({contentType: "application/json", body: JSON.stringify({ok: true, bank})}) : r.continue());
        await ctx.addInitScript(textScale, z); await ctx.addInitScript(() => { try { localStorage.setItem("budgie.checkSeen", JSON.stringify("2027-03-02")); } catch (e) {} });
        page = await ctx.newPage(); await page.clock.install({time: new Date("2027-03-02T19:30:00")});
        if (who === "demo") { await page.goto("http://localhost:" + PORT + "/"); await page.waitForSelector("main"); (found[tag + " connect"] = await page.evaluate(problems)); await page.click('[data-a="demo"][data-v="on"]'); }
        else { await page.goto(links[who]); await page.waitForFunction(() => /Hi /.test(document.querySelector("#top").textContent), null, {timeout: 8000}); }
        await page.evaluate(sz => { window.BudgieApp.S.prefs.size = sz; }, size);
        const goTo = s => page.evaluate(s => { const u = window.BudgieApp.S.ui; Object.assign(u, {money: "month", monthOff: 0, calOff: 0}); if (u.add) u.add.mode = "spend"; document.querySelector("#sheets").innerHTML = ""; if (/^list:/.test(s)) window.BudgieApp.go("list", {table: s.slice(5)}); else window.BudgieApp.go(s); }, s);
        for (const s of screens) { await goTo(s); await page.waitForTimeout(s === "bank" || s === "linked" ? 150 : 20); found[tag + " " + who + " " + s] = await page.evaluate(problems); }
        await goTo("money"); await page.click('[data-a="moneyview"][data-v="year"]'); found[tag + " " + who + " money year"] = await page.evaluate(problems);
        for (const [s, t] of taps) {
          await goTo(s); await page.waitForTimeout(s === "bank" || s === "linked" ? 150 : 20);
          const [a, v] = t.split(":"), sel = '[data-a="' + a + '"]' + (v ? '[data-v="' + v + '"]' : "");
          if (!(await page.$("#main " + sel + ", #sheets " + sel))) continue;
          await page.evaluate(sel => document.querySelector("#main " + sel + ", #sheets " + sel).click(), sel); await page.waitForTimeout(a === "applink" ? 300 : 40);
          found[tag + " " + who + " " + s + " > " + t] = await page.evaluate(problems);
        }
        await ctx.close();
      }
    }
    const bad = Object.entries(found).filter(x => x[1].length).map(x => x[0] + ": " + [...new Set(x[1])].join("; "));
    check("no button runs past its edge, wraps or sits in a ragged row, at 320 to 412px, Larger text and 130% text", !bad.length, bad.slice(0, 12));
    check("(and the check covered the screens)", Object.keys(found).length > 600, Object.keys(found).length);
  }

  console.log(errs.length ? "ERRORS:\n" + errs.join("\n") : "No errors");
  console.log(fails.length ? "FAIL\n  " + fails.join("\n  ") : "All checks passed");
  process.exitCode = fails.length ? 1 : 0;
  await browser.close();
})();
