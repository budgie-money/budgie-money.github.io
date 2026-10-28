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

// --- pennies and dates that don't exist
eq("halves round up to the penny, as on paper", [B.round(1.005), B.round(10.075), B.round(2.675), B.round(-0.005), B.round(-1.005)], [1.01, 10.08, 2.68, -0.01, -1.01]);
eq("a payment split half each of £20.15 is £10.08 each", B.round(B.shareOf(db(), "half", "sophie", 20.15, "ethan")), 10.08);
eq("an ISO day that isn't in its month isn't a date either", [B.parseDate("2027-02-30"), B.parseDate("2027-13-01"), B.parseDate("2028-02-29"), B.parseDate("2026-10-26")], ["", "", "2028-02-29", "2026-10-26"]);
eq("a day that isn't in its month isn't a date", [B.parseDate("31/02/2027"), B.parseDate("30 Feb 2027"), B.parseDate("1/13/2027"), B.parseDate("29/02/2028")], ["", "", "", "2028-02-29"]);

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
  const id = "lisa-month-2026-11-e-lisa", L = (d, p, x) => B.checks(d, p, x).filter(c => /^lisa-/.test(c.id));
  eq("1.4 check: valued 25 days ago, nothing to do", L(dbt(null, "2026-11-20"), "ethan").length, 0);
  eq("1.4 check: 31 days, check it", L(dbt(null, "2026-11-26"), "ethan"), [{id, key: "check:" + id, text: "Check your Lifetime ISA in Moneybox and update its value", action: "potcheck", value: "e-lisa", order: 40}]);
  eq("1.4 check: a new value clears it", L(dbt(t => t.valuations.push({id: "vl", account: "e-lisa", date: "2026-11-26", amount: 11500}), "2026-11-26"), "ethan").length, 0);
  eq("1.4 check: \"It's right\" hides it for the month", L(dbt(t => t.settings.push({person: "ethan", key: "check:" + id, value: "done"}), "2026-11-26"), "ethan").length, 0);
  eq("1.4 check: and it's back next month", L(dbt(t => t.settings.push({person: "ethan", key: "check:" + id, value: "done"}), "2026-12-27"), "ethan").map(c => c.id), ["lisa-month-2026-12-e-lisa"]);
  eq("1.4 check: a date can be given", L(e, "ethan", "2026-11-26").map(c => c.id), [id]);
  eq("1.4 check: only your own LISA", L(dbt(null, "2026-12-27"), "sophie").length, 0);
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
  eq("compat: version", B.VERSION, "1.4.19");
})();

// C3: a payday move ticked in the app and by the bank feed counts once (the latest)
(() => {
  const two = B.load((() => { const t = fixture(); t.moves.push({id: "mv-app", date: "2026-10-29", person: "ethan", from: "e-main", to: "e-lisa", amount: 300, key: "pay:2026-10-29:e-lisa", updated: 1000}, {id: "bk-monzo-1", date: "2026-10-29", person: "ethan", from: "e-main", to: "e-lisa", amount: 333, key: "pay:2026-10-29:e-lisa", updated: 2000}); return t; })(), "2026-11-02");
  near("C3: the LISA got the move once", B.balances(two, "2026-11-02")["e-lisa"] - 10000, 333);
  near("C3: and the tick counts once", two.moveKeys["pay:2026-10-29:e-lisa"], 333);
  eq("C3: Ethan's and Sophie's ticks of the same key are separate", B.load((() => { const t = fixture(); t.moves.push({id: "a", date: "2026-10-29", person: "ethan", from: "e-main", to: "e-bills", amount: 10, key: "pay:2026-10-29:x", updated: 1}, {id: "b", date: "2026-10-29", person: "sophie", from: "s-main", to: "s-rent", amount: 10, key: "pay:2026-10-29:x", updated: 2}); return t; })()).moves.filter(m => !m.dup).length, 2);
})();
// R1: "Got it" on a pot that will be short makes the warning go away (it saves a move with the warning's key)
(() => {
  const t = fixture(); t.bills.push({id: "e-big", person: "ethan", name: "Car repair", amount: 5000, account: "e-car", unit: "once", start: "2026-10-28"});
  const warns = (x) => B.todo(B.load(x, "2026-10-27"), "ethan", "2026-10-27").filter(i => i.type === "warn").map(i => i.key);
  eq("R1: the Car pot will be short", warns(t), ["short:e-car:2026-10-28"]);
  t.moves.push({id: "mv-x", date: "2026-10-27", person: "ethan", amount: 0, key: "short:e-car:2026-10-28", note: "dismissed"});
  eq("R1: and once it's dismissed it stays away", warns(t), []);
})();
// R2: paid on the same day: Sophie's payday cover isn't topped up from Ethan's next pay
(() => {
  const t = fixture(), top = (x) => (B.planFor(x, "ethan", B.periodAt(x, "ethan", "2026-11-27")).lines.find(l => l.kind === "topup") || {}).amount || 0;
  t.moves.push({id: "mv-s-cover", date: "2026-10-29", person: "sophie", from: "s-savings", to: "s-main", amount: 100, key: "pay:2026-10-29:cover"});
  near("R2: nothing to top up for Ethan", top(B.load(t, "2026-11-27")), 0);
  t.moves.push({id: "mv-e-cover", date: "2026-10-29", person: "ethan", from: "e-emergency", to: "e-main", amount: 40, key: "pay:2026-10-29:cover"});
  near("R2: his own cover is topped up", top(B.load(t, "2026-11-27")), 40);
})();
// R3: with nothing shared, the partner summary doesn't say whether Sophie is on track or over budget
(() => {
  const t = fixture(); t.settings.push({person: "sophie", key: "share.totals", value: "false"}, {person: "sophie", key: "share.cats", value: "false"});
  const off = B.summary(B.load(t, "2026-11-05"), "sophie", "2026-11-05"), on = B.summary(B.load(fixture(), "2026-11-05"), "sophie", "2026-11-05");
  eq("R3: nothing shared: no status, totals or budgets", [off.status, off.safe, off.tiles, off.nextPay], [undefined, undefined, undefined, "2026-11-27"]);
  eq("R3: shared: the status is there", typeof on.status, "string");
})();
// R6: family topping up the LISA earns the bonus too: the bonus to come counts it, like the paid-in total does
(() => {
  const t = fixture(); t.income.push({id: "e-par", person: "ethan", name: "Family LISA top-up", amount: 167, account: "e-lisa", unit: "month", on: "1", start: "2026-11-01"});
  t.moves.push({id: "m1", date: "2026-10-29", person: "ethan", from: "e-main", to: "e-lisa", amount: 300, key: "pay:2026-10-29:e-lisa"});
  const L = B.lisa(B.load(t, "2026-12-20"), "e-lisa", "2026-12-20");
  near("R6: paid in: the payday move and two top-ups", L.paidThisYear, 300 + 2 * 167);
  near("R6: a quarter of all of it is still to come", L.expectedBonusTotal, 0.25 * (300 + 2 * 167));
  eq("R6: by the month it went in", L.expectedBonus.map(x => x.for), ["2026-10", "2026-11", "2026-12"]);
  t.moves.push({id: "m2", date: "2026-12-15", person: "ethan", to: "e-lisa", amount: 116.75, key: "lisa:bonus:1"});
  near("R6: a bonus that lands settles the oldest first", B.lisa(B.load(t, "2026-12-20"), "e-lisa", "2026-12-20").expectedBonusTotal, 41.75);
})();
// R7 (1.4.4): a goal Sophie shares shows how far it's got, never each account's balance or her notes
(() => {
  const t = fixture(); t.goals.push({id: "s-car", owners: "sophie", name: "Car", target: 5000, accounts: "s-savings, s-main", notes: "private", kind: "car"});
  t.valuations.push({id: "v-s", account: "s-savings", date: "2026-10-26", amount: 1234});
  const g = (B.summary(B.load(t, "2026-11-05"), "sophie", "2026-11-05").goals || [])[0] || {};
  eq("R7: the shared goal is there, with its progress", [g.name, g.target, g.saved > 1000], ["Car", 5000, true]);
  eq("R7: but not the accounts in it or its notes", [g.parts, g.notes, g.accounts], [undefined, undefined, undefined]);
})();
// R8 (1.4.4): a move only ever ticks off its own person's To do, whatever key it carries (the partner's LISA moves are seen)
(() => {
  const t = fixture(), d = "2026-11-27", key = "pay:" + d + ":s-rent";
  const before = B.todo(B.load(t, d), "sophie", d).filter(x => x.key === key).length;
  t.moves.push({id: "m-his", date: d, person: "ethan", from: "e-main", to: "e-lisa", amount: 0.01, key: key});
  const after = B.todo(B.load(t, d), "sophie", d).filter(x => x.key === key).length;
  eq("R8: Sophie's payday move is still to do after Ethan's move with its key", [before, after], [1, 1]);
  t.moves.push({id: "m-hers", date: d, person: "sophie", from: "s-main", to: "s-rent", amount: 999, key: key});
  eq("R8: her own tick does it", B.todo(B.load(t, d), "sophie", d).filter(x => x.key === key).length, 0);
  // both paid on the same day: the payday cover key is the same for both, but each counts only their own tick
  t.moves.push({id: "m-cov", date: d, person: "sophie", from: "s-savings", to: "s-main", amount: 50, key: "pay:" + d + ":cover"});
  const L = B.load(t, d);
  eq("R8: Sophie's cover doesn't tick Ethan's", [B.ticked(L, "ethan", "pay:" + d + ":cover") > 0, B.ticked(L, "sophie", "pay:" + d + ":cover") > 0], [false, true]);
})();
// A2: a loan paid from a pot is paid back into the main account, as the repayment is logged, so payday still tops the pot up
(() => {
  const t = fixture(); t.loans[0].account = "e-emergency";
  t.transactions.push({id: "t-over", date: "2026-12-10", person: "ethan", amount: 400, budget: "e-fun", account: "e-main"});
  t.settlements.push({id: "s-rep", date: "2026-12-28", from: "sophie", to: "ethan", amount: 200, loan: "sofa", key: "loan:sofa:2026-12-28"});
  const L = B.load(t, "2026-12-31"), per = B.periodAt(L, "ethan", "2026-12-24");
  eq("A2: the repayment is planned into the main account", B.planFor(L, "ethan", per).lines.filter(l => l.loan).map(l => l.account), ["e-main"]);
  eq("A2: and the Emergency pot's top-up is still moved on payday", B.payday(L, "ethan", per).moves.filter(m => m.to === "e-emergency").map(m => m.amount), [100]);
  eq("A2: Coming up says where it lands", B.coming(L, "ethan", "2027-01-20", 10).filter(c => c.table === "loans").map(c => c.account), ["Main account"]);
})();
// --- whole picture runs without errors for both, across a year
["ethan", "sophie"].forEach(p => {
  for (let d = "2026-10-26"; d < "2027-11-01"; d = B.addDays(d, 17)) { B.today(e, p, d); B.pots(e, p, d); B.year(e, p, d); B.summary(e, p, d); }
});
passes++;

// R1: money on screen is rounded the same way as the sums (halves away from zero)
eq("R1: money shows halves rounded as the sums are", [B.money(10.075), B.money(1.005), B.money(2.675), B.money(-0.005), B.money(-0.004), B.money(1234567.891), B.money("x")], ["£10.08", "£1.01", "£2.68", "-£0.01", "£0.00", "£1,234,567.89", "£0.00"]);
eq("R1: half of £20.15 shows as what's owed", B.money(B.shareOf(db(), "half", "sophie", 20.15, "ethan")), "£10.08");

// L1: a loan paid back early (in one go, or partly) isn't planned to be paid (or to come in) again
{
  const loanLines = (t, who, date, n) => { const L = B.load(t, date); let per = B.periodAt(L, who, date); const out = []; for (let i = 0; i < n; i++) { out.push(B.planFor(L, who, per).lines.filter(l => l.loan).map(l => l.amount + " " + l.date).join()); per = B.nextPeriod(L, who, per); } return out; };
  const all = fixture(); all.settlements.push({id: "lump", date: "2026-12-01", from: "sophie", to: "ethan", amount: 600, loan: "sofa", key: "loan:sofa:lump"});
  eq("L1: paid back in full early: no repayments planned for Sophie", loanLines(all, "sophie", "2026-12-05", 4), ["", "", "", ""]);
  eq("L1: and none planned to come in for Ethan", loanLines(all, "ethan", "2026-12-05", 4), ["", "", "", ""]);
  near("L1: nor counted as money in for his year", B.yearReview(B.load(all, "2027-04-05"), "ethan", "2026-04-06").in - B.yearReview(B.load(fixture(), "2027-04-05"), "ethan", "2026-04-06").in, 0);
  const part = fixture(); part.settlements.push({id: "lump", date: "2026-12-01", from: "sophie", to: "ethan", amount: 300, loan: "sofa", key: "loan:sofa:lump"});
  eq("L1: £300 paid early covers December's £200 and half of January's", loanLines(part, "sophie", "2026-12-05", 4), ["", "", "100 2027-01-28", "200 2027-02-28"]);
  const onTime = fixture(); onTime.settlements.push({id: "r1", date: "2026-12-28", from: "sophie", to: "ethan", amount: 200, loan: "sofa", key: "loan:sofa:2026-12-28"});
  eq("L1: a repayment paid on its day still counts in its own month", loanLines(onTime, "sophie", "2026-12-29", 3), ["200 2026-12-28", "200 2027-01-28", "200 2027-02-28"]);
}

// ================= review 2026-10-27 (1.4.7) =================
// S1: settling up what's shown for an odd-penny split leaves you all square, not a penny owed back and forth
{
  const t = fixture(), d = "2026-10-28";
  t.transactions.push({id: "t-odd", date: d, person: "ethan", amount: 20.15, budget: "e-fun", account: "e-main", split: "half"});
  const owed = B.between(B.load(t, d), "ethan", d).owedToMe;
  near("S1: half of £20.15 is owed as £10.08", owed, 10.08);
  t.settlements.push({id: "set-odd", date: d, from: "sophie", to: "ethan", amount: owed, key: "split:" + d, note: "Settled up"});
  const L = B.load(t, d), e1 = B.between(L, "ethan", d), s1 = B.between(L, "sophie", d);
  eq("S1: after paying the £10.08 you're both all square", [e1.owedToMe, e1.iOwe, s1.owedToMe, s1.iOwe], [0, 0, 0, 0]);
  eq("S1: and neither To do asks for a penny", B.todo(L, "ethan", d).concat(B.todo(L, "sophie", d)).filter(x => x.type === "settle").map(x => x.what), []);
  // three odd halves: what's shown is still what's paid, and that still squares it
  const u = fixture();
  ["a", "b", "c"].forEach((x, i) => u.transactions.push({id: "t-" + x, date: d, person: "sophie", amount: 7.33 + i * 2, budget: "s-food", account: "s-main", split: "half"}));
  const iOwe = B.between(B.load(u, d), "ethan", d).iOwe;
  u.settlements.push({id: "set-3", date: d, from: "ethan", to: "sophie", amount: iOwe, key: "split:" + d});
  eq("S1: after three odd halves too", B.between(B.load(u, d), "ethan", d).net, 0);
  eq("S1: a whole penny is still owed", B.between(B.load(Object.assign(fixture(), {transactions: [{id: "t-2p", date: d, person: "ethan", amount: 0.02, budget: "e-fun", account: "e-main", split: "half"}]}), d), "sophie", d).iOwe, 0.01);
}

