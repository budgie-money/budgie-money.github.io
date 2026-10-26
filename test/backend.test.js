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
ok("budget tab has sections", ["Money in", "Bills", "Spending", "Savings"].every(x => eb.includes(x)), eb);

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

// #5 the one-file backend (apps-script/Budgie.gs, made by migrate/build.js) must be built from the current files
{
  const fs = require("fs"), path = require("path"), dir = path.join(__dirname, ".."), bundle = path.join(dir, "apps-script/Budgie.gs");
  if (fs.existsSync(bundle)) {
    const b = fs.readFileSync(bundle, "utf8"), parts = ["engine.js", "apps-script/Code.gs", "apps-script/Prices.gs", "apps-script/BankFeeds.gs", "apps-script/Extras.gs"].filter(f => fs.existsSync(path.join(dir, f)));
    const stale = parts.filter(f => b.indexOf(fs.readFileSync(path.join(dir, f), "utf8")) < 0);
    ok("#5 Budgie.gs is up to date (run node migrate/build.js)", !stale.length, stale);
  }
}
console.log(fails ? fails + " failed, " + passes + " passed" : "All " + passes + " passed");
process.exit(fails ? 1 : 0);
