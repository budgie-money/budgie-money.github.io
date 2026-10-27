// Budgie at its real addresses (routed to the local test server): CSP, connect-link checks, Linked apps, the move.
const { chromium, devices } = require("playwright");
const PORT = process.env.PORT || 8790;
const links = require(__dirname + "/.links.json");
const T = s => (s || "").replace(/\s+/g, " ").trim();
const keyOf = l => JSON.parse(Buffer.from(l.split("#connect=")[1], "base64url").toString()).k;
const mk = (home, u, k) => home + "#connect=" + Buffer.from(JSON.stringify({u, k})).toString("base64url");
const SHEET = "https://script.google.com/macros/s/TEST/exec";
const out = [], fail = [];
const ok = (name, cond, extra) => { (cond ? out : fail).push(name + (cond ? "" : " :: " + JSON.stringify(extra || "").slice(0, 300))); };
async function setup(b, slowHome) {
  const ctx = await b.newContext({...devices["Pixel 7"], locale: "en-GB", serviceWorkers: "block"});
  const csp = [], errs = [];
  await ctx.route("https://alertrobot.github.io/budgie/**", r => route(r, new URL(r.request().url()).pathname.replace(/^\/budgie/, "")));
  await ctx.route("https://budgie-money.github.io/**", async r => { if (slowHome) await new Promise(res => setTimeout(res, slowHome)); return route(r, new URL(r.request().url()).pathname); });
  await ctx.route("https://script.google.com/**", async r => {
    if (!r.request().url().startsWith(SHEET)) return r.fulfill({status: 404, body: "no"});
    const res = await r.fetch({url: "http://localhost:" + PORT + "/exec"}); return r.fulfill({response: res, headers: {...res.headers(), "access-control-allow-origin": "*"}});
  });
  await ctx.route(/fonts\.(googleapis|gstatic)\.com/, r => r.fulfill({status: 200, body: ""}));
  async function route(r, path) { const res = await r.fetch({url: "http://localhost:" + PORT + "" + (path || "/")}); return r.fulfill({response: res}); }
  const watch = p => { p.on("console", m => { if (/Content Security Policy|Refused to/i.test(m.text())) csp.push(m.text()); }); p.on("pageerror", e => errs.push(e.message)); };
  return {ctx, csp, errs, watch};
}
(async () => {
  const b = await chromium.launch();
  const kE = keyOf(links.ethan);
  // 1) the new home: connect, every screen, no CSP complaints
  {
    const {ctx, csp, errs, watch} = await setup(b), p = await ctx.newPage(); watch(p);
    await p.goto(mk("https://budgie-money.github.io/", SHEET, kE)); await p.waitForFunction(() => /Hi /.test(document.querySelector("#top").textContent), null, {timeout: 15000}); await p.waitForTimeout(800);
    ok("new home connects to a Google Sheet address", /Hi Ethan/.test(T(await p.textContent("#top"))));
    if (await p.$("#sheets .sheet")) await p.click('#sheets [data-a="sheetclose"]');
    for (const s of ["today", "add", "bills", "insights", "lisa", "goals", "settings", "bank", "emailset", "linked", "sharing", "payments"]) { await p.evaluate(s => BudgieApp.go(s), s).catch(() => {}); await p.waitForTimeout(250); }
    // Linked apps: make a Peckish link
    await p.evaluate(() => BudgieApp.go("linked")); await p.waitForTimeout(300);
    const linkedText = T(await p.textContent("#main"));
    ok("Linked apps screen shows both apps", /Peckish/.test(linkedText) && /Caledonite/.test(linkedText), linkedText.slice(0, 200));
    const btn = await p.$('[data-a="applink"][data-v="peckish"]');
    if (btn) { await btn.click(); await p.waitForTimeout(1200); }
    const all = await p.evaluate(() => (document.querySelector("#appLinkOut") || {}).value || document.body.innerText);
    const m = all.match(/https:\/\/alertrobot\.github\.io\/es-kitchen\/#connect=[A-Za-z0-9_-]+/);
    ok("Link Peckish makes a Peckish link with its own limited key", !!m && /^app_peckish_[0-9a-f]{64}$/.test(keyOf(m[0])), all.slice(0, 300));
    // a link pointing somewhere that isn't Google: refused
    await p.goto("about:blank"); await p.goto(mk("https://budgie-money.github.io/", "https://evil.example/exec", kE)); await p.waitForTimeout(1200);
    await p.waitForTimeout(300);
    const ev = T(await p.textContent("#toast"));
    ok("a link to a non-Google address is refused, and says so", /doesn.t point at a Google Sheet/.test(ev) && await p.evaluate(s => JSON.parse(localStorage.getItem("budgie.cfg")).u === s, SHEET) && !/#connect/.test(p.url()), ev);
    for (const [u, why] of [["http://script.google.com/macros/s/TEST/exec", "plain http"], ["http://localhost:" + PORT + "/exec", "this computer"]]) {
      await p.goto("about:blank"); await p.goto(mk("https://budgie-money.github.io/", u, kE)); await p.waitForTimeout(1200);
      ok("refused: " + why, /doesn.t point at a Google Sheet/.test(T(await p.textContent("#toast"))));
    }
    await p.goto("about:blank"); await p.goto(mk("https://budgie-money.github.io/", SHEET, "app_peckish_" + "a".repeat(64))); await p.waitForTimeout(1200);
    ok("refused: another app's link", /another app/.test(T(await p.textContent("#toast"))) && await p.evaluate(k => JSON.parse(localStorage.getItem("budgie.cfg")).k === k, kE));
    // a link to a different Google Sheet: asks first, and keeps the current one
    await p.goto("about:blank"); await p.goto(mk("https://budgie-money.github.io/", "https://script.google.com/macros/s/OTHER/exec", kE)); await p.waitForTimeout(1200);
    ok("a link to a different sheet asks first", /Switch to a different sheet\?/.test(T(await p.textContent("#sheets"))));
    ok("and the phone keeps its own sheet meanwhile", await p.evaluate(s => JSON.parse(localStorage.getItem("budgie.cfg")).u === s, SHEET));
    ok("no CSP complaints at the new home", csp.length === 0, csp);
    ok("no page errors at the new home", errs.length === 0, errs);
    await ctx.close();
  }
  // 2) the old home: shows the moved screen, carries the phone across, wipes its old copy
  {
    const {ctx, csp, errs, watch} = await setup(b), p = await ctx.newPage(); watch(p);
    await p.goto("https://alertrobot.github.io/budgie/");
    await p.evaluate(([u, k]) => { localStorage.setItem("budgie.cfg", JSON.stringify({u, k})); localStorage.setItem("budgie.theme", JSON.stringify("x")); }, [SHEET, kE]);
    await p.reload(); await p.waitForTimeout(1500);
    const moved = T(await p.textContent("#main"));
    ok("old home shows Budgie has moved", /Budgie has moved/.test(T(await p.textContent("#top"))) && /budgie-money\.github\.io/.test(moved), moved.slice(0, 200));
    ok("old home shows no money", !/£/.test(moved));
    await p.evaluate(() => window.BudgieApp.render()); await p.waitForTimeout(200);
    ok("old home stays the moved screen when it redraws (after a sync while moving)", /Budgie has moved/.test(T(await p.textContent("#top"))) && !/£/.test(T(await p.textContent("#main"))) && !(await p.$("nav button")));
    await p.click('[data-a="moveme"]');
    await p.waitForURL(/budgie-money\.github\.io/, {timeout: 15000});
    await p.waitForFunction(() => /Hi /.test(document.querySelector("#top").textContent), null, {timeout: 15000});
    ok("the phone lands at the new home, connected", /Hi Ethan/.test(T(await p.textContent("#top"))) && !/#connect=/.test(p.url()), p.url());
    const p2 = await ctx.newPage(); await p2.goto("https://alertrobot.github.io/budgie/"); await p2.waitForTimeout(800);
    const left = await p2.evaluate(async () => ({ls: Object.keys(localStorage).filter(k => /^budgie\./.test(k)), dbs: indexedDB.databases ? (await indexedDB.databases()).map(d => d.name) : []}));
    ok("nothing of Budgie's is left at the old address", left.ls.length === 0 && left.dbs.indexOf("budgie") < 0, left);
    ok("no CSP complaints at the old home", csp.length === 0, csp);
    ok("no page errors at the old home", errs.length === 0, errs);
    await ctx.close();
  }
  // 3) the old home with Show and tell left on and a payment still waiting: moving across still sends it first
  {
    const {ctx, csp, errs, watch} = await setup(b), p = await ctx.newPage(); watch(p);
    await p.goto("https://alertrobot.github.io/budgie/");
    await p.evaluate(([u, k]) => new Promise(res => {
      localStorage.setItem("budgie.cfg", JSON.stringify({u, k})); localStorage.setItem("budgie.prefs", JSON.stringify({demo: true}));
      const r = indexedDB.open("budgie", 1); r.onupgradeneeded = () => r.result.createObjectStore("kv");
      r.onsuccess = () => { const tx = r.result.transaction("kv", "readwrite"); tx.objectStore("kv").put({tables: {}, since: 0, me: "ethan", queue: [{op: "put", table: "transactions", row: {id: "t-waiting-move", date: "2026-10-26", person: "ethan", amount: 3.21, budget: "e-fun", account: "e-main"}}]}, "data"); tx.oncomplete = () => { r.result.close(); res(); }; };
    }), [SHEET, kE]);
    await p.reload(); await p.waitForTimeout(1200);
    await p.click('[data-a="moveme"]');
    let landed = true; await p.waitForURL(/budgie-money\.github\.io/, {timeout: 15000}).catch(() => { landed = false; });
    const tx = await (await p.request.get("http://localhost:" + PORT + "/dump?transactions")).json();
    ok("Show and tell left on at the old home doesn't stop a waiting payment going across", landed && tx.some(r => r.id === "t-waiting-move"), {landed, toast: T(await p.textContent("#toast").catch(() => ""))});
    ok("no page errors moving with Show and tell on", errs.length === 0, errs);
    await ctx.close();
  }
  // 4) moving across when the sheet turns a waiting change down (so Budgie fetches everything again straight after)
  // and the new address is slow to open: nothing that sync brings back is saved at the old address
  {
    const {ctx, errs, watch} = await setup(b, 2500), p = await ctx.newPage(); watch(p);
    await p.goto("https://alertrobot.github.io/budgie/");
    await p.evaluate(([u, k]) => new Promise(res => {
      localStorage.setItem("budgie.cfg", JSON.stringify({u, k}));
      const r = indexedDB.open("budgie", 1); r.onupgradeneeded = () => r.result.createObjectStore("kv");
      r.onsuccess = () => { const tx = r.result.transaction("kv", "readwrite"); tx.objectStore("kv").put({tables: {}, since: Date.now() - 60000, me: "ethan", queue: [{op: "put", table: "transactions", row: {id: "t-refused-move", date: "2026-10-26", person: "ethan", amount: 1, budget: "e-fun", account: "s-main"}}]}, "data"); tx.oncomplete = () => { r.result.close(); res(); }; };
    }), [SHEET, kE]);
    await p.reload(); await p.waitForTimeout(1200);
    // (watched from a page at the old address that stays open: anything written there after the wipe shows up)
    const old = await ctx.newPage(); await old.goto("https://alertrobot.github.io/budgie/"); await old.waitForTimeout(300);
    await p.click('[data-a="moveme"]');
    await p.waitForURL(/budgie-money\.github\.io/, {timeout: 20000}).catch(() => {});
    await old.waitForTimeout(500);
    const left = await old.evaluate(() => Object.keys(localStorage).filter(k => /^budgie\./.test(k)));
    ok("a sync still on its way while moving saves nothing at the old address", left.length === 0, left);
    ok("no page errors moving while the sheet turns a change down", errs.length === 0, errs);
    await ctx.close();
  }
  // 5) the old home with a key that's been changed since (a new one made after a lost phone): moving says why it can't,
  // rather than blaming the phone signal
  {
    const {ctx, errs, watch} = await setup(b), p = await ctx.newPage(); watch(p);
    await p.goto("https://alertrobot.github.io/budgie/");
    await p.evaluate(([u, k]) => new Promise(res => {
      localStorage.setItem("budgie.cfg", JSON.stringify({u, k}));
      const r = indexedDB.open("budgie", 1); r.onupgradeneeded = () => r.result.createObjectStore("kv");
      r.onsuccess = () => { const tx = r.result.transaction("kv", "readwrite"); tx.objectStore("kv").put({tables: {}, since: 0, me: "ethan", queue: [{op: "put", table: "transactions", row: {id: "t-old-key", date: "2026-10-26", person: "ethan", amount: 2, budget: "e-fun", account: "e-main"}}]}, "data"); tx.oncomplete = () => { r.result.close(); res(); }; };
    }), [SHEET, "b".repeat(64)]);
    await p.reload(); await p.waitForTimeout(1200);
    await p.click('[data-a="moveme"]');
    await p.waitForFunction(() => /connect link|signal/.test(document.querySelector("#toast").textContent), null, {timeout: 20000}).catch(() => {});
    const said = T(await p.textContent("#toast"));
    ok("moving with a changed key says the link has stopped working, not the signal", /connect link/.test(said) && !/signal/.test(said) && /alertrobot/.test(p.url()), said);
    ok("no page errors moving with a changed key", errs.length === 0, errs);
    await ctx.close();
  }
  console.log("PASS\n  " + out.join("\n  ")); console.log("FAIL\n  " + fail.join("\n  ")); process.exitCode = fail.length ? 1 : 0;
  await b.close();
})();
