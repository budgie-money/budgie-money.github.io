// Cooldown: the engine's rules and the sheet's privacy for parked purchases. Every name and amount is invented.
// Run with: node test/cooldown.test.js
const assert = require("assert"), B = require("../engine"), fixture = require("./fixture"), makeEnv = require("./fake-gas.js");
let n = 0;
const eq = (a, b, s) => { assert.deepStrictEqual(a, b, s); n++; }, ok = (v, s) => { assert(v, s); n++; };

// cooling periods by price, and the change of heart rule
eq([0, 14.99, 15, 49.99, 50, 149.99, 150, 399.99, 400, 2000].map(B.coolDays), [1, 1, 3, 3, 7, 7, 14, 14, 30, 30], "days by price");
eq([[5, 4], [5, 3], [4, 4], [4, 3], [3, 3], [3, 2], [2, 2], [2, 1], [1, 1], [5, 5]].map(x => B.coolKeep(x[0], x[1])), [true, false, true, false, true, false, true, false, true, true], "kept unless below the lower of the first score and 4");

// a household: £150 a pay period of Fun (daily) in Main, an example savings account linked to a car goal
function house(rows) {
  const t = fixture();
  t.accounts.push({id: "e-save", owner: "ethan", name: "Example savings", kind: "saving", order: 6});
  t.valuations.push({id: "v-save", account: "e-save", date: "2026-10-26", amount: 900});
  t.goals.push({id: "g-car", owners: "ethan", name: "Example car", target: 2500, accounts: "e-save", kind: "car"});
  t.cooldown = rows;
  return t;
}
const row = (id, o) => Object.assign({id, person: "ethan", name: "Example " + id, hype: 4, status: "cooling", date: "2026-11-02"}, o);
const at = (t, d) => { const db = B.load(t, d); return {db, v: B.cooldown(db, "ethan", d)}; };
const get = (v, id) => v.items.find(x => x.id === id);

{
  const t = house([row("a", {price: 12, source: "e-fun"}), row("b", {price: 180, source: "e-fun"}), row("c", {price: 40, source: "next"}), row("d", {price: 300, source: "e-save"}), row("e", {price: 20, source: "e-fun", days: 10})]);
  let {v} = at(t, "2026-11-02");
  eq(v.items.map(x => x.days), [1, 14, 3, 14, 10], "suggested days, and a period set by hand");
  eq(v.items.map(x => x.state), ["cooling", "cooling", "cooling", "cooling", "cooling"], "everything cools first, affordable or not");
  eq(get(v, "a").readyOn, "2026-11-03", "1 day: green the next day");
  ({v} = at(t, "2026-11-03"));
  eq(get(v, "a").state, "ready", "time up and Fun can cover £12");
  ok(get(v, "a").afford && get(v, "a").has >= 12 && get(v, "a").sourceName === "Fun", "says what Fun has");
  ({v} = at(t, "2026-11-16"));
  const b = get(v, "b");
  eq(b.state, "waiting", "time up but Fun can't cover £180 yet: cooled, waiting for money");
  ok(b.has < 180 && b.has >= 0, "and shows what Fun has: " + b.has);
  ({v} = at(t, "2026-11-09"));
  eq(get(v, "c").state, "waiting", "next month: waiting until payday");
  eq(get(v, "c").payday, "2026-11-26", "payday after it was parked (last Thursday of November)");
  eq(at(t, "2026-11-26").v.items.find(x => x.id === "c").state, "ready", "and green on payday");
  ({v} = at(t, "2026-11-16"));
  const d = get(v, "d");
  eq([d.state, d.kind, d.has], ["ready", "saving", 900], "savings: green when the account has the money");
  eq(d.goals.map(g => [g.id, g.car, g.linked, g.saved, g.after, g.target]), [["g-car", true, true, 900, 600, 2500]], "and its effect on the car goal");
}

// live numbers: spending logged (or brought in by the bank feed) stops an item going green
{
  const t = house([row("a", {price: 12, source: "e-fun"})]);
  t.transactions.push({id: "t-spent", date: "2026-11-02", person: "ethan", amount: 100, budget: "e-fun", account: "e-main"});
  t.transactions.push({id: "t-bank", date: "2026-11-02", person: "ethan", amount: 60, budget: "e-fun", account: "e-main", bankId: "tx_example"});
  eq(at(t, "2026-11-03").v.items[0].state, "waiting", "Fun spent down: cooled, waiting for money");
  eq(at(t, "2026-11-26").v.items[0].state, "waiting", "on payday only a day has built up: not yet");
  eq(at(t, "2026-11-29").v.items[0].state, "ready", "and green again once the new allowance has built up enough");
}

