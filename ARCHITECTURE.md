# Budgie: how it fits together

One app, two people, one Google Sheet. Phones never talk to a bank. If you connect Monzo or Starling, the sheet's script reads them (read-only) and
adds what it finds. Everything else is worked out from **rules you set once** (pay, bills, budgets, splits) plus **what actually happened** (payments you log,
pot moves you tick off, balances you check now and then).

```
Phone app (PWA, works offline)            Google Sheet "Budgie data"            Your budget tabs
  engine.js  <-- sync (changes only) -->    one tab per table                     "Ethan budget", "Sophie budget"
  screens                                   Apps Script web app (Code.gs)  ---->   written by the same engine.js
  offline queue                             + engine.js (same file)               on a timer and after each change
```

The same `engine.js` runs in the app and in Apps Script, so the phone and the sheet can never disagree.

## Principles

1. **Rules, not diaries.** Nothing is typed out month by month. A bill is "£15, every month on the 5th, from the
   Bills pot". The engine works out every date, forever, including weekends and UK bank holidays.
2. **History is never rewritten.** Changing a price, a pay rise or a budget adds a dated row to `amounts`
   ("from 1 Dec it's £18"). Old months keep their old numbers.
3. **Exceptions, not edits.** "This one didn't happen", "it was £204 this time", "it moved to the 3rd" are rows in
   `exceptions`, tied to one occurrence. Actual pay on payday is the same thing.
4. **Every row has an id, and nothing is hard-deleted.** Rows get `deleted = TRUE`. Ids are made on the phone,
   so a payment logged offline and sent twice is still only saved once.
5. **Only predict what's certain.** Paydays, bills, transfers and loan repayments are predicted. Spending is
   only ever what you logged.
6. **One fallback pot.** Anything that can't come from where it should (over budget, an empty pot) comes from
   the fallback pot (Ethan: Emergency pot, Sophie: Savings Space) and the next pay tops it back up automatically.

## Tables (one tab each in "Budgie data")

Row 1 is the header. Every table also has `deleted`, `updated` (time) and `by` (who changed it).
People are `ethan` and `sophie`. Money is in pounds. Dates are real dates.

| Table | One row is | Key columns |
|---|---|---|
| `people` | a person | id, name, bank, potWord, partner |
| `accounts` | a bank account, pot, Space, ISA, LISA, card | id, owner, name, kind (main, pot, saving, isa, lisa, pension, credit), purpose, fallback, order |
| `income` | money that comes in on a schedule | id, person, name, amount, account, isPay, *schedule* |
| `bills` | money that goes out on a schedule | id, person (who pays), name, category, amount, account, split, variable, *schedule* |
| `budgets` | a spending or saving line per pay period | id, person, name, amount, mode (daily, weekly, oneoff, saving, remainder), account, to, carry |
| `splits` | how two people share something | id, name, shares ("ethan:2, sophie:1" or "sophie=400") |
| `transfers` | one person paying the other on a schedule | id, from, to, amount, fromAccount, toAccount, purpose, *schedule* |
| `transactions` | a payment you logged | id, date, person, amount, budget, account, split, note, source |
| `moves` | a pot move you ticked off | id, date, person, from, to, amount, key |
| `settlements` | a one-off payment between you two | id, date, from, to, amount, fromAccount, toAccount, loan, note |
| `loans` | money one of you owes the other | id, lender, borrower, name, amount, date, account, repay, repayDay |
| `goals` | something you're saving for | id, owners, name, target, due, accounts, kind, extra |
| `valuations` | a balance you checked | id, account, date, amount |
| `amounts` | a price or pay change from a date | id, item, start, amount |
| `exceptions` | a change to one occurrence | id, item, date, action (skip, move, amount), newDate, amount |
| `settings` | a setting | id, person, key, value |
| `meta` | schema version and other housekeeping | key, value |

*Schedule* columns (income, bills, transfers): `unit` (month, week, year, once, dates), `every` (1, 2, 4…),
`on` (15, last, last working day, last friday, 1st monday…), `shift` (next working day, previous working day),
`start`, `end`, `dates` (a list, for things like a membership renewed on 10 Feb, 10 May and 10 Aug).

## What the engine works out

- **Pay periods** from each person's paydays (`income.isPay`), so a pay date that moves for a weekend moves the period.
- **The plan for each pay period**: money in, bills, budgets, savings, fallback top-up, and whatever is left going
  to the remainder (Ethan: Cash ISA; Sophie: fun).
- **Spending so far** against each budget. Split payments count your share; the other share is owed to you.
  Weekly budgets (food) are paced week by week, so a big shop on payday isn't "over". Budgets marked carry keep
  what's unspent, up to one month's worth.
- **What should be in each account or pot today**, from the last checked balance plus everything since.
- **To do**: payday moves, moving money back when something was paid from the wrong pot, covering an overspend
  from the fallback pot, topping up a pot before a bill. A move is only suggested if the money is really there.
- **Between you two**: shared bills and split payments by their split rule (for example 2 parts to 1), minus what
  has been paid, so you always know who owes whom and by how much. Loans between you are kept separate.
- **Goals, LISA, house, net worth, insights, calendar.**

## Privacy between partners

The Apps Script only sends your partner's **summary** (worked out on the server by the same engine), filtered by
what they chose to share. Their individual payments are only sent if they turn "Each payment" on. Things you
share (split payments, shared bills, loans, joint goals) you both see.

## Sync

Each person has their own key (stored in Apps Script properties, never in the sheet). The app keeps a full copy
on the phone, sends changes in batches (queued when offline) and asks only for rows changed since its last sync.

## Linked apps

Peckish and Caledonite never get a person's Budgie key. Each person makes a separate, limited link for each app
(Settings, Linked apps); making a new link switches the old one off, and a new Budgie key for a person unlinks all
of that person's apps.

- **Peckish** sees names, its person's own budgets and accounts (cut down), the splits, and food shops. Because
  Peckish's shop list is shared by both of you, a payment only goes there if your partner could see it in Budgie
  anyway: split ones, ones Peckish logged, or all of them if you share each payment. It always gets the whole small
  picture, never "what changed", so it never hears about rows it can't see. It can only add or change its own food
  shops (ids `t-pk-…`): into its person's own food budget, from their own account or none, split half each or not
  at all, between £0 and £2,000, with no review flags or bank link.
- **Caledonite** can't sync at all. It only asks for its person's own paydays, bills and what's left for fun, which
  it shows on that person's phone only.
- Keys are looked up through one cached list of key hashes, so made-up keys cost nothing.

## Later

- Google Calendar: a shared "Budgie" calendar with paydays, bills and who-pays-whom, kept up to date by Apps Script.
- More themes, receipt photos, mortgage tracking once there is a mortgage.