// S2: a repayment that's partly paid already asks only for the rest, in To do, Coming up and Debts
{
  const t = fixture(); t.settlements.push({id: "part", date: "2026-12-01", from: "sophie", to: "ethan", amount: 300, loan: "sofa", key: "loan:sofa:part"});
  const L = B.load(t, "2027-01-28");
  eq("S2: To do asks Sophie for the £100 left of January's", B.todo(L, "sophie", "2027-01-28").filter(x => x.type === "loan").map(x => [x.amount, x.what]), [[100, "Pay Ethan £100.00"]]);
  eq("S2: and tells Ethan £100 is coming", B.todo(L, "ethan", "2027-01-28").filter(x => x.type === "loan").map(x => x.amount), [100]);
  eq("S2: Coming up says the same", B.coming(B.load(t, "2027-01-20"), "sophie", "2027-01-20", 14).filter(c => c.table === "loans").map(c => c.amount), [100]);
  eq("S2: Debts lists £100 then £200", B.loans(L, "sophie", "2027-01-20")[0].plan.map(r => r.amount), [100, 200]);
}
// ================= review 2026-10-27b (1.4.8) =================
// L2: a repayment ticked for its own date pays that one, so one still owed from an earlier month stays in To do
{
  const t = fixture(), d = "2027-01-28";
  // December's £200 wasn't ticked; on 28 January Sophie ticks January's, the one due today
  t.settlements.push({id: "s-jan", date: d, from: "sophie", to: "ethan", amount: 200, loan: "sofa", key: "loan:sofa:2027-01-28"});
  const L = B.load(t, d), loanTodo = (p, L2, d2) => B.todo(L2, p, d2).filter(x => x.type === "loan").map(x => [x.key, x.amount]);
  eq("L2: December's repayment is still asked for", loanTodo("sophie", L, d), [["loan:sofa:2026-12-28", 200]]);
  eq("L2: and Ethan is still told it's coming", loanTodo("ethan", L, d), [["loan:sofa:2026-12-28", 200]]);
  eq("L2: Debts lists December's and February's as still to pay", B.loans(L, "sophie", d)[0].plan.map(r => r.date + " " + r.amount), ["2026-12-28 200", "2027-02-28 200"]);
  // money paid early without a repayment's key still pays the earliest first
  const u = fixture(); u.settlements.push({id: "s-early", date: "2026-12-01", from: "sophie", to: "ethan", amount: 250, loan: "sofa", key: "loan:sofa:early"});
  eq("L2: an early payment still pays the earliest first", B.loans(B.load(u, "2026-12-02"), "sophie", "2026-12-02")[0].plan.map(r => r.date + " " + r.amount), ["2027-01-28 150", "2027-02-28 200"]);
  // more than a repayment's own amount under its key: the rest pays the earliest still owed
  const w = fixture(); w.settlements.push({id: "s-big", date: d, from: "sophie", to: "ethan", amount: 300, loan: "sofa", key: "loan:sofa:2027-01-28"});
  eq("L2: anything over a repayment pays the earliest still owed", B.loans(B.load(w, d), "sophie", d)[0].plan.map(r => r.date + " " + r.amount), ["2026-12-28 100", "2027-02-28 200"]);
}
// T1: a payday move ticked in a new tax year (March's LISA money moved on 7 April) is dated when it was moved, as
// the bank feed dates it, so it counts towards this tax year's £4,000 and not last year's
{
  eq("T1: ticked in the same tax year: dated on payday", B.moveDate("pay:2027-03-25:e-lisa", "2027-04-05"), "2027-03-25");
  eq("T1: ticked after 6 April: dated the day it was ticked", B.moveDate("pay:2027-03-25:e-lisa", "2027-04-07"), "2027-04-07");
  const t = fixture(); t.moves.push({id: "m-lisa", date: B.moveDate("pay:2027-03-25:e-lisa", "2027-04-07"), person: "ethan", from: "e-main", to: "e-lisa", amount: 300, key: "pay:2027-03-25:e-lisa"});
  eq("T1: and the LISA counts it in the new tax year", B.lisa(B.load(t, "2027-04-08"), "e-lisa", "2027-04-08").paidThisYear, 300);
}
// P4: a setting typed into the sheet for a person or key called like a built-in name is just a setting
{
  const t = fixture(); t.settings.push({person: "__proto__", key: "split", value: "half"}, {person: "ethan", key: "x", value: "1"});
  const L = B.load(t, "2026-10-28");
  eq("P4: nothing leaks into JavaScript's own objects", [({}).split, Object.prototype.hasOwnProperty.call(Object.prototype, "split")], [undefined, false]);
  eq("P4: a setting that isn't there is the default, whatever its name", [B.setting(L, "ethan", "constructor", "d"), B.setting(L, "ethan", "toString", "d"), B.setting(L, "nobody", "valueOf", "d")], ["d", "d", "d"]);
}
// P6: an account, budget or payment called like a built-in name (typed into the sheet) adds up like any other
{
  const t = fixture(), d = "2026-11-02";
  t.accounts.push({id: "constructor", owner: "ethan", name: "Odd pot", kind: "pot", order: 6}, {id: "toString", owner: "ethan", name: "Odd LISA", kind: "lisa", order: 7});
  t.valuations.push({id: "v-odd", account: "constructor", date: "2026-10-26", amount: 70}, {id: "v-odd2", account: "toString", date: "2026-10-26", amount: 500});
  t.moves.push({id: "isPrototypeOf", date: "2026-10-30", person: "ethan", from: "e-main", to: "toString", amount: 40, key: "lisa:in:1"});
  t.transactions.push({id: "hasOwnProperty", date: "2026-10-30", person: "ethan", amount: 5, budget: "e-fun", account: "constructor"});
  const L = B.load(t, d);
  eq("P6: its balance is its last check plus what's happened since", B.balances(L, d).constructor, 65);
  eq("P6: and a payment in called isPrototypeOf counts towards the LISA's allowance", B.lisa(L, "toString", d).paidThisYear, 40);
  eq("P6: and the payment from it is asked back from the pot it's for", B.todo(L, "ethan", d).filter(x => x.type === "move" && x.to === "constructor").map(x => x.amount), [5]);
}
// ================= review 2026-10-27c (1.4.9) =================
// F1: a pot that will run short before payday, with the money in the main account: the move To do suggests can be
// ticked like any other (it says which key it ticks off, and how much)
{
  const t = fixture(), d = "2026-11-02"; t.valuations.push({id: "v-sm", account: "s-main", date: "2026-10-26", amount: 2000});
  const fill = B.todo(B.load(t, d), "sophie", d).filter(x => x.fill);
  eq("F1: the move to fill the Space is in To do", fill.map(x => [x.from, x.to, x.amount]), [["s-main", "s-rent", 640]]);
  eq("F1: and it carries the key it ticks off", fill.map(x => x.keys), [[{key: "fill:s-rent:2026-11-13", amount: 640}]]);
}
// C1: the Bills calendar shows what's due on the last day of the month (pay on the last working day, a bill on the 31st)
{
  const L = B.load(fixture(), "2026-11-02"), nov = B.calendar(L, "sophie", 2026, 10), dec = B.calendar(L, "sophie", 2026, 11);
  eq("C1: Sophie's side income on Mon 30 Nov is on November's calendar", (nov["2026-11-30"] || []).map(c => c.name), ["Side income"]);
  eq("C1: and on Thu 31 Dec on December's", (dec["2026-12-31"] || []).map(c => c.name), ["Side income"]);
  eq("C1: and nothing from the next month creeps in", Object.keys(nov).every(k => k.slice(0, 7) === "2026-11") && Object.keys(dec).every(k => k.slice(0, 7) === "2026-12"), true);
}
// L3: a repayment only partly paid under its own key (the monthly amount went up after it was ticked) still asks for the
// rest in To do, as Debts says
{
  const t = fixture(), d = "2027-01-05"; t.loans[0].repay = 250;
  t.settlements.push({id: "s-dec", date: "2026-12-28", from: "sophie", to: "ethan", amount: 200, loan: "sofa", key: "loan:sofa:2026-12-28"});
  const L = B.load(t, d);
  eq("L3: To do asks Sophie for the £50 left of December's", B.todo(L, "sophie", d).filter(x => x.type === "loan").map(x => [x.key, x.amount]), [["loan:sofa:2026-12-28", 50]]);
  eq("L3: as Debts does", B.loans(L, "sophie", d)[0].plan.map(r => r.date + " " + r.amount)[0], "2026-12-28 50");
}
// ================= review 2026-10-27d (1.4.10) =================
// S1: what a split payment owes is to the penny, so settling up the £10.08 shown for half of £20.15 leaves nothing
// over: half of a later £9 is £4.50 owed, not £4.51
{
  const t = fixture(), d = "2026-11-02";
  t.transactions.push({id: "t-s1a", date: d, person: "ethan", amount: 20.15, budget: "e-fun", account: "e-main", split: "half"});
  t.settlements.push({id: "s-s1", date: d, from: "sophie", to: "ethan", amount: 10.08, key: "split:" + d});
  t.transactions.push({id: "t-s1b", date: d, person: "sophie", amount: 9, budget: "s-food", account: "s-main", split: "half"});
  const L = B.load(t, d);
  eq("S1: Ethan owes Sophie £4.50", B.between(L, "ethan", d).iOwe, 4.5);
  eq("S1: and Sophie's phone says the same", B.between(L, "sophie", d).owedToMe, 4.5);
  eq("S1: To do asks for £4.50", B.todo(L, "ethan", d).filter(x => x.type === "settle").map(x => x.amount), [4.5]);
}
// F2: a pot filled from the fallback pot before a payment (the main account couldn't) is put back on the next payday,
// like covering for going over
{
  const t = fixture(), d = "2026-11-10";
  const L0 = B.load(t, "2026-10-30"), per = B.periodAt(L0, "ethan", "2026-10-30");
  B.payday(L0, "ethan", per).moves.forEach((m, i) => t.moves.push({id: "pm" + i, date: per.start, person: "ethan", from: m.from, to: m.to, amount: m.amount, key: "pay:" + per.start + ":" + m.to}));
  t.transactions.push({id: "t-f2", date: "2026-11-09", person: "ethan", amount: 100, budget: "e-fun", account: "e-main"});
  t.exceptions.push({id: "x-e-rent-2026-11-16-amount", item: "e-rent", date: "2026-11-16", action: "amount", amount: 1500});
  const fill = B.todo(B.load(t, d), "ethan", d).filter(x => x.fill);
  eq("F2: the fill comes from the Emergency pot, and says it's put back", fill.map(x => [x.from, x.to, x.amount, /next pay tops the Emergency pot back up/.test(x.why)]), [["e-emergency", "e-bills", 300, true]]);
  t.moves.push({id: "m-f2", date: d, person: "ethan", from: "e-emergency", to: "e-bills", amount: 300, key: fill[0].keys[0].key});
  const L = B.load(t, "2026-11-27"), pl = B.planFor(L, "ethan", B.periodAt(L, "ethan", "2026-11-27"));
  eq("F2: the next payday tops the Emergency pot back up", pl.lines.filter(l => l.kind === "topup").map(l => [l.account, l.amount]), [["e-emergency", 300]]);
}
// F3: a pot filled before a payment that then needs more (the bill came in higher after the move was ticked) is asked
// for the rest, rather than the ticked move hiding it
{
  const t = fixture(), d = "2026-11-02"; t.valuations.push({id: "v-sm", account: "s-main", date: "2026-10-26", amount: 2000});
  t.moves.push({id: "m-f3", date: d, person: "sophie", from: "s-main", to: "s-rent", amount: 640, key: "fill:s-rent:2026-11-13"});
  eq("F3: (once it's ticked, nothing more is asked)", B.todo(B.load(t, d), "sophie", d).filter(x => x.fill).length, 0);
  t.exceptions.push({id: "x-s-to-e-rent-2026-11-13-amount", item: "s-to-e-rent", date: "2026-11-13", action: "amount", amount: 550});
  eq("F3: £50 more is asked for when the payment goes up", B.todo(B.load(t, d), "sophie", d).filter(x => x.fill).map(x => [x.from, x.to, x.amount]), [["s-main", "s-rent", 50]]);
}
// ================= review 2026-10-27e (1.4.11) =================
const tickPay11 = (t, p, d) => { const L0 = B.load(t, d), per = B.periodAt(L0, p, d); B.payday(L0, p, per).moves.forEach((m, i) => t.moves.push({id: "pm-" + p + d + i, date: per.start, person: p, from: m.from, to: m.to, amount: m.amount, key: "pay:" + per.start + ":" + m.to})); };
// P1: the payer's share of a split payment is what's left once the other share (rounded, as it's settled) is taken
// off, so the two shares add up to what was paid: half of £20.15 is £10.07 for Ethan, who gets £10.08 back
{
  const t = fixture(), d = "2026-11-02";
  t.transactions.push({id: "t-p1", date: d, person: "ethan", amount: 20.15, budget: "e-fun", account: "e-main", split: "half"});
  const L = B.load(t, d), se = B.budgetState(L, "ethan", B.periodAt(L, "ethan", d))["e-fun"].spent, ss = B.budgetState(L, "sophie", B.periodAt(L, "sophie", d))["s-fun"].spent;
  eq("P1: Ethan's share and Sophie's add up to £20.15", [se, ss, B.round(se + ss), B.between(L, "ethan", d).owedToMe], [10.07, 10.08, 20.15, 10.08]);
}
// P2: a split payment your partner made counts your share against your budget, and you pay it back from your main
// account when you settle up, so a budget kept in a pot gives that share to the main account (and your partner's share
// of what you paid from the pot comes back into the main account, so it goes back to the pot): one move, the difference
{
  const t = fixture(), d = "2026-11-03"; tickPay11(t, "ethan", "2026-10-29");
  t.transactions.push({id: "t-p2s", date: "2026-11-02", person: "sophie", amount: 100, budget: "s-food", account: "s-main", split: "half"});
  const mv = L => B.todo(L, "ethan", d).filter(x => x.type === "move").map(x => [x.from, x.to, x.amount]);
  eq("P2: your £50 share of Sophie's shop moves from the Food pot to Main", mv(B.load(t, d)), [["e-food", "e-main", 50]]);
  eq("P2: and says why", /Your share of food Sophie paid for is settled up from Main account/.test(B.todo(B.load(t, d), "ethan", d)[0].why), true);
  t.transactions.push({id: "t-p2e", date: d, person: "ethan", amount: 40, budget: "e-food-b", account: "e-food", split: "half"});
  const L2 = B.load(t, d), it = B.todo(L2, "ethan", d).filter(x => x.type === "move");
  eq("P2: Sophie's £20 share of a £40 shop from the Food pot nets it to £30", it.map(x => [x.from, x.to, x.amount]), [["e-food", "e-main", 30]]);
  it.forEach(x => x.keys.forEach((k, i) => t.moves.push({id: "m-p2" + i, date: d, person: "ethan", from: x.from, to: x.to, amount: k.amount, key: k.key})));
  t.transactions.push({id: "t-p2f", date: d, person: "ethan", amount: 60, budget: "e-food-b", account: "e-food", split: "half"});
  const L3 = B.load(t, d);
  eq("P2: after ticking that, a £60 shop from the pot (£30 hers) asks for £30 back the other way", mv(L3), [["e-main", "e-food", 30]]);
  t.moves.push({id: "m-p2g", date: d, person: "ethan", from: "e-main", to: "e-food", amount: 30, key: B.todo(L3, "ethan", d).filter(x => x.type === "move")[0].keys[0].key});
  t.settlements.push({id: "s-p2", date: d, from: "sophie", to: "ethan", amount: 0, key: "x"});
  const L4 = B.load(t, d), st = B.budgetState(L4, "ethan", B.periodAt(L4, "ethan", d))["e-food-b"], bal = B.balances(L4, d);
  eq("P2: the Food pot holds what Food has left", B.round(bal["e-food"]), st.left);
  eq("P2: nothing more to move", mv(L4), []);
  // a budget in the main account: your share of what Sophie paid can take it over, and the fallback pot covers it
  const u = fixture(); tickPay11(u, "ethan", "2026-10-29");
  u.budgets = u.budgets.filter(b => b.id !== "s-fun").concat([{id: "s-fun2", person: "sophie", name: "Fun", amount: 100, mode: "daily", account: "s-main"}]);
  u.transactions.push({id: "t-p2h", date: "2026-11-02", person: "sophie", amount: 400, budget: "s-fun2", account: "s-main", split: "half"});
  eq("P2: going over Fun with your share of Sophie's is covered from the Emergency pot", B.todo(B.load(u, d), "ethan", d).filter(x => x.over).map(x => [x.from, x.to, x.amount]), [["e-emergency", "e-main", B.round(200 - (150 + 150 * 3 / 28))]]);
}
// P3: a pot that will run short before a payment is filled from the main account only with money its budgets don't
// still need; otherwise the fallback pot fills it (and the next pay tops that back up)
{
  const t = fixture(), d = "2026-11-03"; tickPay11(t, "ethan", "2026-10-29");
  t.exceptions.push({id: "x-e-rent-2026-11-16-amount", item: "e-rent", date: "2026-11-16", action: "amount", amount: 1300});
  const L = B.load(t, d);
  eq("P3: Main only holds what Fun has left, so the Emergency pot fills the Bills pot", B.todo(L, "ethan", d).filter(x => x.fill).map(x => [x.from, x.to, x.amount]), [["e-emergency", "e-bills", 100]]);
  t.valuations.push({id: "v-p3", account: "e-main", date: d, amount: 500, updated: 9e12});
  eq("P3: with £500 in Main, it comes from Main", B.todo(B.load(t, d), "ethan", d).filter(x => x.fill).map(x => [x.from, x.to, x.amount]), [["e-main", "e-bills", 100]]);
}
// P4: money that lands in the pay's account after payday (Sophie's sofa repayment on the 28th, after Christmas pay on
// the 24th) isn't moved to the Cash ISA on payday, so the main account isn't left overdrawn; it carries into next month
{
  const t = fixture(); ["2026-10-29", "2026-11-26"].forEach(d => tickPay11(t, "ethan", d));
  const d = "2026-12-24", L = B.load(t, d), per = B.periodAt(L, "ethan", d), pd = B.payday(L, "ethan", per);
  const isaLine = pd.plan.lines.filter(l => l.remainder)[0].amount, isaMove = pd.moves.filter(m => m.to === "e-isa")[0].amount;
  eq("P4: the Cash ISA move waits for the £200 that comes on the 28th", B.round(isaLine - isaMove), 200);
  const out = pd.moves.reduce((a, m) => a + m.amount, 0);
  eq("P4: Main isn't overdrawn after the payday moves", B.balances(L, d)["e-main"] - out >= 0, true);
  pd.moves.forEach((m, i) => t.moves.push({id: "m-p4" + i, date: d, person: "ethan", from: m.from, to: m.to, amount: m.amount, key: "pay:" + d + ":" + m.to}));
  const later = dd => B.todo(B.load(t, dd), "ethan", dd).filter(x => x.later).map(x => [x.from, x.to, x.amount]);
  eq("P4: nothing more to move before the repayment comes", later("2026-12-27"), []);
  t.settlements.push({id: "s-p4", date: "2026-12-28", from: "sophie", to: "ethan", amount: 200, loan: "sofa", key: "loan:sofa:2026-12-28"});
  eq("P4: once it's in, its £200 goes to the Cash ISA", later("2026-12-28"), [["e-main", "e-isa", 200]]);
  const isaNext = u => { const L2 = B.load(u, "2027-01-28"); return B.planFor(L2, "ethan", B.periodAt(L2, "ethan", "2027-01-28")).lines.filter(l => l.remainder)[0].amount; };
  const before = isaNext(t);
  t.moves.push({id: "m-p4l", date: "2026-12-28", person: "ethan", from: "e-main", to: "e-isa", amount: 200, key: "late:2026-12-24:e-isa"});
  eq("P4: and it's counted once: ticking it doesn't change next month's Cash ISA", [later("2026-12-29"), isaNext(t)], [[], before]);
}
// P5: last month's move ticked on payday morning isn't in the balance the day before, so it's still counted as done:
// ticking it doesn't change this month's plan (or ask for a catch-up the payday moves already made)
{
  const t = fixture(); tickPay11(t, "ethan", "2026-10-29");
  t.transactions.push({id: "t-p5", date: "2026-11-20", person: "ethan", amount: 30, budget: "e-fuel", account: "e-main"});
  const d = "2026-11-26", lines = L => B.planFor(L, "ethan", B.periodAt(L, "ethan", d)).lines.filter(l => l.already || l.leftover || l.catchup || l.remainder).map(l => [l.name, l.amount]);
  const L0 = B.load(t, d), before = lines(L0), it = B.todo(L0, "ethan", d).filter(x => x.type === "move" && !x.payday)[0];
  it.keys.forEach((k, i) => t.moves.push({id: "m-p5" + i, date: d, person: "ethan", from: it.from, to: it.to, amount: k.amount, key: k.key}));
  eq("P5: the plan is the same after ticking it", lines(B.load(t, d)), before);
}
// ================= review 2026-10-27 (1.4.12) =================
// Q1: your partner's share of a split shop you paid from a pot goes back into the pot from the main account only as far
// as the main account can spare it (beyond what its own budgets still have to spend); otherwise the fallback pot puts it
// back until you settle up, and the next pay tops the fallback pot up, so the main account isn't left short
{
  const t = fixture(), d = "2026-11-10"; tickPay11(t, "ethan", "2026-10-29");
  const L0 = B.load(t, d), fun = B.budgetState(L0, "ethan", B.periodAt(L0, "ethan", d))["e-fun"].avail;
  t.transactions.push({id: "t-q1a", date: "2026-11-05", person: "ethan", amount: fun, budget: "e-fun", account: "e-main"});
  t.transactions.push({id: "t-q1b", date: d, person: "ethan", amount: 60, budget: "e-food-b", account: "e-food", split: "half"});
  const L = B.load(t, d), it = B.todo(L, "ethan", d).filter(x => x.type === "move");
  eq("Q1: Fun spent: Sophie's £30 goes back into the Food pot from the Emergency pot", it.map(x => [x.from, x.to, x.amount, !!x.short]), [["e-emergency", "e-food", 30, false]]);
  eq("Q1: and says so", /Until then it comes from Emergency pot, and your next pay tops the Emergency pot back up/.test(it[0].why), true);
  it[0].keys.forEach((k, i) => t.moves.push({id: "m-q1" + i, date: d, person: "ethan", from: it[0].from, to: it[0].to, amount: k.amount, key: k.key}));
  eq("Q1: nothing more to move once it's ticked", B.todo(B.load(t, d), "ethan", d).filter(x => x.type === "move").length, 0);
  eq("Q1: and the main account isn't touched", B.balances(B.load(t, d), d)["e-main"], 0);
  const L2 = B.load(t, "2026-11-26"), top = B.planFor(L2, "ethan", B.periodAt(L2, "ethan", "2026-11-26")).lines.filter(l => l.kind === "topup");
  eq("Q1: the next pay tops the Emergency pot back up by it", top.map(l => l.amount), [30]);
  // money in the main account beyond what its budgets need is used first, as before
  const u = fixture(); tickPay11(u, "ethan", "2026-10-29");
  u.valuations.push({id: "v-q1", account: "e-main", date: "2026-11-09", amount: 300});
  u.transactions.push({id: "t-q1c", date: d, person: "ethan", amount: 60, budget: "e-food-b", account: "e-food", split: "half"});
  eq("Q1: with money to spare in Main, it comes from Main", B.todo(B.load(u, d), "ethan", d).filter(x => x.type === "move").map(x => [x.from, x.to, x.amount]), [["e-main", "e-food", 30]]);
}
// Q2: money that comes into the main account after payday (a loan repayment) and is more than the move it holds back:
// until it's in, the fallback pot covers what the main account needs before then, so payday's moves don't overdraw it.
// A repayment due on payday itself is only there once it's paid, so it's held back too.
{
  // Ethan's payday is 24 Dec (moved for Christmas); Sophie's £200 repayment is due on the 28th. With nothing left over for
  // the Cash ISA this month (a budget for a new bed takes it), the £200 can't be held back from it.
  // (and Fun spent to the last penny before payday, so nothing is carried over in Main)
  const t = fixture(); ["2026-10-29", "2026-11-26"].forEach(d => tickPay11(t, "ethan", d));
  const Lf = B.load(t, "2026-12-20"), fa = B.budgetState(Lf, "ethan", B.periodAt(Lf, "ethan", "2026-12-20"))["e-fun"].avail;
  t.transactions.push({id: "t-q2f", date: "2026-12-20", person: "ethan", amount: fa, budget: "e-fun", account: "e-main"});
  t.budgets.push({id: "e-bed", person: "ethan", name: "Bed", amount: 1300, mode: "oneoff", account: "e-car", start: "2026-12-20", end: "2027-01-20"});
  const d = "2026-12-24", L = B.load(t, d), per = B.periodAt(L, "ethan", d), pd = B.payday(L, "ethan", per);
  const out = pd.moves.reduce((a, m) => a + m.amount, 0), after = B.round(B.balances(L, B.addDays(d, -1))["e-main"] + 2400 - out + (pd.cover ? pd.cover.amount : 0));
  eq("Q2: the Cash ISA gets nothing this month, so there's nothing to hold back", pd.later.length === 0 && !pd.moves.some(m => m.to === "e-isa"), true);
  eq("Q2: the Emergency pot covers what Main needs until the 28th", [!!pd.cover, pd.soonFor && pd.soonFor.names, pd.soonFor && pd.soonFor.date], [true, ["Sophie's Sofa repayment"], "2026-12-28"]);
  eq("Q2: so Main isn't overdrawn after payday's moves: it has Fun's share of the 4 days until then", after, B.round(150 * 4 / 35));
  eq("Q2: the payday screen can say how much is only until then", pd.soon, B.round(150 * 4 / 35 + 50));
  // with money carried over in Main for its budgets, nothing more is needed
  const v = fixture(); ["2026-10-29", "2026-11-26"].forEach(dd => tickPay11(v, "ethan", dd));
  v.budgets.push({id: "e-bed", person: "ethan", name: "Bed", amount: 1350, mode: "oneoff", account: "e-car", start: "2026-12-20", end: "2027-01-20"});
  const Lv = B.load(v, d), pdv = B.payday(Lv, "ethan", B.periodAt(Lv, "ethan", d));
  eq("Q2: Fun's £150 carried over in Main covers the days until then, so only the plan's own gap is covered", [pdv.soon, pdv.cover && pdv.cover.amount], [0, pdv.plan.shortfall]);
  // the repayment due on Ethan's payday itself (28 Jan, a Thursday) holds back the Cash ISA move until it's paid
  const u = fixture(); ["2026-10-29", "2026-11-26", "2026-12-24"].forEach(dd => tickPay11(u, "ethan", dd));
  u.settlements.push({id: "s-q2", date: "2026-12-28", from: "sophie", to: "ethan", amount: 200, loan: "sofa", key: "loan:sofa:2026-12-28"});
  u.moves.push({id: "m-q2", date: "2026-12-28", person: "ethan", from: "e-main", to: "e-isa", amount: 200, key: "late:2026-12-24:e-isa"});
  const L3 = B.load(u, "2027-01-28"), pd3 = B.payday(L3, "ethan", B.periodAt(L3, "ethan", "2027-01-28"));
  eq("Q2: a repayment due on payday is held back from the Cash ISA move until it's paid", pd3.later.map(m => [m.to, m.amount, m.date]), [["e-isa", 200, "2027-01-28"]]);
  eq("Q2: To do asks for it once it's paid", B.todo(L3, "ethan", "2027-01-28").filter(x => x.later).length, 0);
  u.settlements.push({id: "s-q2b", date: "2027-01-28", from: "sophie", to: "ethan", amount: 200, loan: "sofa", key: "loan:sofa:2027-01-28"});
  eq("Q2: and once it's in, it goes", B.todo(B.load(u, "2027-01-28"), "ethan", "2027-01-28").filter(x => x.later).map(x => [x.from, x.to, x.amount, x.why]), [["e-main", "e-isa", 200, "Sophie's Sofa repayment came in, so its part of what's left goes to Cash ISA now."]]);
}
// Q4: the main account itself going under before payday (here: Sophie's half of a split shop Ethan paid from it, with
// his Fun all spent) is covered from the fallback pot, which the next pay tops back up; the payday screen's own cover
// counts as on its way, so it isn't asked for twice
{
  const t = fixture(), d = "2026-11-10"; tickPay11(t, "ethan", "2026-10-29");
  const L0 = B.load(t, d), fun = B.budgetState(L0, "ethan", B.periodAt(L0, "ethan", d))["e-fun"].avail;
  t.transactions.push({id: "t-q4a", date: "2026-11-05", person: "ethan", amount: fun, budget: "e-fun", account: "e-main"});
  t.transactions.push({id: "t-q4b", date: d, person: "ethan", amount: 40, budget: "e-fun", account: "e-main", split: "half"});
  const L = B.load(t, d), mv = B.todo(L, "ethan", d).filter(x => x.type === "move");
  eq("Q4: his £20 over Fun and Sophie's £20 until she settles both come from the Emergency pot", mv.map(x => [x.from, x.to, x.amount, x.over ? "over" : x.fill ? "fill" : ""]), [["e-emergency", "e-main", 20, "over"], ["e-emergency", "e-main", 20, "fill"]]);
  eq("Q4: and says why", (mv[1] || {}).why, "Main account is £20.00 under. Your next pay tops the Emergency pot back up.");
  mv.forEach((x, j) => x.keys.forEach((k, i) => t.moves.push({id: "m-q4" + j + i, date: d, person: "ethan", from: x.from, to: x.to, amount: k.amount, key: k.key})));
  const L2 = B.load(t, d);
  eq("Q4: once they're ticked Main is back to nothing, and nothing more is asked", [B.balances(L2, d)["e-main"], B.todo(L2, "ethan", d).filter(x => x.type === "move").length], [0, 0]);
  const L3 = B.load(t, "2026-11-26");
  eq("Q4: the next pay tops the Emergency pot back up by both", B.planFor(L3, "ethan", B.periodAt(L3, "ethan", "2026-11-26")).lines.filter(l => l.kind === "topup").map(l => l.amount), [40]);
  // with nothing in the Emergency pot, it says so (once: "Got it" puts it away)
  const w = fixture(); w.valuations.push({id: "v-q4w", account: "e-emergency", date: "2026-11-02", amount: 0});
  w.transactions.push({id: "t-q4w", date: "2026-11-02", person: "ethan", amount: 400, budget: "e-fun", account: "e-main", split: "half"});
  const ww = B.todo(B.load(w, "2026-11-02"), "ethan", "2026-11-02").filter(x => x.type === "warn");
  eq("Q4: with the Emergency pot empty, it warns instead", ww.map(x => [x.what, x.why]), [["Main account is £200.00 under", "There isn't enough in your Emergency pot to cover it yet."]]);
  w.moves.push({id: "m-q4w", date: "2026-11-02", person: "ethan", amount: 0, key: ww[0].key, note: "dismissed"});
  eq("Q4: and Got it puts it away", B.todo(B.load(w, "2026-11-02"), "ethan", "2026-11-02").filter(x => x.type === "warn").length, 0);
  // a payday cover not yet ticked counts as on its way: nothing more is asked for the main account
  const u = fixture();
  u.budgets.push({id: "e-bed4", person: "ethan", name: "Bed", amount: 2500, mode: "oneoff", account: "e-car", start: "2026-11-01", end: "2026-11-20"});
  const L4 = B.load(u, "2026-10-29"), pd4 = B.payday(L4, "ethan", B.periodAt(L4, "ethan", "2026-10-29"));
  pd4.moves.forEach((m, i) => u.moves.push({id: "m-q4p" + i, date: "2026-10-29", person: "ethan", from: m.from, to: m.to, amount: m.amount, key: "pay:2026-10-29:" + m.to}));
  const L5 = B.load(u, "2026-10-29");
  // (with the payday moves all ticked, To do asks for the cover itself, once, under its own key)
  const c5 = B.todo(L5, "ethan", "2026-10-29").filter(x => x.type === "move" && x.to === "e-main");
  eq("Q4: with the payday cover still to tick, To do asks for that cover, not more", [!!pd4.cover, c5.map(x => [x.from, x.amount, x.keys.map(k => k.key).join()])], [true, [["e-emergency", pd4.cover.amount, "pay:2026-10-29:cover"]]]);
  u.moves.push({id: "m-q4c", date: "2026-10-29", person: "ethan", from: "e-emergency", to: "e-main", amount: pd4.cover.amount, key: "pay:2026-10-29:cover"});
  eq("Q4: and once it's ticked, nothing more is asked for Main", B.todo(B.load(u, "2026-10-29"), "ethan", "2026-10-29").filter(x => x.type === "move" && x.to === "e-main").length, 0);
  // while the payday screen still has moves to tick, the cover is asked for there, not in To do as well
  const v4 = fixture(); v4.budgets.push(u.budgets[u.budgets.length - 1]);
  eq("Q4: before payday's moves are ticked, the cover is only on the payday screen", B.todo(B.load(v4, "2026-10-29"), "ethan", "2026-10-29").filter(x => x.type === "move" && !x.payday && x.to === "e-main").length, 0);
}
// Q5: spending from before a payday that's logged after that payday's moves were ticked: its cover from the fallback
// pot is asked for, and the next payday tops the fallback pot up by it (that payday's own top-up was already done), so
// the fallback pot gets back to where it was rather than staying short for good
{
  const t = fixture(); tickPay11(t, "ethan", "2026-10-29");
  t.transactions.push({id: "t-q5a", date: "2026-11-18", person: "ethan", amount: 200, budget: "e-fun", account: "e-main"});
  const it = B.todo(B.load(t, "2026-11-20"), "ethan", "2026-11-20").filter(x => x.over)[0];
  it.keys.forEach((k, i) => t.moves.push({id: "m-q5a" + i, date: "2026-11-20", person: "ethan", from: it.from, to: it.to, amount: k.amount, key: k.key}));
  tickPay11(t, "ethan", "2026-11-26");
  t.transactions.push({id: "t-q5b", date: "2026-11-24", person: "ethan", amount: 40, budget: "e-fun", account: "e-main"});
  const it2 = B.todo(B.load(t, "2026-11-30"), "ethan", "2026-11-30").filter(x => x.over);
  eq("Q5: the £40 logged late is covered from the Emergency pot", it2.map(x => [x.from, x.to, x.amount]), [["e-emergency", "e-main", 40]]);
  it2.forEach(x => x.keys.forEach((k, i) => t.moves.push({id: "m-q5b" + i, date: "2026-11-30", person: "ethan", from: x.from, to: x.to, amount: k.amount, key: k.key})));
  const L2 = B.load(t, "2026-12-24");
  eq("Q5: the next payday tops it up by that £40", B.planFor(L2, "ethan", B.periodAt(L2, "ethan", "2026-12-24")).lines.filter(l => l.kind === "topup").map(l => l.amount), [40]);
  tickPay11(t, "ethan", "2026-12-24");
  eq("Q5: so the Emergency pot is back at £400", B.balances(B.load(t, "2026-12-24"), "2026-12-24")["e-emergency"], 400);
}
// Q6: what you owe your partner when payday comes stays in the main account (where settling up happens) rather than
// counting as left over for the Cash ISA, so settling up after payday doesn't take it out of this month's budgets
{
  const t = fixture(); tickPay11(t, "ethan", "2026-10-29");
  t.transactions.push({id: "t-q6", date: "2026-11-20", person: "sophie", amount: 100, budget: "s-food", account: "s-main", split: "half"});
  const it = B.todo(B.load(t, "2026-11-21"), "ethan", "2026-11-21").filter(x => x.type === "move");
  eq("Q6: Ethan's £50 share of Sophie's shop moves from the Food pot to Main to settle up", it.map(x => [x.from, x.to, x.amount]), [["e-food", "e-main", 50]]);
  it.forEach(x => x.keys.forEach((k, i) => t.moves.push({id: "m-q6" + i, date: "2026-11-21", person: "ethan", from: x.from, to: x.to, amount: k.amount, key: k.key})));
  tickPay11(t, "ethan", "2026-11-26");
  t.settlements.push({id: "s-q6", date: "2026-11-27", from: "ethan", to: "sophie", amount: 50, key: "split:2026-11-27"});
  const L = B.load(t, "2026-11-27"), per = B.periodAt(L, "ethan", "2026-11-27"), fun = B.budgetState(L, "ethan", per)["e-fun"];
  eq("Q6: after settling up the day after payday, Main still has all of Fun's money", B.balances(L, "2026-11-27")["e-main"], fun.left);
}
// Q7: what's owed on a day, from running totals, is what between() says, on every day (splits, shared bills, the
// regular payments, settling up and a bill's real amount)
{
  const t = fixture();
  [["2026-10-28", "ethan", 31.37], ["2026-11-03", "sophie", 20.15], ["2026-11-19", "ethan", 9], ["2026-12-02", "sophie", 64.01], ["2027-01-07", "ethan", 15.55]].forEach((x, i) => t.transactions.push({id: "t-q7" + i, date: x[0], person: x[1], amount: x[2], budget: x[1] === "ethan" ? "e-food-b" : "s-food", account: x[1] === "ethan" ? "e-main" : "s-main", split: "half"}));
  t.exceptions.push({id: "x-e-flat-2026-12-01-amount", item: "e-flat", date: "2026-12-01", action: "amount", amount: 377.77});
  t.settlements.push({id: "s-q7", date: "2026-12-10", from: "ethan", to: "sophie", amount: 12.34, key: "split:2026-12-10"});
  const L = B.load(t, "2027-02-01"), bad = [];
  ["ethan", "sophie"].forEach(p => { for (let d = "2026-10-26"; d <= "2027-02-01"; d = B.addDays(d, 1)) if (Math.abs(B.owedAt(L, p, d) - B.between(L, p, d).net) > 0.001) bad.push([p, d, B.owedAt(L, p, d), B.between(L, p, d).net]); });
  eq("Q7: owed on each day matches between()", bad.slice(0, 3), []);
}
// Q8: a pot that will run short before more than one payment is filled once, for the lowest it goes before payday
// (not one move a payment, asked one after the other); when nowhere has that much, for the first payment
{
  const t = fixture(); tickPay11(t, "ethan", "2026-10-29");
  t.valuations.push({id: "v-q8b", account: "e-bills", date: "2026-10-30", amount: 0, updated: 1}, {id: "v-q8m", account: "e-main", date: "2026-10-30", amount: 1500, updated: 1});
  const f = B.todo(B.load(t, "2026-10-30"), "ethan", "2026-10-30").filter(x => x.fill);
  eq("Q8: one move for both the household bills and the rent", f.map(x => [x.from, x.to, x.amount, x.why]), [["e-main", "e-bills", 1000, "Household bills on Sun 1 Nov and Rent on Mon 16 Nov need it."]]);
  f[0].keys.forEach((k, i) => t.moves.push({id: "m-q8" + i, date: "2026-10-30", person: "ethan", from: f[0].from, to: f[0].to, amount: k.amount, key: k.key, updated: 2}));
  eq("Q8: once it's ticked, nothing more is asked before payday", ["2026-10-30", "2026-11-02", "2026-11-14"].map(d => B.todo(B.load(t, d), "ethan", d).filter(x => x.fill).length), [0, 0, 0]);
  const u = fixture(); tickPay11(u, "ethan", "2026-10-29"); u.valuations.push({id: "v-q8c", account: "e-bills", date: "2026-10-30", amount: 100, updated: 1});
  eq("Q8: with nowhere to take £900 from, the Emergency pot fills it for the first payment", B.todo(B.load(u, "2026-10-30"), "ethan", "2026-10-30").filter(x => x.fill).map(x => [x.from, x.to, x.amount, x.why]), [["e-emergency", "e-bills", 320, "Household bills on Sun 1 Nov needs it. Your next pay tops the Emergency pot back up."]]);
}
// Q9: a repayment you're due to make to your partner before payday counts towards the main account going under, so
// the fallback pot is asked for what it's short before you pay it, not after
{
  const t = fixture(); ["2026-11-27", "2026-12-24"].forEach(d => tickPay11(t, "sophie", d)); t.valuations.push({id: "v-q9", account: "s-main", date: "2026-12-26", amount: 50, updated: 1}, {id: "v-q9s", account: "s-savings", date: "2026-12-26", amount: 300, updated: 1});
  const f = B.todo(B.load(t, "2026-12-26"), "sophie", "2026-12-26").filter(x => x.fill && x.to === "s-main");
  eq("Q9: Sophie's £200 sofa repayment on the 28th: £150 from her Savings Space first", f.map(x => [x.from, x.to, x.amount, x.why]), [["s-savings", "s-main", 150, "Main account would be £150.00 under on Mon 28 Dec. Your next pay tops the Savings Space back up."]]);
}
// Q10: a pot that will run short by more than the main account can spare or the fallback pot has on its own is filled
// from both: what the main account can spare and the rest from the fallback pot; and last, all the fallback pot has
// with the rest from the main account (a bill matters more), rather than a warning that there isn't enough
{
  const t = fixture(); tickPay11(t, "ethan", "2026-10-29");
  t.valuations.push({id: "v-q10b", account: "e-bills", date: "2026-10-30", amount: 0, updated: 1}, {id: "v-q10m", account: "e-main", date: "2026-10-30", amount: 216.07, updated: 1});
  eq("Q10: £50 Main can spare and £370 from the Emergency pot for the household bills", B.todo(B.load(t, "2026-10-30"), "ethan", "2026-10-30").filter(x => x.fill).map(x => [x.from, x.to, x.amount]), [["e-main", "e-bills", 50], ["e-emergency", "e-bills", 370]]);
  // Sophie's first part-month: £640 to go out of her Rent Space before her first pay, £400 in Main and £300 saved
  const u = fixture(); u.valuations.push({id: "v-q10s", account: "s-savings", date: "2026-10-26", amount: 300}, {id: "v-q10t", account: "s-main", date: "2026-10-26", amount: 400});
  const f = B.todo(B.load(u, "2026-10-27"), "sophie", "2026-10-27").filter(x => x.fill || x.type === "warn");
  eq("Q10: Sophie's Rent Space gets the £640 from Main and her Savings Space together", f.map(x => [x.from, x.to, x.amount]), [["s-main", "s-rent", 340], ["s-savings", "s-rent", 300]]);
  f.forEach((x, j) => x.keys.forEach((k, i) => u.moves.push({id: "m-q10" + j + i, date: "2026-10-27", person: "sophie", from: x.from, to: x.to, amount: k.amount, key: k.key})));
  const L = B.load(u, "2026-11-27");
  eq("Q10: nothing more is asked, and her first pay tops the Savings Space back up", [B.todo(B.load(u, "2026-10-28"), "sophie", "2026-10-28").filter(x => x.fill || x.type === "warn").length, B.planFor(L, "sophie", B.periodAt(L, "sophie", "2026-11-27")).lines.filter(l => l.kind === "topup").map(l => l.amount)], [0, [300]]);
}
// Q11: when the main account's budgets would have to pay towards a pot's bill, what's left in the fallback pot goes first
{
  const t = fixture(); tickPay11(t, "ethan", "2026-10-29");
  t.valuations.push({id: "v-q11b", account: "e-bills", date: "2026-10-30", amount: 300, updated: 1}, {id: "v-q11f", account: "e-emergency", date: "2026-10-30", amount: 25, updated: 1});
  eq("Q11: the Emergency pot's £25 first, then the rest of the household bills from Main", B.todo(B.load(t, "2026-10-30"), "ethan", "2026-10-30").filter(x => x.fill).map(x => [x.from, x.to, x.amount]), [["e-main", "e-bills", 95], ["e-emergency", "e-bills", 25]]);
}
// Q15: a balance typed in by hand (read off the bank's app) has that day's bank payments in it too: a first import that
// brings in the day before you started, after the balances you started with were typed in, never takes them off again
// (seen with Sophie: £2.80 typed for 24 October, and that day's £120 and £12.21 imported later, made her start at -£117.41)
{
  const t = fixture(), d = "2026-11-17";
  t.valuations.push({id: "v-q15", account: "e-main", date: d, amount: 2.8, updated: 1000});
  t.transactions.push({id: "bk-monzo-tx_q15a", date: d, person: "ethan", amount: 120, account: "e-main", bankId: "tx_q15a", updated: 5000});
  t.transactions.push({id: "t-q15linked", date: d, person: "ethan", amount: 12.21, account: "e-main", bankId: "tx_q15b", updated: 6000});
  eq("Q15: that day's bank payments are already in a hand-typed balance", B.balances(B.load(t, d), d)["e-main"], 2.8);
  // one you log in the app after typing the balance, that the bank hasn't seen, still counts
  t.transactions.push({id: "t-q15cash", date: d, person: "ethan", amount: 4, account: "e-main", updated: 7000});
  eq("Q15: one logged by hand later that day still counts", B.balances(B.load(t, d), d)["e-main"], -1.2);
}
// Q12: a balance the bank feed checked already has every payment and move from the bank that day in it, so changing one
// of those rows later that day (checking what a bank payment was for, editing its note) never takes it off again; one
// you log in the app after that balance, which the bank hasn't seen, still counts
{
  const t = fixture(), d = "2026-11-17";
  t.valuations.push({id: "bk-pot_food-" + d, account: "e-food", date: d, amount: 43.21, updated: 1000, note: "from Monzo"});
  t.moves.push({id: "bk-monzo-tx_q12m", date: d, person: "ethan", from: "e-food", to: "e-main", amount: 5.48, key: "bank:tx_q12m", updated: 2000});
  t.transactions.push({id: "bk-monzo-tx_q12s", date: d, person: "ethan", amount: 7, budget: "e-food-b", account: "e-food", bankId: "tx_q12s", updated: 3000});
  t.transactions.push({id: "t-q12a", date: "2026-11-16", person: "ethan", amount: 9, budget: "e-food-b", account: "e-food", updated: 900});
  eq("Q12: the bank's £43.21 stands, with its own day's bank rows changed after it", B.balances(B.load(t, d), d)["e-food"], 43.21);
  t.transactions.push({id: "t-q12b", date: d, person: "ethan", amount: 2.5, budget: "e-food-b", account: "e-food", updated: 4000});
  eq("Q12: a payment logged in the app after it still counts", B.balances(B.load(t, d), d)["e-food"], 40.71);
}
// Q13: a budget gone over is "Over budget" until the move that covers it is ticked; then it's covered, and says what
// covered it (so Today doesn't look alarming about something that's been dealt with)
{
  const t = fixture(); t.transactions.push({id: "t-q13", date: "2026-10-27", person: "ethan", amount: 40, budget: "e-fun", account: "e-main"});
  const r = B.today(B.load(t, "2026-10-27"), "ethan", "2026-10-27");
  eq("Q13: £23.93 over Fun, not covered yet", [r.status, r.overs], ["Over budget", [{id: "e-fun", name: "Fun", over: 23.93, covered: false, from: "Emergency pot"}]]);
  t.moves.push({id: "m-q13", date: "2026-10-27", person: "ethan", from: "e-emergency", to: "e-main", amount: 23.93, key: "cover:e-fun:2026-10-26:e-main"});
  const r2 = B.today(B.load(t, "2026-10-27"), "ethan", "2026-10-27");
  eq("Q13: once the Emergency pot's move is ticked it's covered", [r2.status, r2.overs.map(o => o.covered)], ["Over, but covered", [true]]);
  eq("Q13: and Sophie sees it the same way", B.summary(B.load(t, "2026-10-27"), "ethan", "2026-10-27").status, "Over, but covered");
}
// Q14: what's spare in the main account goes where whatever's left goes on payday, and Today can say how much and where
{
  const r = B.today(B.load(fixture(), "2026-10-28"), "ethan", "2026-10-28");
  eq("Q14: £233.93 spare in Main goes to the Cash ISA on payday", r.spare, {amount: 233.93, to: "e-isa", toName: "Cash ISA", date: "2026-10-29"});
}


