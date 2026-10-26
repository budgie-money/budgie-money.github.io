// Run with: node test/engine.test.js
const B = require("../engine.js"), fixture = require("./fixture.js");
let fails = 0, passes = 0;
const eq = (name, got, want) => { const ok = JSON.stringify(got) === JSON.stringify(want); ok ? passes++ : fails++; if (!ok) console.log("FAIL", name, "\n  got ", JSON.stringify(got), "\n  want", JSON.stringify(want)); };
const near = (name, got, want) => { const ok = Math.abs(got - want) < 0.011; ok ? passes++ : fails++; if (!ok) console.log("FAIL", name, "got", got, "want", want); };
const db = (mut) => { const t = fixture(); if (mut) mut(t); return B.load(t); };

// --- schedules and bank holidays
eq("last thursday paydays", B.scheduleDates({unit: "month", on: "last thursday", start: "2026-10-01"}, "2026-10-01", "2027-03-01"), ["2026-10-29", "2026-11-26", "2026-12-31", "2027-01-28", "2027-02-25"]);
eq("christmas pay moved by exception", B.periods(db(), "ethan", "2026-12-01", "2027-01-01").map(p => p.start), ["2026-11-26", "2026-12-24"]);
eq("rent on the 15th, next working day", B.scheduleDates({unit: "month", on: "15", shift: "next working day", start: "2026-11-01"}, "2026-11-01", "2027-01-01"), ["2026-11-16", "2026-12-15"]);
eq("every 4 weeks", B.scheduleDates({unit: "week", every: 4, start: "2026-11-25"}, "2026-11-01", "2027-02-01"), ["2026-11-25", "2026-12-23", "2027-01-20"]);
eq("set dates", B.scheduleDates({unit: "dates", dates: "2027-01-04, 1 Apr 2027"}, "2026-11-01", "2028-01-01"), ["2027-01-04", "2027-04-01"]);
eq("quarterly", B.scheduleDates({unit: "month", every: 3, on: "4", start: "2027-01-04"}, "2027-01-01", "2028-01-01"), ["2027-01-04", "2027-04-05", "2027-07-05", "2027-10-04"].map(d => d).slice(0, 0).concat(["2027-01-04", "2027-04-04", "2027-07-04", "2027-10-04"]));
eq("2026 bank holidays at Christmas", ["2026-12-25", "2026-12-28", "2026-12-26"].map(B.isWorkingDay), [false, false, false]);
eq("Easter Monday 2027", B.isWorkingDay("2027-03-29"), false);
eq("pay on Sat 28 Nov moves to Friday", B.scheduleDates({unit: "month", on: "28", shift: "previous working day", start: "2026-11-01"}, "2026-11-01", "2026-12-01"), ["2026-11-27"]);
eq("side income ends after December", B.occurrences(db(), db().byId["s-side"], "2026-10-01", "2027-03-01").map(o => o.date), ["2026-10-30", "2026-11-30", "2026-12-31"]);

// --- pay periods
const e = db();
eq("Ethan's period on 5 Nov", B.periodAt(e, "ethan", "2026-11-05"), {start: "2026-10-29", next: "2026-11-26", name: "Nov 2026", pay: true, opening: false});
eq("Sophie before her first pay", B.periodAt(e, "sophie", "2026-11-05").next, "2026-11-27");

// --- splits
near("2 parts to 1: Sophie's third of £200", B.shareOf(e, "bills", "sophie", 200, "ethan"), 66.67);
near("fixed rent share", B.shareOf(e, "rent", "sophie", 1200, "ethan"), 500);
near("rent: Ethan's part", B.shareOf(e, "rent", "ethan", 1200, "ethan"), 700);

// --- between partners: bills came to £200, Sophie paid her usual £140
const b2 = db(t => { t.exceptions.push({id: "x2", item: "e-flat", date: "2026-11-01", action: "amount", amount: 200}); });
const bt = B.between(b2, "ethan", "2026-11-05");
near("mid-month: nothing owed yet", bt.iOwe + bt.owedToMe, 0);
near("mid-month: this month so far", bt.month.paidIn, 140);
const bt2 = B.between(b2, "ethan", "2026-12-01");
near("Ethan owes Sophie the extra she paid in November", bt2.iOwe, 140 - 66.67);
const bt3 = B.between(db(), "ethan", "2026-11-14");
near("rent share sent on the 13th isn't owed back", bt3.iOwe, 0);

// --- the plan for Ethan's November
const pl = B.planFor(e, "ethan", B.periodAt(e, "ethan", "2026-11-05"));
const already = pl.lines.filter(l => l.already || l.leftover).reduce((t, l) => t + l.amount, 0), catchup = pl.lines.filter(l => l.catchup).reduce((t, l) => t + l.amount, 0);
near("bills pot: £100 already there counts", pl.lines.find(l => l.already && l.account === "e-bills").amount, 100);
near("what is left in the main account carries into the new month", (pl.lines.find(l => l.leftover) || {}).amount, 250 - 150 * 3 / 28);
near("food pot: what's beyond the carried-over food counts", pl.lines.find(l => l.already && l.account === "e-food").amount, 40 - 200 * 3 / 28);
near("car pot was short of the fuel carried over: caught up", catchup, 80 * 3 / 28 - 4);
near("money in: pay + Sophie's shares + money already in pots", pl.totals.in, 2400 + 500 + 140 + already);
const isa = pl.lines.find(l => l.id === "e-isa-b");
near("cash ISA gets what's left", isa.amount, 2400 + 640 + already - catchup - (1200 + 420 + 20) - (200 + 80 + 150) - 300);

// --- payday sort: Sophie's transfers land in the bills pot, so less moves there
const pd = B.payday(e, "ethan", B.periodAt(e, "ethan", "2026-11-05"));
const bm = pd.moves.find(m => m.to === "e-bills");
near("bills pot needs bills minus Sophie's shares minus what's already there", bm.amount, 1200 + 420 + 20 - 640 - 100);

// --- weekly food: a £40 shop on payday is fine
const w = db(t => { t.transactions.push({id: "t1", date: "2026-10-29", person: "ethan", amount: 40, budget: "e-food-b", account: "e-food"}); });
const tw = B.today(w, "ethan", "2026-10-29");
const food = tw.tiles.find(x => x.name === "Food");
eq("food not ahead of pace after a weekly shop", food.pace >= 0, true);

// --- To do: paid for fuel from main -> move from Car pot; over budget -> Emergency pot covers
const m = db(t => {
  t.transactions.push({id: "t2", date: "2026-10-30", person: "ethan", amount: 35, budget: "e-fuel", account: "e-main"});
  t.transactions.push({id: "t3", date: "2026-10-31", person: "ethan", amount: 230, budget: "e-fun", account: "e-main"});
  t.budgets.find(b => b.id === "e-fun").carry = false;
});
const td = B.todo(m, "ethan", "2026-11-02");
const fuel = td.find(x => /^back:e-fuel:/.test(x.key));
eq("move fuel money back", [fuel.from, fuel.to, fuel.amount], ["e-car", "e-main", 35]);
const cover = td.find(x => x.over);
eq("Emergency pot covers going over fun", [cover.from, cover.to, cover.amount], ["e-emergency", "e-main", 230 - 150]);
const dec = B.planFor(m, "ethan", B.periodAt(m, "ethan", "2026-12-01"));
near("December pay tops the Emergency pot back up", (dec.lines.find(l => l.kind === "topup") || {}).amount, 80);

