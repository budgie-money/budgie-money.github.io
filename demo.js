/* Show and tell: a made-up household so the app can be shown off without real money on screen.
   Everything is generated from today's date, so the demo never goes stale. */
(function (root) {
  function make(today) {
    var B = root.Budgie, add = B.addDays, start = add(today, -100);
    var seed = 7, rnd = function () { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };
    var t = {
      people: [
        {id: "alex", name: "Alex", bank: "Monzo", potWord: "pot", partner: "sam"},
        {id: "sam", name: "Sam", bank: "Starling", potWord: "Space", partner: "alex"}
      ],
      accounts: [
        {id: "a-main", owner: "alex", name: "Main account", kind: "main", order: 1},
        {id: "a-bills", owner: "alex", name: "Bills pot", kind: "pot", order: 2, purpose: "Rent, flat bills and subscriptions"},
        {id: "a-food", owner: "alex", name: "Food pot", kind: "pot", order: 3},
        {id: "a-car", owner: "alex", name: "Car pot", kind: "pot", order: 4},
        {id: "a-rainy", owner: "alex", name: "Rainy day pot", kind: "saving", fallback: true, order: 5, purpose: "Covers going over budget"},
        {id: "a-lisa", owner: "alex", name: "Lifetime ISA", kind: "lisa", order: 8},
        {id: "a-isa", owner: "alex", name: "Cash ISA", kind: "isa", order: 9},
        {id: "s-main", owner: "sam", name: "Main account", kind: "main", order: 1},
        {id: "s-rent", owner: "sam", name: "Rent Space", kind: "pot", order: 2},
        {id: "s-bills", owner: "sam", name: "Bills Space", kind: "pot", order: 3},
        {id: "s-save", owner: "sam", name: "Savings Space", kind: "saving", fallback: true, order: 5},
        {id: "s-lisa", owner: "sam", name: "Lifetime ISA", kind: "lisa", order: 8}
      ],
      income: [
        {id: "a-pay", person: "alex", name: "Pay", amount: 2400, account: "a-main", isPay: true, unit: "month", on: "last friday", start: add(start, -40)},
        {id: "s-pay", person: "sam", name: "Pay", amount: 2150, account: "s-main", isPay: true, unit: "month", on: "28", shift: "previous working day", start: add(start, -40)}
      ],
      bills: [
        {id: "a-rent", person: "alex", name: "Rent", category: "home", amount: 1100, account: "a-bills", split: "rent", unit: "month", on: "15", shift: "next working day", start: add(start, -40)},
        {id: "a-energy", person: "alex", name: "Energy", category: "home", amount: 120, account: "a-bills", split: "bills", variable: true, unit: "month", on: "3", start: add(start, -40)},
        {id: "a-water", person: "alex", name: "Water", category: "home", amount: 38, account: "a-bills", split: "bills", unit: "month", on: "8", start: add(start, -40)},
        {id: "a-ctax", person: "alex", name: "Council tax", category: "home", amount: 164, account: "a-bills", split: "bills", unit: "month", on: "1", start: add(start, -40)},
        {id: "a-net", person: "alex", name: "Broadband", category: "home", amount: 28, account: "a-bills", split: "bills", unit: "month", on: "20", start: add(start, -40)},
        {id: "a-phone", person: "alex", name: "Phone", category: "subscription", amount: 12, account: "a-bills", unit: "month", on: "5", start: add(start, -40)},
        {id: "a-music", person: "alex", name: "Music", category: "subscription", amount: 11.99, account: "a-main", unit: "month", on: "12", start: add(start, -40)},
        {id: "a-gym", person: "alex", name: "Gym", category: "subscription", amount: 24, account: "a-main", unit: "month", on: "1", start: add(start, -40)},
        {id: "a-carins", person: "alex", name: "Car insurance", category: "car", amount: 420, account: "a-car", unit: "year", start: add(today, 54)},
        {id: "s-phone", person: "sam", name: "Phone", category: "subscription", amount: 10, account: "s-bills", unit: "month", on: "5", start: add(start, -40)},
        {id: "s-union", person: "sam", name: "Union", category: "work", amount: 16, account: "s-bills", unit: "month", on: "20", start: add(start, -40)},
        {id: "s-reg", person: "sam", name: "Registration fee", category: "work", amount: 30, account: "s-bills", unit: "month", every: 3, on: "4", start: add(start, 30)}
      ],
      budgets: [
        {id: "a-food-b", person: "alex", name: "Food", amount: 240, mode: "weekly", account: "a-food", carry: true},
        {id: "a-fuel", person: "alex", name: "Fuel", amount: 90, mode: "daily", account: "a-car", carry: true},
        {id: "a-fun", person: "alex", name: "Fun", amount: 180, mode: "daily", account: "a-main", carry: true},
        {id: "a-home", person: "alex", name: "Household", amount: 50, mode: "oneoff", account: "a-main"},
        {id: "a-carfund", person: "alex", name: "Car fund", amount: 60, mode: "saving", account: "a-car"},
        {id: "a-lisa-b", person: "alex", name: "Lifetime ISA", amount: 333, mode: "saving", account: "a-lisa"},
        {id: "a-isa-b", person: "alex", name: "Cash ISA (what's left)", mode: "remainder", account: "a-isa"},
        {id: "s-food", person: "sam", name: "Food", amount: 130, mode: "weekly", account: "s-main", carry: true},
        {id: "s-travel", person: "sam", name: "Travel", amount: 70, mode: "daily", account: "s-main", carry: true},
        {id: "s-lisa-b", person: "sam", name: "Lifetime ISA", amount: 333, mode: "saving", account: "s-lisa"},
        {id: "s-save-b", person: "sam", name: "Savings", amount: 420, mode: "saving", account: "s-save"},
        {id: "s-fun", person: "sam", name: "Fun (what's left)", mode: "remainder", account: "s-main"}
      ],
      splits: [
        {id: "bills", name: "Flat bills", shares: "alex:2, sam:1"},
        {id: "rent", name: "Rent", shares: "sam=400"},
        {id: "half", name: "Half each", shares: "alex:1, sam:1"}
      ],
      transfers: [
        {id: "s-rent-t", from: "sam", to: "alex", name: "Rent share", amount: 400, fromAccount: "s-rent", toAccount: "a-bills", unit: "month", on: "13", start: add(start, -40)},
        {id: "s-bills-t", from: "sam", to: "alex", name: "Bills share", amount: 115, fromAccount: "s-rent", toAccount: "a-bills", unit: "month", on: "1", start: add(start, -40)}
      ],
      transactions: [], moves: [], settlements: [],
      loans: [{id: "sofa", lender: "alex", borrower: "sam", name: "New sofa", amount: 600, date: add(start, 5), repay: 150, repayFrom: add(today, 20), repayDay: "28"}],
      goals: [
        {id: "g-house", owners: "alex, sam", name: "House deposit", kind: "house", target: 60000, due: add(today, 365 * 4), accounts: "a-lisa, s-lisa", price: 280000},
        {id: "g-rainy", owners: "alex", name: "Rainy day fund", kind: "emergency", target: 4500, accounts: "a-rainy"},
        {id: "g-car", owners: "alex", name: "Next car", kind: "car", target: 4000, due: add(today, 200), accounts: "a-isa"},
        {id: "g-trip", owners: "sam", name: "Summer trip", kind: "savings", target: 1200, due: add(today, 240), accounts: "s-save"}
      ],
      valuations: [
        {id: "v1", account: "a-main", date: start, amount: 420}, {id: "v2", account: "a-bills", date: start, amount: 160}, {id: "v3", account: "a-food", date: start, amount: 90},
        {id: "v4", account: "a-car", date: start, amount: 210}, {id: "v5", account: "a-rainy", date: start, amount: 1350}, {id: "v6", account: "a-lisa", date: start, amount: 11240},
        {id: "v7", account: "a-isa", date: start, amount: 1800}, {id: "v8", account: "s-main", date: start, amount: 620}, {id: "v9", account: "s-save", date: start, amount: 640},
        {id: "v10", account: "s-lisa", date: start, amount: 4120}, {id: "v11", account: "s-rent", date: start, amount: 515}
      ],
      amounts: [{id: "am1", item: "a-music", start: add(today, -30), amount: 12.99}],
      exceptions: [],
      settings: [{person: "alex", key: "start", value: start}, {person: "sam", key: "start", value: start}, {person: "sam", key: "easy", value: "true"}],
      gifts: [
        {id: "gf1", person: "alex", name: "Mum", idea: "Cookbook", occasion: "Christmas", limit: 30, bought: true, cost: 24},
        {id: "gf2", person: "alex", name: "Dad", idea: "Walking socks", occasion: "Christmas", limit: 20},
        {id: "gf3", person: "alex", name: "Sam", idea: "Concert tickets", occasion: "Birthday", date: add(today, 70), limit: 90}
      ],
      meta: []
    };
    // a few months of everyday spending
    var shops = [["a-food-b", "a-food", "Supermarket", 38, 18], ["a-food-b", "a-main", "Corner shop", 6, 4], ["a-fuel", "a-car", "Fuel", 42, 8], ["a-fun", "a-main", "Takeaway", 22, 8], ["a-fun", "a-main", "Cinema", 18, 4], ["a-home", "a-main", "Bin bags and bits", 9, 5],
      ["s-food", "s-main", "Supermarket", 24, 10], ["s-travel", "s-main", "Bus", 3.2, 0], ["s-fun", "s-main", "Coffee", 3.6, 1], ["s-fun", "s-main", "Lunch out", 11, 4], ["s-fun", "s-main", "Shopping", 34, 18], ["s-fun", "s-main", "Night out", 45, 15]];
    var n = 0;
    for (var d = add(start, 1); d <= today; d = add(d, 1)) {
      shops.forEach(function (s) {
        var chance = /Night out/.test(s[2]) ? 0.06 : /Shopping/.test(s[2]) ? 0.09 : /Lunch/.test(s[2]) ? 0.2 : /Supermarket/.test(s[2]) ? (s[0] === "a-food-b" ? 0.115 : 0.13) : /Bus/.test(s[2]) ? 0.4 : /Fuel/.test(s[2]) ? 0.07 : 0.1;
        if (rnd() < chance) { var who = s[0].charAt(0) === "a" ? "alex" : "sam"; t.transactions.push({id: "dt" + (n++), date: d, person: who, amount: Math.round((s[3] + (rnd() - 0.5) * 2 * s[4]) * 100) / 100, budget: s[0], account: s[1], note: s[2], split: /Takeaway/.test(s[2]) && rnd() < 0.5 ? "half" : ""}); }
      });
    }
    // payday moves already done, so pots look tidy
    var pers = B.periods(B.load(t), "alex", add(start, 1), add(today, 1));
    pers.forEach(function (p) { if (p.pay && p.start <= add(today, -3)) { var db = B.load(t); B.payday(db, "alex", p).moves.forEach(function (m, i) { t.moves.push({id: "dm" + p.start + i, date: p.start, person: "alex", from: m.from, to: m.to, amount: m.amount, key: "pay:" + p.start + ":" + m.to}); }); } });
    var spers = B.periods(B.load(t), "sam", add(start, 1), add(today, 1));
    spers.forEach(function (p) { if (p.pay && p.start <= add(today, -3)) { var db = B.load(t); B.payday(db, "sam", p).moves.forEach(function (m, i) { t.moves.push({id: "sm" + p.start + i, date: p.start, person: "sam", from: m.from, to: m.to, amount: m.amount, key: "pay:" + p.start + ":" + m.to}); }); } });
    return t;
  }
  root.BudgieDemo = {make: make};
})(typeof window !== "undefined" ? window : this);