// ================= 1.4.18: insights =================
// I1: spending this week (counted from payday) against the same days of the last pay period
{
  const mut = t => t.transactions.push(
    {id: "w1", date: "2026-12-04", person: "ethan", amount: 30, budget: "e-food-b", account: "e-food"},
    {id: "w2", date: "2026-12-05", person: "ethan", amount: 15, budget: "e-fun", account: "e-main"},
    {id: "w3", date: "2026-12-05", person: "ethan", amount: -5, budget: "e-fun", account: "e-main", note: "refund"},
    {id: "w4", date: "2026-12-04", person: "sophie", amount: 40, budget: "s-food", account: "s-main", split: "half"},
    {id: "w5", date: "2026-12-02", person: "ethan", amount: 50, budget: "e-food-b", account: "e-food"},
    {id: "w6", date: "2026-11-06", person: "ethan", amount: 20, budget: "e-food-b", account: "e-food"},
    {id: "w7", date: "2026-11-07", person: "ethan", amount: 25, budget: "e-fun", account: "e-main"},
    {id: "w8", date: "2026-11-08", person: "ethan", amount: 99, budget: "e-food-b", account: "e-food"},
    {id: "w9", date: "2026-11-29", person: "sophie", amount: 12, budget: "s-fun", account: "s-main"},
    {id: "w10", date: "2026-10-27", person: "sophie", amount: 9, budget: "s-fun", account: "s-main"});
  const w = B.spendWeek(dbt(mut, "2026-12-05"), "ethan", "2026-12-05");
  eq("I1: day 3 of week 2 (pay period from 26 Nov), against 5 to 7 Nov", [w.week, w.day, w.from, w.total, w.prev], [2, 3, "2026-12-03", 60, {from: "2026-11-05", to: "2026-11-07", total: 45}]);
  eq("I1: the budgets that changed most first (his half of Sophie's split shop counts; a refund nets off)", w.budgets.map(b => [b.id, b.now, b.before, b.change]), [["e-food-b", 50, 20, 30], ["e-fun", 10, 25, -15]]);
  const w0 = B.spendWeek(dbt(mut, "2026-11-02"), "ethan", "2026-11-02");
  eq("I1: the first full month has nothing to compare with (those days were before he started)", [w0.week, w0.from, w0.prev], [1, "2026-10-29", null]);
  const wo = B.spendWeek(dbt(mut, "2026-10-27"), "ethan", "2026-10-27");
  eq("I1: in the short first month the week counts from when he started", [wo.from, wo.prev], ["2026-10-26", null]);
  const ws = B.spendWeek(dbt(mut, "2026-11-29"), "sophie", "2026-11-29");
  eq("I1: Sophie's first month began the day she started, so its days compare", [ws.from, ws.prev, ws.total], ["2026-11-27", {from: "2026-10-26", to: "2026-10-28", total: 9}, 12]);
  const w5 = B.spendWeek(dbt(mut, "2027-01-25"), "ethan", "2027-01-25");
  eq("I1: week 5 of a long month, when last month didn't have one", [w5.week, w5.day, w5.prev], [5, 5, null]);
}
// I3: no-spend days since tracking started (a refund isn't spending; days before you started don't count)
{
  const n = B.noSpend(dbt(t => t.transactions.push(
    {id: "n0", date: "2026-10-20", person: "ethan", amount: 7, budget: "e-fun", account: "e-main"},
    {id: "n1", date: "2026-10-26", person: "ethan", amount: 10, budget: "e-fun", account: "e-main"},
    {id: "n2", date: "2026-10-30", person: "ethan", amount: 5, budget: "e-food-b", account: "e-food"},
    {id: "n3", date: "2026-11-02", person: "ethan", amount: -3, budget: "e-fun", account: "e-main"},
    {id: "n4", date: "2026-11-03", person: "ethan", amount: 8, budget: "e-fun", account: "e-main"},
    {id: "n5", date: "2026-10-28", person: "sophie", amount: 6, budget: "s-fun", account: "s-main"}), "2026-11-05"), "ethan", "2026-11-05");
  eq("I3: this month (from payday on 29 Oct), since he started, and the runs", [n.from, n.days, n.count, n.total, n.longest, n.current, n.list.length],
    ["2026-10-29", 8, 6, 8, {days: 3, from: "2026-10-27", to: "2026-10-29"}, 2, 8]);
  eq("I3: a day with only a refund is a no-spend day", n.list.find(x => x.date === "2026-11-02").spent, false);
  const n0 = B.noSpend(dbt(null, "2026-10-20"), "ethan", "2026-10-20");
  eq("I3: before he started, nothing counts", [n0.days, n0.count, n0.total], [0, 0, 0]);
}
// I5: saving month by month, out of new money in; money put by for a yearly bill isn't saving
{
  const mut = t => t.bills.push({id: "e-ins", person: "ethan", name: "Car insurance", amount: 600, account: "e-car", unit: "year", start: "2027-03-18"});
  const d = dbt(mut, "2026-12-05"), rs = B.savingRates(d, "ethan", "2026-12-05");
  eq("I5: full months only (the short first one is left out), this one last", rs.map(r => [r.period.name, r.current]), [["Nov 2026", false], ["Dec 2026", true]]);
  eq("I5: new money in is pay and Sophie's shares, not what carried over", rs.map(r => r.fresh), [3040, 3040]);
  const pl = planAt(d, "ethan", "2026-11-10"), sa = lineAmt(pl, l => l.setAside && l.kind === "save"), carried = lineAmt(pl, l => l.leftover || l.already);
  eq("I5: November had money carried over and set aside for the insurance", [carried > 0, sa > 0], [true, true]);
  near("I5: saved leaves the insurance out", rs[0].saved, lineAmt(pl, l => (l.kind === "save" && !l.setAside) || l.kind === "topup"));
  near("I5: (the plan's own total has it in)", pl.totals.save - rs[0].saved, sa);
  eq("I5: the rate", rs[0].pct, Math.round(rs[0].saved / 3040 * 100));
  eq("I5: nothing in the short first month", B.savingRates(dbt(null, "2026-11-10"), "sophie", "2026-11-10"), []);
  eq("I5: Sophie's first full month", B.savingRates(dbt(null, "2026-12-05"), "sophie", "2026-12-05").map(r => r.period.start), ["2026-11-27"]);
  // the same counting in year() (new money in and saved), the partner summary and kinds()
  const y = B.year(d, "ethan", "2026-12-05").find(r => r.period.start === "2026-10-29");
  eq("I5: year() has new money in and real saving beside the plan's totals", [y.fresh, y.saved, y.in > y.fresh, y.save > y.saved], [3040, rs[0].saved, true, true]);
  const k = B.kinds(pl.lines);
  near("I5: kinds() always adds up", k.in - k.bill - k.spend - k.save - k.left, 0);
  eq("I5: kinds(): set aside is bills money, a top-up is saving", [B.kindOf({kind: "save", setAside: true}), B.kindOf({kind: "topup"}), B.kindOf({kind: "save"}), B.newMoney({kind: "in", leftover: true}), B.newMoney({kind: "in", id: "opening"}), B.newMoney({kind: "in", isPay: true})], ["bill", "save", "save", false, false, true]);
}
// I5b: the partner's "Saving this month" doesn't count money put by for a yearly bill (Sophie's membership)
{
  const d = dbt(null, "2026-12-05"), pl = planAt(d, "sophie", "2026-12-05"), sa = lineAmt(pl, l => l.setAside && l.kind === "save");
  eq("I5b: Sophie puts money by for her membership in December", sa > 0, true);
  near("I5b: and it isn't in what Ethan sees as saved", B.summary(d, "sophie", "2026-12-05").saved, pl.totals.save - sa);
}
// I10: where each budget is heading by payday
{
  const mut = t => {
    t.budgets.push({id: "e-hob", person: "ethan", name: "Hobbies", amount: 140, mode: "daily", account: "e-main"},
      {id: "e-groc", person: "ethan", name: "Groceries", amount: 280, mode: "weekly", account: "e-main"},
      {id: "e-gift", person: "ethan", name: "Gifts", amount: 60, mode: "oneoff", account: "e-main"});
    t.transactions.push({id: "f0", date: "2026-10-27", person: "ethan", amount: 5, budget: "e-hob", account: "e-main"},
      {id: "f1", date: "2026-11-01", person: "ethan", amount: 50, budget: "e-hob", account: "e-main"}, {id: "f2", date: "2026-11-10", person: "ethan", amount: 30, budget: "e-hob", account: "e-main"},
      {id: "f3", date: "2026-10-29", person: "ethan", amount: 90, budget: "e-groc", account: "e-main"}, {id: "f4", date: "2026-11-05", person: "ethan", amount: 60, budget: "e-groc", account: "e-main"},
      {id: "f5", date: "2026-11-12", person: "ethan", amount: 100, budget: "e-groc", account: "e-main"}, {id: "f6", date: "2026-11-03", person: "ethan", amount: 20, budget: "e-gift", account: "e-main"});
  };
  const f = B.forecast(dbt(mut, "2026-11-13"), "ethan", "2026-11-13"), by = id => f.budgets.find(b => b.id === id);
  eq("I10: day 16 of 28, not early", [f.day, f.days, f.daysLeft, f.early], [16, 28, 12, false]);
  // day to day: £80 in 16 days, steadied by a week at the budget's own £5 a day: (80 + 35) / 23 a day for 12 days
  near("I10: day to day: on course to finish on budget", by("e-hob").end, 140); near("I10: (under)", by("e-hob").under, 0);
  // weekly: £150 over two weeks done (steadied by a planned £70 week: £73.33 a week), £100 already this week
  near("I10: weekly: this week costs what's spent in it, the last week a usual week", by("e-groc").end, 150 + 100 + 220 / 3);
  near("I10: weekly: over", by("e-groc").under, 280 - (250 + 220 / 3));
  eq("I10: one-off: what's left is what's left", [by("e-gift").end, by("e-gift").under], [20, 40]);
  eq("I10: saving (the LISA, the Cash ISA's whatever is left) isn't forecast", f.budgets.some(b => b.id === "e-lisa-b" || b.id === "e-isa-b"), false);
  // a pound on the first day of the last week: that week will still cost a usual week
  const g = B.forecast(dbt(t => { mut(t); t.transactions.push({id: "f7", date: "2026-11-19", person: "ethan", amount: 1, budget: "e-groc", account: "e-main"}); }, "2026-11-19"), "ethan", "2026-11-19").budgets.find(b => b.id === "e-groc");
  near("I10: weekly, a week later: the three weeks so far set the pace", g.end, 250 + (250 + 70) / 4);
  // early in the pay period: too early to say, unless it's already over
  const e1 = B.forecast(dbt(t => { mut(t); t.transactions.push({id: "f8", date: "2026-10-30", person: "ethan", amount: 150, budget: "e-hob", account: "e-main"}); }, "2026-11-02"), "ethan", "2026-11-02");
  eq("I10: day 5: too early, says from when", [e1.early, e1.sure, e1.budgets.find(b => b.id === "e-groc").end], [true, "2026-11-04", null]);
  eq("I10: but a budget already over says so (what's spent isn't a guess)", [e1.budgets.find(b => b.id === "e-hob").end, e1.budgets.find(b => b.id === "e-hob").under], [230, -90]);
  const eo = B.forecast(dbt(mut, "2026-10-27"), "ethan", "2026-10-27");
  eq("I10: the short first month never gets a week in: from a week after payday", [eo.early, eo.from, eo.days, eo.sure], [true, "2026-10-26", 3, "2026-11-04"]);
  // the usual is from full months only (the short first one would make any normal month look high)
  const u = B.forecast(dbt(mut, "2026-12-10"), "ethan", "2026-12-10").budgets.find(b => b.id === "e-hob");
  eq("I10: usual: November's £80, not October's £5", u.usual, 80);
  eq("I10: Sophie's whatever-is-left Fun is forecast like a day-to-day budget", B.forecast(dbt(null, "2026-12-10"), "sophie", "2026-12-10").budgets.map(b => [b.id, b.mode]), [["s-food", "weekly"], ["s-fun", "remainder"]]);
}
// I11: a Cash ISA gets a monthly reminder like the LISA's, first a month after starting
{
  const isa = (d, p, x) => B.checks(d, p, x).filter(c => /^isa-/.test(c.id));
  eq("I11: not in the first month", isa(dbt(null, "2026-11-20"), "ethan").length, 0);
  eq("I11: a month in, never checked", isa(dbt(null, "2026-11-26"), "ethan"), [{id: "isa-month-2026-11-e-isa", key: "check:isa-month-2026-11-e-isa", text: "Check your Cash ISA and update its value", action: "potcheck", value: "e-isa", order: 41}]);
  eq("I11: checked lately, nothing to do", isa(dbt(t => t.valuations.push({id: "vi", account: "e-isa", date: "2026-11-10", amount: 3300}), "2026-11-26"), "ethan").length, 0);
  eq("I11: \"It's right\" hides it for the month", isa(dbt(t => t.settings.push({person: "ethan", key: "check:isa-month-2026-11-e-isa", value: "done"}), "2026-11-26"), "ethan").length, 0);
  eq("I11: Sophie has no ISA", isa(dbt(null, "2026-12-27"), "sophie").length, 0);
}