// --- a ticked move disappears
const m2 = db(t => { t.transactions.push({id: "t2", date: "2026-10-30", person: "ethan", amount: 35, budget: "e-fuel", account: "e-main"}); t.moves.push({id: "mv1", date: "2026-10-30", person: "ethan", from: "e-car", to: "e-main", amount: 35, key: "back:e-fuel:2026-10-29:e-main"}); });
eq("ticked move is done", B.todo(m2, "ethan", "2026-11-02").some(x => /^back:e-fuel/.test(x.key)), false);
// spending more after a tick asks only for the difference
const m3 = db(t => { t.transactions.push({id: "t2", date: "2026-10-30", person: "ethan", amount: 35, budget: "e-fuel", account: "e-main"}, {id: "t4", date: "2026-11-01", person: "ethan", amount: 10, budget: "e-fuel", account: "e-main"}); t.moves.push({id: "mv1", date: "2026-10-30", person: "ethan", from: "e-car", to: "e-main", amount: 35, key: "back:e-fuel:2026-10-29:e-main"}); });
near("only the new £10 to move", (B.todo(m3, "ethan", "2026-11-02").find(x => /^back:e-fuel/.test(x.key)) || {}).amount, 10);

// --- loans
const ln = B.loans(e, "ethan", "2026-11-01")[0];
eq("sofa repayments", ln.plan.map(r => [r.date, r.amount]), [["2026-12-28", 200], ["2027-01-28", 200], ["2027-02-28", 200]]);

// --- balances follow flows
const bal = B.balances(e, "2026-11-16");
near("bills pot after rent, phone, household bills and Sophie's shares", bal["e-bills"], 100 + 140 + 500 - 420 - 20 - 1200);

// --- family paying straight into the LISA: saved, not spendable, and you still move your own share
const pa = db(t => { t.income.push({id: "e-par", person: "ethan", name: "Family LISA top-up", amount: 167, account: "e-lisa", unit: "month", on: "1", start: "2026-11-01"}); });
const paPer = B.periodAt(pa, "ethan", "2026-11-05"), basePl = B.planFor(e, "ethan", B.periodAt(e, "ethan", "2026-11-05")), paPl = B.planFor(pa, "ethan", paPer);
near("family top-up doesn't swell the ISA remainder", paPl.lines.find(l => l.id === "e-isa-b").amount, basePl.lines.find(l => l.id === "e-isa-b").amount);
near("payday still moves your own LISA saving", (B.payday(pa, "ethan", paPer).moves.find(m => m.to === "e-lisa") || {}).amount, 300);
near("family top-up counts as saved", paPl.totals.save - basePl.totals.save, 167);
const L1 = B.lisa(pa, "e-lisa", "2026-10-26");
eq("LISA: planned to 5 April counts paydays and the top-ups", L1.taxYearEnd, "2027-04-05");
near("LISA: on course (6 paydays x 300 + 6 top-ups x 167)", L1.planned, 6 * 300 + 6 * 167);
const pb = db(t => { t.settings.push({person: "ethan", key: "lisa.paidBefore.e-lisa", value: "2500"}); });
near("LISA: paid before Budgie counts towards the limit", B.lisa(pb, "e-lisa", "2026-10-26").paidThisYear, 2500);
near("LISA: going over the limit is flagged", B.lisa(pb, "e-lisa", "2026-10-26").overBy, 2500 + 6 * 300 - 4000);

// --- things to check
const ck = db(t => { t.settings.push({person: "ethan", key: "check:e-home", value: JSON.stringify({t: "Is £50 right?", a: "edit", v: "budgets:e-home", o: 2})}, {person: "ethan", key: "check:pots", value: JSON.stringify({t: "Pots", a: "go", v: "pots", o: 1})}, {person: "ethan", key: "check:old", value: "done"}, {person: "sophie", key: "check:s", value: JSON.stringify({t: "Hers"})}); });
eq("checks: open ones, in order, only mine", B.checks(ck, "ethan").map(c => c.id), ["pots", "e-home"]);


// --- LISA history from the provider's statement: payments count towards the limit, bonuses and fees don't
const lh = db(t => { t.moves.push(
  {id: "h1", date: "2026-05-11", person: "ethan", from: "", to: "e-lisa", amount: 334, key: "lisa:in:2026-05-11"},
  {id: "h2", date: "2026-09-09", person: "ethan", from: "", to: "e-lisa", amount: 334, key: "lisa:in:2026-09-09"},
  {id: "h3", date: "2026-10-01", person: "ethan", from: "", to: "e-lisa", amount: 83.5, key: "lisa:bonus:2026-10-01"},
  {id: "h4", date: "2026-10-07", person: "ethan", from: "e-lisa", to: "", amount: 4.56, key: "lisa:fee:2026-10-07"}); });
const LH = B.lisa(lh, "e-lisa", "2026-10-26");
near("LISA history: payments count", LH.paidThisYear, 668);
near("LISA history: bonus received", LH.bonusReceived, 83.5);
near("LISA history: fees", LH.feesThisYear, 4.56);
eq("LISA history: by month", LH.months.filter(m => m.paid || m.bonus || m.fees).map(m => [m.month, m.paid, m.bonus, m.fees]), [["2026-05", 334, 0, 0], ["2026-09", 334, 0, 0], ["2026-10", 0, 83.5, 4.56]]);
near("LISA history doesn't change today's balance", B.balances(lh, "2026-10-26")["e-lisa"], 10000);

// --- a payday that can't cover everything: the fallback pot covers the gap
const sh = db(t => { t.bills.push({id: "big", person: "ethan", name: "Big one-off", amount: 2500, account: "e-bills", unit: "once", start: "2026-11-20"}); });
const shp = B.payday(sh, "ethan", B.periodAt(sh, "ethan", "2026-11-05"));
// the Emergency pot has £400: it covers what it can, and the rest is flagged
// short = out (bills 1640 + 2500, spending 430, LISA 300, car catch-up) - in (pay 2400, shares 640, already in pots and Main)
const shortBy = (1640 + 2500 + 430 + 300 + (80 * 3 / 28 - 4)) - (2400 + 640 + 100 + (40 - 200 * 3 / 28) + (250 - 150 * 3 / 28));
eq("short pay: Emergency pot covers what it has", [shp.cover && shp.cover.from, shp.cover && shp.cover.amount, B.round(shp.uncovered)], ["e-emergency", 400, B.round(shortBy - 400)]);

// ================= review fixes (1.3.0) =================
const dbt = (mut, today) => { const t = fixture(); if (mut) mut(t); return B.load(t, today); };
const planAt = (d, p, date) => B.planFor(d, p, B.periodAt(d, p, date));
const lineAmt = (pl, f) => pl.lines.filter(f).reduce((t, l) => t + l.amount, 0);