// a car goal the account isn't part of: shown as a share of its target
{
  const t = house([row("s", {price: 250, source: "e-isa"})]);
  t.valuations.push({id: "v-isa", account: "e-isa", date: "2026-10-26", amount: 1000});
  const s = at(t, "2026-11-20").v.items[0];
  eq([s.state, s.goals.length, s.goals[0].linked, s.goals[0].share], ["ready", 1, false, 10], "10% of the car goal");
}

// history, not spent, and the other person's rows
{
  const t = house([row("x", {price: 30, source: "e-fun", status: "letgo", rehype: 2, end: "2026-11-05"}), row("y", {price: 45.5, source: "e-fun", status: "letgo"}), row("z", {price: 99, source: "e-fun", status: "bought"}), row("q", {price: 10, source: "e-fun", person: "sophie"})]);
  const {v} = at(t, "2026-11-10");
  eq([v.items.length, v.count.letgo, v.count.bought, v.notSpent], [3, 2, 1, 75.5], "not spent adds up what was let go; Sophie's isn't Ethan's");
  eq(B.cooldown(B.load(t, "2026-11-10"), "sophie", "2026-11-10").items.map(x => x.id), ["q"], "each sees their own");
}
// a budget that's gone, or someone else's, is never green
{
  const t = house([row("g", {price: 5, source: "gone"}), row("h", {price: 5, source: "s-food"})]);
  eq(at(t, "2026-11-20").v.items.map(x => [x.kind, x.state]), [["missing", "waiting"], ["missing", "waiting"]], "unknown or partner's source waits");
}

// the sheet: a new tab, synced to its owner only, and only its owner can change it
{
  const env = makeEnv(), c = env.ctx, call = body => JSON.parse(c.handle_(body).text);
  c.setup(); const fx = fixture();
  Object.keys(fx).forEach(t => { const sh = env.sheets[t]; if (!sh) return; const head = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0]; fx[t].forEach(r => sh.appendRow(head.map(h => r[h] === undefined ? "" : r[h]))); });
  c.CACHE_ = {}; c.setup();
  const kE = env.props.KEY_ethan, kS = env.props.KEY_sophie;
  ok(env.sheets.cooldown && c.SCHEMA_VERSION >= 6, "cooldown tab made, schema 6 or later");
  let r = call({key: kE, ops: [{op: "put", table: "cooldown", row: {id: "cd-ex1", person: "ethan", name: "Example lamp", price: 60, source: "e-fun", hype: 5, days: 7, date: "2026-11-02", status: "cooling", link: "https://example.com/lamp", why: "=1+1"}}]});
  eq([r.applied.length, r.rejected.length], [1, 0], "Ethan parks something");
  c.CACHE_ = {};
  const saved = c.readTable_("cooldown").rows.find(x => x.id === "cd-ex1");
  ok(saved && saved.price === 60 && saved.why === "=1+1" && saved.status === "cooling", "saved, with text kept as text");
  eq(call({key: kS, ops: [{op: "put", table: "cooldown", row: {id: "cd-ex1", person: "sophie", status: "letgo"}}]}).rejected.length, 1, "Sophie can't change it");
  eq(call({key: kS, ops: [{op: "put", table: "cooldown", row: {id: "cd-ex2", person: "ethan", name: "x", price: 1}}]}).rejected.length, 1, "or park one as Ethan");
  c.CACHE_ = {};
  const sE = call({key: kE, since: 0, full: true, ops: []}), sS = call({key: kS, since: 0, full: true, ops: []});
  ok((sE.rows.cooldown || []).some(x => x.id === "cd-ex1"), "Ethan's phone gets it");
  ok(!(sS.rows.cooldown || []).some(x => x.id === "cd-ex1"), "Sophie's never does");
  r = call({key: kE, ops: [{op: "put", table: "cooldown", row: {id: "cd-ex1", status: "letgo", rehype: 2, end: "2026-11-09"}}]});
  c.CACHE_ = {};
  const after = c.readTable_("cooldown").rows.find(x => x.id === "cd-ex1");
  ok(r.applied.length === 1 && after.status === "letgo" && after.name === "Example lamp", "a change keeps the rest of the row");
  eq(call({key: kE, ops: [{op: "put", table: "transactions", row: {id: "cd-ex1", person: "ethan", date: "2026-11-02", amount: 1, budget: "e-fun"}}]}).rejected.length, 1, "its id is one thing");
  const tabs = B.load(c.allTables_(), "2026-11-09");
  eq(B.cooldown(tabs, "ethan", "2026-11-09").notSpent, 60, "the engine reads it back from the sheet");
}
console.log("All " + n + " cooldown checks passed.");