// P: a pooled bill. "Flat bills and council tax" is a £450 estimate on the 1st from the Bills pot, shared 2 to 1; Sophie
// sends £150 into the pot on the 1st. The real bills are payments logged against it. Bills months run 16th to 15th.
{
  const flat = (t, extra) => {
    Object.assign(t.bills.find(b => b.id === "e-flat"), {name: "Flat bills and council tax", amount: 450, pool: "2026-10-16", variable: ""}, extra || {});
    t.transfers.find(x => x.id === "s-to-e-bills").amount = 150;
  };
  const pay = (t, id, date, amount, extra) => t.transactions.push(Object.assign({id, date, person: "ethan", amount, budget: "e-flat", account: "e-bills", note: id}, extra || {}));
  // the real bills of 16 Oct to 15 Nov: £370 in all (£80 under)
  const under = t => { flat(t); pay(t, "ctax", "2026-11-02", 150); pay(t, "energy", "2026-11-05", 90); pay(t, "water", "2026-11-10", 92); pay(t, "sky", "2026-11-12", 38); };
  const tickPayday = (t, date) => { const d = B.load(t, date), per = B.periodAt(d, "ethan", date); B.payday(d, "ethan", per).moves.forEach((m, i) => t.moves.push({id: "pm" + date + i, date: per.start, person: "ethan", from: m.from, to: m.to, amount: m.amount, key: "pay:" + per.start + ":" + m.to})); };
  const out = (d, from, to) => B.flows(d, B.addDays(from, -1), B.addDays(to, -1)).filter(f => f.account === "e-bills" && f.amount < 0 && (f.what === "Flat bills and council tax" || d.byId[f.src] && d.byId[f.src].budget === "e-flat" || /^(ctax|energy|water|sky|big)/.test(f.src))).reduce((a, f) => a - f.amount, 0);

  // P1: the bills month
  const d1 = dbt(under, "2026-11-13"), m1 = B.poolMonth(d1, d1.byId["e-flat"], "2026-10-16");
  eq("P1: a bills month runs 16th to 15th, with the estimate dated in it", [m1.start, m1.end, m1.date, m1.estimate, m1.actual, m1.closed], ["2026-10-16", "2026-11-15", "2026-11-01", 450, 370, false]);
  eq("P1: a date picks its bills month", [B.poolStart(d1.byId["e-flat"], "2026-11-15"), B.poolStart(d1.byId["e-flat"], "2026-11-16"), B.poolStart(d1.byId["e-flat"], "2027-01-03")], ["2026-10-16", "2026-11-16", "2026-12-16"]);
  eq("P1: the start day is the pool date's day (a setting, not fixed)", B.poolStart(dbt(t => { under(t); t.bills.find(b => b.id === "e-flat").pool = "2026-10-03"; }, "2026-11-13").byId["e-flat"], "2026-11-13"), "2026-11-03");

  // P2: the double count can't happen. Money out of the Bills pot for the flat bills over the month is the estimate
  // (£450: £370 paid and £80 still to go until the month is over), never £450 + £370
  near("P2: mid-month, the pot's flat bills come to the estimate, not the estimate plus the real bills", out(d1, "2026-10-16", "2026-11-16"), 450);
  const d1b = dbt(under, "2026-11-16");
  near("P2: once the month is over, only what was really paid", out(d1b, "2026-10-16", "2026-11-16"), 370);
  near("P2: going over, the real bills (never the estimate on top)", out(dbt(t => { under(t); pay(t, "big", "2026-11-14", 110); }, "2026-11-13"), "2026-10-16", "2026-11-16"), 480);
  const fl1 = B.flows(d1, "2026-10-31", "2026-11-01").filter(f => f.what === "Flat bills and council tax");
  eq("P2: no £450 payment on the 1st once the real bills are in: what's still to go, from tomorrow", B.flows(d1, "2026-10-15", "2026-12-15").filter(f => f.what === "Flat bills and council tax").map(f => [f.date, f.amount]), [["2026-11-14", -80], ["2026-12-01", -450]]);
  eq("P2: (nothing at all on the 1st itself)", fl1.length, 0);
  // the payday that funds the month moves the estimate once, whatever's been paid; and To do never asks to fill the pot for
  // the real bills when the payday moves were made
  const t2 = fixture(); under(t2); t2.transactions = t2.transactions.filter(x => x.date < "2026-10-29"); tickPayday(t2, "2026-10-29");
  under(t2); t2.transactions = t2.transactions.filter((x, i, a) => a.findIndex(y => y.id === x.id) === i);
  const pd29 = B.payday(dbt(() => {}, "2026-10-29"), "ethan", B.periodAt(dbt(() => {}, "2026-10-29"), "ethan", "2026-10-29"));
  const d2 = B.load(t2, "2026-11-13");
  near("P2: the payday move into the Bills pot is the estimate once (rent, flat bills, phone less Sophie's)", t2.moves.find(m => m.to === "e-bills").amount, 1200 + 450 + 20 - 650 - 100);
  eq("P2: To do never says the pot is short or asks to fill it for the real bills", B.todo(d2, "ethan", "2026-11-13").filter(x => x.from === "e-bills" || x.to === "e-bills" || x.type === "warn").map(x => x.what), []);
  near("P2: while the month is going, what's left of the estimate is still to go", B.balances(d2, "2026-11-15")["e-bills"], 100 + 920 + 150 + 500 - 370 - 20 - 80);
  near("P2: once it's over, the pot holds just what's left (£80) before the rent", B.balances(B.load(t2, "2026-11-16"), "2026-11-15")["e-bills"], 100 + 920 + 150 + 500 - 370 - 20);
  eq("P2: the plan still shows the £450 estimate as the bill (the Money tab)", B.planFor(d2, "ethan", B.periodAt(d2, "ethan", "2026-11-13")).lines.filter(l => l.id === "e-flat").map(l => [l.amount, l.pool]), [[450, true]]);
  eq("P2: a pooled bill isn't set aside for, and its real bills aren't spending", [d2.byId["e-flat"].setAside, B.noSpend(d2, "ethan", "2026-11-12").list.filter(x => x.date === "2026-11-10")[0].spent], [false, false]);
  // next month's real bills before the payday that funds it were paid from that estimate: no catch-up for them
  const t3 = JSON.parse(JSON.stringify(t2)); pay(t3, "ctax2", "2026-11-20", 150);
  const p3 = B.payday(B.load(t3, "2026-11-25"), "ethan", B.periodAt(B.load(t3, "2026-11-25"), "ethan", "2026-11-26"));
  const p2b = B.payday(B.load(t2, "2026-11-25"), "ethan", B.periodAt(B.load(t2, "2026-11-25"), "ethan", "2026-11-26"));
  near("P2: a bill of next month paid before payday doesn't make payday move it twice (the same move: it was paid from the estimate)", p3.moves.find(m => m.to === "e-bills").amount, p2b.moves.find(m => m.to === "e-bills").amount);
  eq("P2: and isn't a catch-up", p3.plan.lines.filter(l => l.catchup && l.account === "e-bills").length, 0);
  eq("P2: Coming up shows what's still to come of next month's estimate", B.coming(B.load(t3, "2026-11-25"), "ethan", "2026-11-25", 14).filter(c => c.item === "e-flat").map(c => [c.date, c.amount]), [["2026-12-01", 300]]);
  eq("P2: the year's bills count what really went", B.yearReview(B.load(t3, "2026-11-25"), "ethan", "2026-04-06").billsBy.filter(x => x.id === "e-flat").map(x => x.amount), [370 + 150]);

  // P3: a month under the estimate: £80 left, split 2 to 1. Sophie's £26.67 comes back; Ethan's £53.33 stays in the pot
  // and goes to his savings through the next payday (less goes into the pot, more to whatever is left)
  near("P3: Sophie gets her third of what's left back", m1.back, 26.67);
  near("P3: Ethan keeps two thirds", m1.keep, 53.33);
  eq("P3: nothing owed before the month is over", B.between(d1, "ethan", "2026-11-13").net, 0);
  eq("P3: no move to savings at all (it goes through payday)", B.todo(d1b, "ethan", "2026-11-16").filter(x => x.type === "move" && /^pool:/.test(x.key)).length, 0);
  const te = B.todo(d1b, "ethan", "2026-11-16"), ts = B.todo(d1b, "sophie", "2026-11-16");
  eq("P3: the 16th, Ethan: pay Sophie her share", te.filter(x => !x.payday && x.type !== "warn" && !/^fill/.test(x.key)).map(x => [x.what, x.why]), [
    ["Pay Sophie £26.67", "Sophie's share of what's left of flat bills and council tax, 16 Oct to 15 Nov."]]);
  eq("P3: Sophie sees the same from her side", ts.filter(x => x.type === "settle").map(x => [x.what, x.why]), [["Ethan owes you £26.67", "Your share of what's left of flat bills and council tax, 16 Oct to 15 Nov. Tick when it arrives."]]);
  eq("P3: between you, from both sides", [B.between(d1b, "ethan", "2026-11-16").iOwe, B.between(d1b, "sophie", "2026-11-16").owedToMe], [26.67, 26.67]);
  eq("P3: paying Sophie back squares it", B.between(dbt(t => { under(t); t.settlements.push({id: "s", date: "2026-11-17", from: "ethan", to: "sophie", amount: 26.67}); }, "2026-11-17"), "sophie", "2026-11-17").net, 0);
  // the next payday counts what's left, still in the pot, as already there (Ethan paid Sophie from his main account),
  // so £80 less goes into the pot and £80 more to his Cash ISA (whatever is left) than if it had come to the estimate
  const t4 = JSON.parse(JSON.stringify(t2)); t4.settlements.push({id: "s", date: "2026-11-16", from: "ethan", to: "sophie", amount: 26.67});
  const p4 = B.payday(B.load(t4, "2026-11-25"), "ethan", B.periodAt(B.load(t4, "2026-11-25"), "ethan", "2026-11-26"));
  const t5 = JSON.parse(JSON.stringify(t4)); pay(t5, "rest", "2026-11-14", 80);
  const p5 = B.payday(B.load(t5, "2026-11-25"), "ethan", B.periodAt(B.load(t5, "2026-11-25"), "ethan", "2026-11-26"));
  eq("P3: next payday: what's left counts as already in the pot, and says where it's from", p4.plan.lines.filter(l => l.already && l.account === "e-bills").map(l => [l.amount, l.poolLeft && l.poolLeft.amount, l.poolLeft && l.poolLeft.start]), [[80, 80, "2026-10-16"]]);
  near("P3: so £80 less goes into the pot", p5.moves.find(m => m.to === "e-bills").amount - p4.moves.find(m => m.to === "e-bills").amount, 80);
  // (both had Ethan pay Sophie £26.67 from his account, so the £80 freed is his £53.33 plus the £26.67 he paid her)
  near("P3: and the pay that frees goes to whatever is left (the Cash ISA)", p4.plan.remainder - p5.plan.remainder, 80);

  // P4: a month over the estimate: £480, £30 over. Sophie owes her £10; Ethan's £20 is his own
  const over = t => { under(t); pay(t, "big", "2026-11-14", 110); };
  const d5 = dbt(over, "2026-11-16"), m5 = B.poolMonth(d5, d5.byId["e-flat"], "2026-10-16");
  eq("P4: over", [m5.actual, m5.left, m5.owes, m5.mineOver, m5.keep, m5.back], [480, -30, 10, 20, 0, 0]);
  eq("P4: Ethan: Sophie owes him her share", B.todo(d5, "ethan", "2026-11-16").filter(x => x.type === "settle").map(x => [x.what, x.why]), [["Sophie owes you £10.00", "Sophie's share of flat bills and council tax going over, 16 Oct to 15 Nov. Tick when it arrives."]]);
  eq("P4: Sophie: pay Ethan her share", B.todo(d5, "sophie", "2026-11-16").filter(x => x.type === "settle").map(x => [x.what, x.why]), [["Pay Ethan £10.00", "Your share of flat bills and council tax going over, 16 Oct to 15 Nov."]]);
  eq("P4: between you", B.between(d5, "sophie", "2026-11-16").iOwe, 10);

  // P5: Sophie's view: her phone gets the bill and its real payments (not Ethan's other payments) and works out the same
  const sophieRows = t => { under(t); t.transactions.push({id: "lunch", date: "2026-11-03", person: "ethan", amount: 9, budget: "e-fun", account: "e-main"}); };
  const ds = dbt(t => { sophieRows(t); t.transactions = t.transactions.filter(x => x.budget === "e-flat"); }, "2026-11-13");
  eq("P5: Sophie's phone, from the rows she gets, sees the same running total", (({estimate, actual, back}) => [estimate, actual, back])(B.poolMonth(ds, ds.byId["e-flat"], "2026-10-16")), [450, 370, 26.67]);
  eq("P5: the pooled bills she can see: shared with her", [B.pools(ds, "sophie").map(b => b.id), B.pools(ds, "ethan").map(b => b.id)], [["e-flat"], ["e-flat"]]);
  eq("P5: none of it is her spending", B.yearReview(ds, "sophie", "2026-04-06").spent.length, 0);

  // P6: the estimate changes (amounts) and the split changes (a dated split), from 1 Dec: November keeps its own
  const changed = t => { under(t); t.amounts.push({id: "a1", item: "e-flat", start: "2026-12-01", amount: 500}, {id: "a2", item: "bills", start: "2026-12-01", shares: "ethan:1, sophie:1"}); t.amounts.push({id: "a3", item: "s-to-e-bills", start: "2026-12-01", amount: 250}); pay(t, "ctax2", "2026-11-20", 150); pay(t, "energy2", "2026-12-05", 90); };
  const d6 = dbt(changed, "2026-12-16"), mA = B.poolMonth(d6, d6.byId["e-flat"], "2026-10-16"), mB = B.poolMonth(d6, d6.byId["e-flat"], "2026-11-16");
  eq("P6: the old month keeps £450 and 2 to 1", [mA.estimate, mA.back, mA.keep], [450, 26.67, 53.33]);
  eq("P6: the new month: £500, half each", [mB.estimate, mB.actual, mB.back, mB.keep], [500, 240, 130, 130]);
  eq("P6: between you: November's back, then December's (her £250 matches her new half)", B.between(d6, "sophie", "2026-12-16").owedToMe, B.round(26.67 + 130));
  eq("P6: the split from a date, and before it", [B.sharesAt(d6, "bills", "2026-11-30"), B.sharesAt(d6, "bills", "2026-12-01")], ["ethan:2, sophie:1", "ethan:1, sophie:1"]);
  eq("P6: a split payment from before the change keeps its share", B.myShare(dbt(t => { changed(t); t.transactions.push({id: "sp", date: "2026-11-20", person: "ethan", amount: 30, budget: "e-fun", split: "bills"}); }, "2026-12-16"), "sophie", {date: "2026-11-20", person: "ethan", amount: 30, split: "bills"}), 10);
  eq("P6: Sophie's back for both months is one settling up", B.todo(d6, "ethan", "2026-12-16").filter(x => x.type === "settle").map(x => [x.amount, x.why]), [[156.67, "Sophie's share of what's left of flat bills and council tax, 16 Oct to 15 Dec."]]);

  // P7: a partial first month: pooling from 5 Nov. The 1 Nov estimate is an ordinary bill; the first bills month is
  // 5 Nov to 4 Dec, and a real bill before 5 Nov isn't in it
  const d7 = dbt(t => { under(t); t.bills.find(b => b.id === "e-flat").pool = "2026-11-05"; }, "2026-12-05");
  const m7 = B.poolMonth(d7, d7.byId["e-flat"], "2026-11-05");
  eq("P7: first month", [m7.start, m7.end, m7.estimate, m7.actual], ["2026-11-05", "2026-12-04", 450, 220]);
  eq("P7: before it, the estimate is paid as an ordinary bill", B.flows(d7, "2026-10-31", "2026-11-01").filter(f => f.what === "Flat bills and council tax").map(f => f.amount), [-450]);
  eq("P7: the months before the pool date aren't settled up", B.between(d7, "sophie", "2026-12-05").pools.map(x => x.month.start), ["2026-11-05"]);

  // P8: a real bill paid by card from the main account: the money for it goes back from the Bills pot
  const d8 = dbt(t => { under(t); t.transactions.find(x => x.id === "water").account = "e-main"; }, "2026-11-13");
  eq("P8: paid from the main account: To do moves it back from the pot", B.todo(d8, "ethan", "2026-11-13").filter(x => x.from === "e-bills" && x.to === "e-main").map(x => [x.amount, x.why]), [[92, "You paid for flat bills and council tax from Main account."]]);
  near("P8: and it still counts against the estimate", B.poolMonth(d8, d8.byId["e-flat"], "2026-10-16").actual, 370);
}