// #1 payday moves done in the bank but not ticked, then every balance checked: no double counting
(() => {
  const base = dbt(null, "2026-10-29"), nov = B.periodAt(base, "ethan", "2026-10-29"), moves = B.payday(base, "ethan", nov).moves;
  const bal = Object.assign({}, B.balances(base, "2026-11-20")); moves.forEach(m => { bal[m.from] -= m.amount; bal[m.to] += m.amount; });
  const checks = t => Object.keys(bal).filter(a => /^e-/.test(a)).forEach((a, i) => t.valuations.push({id: "chk" + i, account: a, date: "2026-11-20", amount: B.round(bal[a])}));
  const unticked = planAt(dbt(checks, "2026-11-26"), "ethan", "2026-11-26");
  const ticked = planAt(dbt(t => { moves.forEach((m, i) => t.moves.push({id: "tk" + i, date: "2026-10-29", person: "ethan", from: m.from, to: m.to, amount: m.amount, key: "pay:2026-10-29:" + m.to})); checks(t); }, "2026-11-26"), "ethan", "2026-11-26");
  near("#1 unticked moves + later balance checks: same ISA as ticked", lineAmt(unticked, l => l.id === "e-isa-b"), lineAmt(ticked, l => l.id === "e-isa-b"));
  eq("#1 no catch-up on Main", unticked.lines.some(l => l.catchup), false);
  eq("#1 payday ticks are dated on payday", [B.moveDate("pay:2026-10-29:e-isa", "2026-11-03"), B.moveDate("back:e-fuel:2026-10-29:e-main", "2026-11-03")], ["2026-10-29", "2026-11-03"]);
})();

// #6 the payday cover fills the whole gap, only from money that's there, and is topped up after
(() => {
  const big = amt => t => t.bills.push({id: "big", person: "ethan", name: "Big one-off", amount: amt, account: "e-bills", unit: "once", start: "2026-11-20"});
  const a = dbt(big(1200), "2026-10-29"), pa = B.payday(a, "ethan", B.periodAt(a, "ethan", "2026-10-29"));
  const gap = B.round((1640 + 1200 + 430 + 300 + (80 * 3 / 28 - 4)) - (2400 + 640 + 100 + (40 - 200 * 3 / 28) + (250 - 150 * 3 / 28)));
  eq("#6 a small gap is covered too, so Fun keeps its £150", [pa.plan.shortfall, pa.cover && pa.cover.amount, pa.keeps], [gap, gap, 150]);
  const b = dbt(big(2500), "2026-10-29"), pb = B.payday(b, "ethan", B.periodAt(b, "ethan", "2026-10-29"));
  const ms = pb.moves.map((m, i) => ({id: "m" + i, date: "2026-10-29", person: "ethan", from: m.from, to: m.to, amount: m.amount, key: "pay:2026-10-29:" + m.to}));
  ms.push({id: "cv", date: "2026-10-29", person: "ethan", from: "e-emergency", to: "e-main", amount: pb.cover.amount, key: pb.cover.key});
  const c = dbt(t => { big(2500)(t); t.moves.push(...ms); }, "2026-11-26");
  near("#6 Emergency pot never goes under", B.balances(c, "2026-11-25")["e-emergency"], 0);
  near("#6 next pay tops up the cover", lineAmt(planAt(c, "ethan", "2026-11-26"), l => l.kind === "topup"), 400);
})();

// #7 budgets follow the middle of the pay period
(() => {
  // Christmas until 27 Dec, but the December pay comes on the 24th: planned once
  const x = dbt(t => t.budgets.push({id: "s-xmas", person: "sophie", name: "Christmas", amount: 100, mode: "oneoff", account: "s-main", start: "2026-11-27", end: "2026-12-27"}));
  const t_ = ["2026-11-27", "2026-12-24", "2027-01-28"].map(d => lineAmt(planAt(x, "sophie", d), l => l.id === "s-xmas"));
  eq("#7 Sophie's Christmas planned once", t_, [100, 0, 0]);
  // Christmas merged into Gifts: 300 from 26 Nov, back to 25 from 24 Dec, nothing before it starts
  const g = dbt(t => { t.budgets.push({id: "e-gifts", person: "ethan", name: "Gifts and birthdays", amount: 25, mode: "oneoff", account: "e-main", start: "2026-11-26"}); t.amounts.push({id: "g1", item: "e-gifts", start: "2026-11-26", amount: 300}, {id: "g2", item: "e-gifts", start: "2026-12-24", amount: 25}); });
  eq("#7 Gifts and birthdays by period", ["2026-11-05", "2026-11-26", "2026-12-24", "2027-01-28"].map(d => lineAmt(planAt(g, "ethan", d), l => l.id === "e-gifts")), [0, 300, 25, 25]);
  // an amount dated by the calendar (1 Dec) still lands in the Christmas period
  const g2 = dbt(t => { t.budgets.push({id: "e-gifts", person: "ethan", name: "Gifts", amount: 25, mode: "oneoff", account: "e-main"}); t.amounts.push({id: "g1", item: "e-gifts", start: "2026-12-01", amount: 300}, {id: "g2", item: "e-gifts", start: "2027-01-01", amount: 25}); });
  eq("#7 calendar-dated amounts", ["2026-11-26", "2026-12-24"].map(d => lineAmt(planAt(g2, "ethan", d), l => l.id === "e-gifts")), [300, 25]);
  // a change "from today" early in a period counts this period
  const f = dbt(t => t.amounts.push({id: "a1", item: "e-fun", start: "2026-11-10", amount: 300}), "2026-11-10");
  near("#7 Fun changed on 10 Nov counts now", B.today(f, "ethan", "2026-11-10").tiles.find(x => x.name === "Fun").amount, 300 + 150 * 3 / 28);
})();

// #8 going over a budget whose pot paid for it: caught up once, no top-up for money the fallback never paid
(() => {
  const d = dbt(t => t.transactions.push({id: "f1", date: "2026-11-10", person: "ethan", amount: 300, budget: "e-food-b", account: "e-food"}), "2026-11-26");
  const pl = planAt(d, "ethan", "2026-11-26");
  eq("#8 no top-up", pl.lines.some(l => l.kind === "topup"), false);
  near("#8 the Food pot is caught up", lineAmt(pl, l => l.catchup && l.account === "e-food"), 300 - (200 + 200 * 3 / 28));
})();

// #9 a split payment from the wrong account: only my share moves, and it isn't "over"
(() => {
  const d = dbt(t => t.transactions.push({id: "big", date: "2026-11-02", person: "ethan", amount: 300, budget: "e-food-b", account: "e-main", split: "half"}), "2026-11-03");
  const td = B.todo(d, "ethan", "2026-11-03");
  near("#9 move back my £150 share", (td.find(x => /^back:e-food-b/.test(x.key)) || {}).amount, 150);
  eq("#9 not over budget", td.some(x => x.over), false);
})();

// #10 spending logged after a balance check on the same day still counts
(() => {
  const d = dbt(t => { t.valuations.find(v => v.id === "v1").updated = Date.parse("2026-10-26T09:00:00Z"); t.transactions.push({id: "late", date: "2026-10-26", person: "ethan", amount: 20, budget: "e-fun", account: "e-main", updated: Date.parse("2026-10-26T15:00:00Z")}, {id: "early", date: "2026-10-26", person: "ethan", amount: 5, budget: "e-fun", account: "e-main", updated: Date.parse("2026-10-26T08:00:00Z")}); }, "2026-10-26");
  near("#10 later spend counts, earlier one is in the check", B.balances(d, "2026-10-26")["e-main"], 230);
})();

