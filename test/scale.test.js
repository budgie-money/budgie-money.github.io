// Ten years of daily spending for two people, with every payday ticked and balances checked each month: the views must stay quick.
const B = require("../engine.js"), fixture = require("./fixture.js");
const t = fixture(); let n = 0, seed = 3; const rnd = () => (seed = (seed * 9301 + 49297) % 233280) / 233280;
const END = "2036-10-27", TODAY = "2036-10-20";
for (let d = "2026-10-27"; d < END; d = B.addDays(d, 1)) {
  if (rnd() < 0.5) t.transactions.push({id: "x" + n++, date: d, person: "ethan", amount: +(5 + rnd() * 30).toFixed(2), budget: rnd() < 0.6 ? "e-food-b" : "e-fun", account: rnd() < 0.8 ? "e-food" : "e-main", split: rnd() < 0.05 ? "half" : ""});
  if (rnd() < 0.5) t.transactions.push({id: "x" + n++, date: d, person: "sophie", amount: +(3 + rnd() * 20).toFixed(2), budget: "s-food", account: "s-main", split: rnd() < 0.1 ? "half" : ""});
  if (d.slice(8) === "15") t.valuations.push({id: "v" + d, account: "e-main", date: d, amount: +(200 + rnd() * 100).toFixed(2)});
}
// tick every payday's moves, as people do
const db0 = B.load(t, END);
B.periods(db0, "ethan", "2026-10-29", END).forEach((p, i) => { if (p.pay && !p.opening) B.payday(db0, "ethan", p).moves.forEach((m, j) => t.moves.push({id: "pm" + i + "-" + j, date: p.start, person: "ethan", from: m.from, to: m.to, amount: m.amount, key: "pay:" + p.start + ":" + m.to})); });
let s = Date.now(); const db = B.load(t, TODAY); const load = Date.now() - s;
s = Date.now(); const v = B.today(db, "ethan", TODAY); const first = Date.now() - s;
s = Date.now(); B.today(db, "ethan", TODAY); B.pots(db, "ethan", TODAY); B.year(db, "ethan", TODAY); B.lisa(db, "e-lisa", TODAY); const again = Date.now() - s;
s = Date.now(); B.summary(B.load(t, TODAY), "sophie", TODAY); const summary = Date.now() - s;
console.log(t.transactions.length + " payments, " + t.moves.length + " moves · load " + load + " ms · first Today " + first + " ms · again " + again + " ms · partner summary " + summary + " ms · safe £" + v.safe + " · to do " + v.todo.length);
process.exit(first > 5000 || summary > 5000 ? 1 : 0);