// P9-P14 (review of 1.4.19): weekend shifts, skipped estimates, one-date amounts, frozen months, a year of paydays
{
  const pay = (t, id, date, amount, extra) => t.transactions.push(Object.assign({id, date, person: "ethan", amount, budget: "e-flat", account: "e-bills", note: id}, extra || {}));
  const flat = (t, extra) => { Object.assign(t.bills.find(b => b.id === "e-flat"), {name: "Flat bills", amount: 450, pool: "2026-10-16", variable: ""}, extra || {}); t.transfers.find(x => x.id === "s-to-e-bills").amount = 150; };
  const months = (d, list) => list.map(s => (m => [m.start, m.estimate, m.actual, m.back, m.owes])(B.poolMonth(d, d.byId["e-flat"], s)));
  // P9: the estimate on the 15th, moved to the next working day (Sun 15 Nov is Mon 16 Nov, in the next bills month by
  // its day): each bills month still has exactly one estimate, its own
  const shifted = t => { flat(t, {on: "15", shift: "next working day", start: "2026-10-15"}); pay(t, "a1", "2026-10-20", 370); pay(t, "a2", "2026-11-20", 370); pay(t, "a3", "2026-12-20", 370); };
  const d9 = dbt(shifted, "2027-01-20");
  eq("P9: one estimate a month, whatever day a weekend moves it to", months(d9, ["2026-10-16", "2026-11-16", "2026-12-16"]), [["2026-10-16", 450, 370, 26.67, 0], ["2026-11-16", 450, 370, 26.67, 0], ["2026-12-16", 450, 370, 26.67, 0]]);
  eq("P9: settled up: £26.67 back to Sophie each month", B.between(d9, "sophie", "2027-01-20").pools.map(x => x.amount), [26.67, 26.67, 26.67]);
  const prev = t => { flat(t, {on: "16", shift: "previous working day", start: "2026-10-16"}); pay(t, "a1", "2026-10-20", 370); pay(t, "a2", "2026-11-20", 370); pay(t, "a3", "2026-12-20", 370); };
  const d9b = dbt(prev, "2027-01-20");
  eq("P9: the previous working day, crossing back into the month before, doesn't either", months(d9b, ["2026-10-16", "2026-11-16", "2026-12-16"]).map(x => x[1]), [450, 450, 450]);
  eq("P9: (Sat 16 Jan's estimate is paid on Fri 15 Jan, and still belongs to the month from the 16th)", B.poolMonth(d9b, d9b.byId["e-flat"], "2027-01-16").date, "2027-01-15");
  // P10: a month whose estimate was skipped, or the bill stopped while late bills still came: settled against nothing
  const skip = t => { flat(t); pay(t, "c", "2026-11-02", 150); pay(t, "c2", "2026-11-20", 300); pay(t, "c3", "2027-01-02", 100); t.exceptions.push({id: "xs", item: "e-flat", date: "2026-12-01", action: "skip"}); };
  const d10 = dbt(skip, "2027-01-20");
  eq("P10: a skipped estimate's month is settled up against nothing (Sophie's third of the £300)", B.between(d10, "sophie", "2027-01-20").pools.map(x => [x.month.start, x.amount]), [["2026-10-16", 100], ["2026-11-16", -100], ["2026-12-16", 116.67]]);
  const stop = t => { flat(t, {end: "2026-11-30"}); pay(t, "c", "2026-11-02", 400); pay(t, "late", "2026-12-04", 60); };
  const d10b = dbt(stop, "2027-01-20");
  eq("P10: stopped, with a late bill after: that month settles too (Sophie pays her third of it)", B.between(d10b, "sophie", "2027-01-20").pools.map(x => [x.month.start, x.amount]), [["2026-10-16", 16.67], ["2026-11-16", -20]]);
  // P11: a one-date amount (or the bank feed's day) on a pooled estimate isn't its estimate: the payments are the money
  const ex = t => { flat(t); pay(t, "c", "2026-11-02", 370); t.exceptions.push({id: "x-e-flat-2026-11-01-bank-ethan", item: "e-flat", date: "2026-11-01", action: "amount", amount: 472.1}, {id: "x-e-flat-2026-11-01-bankday-ethan", item: "e-flat", date: "2026-11-01", action: "move", newDate: "2026-11-03"}); };
  const d11 = dbt(ex, "2026-11-20"), m11 = B.poolMonth(d11, d11.byId["e-flat"], "2026-10-16");
  eq("P11: the estimate stays £450 on its own day", [m11.estimate, m11.date, m11.back], [450, "2026-11-01", 26.67]);
  eq("P11: but before the pool date an amount for one date still counts", B.occurrences(dbt(t => { flat(t, {start: "2026-10-01"}); t.exceptions.push({id: "x1o", item: "e-flat", date: "2026-10-01", action: "amount", amount: 400}); }), t => 0, "2026-10-01", "2026-10-02").length === undefined ? 0 : B.occurrences(dbt(t => { flat(t, {start: "2026-10-01"}); t.exceptions.push({id: "x1o", item: "e-flat", date: "2026-10-01", action: "amount", amount: 400}); }), dbt(t => flat(t, {start: "2026-10-01"})).byId["e-flat"], "2026-10-01", "2026-10-02").map(o => o.amount), [400]);
  // P12: a month that's over is frozen (settings "pool:<bill>:<start>"); after that, moving the pool date, turning
  // pooling off or changing a past payment doesn't settle it again, and pooling only changes from the next month
  const base = t => { flat(t); pay(t, "c", "2026-11-02", 150); pay(t, "e", "2026-11-05", 90); pay(t, "w", "2026-11-10", 92); pay(t, "s", "2026-11-12", 38); t.settlements.push({id: "st", date: "2026-11-16", from: "ethan", to: "sophie", amount: 26.67}); };
  const freeze = (t, date) => B.poolToFreeze(B.load(t, date), "ethan", date).forEach(f => t.settings.push({person: "ethan", key: f.key, value: f.value}));
  const tf = fixture(); base(tf);
  eq("P12: not frozen until two days after the month", B.poolToFreeze(B.load(tf, "2026-11-17"), "ethan", "2026-11-17").length, 0);
  freeze(tf, "2026-11-18");
  eq("P12: then once", [tf.settings.filter(x => /^pool:/.test(x.key)).map(x => x.key), B.poolToFreeze(B.load(tf, "2026-11-19"), "ethan", "2026-11-19").length], [["pool:e-flat:2026-10-16"], 0]);
  const net = (mut) => B.between(dbt(t => { base(t); t.settings = t.settings.concat(tf.settings.filter(x => /^pool:/.test(x.key))); pay(t, "d", "2026-11-25", 100); mut(t); }, "2026-11-30"), "sophie", "2026-11-30").net;
  eq("P12: settled, as it is", net(() => {}), 0);
  eq("P12: the pool date moved to the 1st: the settled month stays settled", net(t => { t.bills.find(b => b.id === "e-flat").pool = "2026-11-01"; }), 0);
  eq("P12: pooling turned off: the same", net(t => { t.bills.find(b => b.id === "e-flat").pool = ""; }), 0);
  eq("P12: an old payment changed afterwards: the same", net(t => { t.transactions.find(x => x.id === "c").amount = 50; }), 0);
  const d12 = dbt(t => { base(t); t.settings = t.settings.concat(tf.settings.filter(x => /^pool:/.test(x.key))); t.bills.find(b => b.id === "e-flat").pool = "2026-11-01"; }, "2026-11-30");
  eq("P12: a new pool date applies from the end of the last settled month", B.poolMonths(d12, d12.byId["e-flat"], "2026-10-01", "2027-01-05").map(m => [m.start, m.next, m.frozen]), [["2026-10-16", "2026-11-16", true], ["2026-11-16", "2026-12-01", false], ["2026-12-01", "2027-01-01", false], ["2027-01-01", "2027-02-01", false]]);
  const d12b = dbt(t => { base(t); t.settings = t.settings.concat(tf.settings.filter(x => /^pool:/.test(x.key))); t.bills.find(b => b.id === "e-flat").pool = ""; }, "2026-11-30");
  eq("P12: pooling off: the settled month keeps its record, and the next estimate is an ordinary bill again", [B.poolMonth(d12b, d12b.byId["e-flat"], "2026-10-16").back, B.flows(d12b, "2026-11-30", "2026-12-01").filter(f => f.what === "Flat bills").map(f => f.amount)], [26.67, [-450]]);
  // P13: a pooled bill's real bill before the pool date isn't one of its payments
  eq("P13: tagged before the pool date, it's not counted in a month (nor is it a bill's)", [B.isPoolTx(dbt(t => { flat(t); pay(t, "old", "2026-10-10", 50); }), {budget: "e-flat", person: "ethan", date: "2026-10-10"}), B.isPoolTx(dbt(t => flat(t)), {budget: "e-flat", person: "ethan", date: "2026-10-20"})], [false, true]);
  // P14: a year of paydays (the review's simulation): each payday's moves made, Sophie settled each 16th. The Bills pot
  // is never short, never asks to be filled, what's left goes through payday, and it all adds up
  const sim = (cfg) => {
    const t = fixture(); flat(t, {on: cfg.on || "1", shift: cfg.shift || "", start: cfg.start || "2026-11-01"});
    let n = 0; const real = {2: 150, 5: 90, 10: 92, 12: 38}, log = [];
    for (let day = "2026-10-26"; day <= "2027-09-30"; day = B.addDays(day, 1)) {
      const dd = +day.slice(8, 10);
      if (real[dd]) t.transactions.push({id: "rb" + n++, date: day, person: "ethan", amount: Math.round(real[dd] * (cfg.scale || 1) * (1 + 0.3 * Math.sin(n)) * 100) / 100, budget: "e-flat", account: "e-bills", note: "real"});
      let d = B.load(t, day); const per = B.periodAt(d, "ethan", day);
      if (per.pay && per.start === day && day !== "2026-10-26") { B.payday(d, "ethan", per).moves.forEach(m => t.moves.push({id: "pm" + n++, date: day, person: "ethan", from: m.from, to: m.to, amount: m.amount, key: "pay:" + day + ":" + m.to})); d = B.load(t, day); }
      const td = B.todo(d, "ethan", day);
      td.filter(x => x.type === "move" && /^(back|refund):/.test(x.key)).forEach(x => x.keys.forEach(k => t.moves.push({id: "o" + n++, date: day, person: "ethan", from: x.from, to: x.to, amount: k.amount, key: k.key})));
      td.filter(x => x.type === "warn" || (x.type === "move" && /^fill:/.test(x.key) && x.to === "e-bills")).forEach(x => log.push(day + " " + x.what));
      const bt = B.between(d, "ethan", day);
      if (dd === 16 && Math.abs(bt.net) > 0.004) t.settlements.push(bt.iOwe ? {id: "s" + n++, date: day, from: "ethan", to: "sophie", amount: bt.iOwe} : {id: "s" + n++, date: day, from: "sophie", to: "ethan", amount: bt.owedToMe});
      // (the sheet's hourly record, as the re-review's simulation runs it: every day)
      B.poolToFreeze(d, "ethan", day).forEach(f => t.settings.push({person: "ethan", key: f.key, value: f.value}));
    }
    const d = B.load(t, "2027-09-30"), ms = B.poolMonths(d, d.byId["e-flat"], "2026-10-16", "2027-09-16").filter(m => m.closed);
    return {log, months: ms.length, frozen: ms.filter(m => m.frozen).length, between: B.between(d, "ethan", "2027-09-30").net, est: ms.every(m => m.estimate === 450)};
  };
  const s1 = sim({});
  eq("P14: a year: never short, every month one estimate, settled, frozen", [s1.log, s1.months, s1.frozen, s1.est, s1.between], [[], 11, 11, true, 0]);
  const s2 = sim({on: "15", shift: "next working day", start: "2026-10-15"});
  eq("P14: the same with the estimate on the 15th, moved for weekends", [s2.log, s2.est, s2.between], [[], true, 0]);
  const s3 = sim({scale: 1.3});
  // (going over is real money the pot hasn't got: To do fills it until payday, which then tops it up; it's never short
  // with nowhere to fill it from)
  eq("P14: and going over every month: filled until payday, never short", [s3.log.filter(l => / short$/.test(l) && !/^2026-1[01]/.test(l)), s3.between, s3.est], [[], 0, true]);
}