// #11 an unspent one-off budget (no carry) is released next month, not held back
(() => {
  const d = dbt(t => t.budgets.push({id: "e-home", person: "ethan", name: "Household", amount: 50, mode: "oneoff", account: "e-main"}), "2026-11-26");
  const without = planAt(dbt(null, "2026-11-26"), "ethan", "2026-11-26"), withHome = planAt(d, "ethan", "2026-11-26");
  // last month's unspent £50 comes back as left over and pays for this month's £50, so the ISA is unchanged
  near("#11 unspent one-off money is left over next month", lineAmt(withHome, l => l.id === "leftover") - lineAmt(without, l => l.id === "leftover"), 50);
  near("#11 so the ISA doesn't lose it", lineAmt(without, l => l.id === "e-isa-b") - lineAmt(withHome, l => l.id === "e-isa-b"), 0);
  eq("#11 nothing carries for it", B.budgetState(d, "ethan", B.periodAt(d, "ethan", "2026-11-05"))["e-home"].carryOut, 0);
})();

// #12 the payday estimate keeps what's left of a "whatever is left" budget, which can still be spent
(() => {
  const est = planAt(dbt(null, "2026-11-01"), "sophie", "2026-11-27");
  const left = B.today(dbt(null, "2026-11-01"), "sophie", "2026-11-01").tiles.find(x => x.id === "s-fun").left;
  const spent = planAt(dbt(t => t.transactions.push({id: "sf", date: "2026-11-20", person: "sophie", amount: left, budget: "s-fun", account: "s-main"}), "2026-11-21"), "sophie", "2026-11-27");
  near("#12 estimate doesn't count fun money as left over", lineAmt(est, l => l.id === "s-fun"), lineAmt(spent, l => l.id === "s-fun"));
})();

// #13 a sinking fund in a pot builds up
(() => {
  // (setAside off: this is about the saving budget on its own; 1.4.0 below has both together)
  const t0 = t => { t.budgets.push({id: "e-carfund", person: "ethan", name: "Car insurance fund", amount: 50, mode: "saving", account: "e-car"}); t.bills.push({id: "e-ins", person: "ethan", name: "Car insurance", amount: 600, account: "e-car", unit: "year", start: "2027-10-01", setAside: "FALSE"}); };
  const moves = []; let d = "2026-10-29", last = 0, toCar = [];
  for (let i = 0; i < 6; i++) {
    const x = dbt(t => { t0(t); t.moves.push(...moves); }, d), per = B.periodAt(x, "ethan", d), pd = B.payday(x, "ethan", per);
    pd.moves.forEach((m, j) => moves.push({id: "m" + i + j, date: per.start, person: "ethan", from: m.from, to: m.to, amount: m.amount, key: "pay:" + per.start + ":" + m.to}));
    toCar.push((pd.moves.find(m => m.to === "e-car") || {amount: 0}).amount); d = per.next;
  }
  const fin = dbt(t => { t0(t); t.moves.push(...moves); }, d);
  near("#13 after 6 paydays the pot holds the fund plus the fuel carry", B.balances(fin, B.addDays(d, -1))["e-car"], 6 * 50 + 80 + 80);
  eq("#13 the £50 is moved every month", toCar.slice(2).every(a => a >= 50), true);
})();

// #14 tracking that starts on a payday is a normal pay period; balances checked on the first day count
(() => {
  const d = dbt(t => { t.settings.find(s => s.person === "ethan").value = "2026-10-29"; t.valuations.forEach(v => v.date = "2026-10-28"); }, "2026-10-29");
  const per = B.periodAt(d, "ethan", "2026-10-29"), pl = B.planFor(d, "ethan", per);
  eq("#14 not an opening period", [per.pay, per.opening], [true, false]);
  near("#14 LISA saving planned", lineAmt(pl, l => l.id === "e-lisa-b"), 300);
  near("#14 money in Main at the start is left over for this month", lineAmt(pl, l => l.id === "leftover"), 250);
  // a balance checked on the first day after the pay landed isn't counted on top of the pay
  const d2 = dbt(t => { t.settings.find(s => s.person === "ethan").value = "2026-10-29"; t.valuations.forEach(v => v.date = "2026-10-29"); t.valuations.find(v => v.id === "v1").amount = 250 + 2400; }, "2026-10-29");
  near("#14 start-day check after payday: Main counted once", lineAmt(planAt(d2, "ethan", "2026-10-29"), l => l.id === "leftover"), 250);
  eq("#14 payday sort on the To do", B.todo(d, "ethan", "2026-10-29").some(x => x.payday), true);
  eq("#14 something goes to the ISA", lineAmt(pl, l => l.id === "e-isa-b") > 0, true);
  const op = B.planFor(e, "ethan", B.periodAt(e, "ethan", "2026-10-27"));
  near("#14 balances checked on the start day are the opening money", lineAmt(op, l => l.id === "opening"), 250 + 100 + 40 + 4);
})();

// #15 the period before the opening one ends where tracking starts
(() => {
  const op = B.periodAt(e, "ethan", "2026-10-27"), pv = B.prevPeriod(e, "ethan", op);
  eq("#15 no overlap", [op.start, pv.next <= "2026-10-26"], ["2026-10-26", true]);
  eq("#15 the year marks the current period", B.year(e, "sophie", "2026-11-05").filter(r => r.current).length, 1);
  eq("#15 no top-up in the opening period for its own overspend", B.planFor(dbt(t => t.transactions.push({id: "o1", date: "2026-10-27", person: "ethan", amount: 100, budget: "e-fun", account: "e-main"})), "ethan", op).lines.some(l => l.kind === "topup"), false);
})();

// #19 LISA: this month's saving counts until it's ticked; money paid before Budgie isn't counted twice
(() => {
  eq("#19 on course is the same on payday as the day before", [B.lisa(dbt(null, "2026-10-28"), "e-lisa", "2026-10-28").onCourse, B.lisa(dbt(null, "2026-10-29"), "e-lisa", "2026-10-29").onCourse], [1800, 1800]);
  const tk = B.lisa(dbt(t => t.moves.push({id: "m1", date: "2026-10-29", person: "ethan", from: "e-main", to: "e-lisa", amount: 300, key: "pay:2026-10-29:e-lisa"}), "2026-10-29"), "e-lisa", "2026-10-29");
  eq("#19 after ticking", [tk.paidThisYear, tk.onCourse], [300, 1800]);
  const hist = t => t.moves.push({id: "h1", date: "2026-05-11", person: "ethan", from: "", to: "e-lisa", amount: 334, key: "lisa:in:2026-05-11"}, {id: "h2", date: "2026-09-09", person: "ethan", from: "", to: "e-lisa", amount: 334, key: "lisa:in:2026-09-09"});
  near("#19 paid-before plus statement rows", B.lisa(dbt(t => { hist(t); t.settings.push({person: "ethan", key: "lisa.paidBefore.e-lisa", value: "668"}); }), "e-lisa", "2026-10-26").paidThisYear, 668);
  near("#19 paid-before larger than the statement rows", B.lisa(dbt(t => { hist(t); t.settings.push({person: "ethan", key: "lisa.paidBefore.e-lisa", value: "1000"}); }), "e-lisa", "2026-10-26").paidThisYear, 1000);
  const dup = dbt(t => t.moves.push({id: "m1", date: "2026-10-29", person: "ethan", from: "e-main", to: "e-lisa", amount: 333, key: "pay:2026-10-29:e-lisa"}, {id: "h3", date: "2026-10-30", person: "ethan", from: "", to: "e-lisa", amount: 333, key: "lisa:in:2026-10-30"}), "2026-11-02");
  eq("#19 a statement row for a ticked move counts once", [B.lisa(dup, "e-lisa", "2026-11-02").paidThisYear, B.balances(dup, "2026-11-02")["e-lisa"]], [333, 10000 + 333]);
})();

