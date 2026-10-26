// A small made-up household for tests (two people, ethan and sophie). Every name and amount is invented.
module.exports = function () {
  return {
    people: [
      {id: "ethan", name: "Ethan", bank: "Monzo", potWord: "pot", partner: "sophie"},
      {id: "sophie", name: "Sophie", bank: "Starling", potWord: "Space", partner: "ethan"}
    ],
    accounts: [
      {id: "e-main", owner: "ethan", name: "Main account", kind: "main", order: 1},
      {id: "e-bills", owner: "ethan", name: "Bills & Rent pot", kind: "pot", order: 2},
      {id: "e-food", owner: "ethan", name: "Food pot", kind: "pot", order: 3},
      {id: "e-car", owner: "ethan", name: "Car pot", kind: "pot", order: 4},
      {id: "e-emergency", owner: "ethan", name: "Emergency pot", kind: "saving", fallback: "TRUE", order: 5},
      {id: "e-lisa", owner: "ethan", name: "Lifetime ISA", kind: "lisa", order: 8},
      {id: "e-isa", owner: "ethan", name: "Cash ISA", kind: "isa", order: 9},
      {id: "s-main", owner: "sophie", name: "Main account", kind: "main", order: 1},
      {id: "s-rent", owner: "sophie", name: "Rent & bills Space", kind: "pot", order: 2},
      {id: "s-savings", owner: "sophie", name: "Savings Space", kind: "saving", fallback: true, order: 5}
    ],
    income: [
      {id: "e-pay", person: "ethan", name: "Pay", amount: 2400, account: "e-main", isPay: true, unit: "month", on: "last thursday", start: "2026-10-01"},
      {id: "s-pay", person: "sophie", name: "Pay", amount: 2100, account: "s-main", isPay: true, unit: "month", on: "28", shift: "previous working day", start: "2026-11-01"},
      {id: "s-side", person: "sophie", name: "Side income", amount: 200, account: "s-main", unit: "month", on: "last working day", start: "2026-10-01", end: "2026-12-31"}
    ],
    bills: [
      {id: "e-rent", person: "ethan", name: "Rent", amount: 1200, account: "e-bills", unit: "month", on: "15", shift: "next working day", start: "2026-11-01", split: "rent"},
      {id: "e-flat", person: "ethan", name: "Household bills", amount: 420, account: "e-bills", unit: "month", on: "1", start: "2026-11-01", split: "bills", variable: true},
      {id: "e-phone", person: "ethan", name: "Phone", amount: 20, account: "e-bills", unit: "month", on: "5", start: "2026-11-01"},
      {id: "s-gym", person: "sophie", name: "Gym", amount: 40, account: "s-main", unit: "week", every: 4, start: "2026-11-18"},
      {id: "s-member", person: "sophie", name: "Membership", amount: 25, account: "s-main", unit: "dates", dates: "2027-01-11, 2027-04-12, 2027-07-12"}
    ],
    budgets: [
      {id: "e-food-b", person: "ethan", name: "Food", amount: 200, mode: "weekly", account: "e-food", carry: true},
      {id: "e-fuel", person: "ethan", name: "Fuel", amount: 80, mode: "daily", account: "e-car", carry: true},
      {id: "e-fun", person: "ethan", name: "Fun", amount: 150, mode: "daily", account: "e-main", carry: true},
      {id: "e-lisa-b", person: "ethan", name: "Lifetime ISA", amount: 300, mode: "saving", account: "e-lisa"},
      {id: "e-isa-b", person: "ethan", name: "Cash ISA", mode: "remainder", account: "e-isa"},
      {id: "s-food", person: "sophie", name: "Food", amount: 150, mode: "weekly", account: "s-main", carry: true},
      {id: "s-fun", person: "sophie", name: "Fun", mode: "remainder", account: "s-main"}
    ],
    splits: [
      {id: "bills", name: "Household bills", shares: "ethan:2, sophie:1"},
      {id: "rent", name: "Rent", shares: "sophie=500"},
      {id: "half", name: "Half each", shares: "ethan:1, sophie:1"}
    ],
    transfers: [
      {id: "s-to-e-rent", from: "sophie", to: "ethan", name: "Rent share", amount: 500, fromAccount: "s-rent", toAccount: "e-bills", unit: "month", on: "13", start: "2026-11-01"},
      {id: "s-to-e-bills", from: "sophie", to: "ethan", name: "Bills share", amount: 140, fromAccount: "s-rent", toAccount: "e-bills", unit: "month", on: "1", start: "2026-11-01"}
    ],
    transactions: [],
    moves: [],
    settlements: [],
    loans: [
      {id: "sofa", lender: "ethan", borrower: "sophie", name: "Sofa", amount: 600, date: "2026-10-25", repay: 200, repayFrom: "2026-12-28", repayDay: "28"}
    ],
    goals: [{id: "house", owners: "ethan, sophie", name: "House deposit", target: 60000, due: "2031-10-01", accounts: "e-lisa", kind: "house"}],
    valuations: [
      {id: "v1", account: "e-main", date: "2026-10-26", amount: 250},
      {id: "v2", account: "e-bills", date: "2026-10-26", amount: 100},
      {id: "v3", account: "e-food", date: "2026-10-26", amount: 40},
      {id: "v4", account: "e-car", date: "2026-10-26", amount: 4},
      {id: "v5", account: "e-emergency", date: "2026-10-26", amount: 400},
      {id: "v6", account: "e-lisa", date: "2026-10-26", amount: 10000},
      {id: "v7", account: "s-main", date: "2026-10-26", amount: 50}
    ],
    amounts: [],
    exceptions: [{id: "x1", item: "e-pay", date: "2026-12-31", action: "move", newDate: "2026-12-24"}],
    settings: [{person: "ethan", key: "start", value: "2026-10-26"}, {person: "sophie", key: "start", value: "2026-10-26"}],
    meta: []
  };
};