// P15-P21 (re-review of 1.4.19): late bills for a recorded month, waiting to record, old-style payments from the pot,
// changes only from the next month, and one month's estimate changed by hand
{
  const pay = (t, id, date, amount, extra) => t.transactions.push(Object.assign({id, date, person: "ethan", amount, budget: "e-flat", account: "e-bills", note: id}, extra || {}));
  const flat = (t, extra) => { Object.assign(t.bills.find(b => b.id === "e-flat"), {name: "Flat bills", amount: 450, pool: "2026-10-16", variable: ""}, extra || {}); t.transfers.find(x => x.id === "s-to-e-bills").amount = 150; };
  const freeze = (t, date, sync) => B.poolToFreeze(B.load(t, date), "ethan", date, sync).forEach(f => t.settings.push({person: "ethan", key: f.key, value: f.value}));
  const base = () => { const t = fixture(); flat(t); pay(t, "c", "2026-11-02", 150); pay(t, "e", "2026-11-05", 90); pay(t, "w", "2026-11-10", 92); pay(t, "s", "2026-11-12", 38); return t; };
  // P15: a 12 Nov direct debit said "Part of flat bills" on 20 Nov, after 16 Oct to 15 Nov was recorded on the 18th: it
  // goes into the month going now, listed as late from the recorded month, and is shared at its settling up
  const t15 = base(); freeze(t15, "2026-11-18");
  pay(t15, "dd", "2026-11-12", 60);
  const d15 = B.load(t15, "2026-11-20"), b15 = d15.byId["e-flat"], rec15 = B.poolMonth(d15, b15, "2026-10-16"), cur15 = B.poolMonth(d15, b15, "2026-11-16");
  eq("P15: the recorded month keeps what it had, and lists just that", [rec15.actual, rec15.payments.map(x => x.id), rec15.payments.reduce((a, x) => a + x.amount, 0)], [370, ["c", "e", "w", "s"], 370]);
  eq("P15: the late one is in the month going now, as late from the recorded one", [cur15.actual, cur15.late.map(x => [x.id, x.from, x.amount])], [60, [["dd", "2026-10-16", 60]]]);
  eq("P15: so Sophie's share of it comes at that month's settling up", B.between(B.load(t15, "2026-12-16"), "sophie", "2026-12-16").pools.map(x => [x.month.start, x.amount]), [["2026-10-16", 26.67], ["2026-11-16", 130]]);
  freeze(t15, "2026-12-18");
  const d15b = B.load(t15, "2026-12-20"), m15 = B.poolMonth(d15b, d15b.byId["e-flat"], "2026-11-16");
  eq("P15: once that month is recorded, it lists the late one too, and it isn't late again", [m15.frozen, m15.actual, m15.late.map(x => x.id), B.poolMonth(d15b, d15b.byId["e-flat"], "2026-12-16").late.length], [true, 60, ["dd"], 0]);
  // taken off again after both were recorded: it comes off the month going then
  const t15c = JSON.parse(JSON.stringify(t15)); t15c.transactions.find(x => x.id === "dd").budget = "e-fun";
  const d15c = B.load(t15c, "2026-12-20");
  eq("P15: taken off later: taken off the month going then", B.poolMonth(d15c, d15c.byId["e-flat"], "2026-12-16").late.map(x => [x.id, x.amount]), [["dd", -60]]);
  // P16: the record waits while a payment from the pot in the month is still to be checked, or the bank hasn't been read
  // since the day after (Monzo needing approval again), up to 10 days
  const t16 = base(); t16.transactions.push({id: "q", date: "2026-11-14", person: "ethan", amount: 25, budget: "", account: "e-bills", note: "NEW PAYEE", review: true});
  const nf = (t, d, sync) => B.poolToFreeze(B.load(t, d), "ethan", d, sync).length;
  eq("P16: waits for an unchecked payment from the pot", [nf(t16, "2026-11-18"), nf(t16, "2026-11-25"), nf(t16, "2026-11-26")], [0, 0, 1]);
  eq("P16: waits for the bank to be read after the month", [nf(base(), "2026-11-18", "2026-11-15"), nf(base(), "2026-11-18", "2026-11-17"), nf(base(), "2026-11-26", "2026-11-15")], [0, 1, 1]);
  // P17: a payment saved the old way (from Main, with the bank's move from the pot) and counted in later: already paid
  // from the pot, so To do doesn't ask to move it back
  const d17 = dbt(t => { flat(t); pay(t, "old", "2026-11-03", 75, {account: "e-main"}); t.moves.push({id: "bk-monzo-oldwd", date: "2026-11-03", person: "ethan", from: "e-bills", to: "e-main", amount: 75, key: "bank:oldwd"}); }, "2026-11-13");
  eq("P17: an old-style payment from the pot isn't moved back", B.todo(d17, "ethan", "2026-11-13").filter(x => x.from === "e-bills" && x.to === "e-main").length, 0);
  eq("P17: (without the bank's move, it is)", B.todo(dbt(t => { flat(t); pay(t, "old", "2026-11-03", 75, {account: "e-main"}); }, "2026-11-13"), "ethan", "2026-11-13").filter(x => x.from === "e-bills" && x.to === "e-main").map(x => x.amount), [75]);
  // P18: turning pooling off, or a new day, counts from the next bills month that hasn't started: the month going now
  // and one waiting to be recorded stay as they are
  const t18 = base(); t18.settlements.push({id: "st", date: "2026-11-16", from: "ethan", to: "sophie", amount: 26.67});
  const d18 = B.load(t18, "2026-11-17"), b18 = d18.byId["e-flat"];
  eq("P18: off on 17 Nov (16 Oct to 15 Nov waiting to be recorded): from 16 Dec", B.poolChange(d18, b18, false, 16, "2026-11-17"), "2026-10-16, off 2026-12-16");
  eq("P18: the 1st instead: from 1 Jan, after a short month to 31 Dec", B.poolChange(d18, b18, true, 1, "2026-11-17"), "2026-10-16, 2027-01-01");
  const off18 = dbt(t => { Object.assign(t, JSON.parse(JSON.stringify(t18))); t.bills.find(b => b.id === "e-flat").pool = "2026-10-16, off 2026-12-16"; }, "2026-11-17");
  eq("P18: off: the settled month and the month going now are as they were", [B.between(off18, "sophie", "2026-11-17").net, B.poolMonths(off18, off18.byId["e-flat"], "2026-10-01", "2027-02-01").map(m => m.start)], [0, ["2026-10-16", "2026-11-16"]]);
  eq("P18: and from 16 Dec it's an ordinary bill again", B.flows(off18, "2026-12-31", "2027-01-01").filter(f => f.what === "Flat bills").map(f => f.amount), [-450]);
  const day18 = dbt(t => { Object.assign(t, JSON.parse(JSON.stringify(t18))); t.bills.find(b => b.id === "e-flat").pool = "2026-10-16, 2027-01-01"; }, "2026-11-17");
  eq("P18: a new day: the months run on to it", B.poolMonths(day18, day18.byId["e-flat"], "2026-10-01", "2027-03-01").map(m => [m.start, m.end, m.estimate]), [["2026-10-16", "2026-11-15", 450], ["2026-11-16", "2026-12-15", 450], ["2026-12-16", "2026-12-31", 0], ["2027-01-01", "2027-01-31", 450], ["2027-02-01", "2027-02-28", 450]]);
  eq("P18: turned on (not yet pooled): from the bills month going now", B.poolChange(dbt(t => { flat(t, {pool: ""}); }, "2026-11-20"), dbt(t => { flat(t, {pool: ""}); }).byId["e-flat"], true, 16, "2026-11-20"), "2026-11-16");
  eq("P18: a change not started yet is replaced", B.poolChange(off18, off18.byId["e-flat"], true, 16, "2026-11-20"), "2026-10-16");
  // P19: one month's estimate changed by hand ("December's is £520") counts; the bank feed's own amount doesn't
  const d19 = dbt(t => { flat(t); t.exceptions.push({id: "x-e-flat-2026-12-01-amount", item: "e-flat", date: "2026-12-01", action: "amount", amount: 520}, {id: "x-e-flat-2027-01-01-bank-ethan", item: "e-flat", date: "2027-01-01", action: "amount", amount: 380}); }, "2026-11-20");
  eq("P19: your own change to one month's estimate counts, the bank's doesn't", [B.poolMonth(d19, d19.byId["e-flat"], "2026-11-16").estimate, B.poolMonth(d19, d19.byId["e-flat"], "2026-12-16").estimate], [520, 450]);
}