// #20 refunds
(() => {
  const a = dbt(t => t.transactions.push({id: "p", date: "2026-11-02", person: "ethan", amount: 60, budget: "e-fuel", account: "e-main"}, {id: "r", date: "2026-11-03", person: "ethan", amount: -60, budget: "e-fuel", account: "e-main"}), "2026-11-04");
  eq("#20 paid and refunded through Main: nothing to move", B.todo(a, "ethan", "2026-11-04").filter(x => !x.payday && x.type === "move").length, 0);
  const b = dbt(t => t.transactions.push({id: "p", date: "2026-11-02", person: "ethan", amount: 60, budget: "e-fuel", account: "e-car"}, {id: "r", date: "2026-11-03", person: "ethan", amount: -20, budget: "e-fuel", account: "e-main"}), "2026-11-04");
  const rf = B.todo(b, "ethan", "2026-11-04").find(x => /^refund:/.test(x.key));
  eq("#20 a refund into Main goes back to the Car pot", rf && [rf.from, rf.to, rf.amount], ["e-main", "e-car", 20]);
})();

// #21 someone without a payday still gets monthly periods
(() => {
  const d = dbt(t => { t.income = t.income.filter(i => i.person !== "sophie" || !i.isPay); });
  eq("#21 monthly periods from the start day", B.periodAt(d, "sophie", "2027-03-01"), {start: "2027-02-26", next: "2027-03-26", name: "Mar 2027", pay: false, opening: false});
})();

// #24 two dates shifted onto the same working day are both kept
eq("#24 daily, next working day: 7 payments in a week", B.scheduleDates({unit: "day", start: "2026-11-02", shift: "next working day"}, "2026-11-02", "2026-11-09").length + B.scheduleDates({unit: "day", start: "2026-11-02", shift: "next working day"}, "2026-11-09", "2026-11-10").length - 1, 7);
eq("#24 each occurrence has its own key", (() => { const d = dbt(t => t.bills.push({id: "dly", person: "ethan", name: "Daily", amount: 1, account: "e-main", unit: "day", start: "2026-11-02", shift: "next working day"})); const k = B.occurrences(d, d.byId.dly, "2026-11-09", "2026-11-10").map(o => o.key); return k.length === new Set(k).size && k.length === 3; })(), true);

// goals return the target date as due; prices load
eq("goals: due date", B.goals(e, "ethan", "2026-10-26")[0].due, "2031-10-01");
eq("goals: no due date", B.goals(dbt(t => { delete t.goals[0].due; }), "ethan", "2026-10-26")[0].due, "");
eq("goals: no by", "by" in B.goals(e, "ethan", "2026-10-26")[0], false);
eq("prices load", dbt(t => t.prices = [{id: "p1", fund: "X", date: "2026-10-26", price: "1.23"}, {id: "p2", fund: "X", date: "2026-10-25", price: 1, deleted: true}]).prices.map(p => p.price), [1.23]);
eq("deleted stubs from sync are ignored", dbt(t => t.transactions.push({id: "t1", deleted: true})).transactions.length, 0);

// ================= 1.4.0: yearly costs, LISA bonus, tax year round-up =================
// play the months forward from a date, ticking every payday's moves as people do
const playForward = (mut, from, n, p = "ethan") => {
  const moves = [], plans = []; let d = from;
  for (let i = 0; i < n; i++) {
    const x = dbt(t => { mut(t); t.moves.push(...moves); }, d), per = B.periodAt(x, p, d), pl = B.planFor(x, p, per);
    if (per.pay && !per.opening) B.payday(x, p, per).moves.forEach((m, j) => moves.push({id: "pf" + i + "-" + j, date: per.start, person: p, from: m.from, to: m.to, amount: m.amount, key: "pay:" + per.start + ":" + m.to}));
    plans.push(pl); d = per.next;
  }
  return {plans, moves, end: d, db: (today) => dbt(t => { mut(t); t.moves.push(...moves); }, today || d)};
};
const saLine = (pl, id) => lineAmt(pl, l => l.setAside && l.bill === id && l.kind === "save");
const savedUp = (pl, id) => lineAmt(pl, l => l.setAside && l.bill === id && l.kind === "in");

// setAside: on by default for bills every 3 months or more, "FALSE"/"false" turn it off
(() => {
  const b = (id, x) => Object.assign({id, person: "ethan", name: id, amount: 1, account: "e-bills", start: "2027-01-01"}, x);
  const d = dbt(t => t.bills.push(b("y", {unit: "year"}), b("q", {unit: "month", every: 3}), b("m", {unit: "month"}), b("w12", {unit: "week", every: 12}), b("w8", {unit: "week", every: 8}), b("o", {unit: "once"}),
    b("yF", {unit: "year", setAside: "FALSE"}), b("yf", {unit: "year", setAside: "false"}), b("yb", {unit: "year", setAside: false}), b("mT", {unit: "month", setAside: "TRUE"})));
  eq("1.4 setAside defaults", ["y", "q", "m", "w12", "w8", "o", "yF", "yf", "yb", "mT"].map(id => d.byId[id].setAside), [true, true, false, true, false, false, false, false, false, true]);
  eq("1.4 a membership on set dates about 3 months apart is set aside for", d.byId["s-member"].setAside, true);
})();

// a yearly car insurance: £600 on 18 March from the Car pot
(() => {
  const ins = t => t.bills.push({id: "e-ins", person: "ethan", name: "Car insurance", amount: 600, account: "e-car", unit: "year", start: "2027-03-18"});
  // the plan as it looks today: Nov to Feb set aside 600/5, March pays from it, April starts again for 2028
  const now = dbt(ins, "2026-10-26"), base = dbt(null, "2026-10-26"), pers = [];
  for (let per = B.periodAt(now, "ethan", "2026-11-05"); pers.length < 6; per = B.nextPeriod(now, "ethan", per)) pers.push(per);
  eq("1.4 set aside each pay period until it's due", pers.map(per => saLine(B.planFor(now, "ethan", per), "e-ins")), [120, 120, 120, 120, 0, 50]);
  eq("1.4 March pays it from what's set aside", pers.map(per => savedUp(B.planFor(now, "ethan", per), "e-ins")), [0, 0, 0, 0, 480, 0]);
  // it comes out of what's left (the Cash ISA), never twice, and never as a shortfall
  eq("1.4 Cash ISA gives up one instalment a month, the bill isn't counted again", pers.map(per => B.round(lineAmt(B.planFor(now, "ethan", per), l => l.id === "e-isa-b") - lineAmt(B.planFor(base, "ethan", per), l => l.id === "e-isa-b"))), [-120, -120, -120, -120, -120, -50]);
  eq("1.4 no shortfall", pers.map(per => B.planFor(now, "ethan", per).shortfall), [0, 0, 0, 0, 0, 0]);
  const line = B.planFor(now, "ethan", pers[0]).lines.find(l => l.setAside && l.kind === "save");
  eq("1.4 the line", [line.kind, line.setAside, line.bill, line.name, line.amount, line.account], ["save", true, "e-ins", "Set aside for Car insurance", 120, "e-car"]);
  near("1.4 payday moves it to the Car pot", B.payday(now, "ethan", pers[0]).moves.find(m => m.to === "e-car").amount - B.payday(base, "ethan", pers[0]).moves.find(m => m.to === "e-car").amount, 120);
  // the same, lived: every payday ticked
  const run = playForward(ins, "2026-10-26", 7);
  eq("1.4 lived: set aside", run.plans.map(pl => saLine(pl, "e-ins")), [0, 120, 120, 120, 120, 0, 50]);
  eq("1.4 lived: March pays from the reserve, no catch-up", [savedUp(run.plans[5], "e-ins"), run.plans[5].lines.some(l => l.catchup && l.account === "e-car")], [480, false]);
  const lived = run.db("2027-05-01");
  let low = 1e9; for (let d = "2026-10-29"; d < "2027-04-29"; d = B.addDays(d, 1)) low = Math.min(low, B.balances(lived, d)["e-car"]);
  eq("1.4 lived: the Car pot never goes under", low >= -0.004, true);
  near("1.4 lived: the pot holds the 480 the day before", B.balances(lived, "2027-03-17")["e-car"] - B.balances(lived, "2027-03-18")["e-car"], 600);
  // yearly() for the Bills screen
  const y1 = B.yearly(run.db("2026-11-05"), "ethan", "2026-11-05")[0];
  eq("1.4 yearly() shape", y1, {id: "e-ins", name: "Car insurance", amount: 600, next: "2027-03-18", monthly: 120, saved: 120, account: "e-car", accountName: "Car pot", periods: 5, onTrack: true});
  const y2 = B.yearly(run.db("2027-03-01"), "ethan", "2027-03-01")[0];
  eq("1.4 yearly() when it's due this pay period", [y2.next, y2.monthly, y2.saved, y2.periods], ["2027-03-18", 120, 480, 1]);
  const y3 = B.yearly(run.db("2027-03-20"), "ethan", "2027-03-20")[0];
  eq("1.4 yearly() after it's paid: the next one", [y3.next, y3.monthly, y3.saved], ["2028-03-18", 0, 0]);
  eq("1.4 yearly() today, before the first payday", [B.yearly(now, "ethan", "2026-10-26")[0].monthly, B.yearly(now, "ethan", "2026-10-26")[0].periods], [0, 5]);
  // the Car pot was emptied in January: what's really there counts, the rest is caught up by bigger instalments
  const emptied = t => { ins(t); t.valuations.push({id: "vcar", account: "e-car", date: "2027-01-27", amount: 0}); };
  const febDb = dbt(t => { emptied(t); t.moves.push(...run.moves.filter(m => m.date < "2027-01-28")); }, "2027-01-28"), feb = B.planFor(febDb, "ethan", B.periodAt(febDb, "ethan", "2027-01-28"));
  eq("1.4 pot emptied: set aside (600 - 0) / 2", [saLine(feb, "e-ins"), feb.setAsideShort["e-ins"]], [300, 360]);
  eq("1.4 pot emptied: not on track", B.yearly(febDb, "ethan", "2027-01-28")[0].onTrack, false);
  // a bill that has ended: nothing more set aside
  eq("1.4 ended: no line", saLine(B.planFor(dbt(t => { ins(t); t.bills.find(b => b.id === "e-ins").end = "2027-01-01"; }, "2026-10-26"), "ethan", pers[0]), "e-ins"), 0);
  eq("1.4 turned off: no line", saLine(B.planFor(dbt(t => { ins(t); t.bills.find(b => b.id === "e-ins").setAside = "FALSE"; }, "2026-10-26"), "ethan", pers[0]), "e-ins"), 0);
})();

// a yearly cost in a pot that also has a saving budget of its own: both kept, neither counts the other's money
(() => {
  const both = t => { t.budgets.push({id: "e-carfund", person: "ethan", name: "Car fund", amount: 50, mode: "saving", account: "e-car"}); t.bills.push({id: "e-ins", person: "ethan", name: "Car insurance", amount: 600, account: "e-car", unit: "year", start: "2027-01-15"}); };
  const run = playForward(both, "2026-10-26", 5), [, nov, dec, jan] = run.plans;
  eq("1.4 both: the fund and the set-aside each month", [nov, dec].map(pl => [lineAmt(pl, l => l.id === "e-carfund"), saLine(pl, "e-ins")]), [[50, 200], [50, 200]]);
  eq("1.4 both: kept apart", [dec.reserveOut["e-car"], dec.setAside["e-ins"]], [100, 400]);
  near("1.4 both: yearly() saved is only the set-aside", B.yearly(run.db("2026-12-01"), "ethan", "2026-12-01")[0].saved, 400);
  eq("1.4 both: January pays from the set-aside, and the fund isn't spent on it", [savedUp(jan, "e-ins"), jan.reserveOut["e-car"]], [400, 150]);
  const lived = run.db("2027-02-26");
  let low = 1e9; for (let d = "2026-10-29"; d < "2027-02-25"; d = B.addDays(d, 1)) low = Math.min(low, B.balances(lived, d)["e-car"]);
  eq("1.4 both: the Car pot never goes under", low >= -0.004, true);
  near("1.4 both: after the bill the pot still holds the whole fund plus the fuel carry", B.balances(lived, "2027-01-27")["e-car"], 150 + 80 + 80);
})();

// a yearly cost paid from the main account (Sophie's membership): kept back from what's left over, not moved
(() => {
  const on = dbt(null, "2026-10-26"), off = dbt(t => t.bills.find(b => b.id === "s-member").setAside = "false", "2026-10-26");
  const dec = B.periodAt(on, "sophie", "2026-12-01"), jan = B.periodAt(on, "sophie", "2027-01-01");
  eq("1.4 membership: 25 / 2 in December, paid from it in January", [saLine(B.planFor(on, "sophie", dec), "s-member"), savedUp(B.planFor(on, "sophie", jan), "s-member")], [12.5, 12.5]);
  near("1.4 membership: December's savings give up 12.50", B.planFor(on, "sophie", dec).remainder - B.planFor(off, "sophie", dec).remainder, -12.5);
  near("1.4 membership: January's get it back", B.planFor(on, "sophie", jan).remainder - B.planFor(off, "sophie", jan).remainder, 12.5);
  // once January has started, the 12.50 kept in Main isn't counted as left over as well
  const onJ = dbt(null, "2026-12-24"), offJ = dbt(t => t.bills.find(b => b.id === "s-member").setAside = "false", "2026-12-24"), pj = B.periodAt(onJ, "sophie", "2026-12-24");
  // (Sophie's remainder here is Fun in Main: the 12.50 is in Main either way, and counted once, as saved up or as left over)
  const inJ = d => lineAmt(B.planFor(d, "sophie", pj), l => l.kind === "in");
  eq("1.4 membership lived: counted once", [B.round(inJ(onJ) - inJ(offJ)), savedUp(B.planFor(onJ, "sophie", pj), "s-member")], [0, 12.5]);
  eq("1.4 membership: stays in Main, nothing to move for it", B.payday(on, "sophie", dec).moves.some(m => /Membership/.test(m.why)), false);
})();