// P22-P23 (final review): To do's own move back isn't an old-style payment; once pooling has stopped for good, a
// recorded month isn't offered any more
{
  // P22: water £40 paid by card from Main, To do asks for it back from the pot and Ethan ticks it; then £25 of energy
  // from Main: To do asks for the £25 (the ticked move isn't taken for an old-style payment from the pot)
  const t = fixture(); Object.assign(t.bills.find(b => b.id === "e-flat"), {amount: 450, pool: "2026-10-16", variable: ""});
  t.transactions.push({id: "wat", date: "2026-11-03", person: "ethan", amount: 40, budget: "e-flat", account: "e-main", note: "Water"});
  const back = (d) => B.todo(B.load(t, d), "ethan", d).filter(x => x.type === "move" && x.from === "e-bills" && x.to === "e-main").map(x => x.amount);
  eq("P22: water from Main: To do asks for it back", back("2026-11-03"), [40]);
  const it = B.todo(B.load(t, "2026-11-03"), "ethan", "2026-11-03").find(x => x.from === "e-bills" && x.to === "e-main");
  t.moves.push({id: "tick1", date: "2026-11-03", person: "ethan", from: "e-bills", to: "e-main", amount: 40, key: it.keys[0].key});
  eq("P22: ticked: done", back("2026-11-03"), []);
  t.transactions.push({id: "eng", date: "2026-11-08", person: "ethan", amount: 25, budget: "e-flat", account: "e-main", note: "Energy top-up"});
  eq("P22: then energy £25 from Main: it asks for that", back("2026-11-08"), [25]);
  // the same with the bank feed's own move ticking it (a To do key): still not an old-style one
  const t2 = JSON.parse(JSON.stringify(t)); t2.moves.find(m => m.id === "tick1").id = "bk-monzo-tx_tick"; t2.meta.push({key: "pot.pairFromAt", value: String(Date.UTC(2027, 0, 1))});
  eq("P22: (also when the bank feed ticked it)", B.todo(B.load(t2, "2026-11-08"), "ethan", "2026-11-08").filter(x => x.type === "move" && x.from === "e-bills" && x.to === "e-main").map(x => x.amount), [25]);
  // a bank move written after it started pairing isn't old-style either
  const t3 = fixture(); Object.assign(t3.bills.find(b => b.id === "e-flat"), {amount: 450, pool: "2026-10-16", variable: ""}); t3.meta.push({key: "pot.pairFromAt", value: "1000"});
  t3.transactions.push({id: "old", date: "2026-11-03", person: "ethan", amount: 75, budget: "e-flat", account: "e-main"}); t3.moves.push({id: "bk-monzo-x", date: "2026-11-03", person: "ethan", from: "e-bills", to: "e-main", amount: 75, key: "bank:x", updated: 5000});
  eq("P22: a bank move written after pairing began isn't an old-style payment", B.todo(B.load(t3, "2026-11-13"), "ethan", "2026-11-13").filter(x => x.from === "e-bills" && x.to === "e-main").map(x => x.amount), [75]);
  // P23 (e7): pooling stopped from 16 Nov, 16 Oct to 15 Nov recorded; a 10 Nov bill counted in afterwards has no month to
  // go into: it isn't offered, and if it's counted in anyway it changes nothing (nothing counted twice)
  const t7 = fixture(); Object.assign(t7.bills.find(b => b.id === "e-flat"), {amount: 450, pool: "2026-10-16, off 2026-11-16", variable: ""});
  t7.transfers.find(x => x.id === "s-to-e-bills").amount = 150;
  const pay = (id, date, amount) => t7.transactions.push({id, date, person: "ethan", amount, budget: "e-flat", account: "e-bills", note: id});
  pay("c", "2026-11-02", 150);
  B.poolToFreeze(B.load(t7, "2026-11-18"), "ethan", "2026-11-18").forEach(f => t7.settings.push({person: "ethan", key: f.key, value: f.value}));
  const d7a = B.load(t7, "2026-12-20"), net0 = B.between(d7a, "sophie", "2026-12-20").net;
  eq("P23: not offered for the recorded month once pooling has stopped (before it was recorded, it was)", [B.poolOffer(d7a, d7a.byId["e-flat"], "2026-11-10"), (d => B.poolOffer(d, d.byId["e-flat"], "2026-11-10"))(B.load(Object.assign({}, t7, {settings: t7.settings.filter(x => !/^pool:/.test(x.key))}), "2026-11-12"))], [false, true]);
  pay("late", "2026-11-10", 60);
  const d7 = B.load(t7, "2026-12-20");
  eq("P23: counted in anyway: changes nothing", [B.between(d7, "sophie", "2026-12-20").net, B.poolMonths(d7, d7.byId["e-flat"], "2000-01-01", "2027-01-20").map(m => [m.start, m.actual, m.late.length]), B.isPoolTx(d7, t7.transactions.find(x => x.id === "late"))], [net0, [["2026-10-16", 150, 0]], true]);
  eq("P23: and isn't spending either", B.yearReview(d7, "ethan", "2026-04-06").spent.filter(x => /flat|household/i.test(x.name)).length, 0);
}

console.log(fails ? fails + " failed, " + passes + " passed" : "All " + passes + " passed");
process.exit(fails ? 1 : 0);