// LISA: the bonus still to come
(() => {
  const L = (moves, date) => B.lisa(dbt(t => t.moves.push(...moves), date), "e-lisa", date);
  const h = (date, key, amount) => ({id: key + date, date, person: "ethan", from: "", to: "e-lisa", amount, key: key + date});
  const hist = [h("2026-05-11", "lisa:in:", 334), h("2026-07-09", "lisa:in:", 334), h("2026-08-07", "lisa:in:", 334), h("2026-09-09", "lisa:in:", 334), h("2026-09-30", "lisa:in:", 334),
    h("2026-07-30", "lisa:bonus:", 167), h("2026-09-03", "lisa:bonus:", 83.5), h("2026-10-01", "lisa:bonus:", 83.5), h("2026-10-26", "lisa:bonus:", 83.5)];
  const a = L(hist, "2026-10-26");
  eq("1.4 LISA: the real history is all settled", [a.expectedBonus, a.expectedBonusTotal], [[], 0]);
  const b = L(hist, "2026-10-20");
  eq("1.4 LISA: before the last bonus, 30 Sep's is still to come", b.expectedBonus, [{amount: 83.5, due: "2026-11-11", "for": "2026-09"}]);
  eq("1.4 LISA: in early September, August's", L(hist, "2026-09-02").expectedBonus, [{amount: 83.5, due: "2026-09-18", "for": "2026-08"}]);
  // payday ticks and bank feed rows count; the statement row for a ticked move only once
  const tick = {id: "pt", date: "2026-10-29", person: "ethan", from: "e-main", to: "e-lisa", amount: 333, key: "pay:2026-10-29:e-lisa"};
  const c = L(hist.concat([tick, h("2026-10-30", "lisa:in:", 333), {id: "bk", date: "2026-11-12", person: "ethan", from: "", to: "e-lisa", amount: 100, key: "bank:mb:123"}]), "2026-11-20");
  eq("1.4 LISA: payday tick and bank feed", c.expectedBonus, [{amount: 83.25, due: "2026-12-10", "for": "2026-10"}, {amount: 25, due: "2026-12-24", "for": "2026-11"}]);
  near("1.4 LISA: expected total", c.expectedBonusTotal, 108.25);
  near("1.4 LISA: not in the balance", c.balance, 10000 + 333 + 100);
  // nothing over £4,000 a tax year gets a bonus
  const d = L([h("2026-06-01", "lisa:in:", 3800), h("2026-07-01", "lisa:in:", 500)], "2026-07-05");
  eq("1.4 LISA: £4,000 limit", d.expectedBonus.map(x => x.amount), [950, 50]);
  eq("1.4 LISA: the old fields are still there", ["balance", "paidThisYear", "bonusThisYear", "planned", "onCourse", "months", "series", "bonusReceived", "feesThisYear"].every(k => k in a), true);
})();

// a monthly reminder to check the LISA
(() => {
  const id = "lisa-month-2026-11-e-lisa";
  eq("1.4 check: valued 25 days ago, nothing to do", B.checks(dbt(null, "2026-11-20"), "ethan").length, 0);
  eq("1.4 check: 31 days, check it", B.checks(dbt(null, "2026-11-26"), "ethan"), [{id, key: "check:" + id, text: "Check your Lifetime ISA in Moneybox and update its value", action: "potcheck", value: "e-lisa", order: 40}]);
  eq("1.4 check: a new value clears it", B.checks(dbt(t => t.valuations.push({id: "vl", account: "e-lisa", date: "2026-11-26", amount: 11500}), "2026-11-26"), "ethan").length, 0);
  eq("1.4 check: \"It's right\" hides it for the month", B.checks(dbt(t => t.settings.push({person: "ethan", key: "check:" + id, value: "done"}), "2026-11-26"), "ethan").length, 0);
  eq("1.4 check: and it's back next month", B.checks(dbt(t => t.settings.push({person: "ethan", key: "check:" + id, value: "done"}), "2026-12-27"), "ethan").map(c => c.id), ["lisa-month-2026-12-e-lisa"]);
  eq("1.4 check: a date can be given", B.checks(e, "ethan", "2026-11-26").map(c => c.id), [id]);
  eq("1.4 check: only your own LISA", B.checks(dbt(null, "2026-12-27"), "sophie").length, 0);
})();

// the tax year round-up
(() => {
  const mut = t => {
    t.transactions.push({id: "r1", date: "2026-11-02", person: "ethan", amount: 40, budget: "e-food-b", account: "e-food"}, {id: "r2", date: "2026-11-03", person: "ethan", amount: 20, budget: "e-fun", account: "e-main"},
      {id: "r3", date: "2026-12-10", person: "ethan", amount: 100, budget: "e-fun", account: "e-main", split: "half"}, {id: "r4", date: "2026-12-11", person: "sophie", amount: 30, budget: "s-food", account: "s-main", split: "half"},
      {id: "r5", date: "2027-04-06", person: "ethan", amount: 99, budget: "e-fun", account: "e-main"});
    t.moves.push({id: "w1", date: "2026-11-20", person: "ethan", from: "e-isa", to: "e-main", amount: 400, key: "isa-out"}, {id: "pl", date: "2026-10-29", person: "ethan", from: "e-main", to: "e-lisa", amount: 333, key: "pay:2026-10-29:e-lisa"});
  };
  const d = dbt(mut, "2027-04-05"), r = B.yearReview(d, "ethan", "2026-04-06");
  eq("1.4 review: dates", [r.from, r.to, r.until], ["2026-04-06", "2027-04-05", "2027-04-05"]);
  near("1.4 review: in (6 pays, Sophie's shares, sofa repayments)", r.in, 6 * 2400 + 5 * 500 + 6 * 140 + 600);
  near("1.4 review: bills", r.bills, 5 * 1200 + 6 * 420 + 6 * 20);
  eq("1.4 review: biggest bill", [r.billsBy[0].id, r.billsBy[0].count], ["e-rent", 5]);
  eq("1.4 review: spent by budget (your share, Sophie's split food matched by name)", r.spent, [{budget: "e-fun", name: "Fun", amount: 70}, {budget: "e-food-b", name: "Food", amount: 55}]);
  eq("1.4 review: biggest month", r.biggestMonth, {month: "2026-12", name: "Dec 2026", amount: 65});
  eq("1.4 review: no-spend days since tracking started", r.noSpendDays, B.diff("2026-10-26", "2027-04-05") + 1 - 3);
  let planned = 0; B.periods(d, "ethan", "2026-10-26", "2027-04-06").forEach(pk => { if (pk.start >= "2026-10-26") planned += B.planFor(d, "ethan", pk).totals.save; });
  near("1.4 review: saved = planned savings less the ISA withdrawal", r.saved, planned - 400);
  eq("1.4 review: saved %", r.savedPct, Math.round(r.saved / r.in * 100));
  const L = B.lisa(d, "e-lisa", "2027-04-05");
  eq("1.4 review: LISA", r.lisa, {paidIn: L.paidThisYear, bonus: L.bonusReceived, fees: L.feesThisYear, value: L.balance, expectedBonus: L.expectedBonusTotal});
  eq("1.4 review: goals", r.goals.map(g => [g.name, g.start, g.end]), [["House deposit", 10000, L.balance]]);
  const part = B.yearReview(dbt(mut, "2026-12-01"), "ethan", "2026-04-06");
  eq("1.4 review: part of a year", [part.until, part.spent.map(s => s.amount)], ["2026-12-01", [40, 20]]);
  eq("1.4 review: a year before tracking", [B.yearReview(d, "ethan", "2025-04-06").in, B.yearReview(d, "ethan", "2025-04-06").noSpendDays], [0, 0]);
  eq("1.4 review: Sophie (her half of Ethan's split fun, and of her own food shop)", B.yearReview(d, "sophie", "2026-04-06").spent, [{budget: "s-fun", name: "Fun", amount: 50}, {budget: "s-food", name: "Food", amount: 15}]);
  // quick enough to run on the server for both: three years of daily spending, every payday ticked
  const t = fixture(); let n = 0, seed = 7; const rnd = () => (seed = (seed * 9301 + 49297) % 233280) / 233280;
  for (let x = "2026-10-27"; x < "2029-10-27"; x = B.addDays(x, 1)) {
    if (rnd() < 0.6) t.transactions.push({id: "q" + n++, date: x, person: "ethan", amount: +(5 + rnd() * 30).toFixed(2), budget: rnd() < 0.6 ? "e-food-b" : "e-fun", account: "e-food"});
    if (rnd() < 0.6) t.transactions.push({id: "q" + n++, date: x, person: "sophie", amount: +(3 + rnd() * 20).toFixed(2), budget: "s-food", account: "s-main", split: rnd() < 0.1 ? "half" : ""});
  }
  t.bills.push({id: "e-ins", person: "ethan", name: "Car insurance", amount: 600, account: "e-car", unit: "year", start: "2027-03-18"});
  const big0 = B.load(t, "2029-10-27");
  B.periods(big0, "ethan", "2026-10-29", "2029-10-27").forEach((p, i) => { if (p.pay && !p.opening) B.payday(big0, "ethan", p).moves.forEach((m, j) => t.moves.push({id: "pm" + i + "-" + j, date: p.start, person: "ethan", from: m.from, to: m.to, amount: m.amount, key: "pay:" + p.start + ":" + m.to})); });
  const s0 = Date.now(), big = B.load(t, "2029-10-20"); ["ethan", "sophie"].forEach(p => { B.yearReview(big, p, "2028-04-06"); B.yearReview(big, p, "2029-04-06"); }); const ms = Date.now() - s0;
  eq("1.4 review: quick (" + ms + " ms for two people, two years)", ms < 3000, true);
})();

// other apps load budgie/engine.js in the browser and call these with exactly these shapes: they must never break
(() => {
  const tables = fixture(), me = "ethan", c = B.load(tables, "2026-10-26");
  eq("compat: load(tables, today)", [typeof c, Array.isArray(c.bills), c.today], ["object", true, "2026-10-26"]);
  eq("compat: load(tables) without today", typeof B.load(fixture()).byId, "object");
  eq("compat: load with only some tables", B.load({people: tables.people, bills: tables.bills}, "2026-10-26").bills.length, tables.bills.length);
  const cm = B.coming(c, me, "2026-10-26", 14);
  eq("compat: coming(db, me, from, days)", Array.isArray(cm) && cm.length > 0 && ["date", "key", "item", "table", "name", "amount", "sign", "account", "changed"].every(k => k in cm[0]), true);
  eq("compat: coming dates in the window", cm.every(x => x.date > "2026-10-26" && x.date <= "2026-11-09"), true);
  const per = B.periodAt(c, me, "2026-11-05");
  eq("compat: periodAt(db, me, date)", per, {start: "2026-10-29", next: "2026-11-26", name: "Nov 2026", pay: true, opening: false});
  const pl = B.planFor(c, me, per);
  eq("compat: planFor(db, me, per)", [Array.isArray(pl.lines), typeof pl.remainder, typeof pl.shortfall, Object.keys(pl.totals)], [true, "number", "number", ["in", "bills", "spend", "save"]]);
  eq("compat: plan lines", pl.lines.every(l => typeof l.kind === "string" && typeof l.name === "string" && typeof l.amount === "number" && "account" in l), true);
  const bs = B.budgetState(c, me, per);
  eq("compat: budgetState(db, me, per)", ["amount", "spent", "left", "avail", "carryIn", "carryOut", "over"].every(k => k in bs["e-fun"]) && bs["e-fun"].period.start === per.start, true);
  eq("compat: still exported", ["load", "coming", "periodAt", "planFor", "budgetState", "today", "checks", "lisa", "yearly", "yearReview"].every(k => typeof B[k] === "function"), true);
  eq("compat: version", B.VERSION, "1.4.0");
})();

// C3: a payday move ticked in the app and by the bank feed counts once (the latest)
(() => {
  const two = B.load((() => { const t = fixture(); t.moves.push({id: "mv-app", date: "2026-10-29", person: "ethan", from: "e-main", to: "e-lisa", amount: 300, key: "pay:2026-10-29:e-lisa", updated: 1000}, {id: "bk-monzo-1", date: "2026-10-29", person: "ethan", from: "e-main", to: "e-lisa", amount: 333, key: "pay:2026-10-29:e-lisa", updated: 2000}); return t; })(), "2026-11-02");
  near("C3: the LISA got the move once", B.balances(two, "2026-11-02")["e-lisa"] - 10000, 333);
  near("C3: and the tick counts once", two.moveKeys["pay:2026-10-29:e-lisa"], 333);
  eq("C3: Ethan's and Sophie's ticks of the same key are separate", B.load((() => { const t = fixture(); t.moves.push({id: "a", date: "2026-10-29", person: "ethan", from: "e-main", to: "e-bills", amount: 10, key: "pay:2026-10-29:x", updated: 1}, {id: "b", date: "2026-10-29", person: "sophie", from: "s-main", to: "s-rent", amount: 10, key: "pay:2026-10-29:x", updated: 2}); return t; })()).moves.filter(m => !m.dup).length, 2);
})();
// --- whole picture runs without errors for both, across a year
["ethan", "sophie"].forEach(p => {
  for (let d = "2026-10-26"; d < "2027-11-01"; d = B.addDays(d, 17)) { B.today(e, p, d); B.pots(e, p, d); B.year(e, p, d); B.summary(e, p, d); }
});
passes++;

console.log(fails ? fails + " failed, " + passes + " passed" : "All " + passes + " passed");
process.exit(fails ? 1 : 0);
