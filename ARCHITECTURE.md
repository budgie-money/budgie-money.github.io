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
| `bills` | money that goes out on a schedule | id, person (who pays), name, category, amount, account, split, variable, pool, *schedule* |
| `budgets` | a spending or saving line per pay period | id, person, name, amount, mode (daily, weekly, oneoff, saving, remainder), account, to, carry |
| `splits` | how two people share something | id, name, shares ("ethan:2, sophie:1" or "sophie=400") |
| `transfers` | one person paying the other on a schedule | id, from, to, amount, fromAccount, toAccount, purpose, *schedule* |
| `transactions` | a payment you logged | id, date, person, amount, budget, account, split, note, source |
| `moves` | a pot move you ticked off | id, date, person, from, to, amount, key |
| `settlements` | a one-off payment between you two | id, date, from, to, amount, fromAccount, toAccount, loan, note |
| `loans` | money one of you owes the other | id, lender, borrower, name, amount, date, account, repay, repayDay |
| `goals` | something you're saving for | id, owners, name, target, due, accounts, kind, extra |
| `valuations` | a balance you checked | id, account, date, amount |
| `amounts` | a price or pay change from a date, or a split's new shares | id, item, start, amount, shares |
| `exceptions` | a change to one occurrence | id, item, date, action (skip, move, amount, paid), newDate, amount |
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
  from the fallback pot, topping up a pot (or the main account itself) before a bill. A move is only suggested if the
  money is really there.
  A pot move already made in the bank is done: the bank feed saves it as a loose move (key `bank:…`), and if it is the
  same two accounts, the same amount to the penny, in the same pay period as an item, To do doesn't ask for it (each bank
  move is for one item only). If it was also ticked in the app afterwards, the tick is the move and the loose bank row is
  set aside as the same money, so the balance counts it once.
- **Between you two**: shared bills and split payments by their split rule (for example 2 parts to 1), minus what
  has been paid, so you always know who owes whom and by how much. Loans between you are kept separate. A split that
  changes from a date is a dated row in `amounts` (item: the split, shares), so earlier months keep theirs.
- **Pooled bills** (a bill with a `pool` date, like the flat bills): the amount is an estimate, and the real bills
  (council tax, energy, water) are payments logged against it (their budget is the bill's id). Each bills month runs
  from the pool date's day (16th to 15th) and holds exactly one estimate: the one scheduled in it, whatever day a weekend
  moves it to, at its planned amount (a change you make to one month's estimate counts; the bank feed's own amount
  for a date doesn't, as the payments are the real money). The plan and payday count the estimate on its date, as for
  any bill; balances count the real payments, plus whatever of the estimate isn't paid yet until the month is over, so
  the two are never both counted. The day after a bills month ends it's settled up: your partner's share of what it
  really came to, less their share of the estimate, goes into Between you two (money back, or theirs of going over).
  What's left stays in the pot, and the next payday counts it as already there, so less goes in and more to whatever
  is left (your savings); going over is caught up the same way. A month with real bills and no estimate settles
  against nothing.
  - The sheet records how each month settled (settings `pool:<bill>:<start>`, with its payments), once, every hour with
    the budget tabs: two days after the month, or later while a payment from the pot in it is still to be checked or
    the bank hasn't been read since the day after it (up to 10 days). Phones can't write these; your partner sees them
    only for a bill they can see. From then on the record is used, so a change never settles that month again.
  - A real bill counted in (or taken off, or changed) for a recorded month goes into the first month not recorded yet,
    shown there as late from its own month, and is shared at that month's settling up.
  - The `pool` column lists when pooling started and any change since ("2026-10-16, 2027-01-01" for a new day from
    January, "2026-10-16, off 2027-01-16" to stop then). The app turns it on from the bills month going now, and adds a
    change only from the next bills month that hasn't started, so no month that's going, or waiting to be recorded,
    changes.
- **Payments out** (Money tab): every bill, regular payment to your partner, loan repayment and payment made in a pay period
  as one list (`outgoings`), each Paid (you ticked it, or the bank saw it go out: the bank feed writes a `paid` exception
  for a planned bill or pay it matched), Due, Late (Not seen when there's a bank feed) or Skipped. A pooled bill's estimate
  is one row with its real bills inside it. Sort by date, amount or pot; tapping a row opens the usual sheet to change it.
  While a bank feed hasn't seen the pay on payday (or a late pay), it's counted as on its way, so no top-up is asked for.
- **Goals, LISA, house, net worth, insights, calendar.**

## Privacy between partners

The Apps Script only sends your partner's **summary** (worked out on the server by the same engine), filtered by
what they chose to share. Their individual payments (and their pay, bills, budgets and balances) are only sent if they
turn "Each payment" on. Things you share (split payments, shared bills, loans, joint goals) you both see. A regular
payment between you is the payer's to change. A payment you log, or a pot move you tick, only ever uses your own accounts; a bill, pay or budget uses its person's, a
payment between you goes from the payer's account to the other's, a loan is paid from the lender's, and only the person whose
account money comes out of can say which one it was.

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

## Everyday experience and reconciliation (1.5)

- `experience.js` installs the everyday screens through explicit helpers from `app.js`. It shares the existing forms, navigation, queue and engine; there is no second data store.
- The headline daily allowance rebases at a money event (payment, relevant move or changed balance), not just at midnight. Cash limits exclude future income, and unobserved overdue bank-fed bills stay reserved. Each budget still shows what remains. Both phones use the same engine for the number.
- Temporary write rejections remain queued until acknowledged. IndexedDB failures fall back to versioned local storage; a newer fallback wins over an older database copy after a restart. If neither can save, the app tells the user to keep it open and sync. The sync screen can export an unsent-changes recovery copy without credentials.
- Bank-generated occurrence exceptions carry their source `bankId`. Reversals unwind that source's generated effects, including linked manual payments and grouped moves, and a different active match takes precedence. Old unambiguous matches can be unwound without a reference. Explicit user dismissals stay dismissed; bank-reversed rows can return if the bank reinstates them.
- A bill may have `creditAccount` as well as its paying `account`. Its cash outflow also reduces the credit liability. Spending on that credit account does not ask for another payoff when its statement is already funded; otherwise it reserves the budget's share in the repayment pot. Mapping a credit account remains a user choice. This does not enable a Flex API feed.
- Transactions can have `refundOf`, `loanItem`, `purchaseTotal`, `iouShare`, `planId`, `billId` and `billDate`. A bill receipt creates source-linked paid, amount and date exceptions; it debits the actual paying account once and can request reimbursement from the planned bill pot. Unlinking or reversing the receipt clears only its own generated effects. A linked refund keeps its real cash date while reversing its purchase's budget allocation and the appropriate fraction of a linked IOU. A payment plan stores the remaining explicit dates as a normal bill. Creating a shared item removes a direct split so the same obligation is not counted twice. The original item share remains editable; the credit is derived.
- Each sync sends the visible IOU items with a server-derived `refundCredit`, including on incremental syncs. This lets both phones agree even when purchases and refunds are private. Clients cannot write this derived field. Overpayments become an amount to return, with the reverse cash flow, a To do and protection against two people confirming the same return.
- Per-person `spare.rules` contains version, effective date, `replaceFrom`, Main buffer, emergency account and target, final savings account, timing and source toggles. Bills (including daily challenges), budgets, sinking funds, money owed and unconfirmed receipts are protected before a suggestion. Future income is not available cash. Essential funding actions take precedence. The old savings remainder is replaced from the next pay period; old rows remain for history. Existing goal routing is superseded for new receipts from the effective date. These rules only suggest bank moves. The server checks each saved sweep against the current suggestion, so another phone cannot confirm the same cash twice.
- The Money timeline includes income, payments, bills, transfers in both directions and IOU receipts/due repayments. Paid facts appear above Today, outstanding items below it. Filters do not change the underlying data. The separate budget view explains and edits allocations rather than presenting every tool as an equal daily task.

## Later

- Google Calendar: a shared "Budgie" calendar with paydays, bills and who-pays-whom, kept up to date by Apps Script.
- More themes, receipt photos, mortgage tracking once there is a mortgage.

## Category budget and daily saving (1.5.1)

- `clarity.js` installs the category budget, activity, actual pot balances, category-aware daily guide, credit-balance input and compact saving settings. It reuses existing records and forms. Activity and scheduled items are separate; recorded incoming money opens a receipt before any rule editor. More retains the original icon tiles. The tour is optional.
- Feasible pot actions respect both actual source cash and the engine's reserved funding. Partial reimbursement saves only the amount moved. Each confirmation has a `moves.batch`, so multiple partial moves on the same day reconcile individually against the bank without duplicating cash.
- `transactions.creditAccount` classifies credit funding separately from immutable bank fields. The engine retains `observedAccount` and uses the owned credit account for balances and budget reimbursements. The UI accepts a positive amount owed and stores a negative credit valuation.
- A saving-transfer bill can have an owned `toAccount`, daily frequency and `dailyIncrease`. Its first amount grows by the daily increment from `start`; dated amount changes begin a new base. Saving transfers debit and credit the two owned accounts. Actual moves match scheduled transfers one for one, and matched schedules do not generate another cash flow. The bank feed excludes these transfers from external bill matching.
- Private live-data cleanup remains in the app UI. Neither live amounts nor browser state belong in this repository.
- Partner summaries include each category's actual `left` value (1.5.2). The category table also derives it from amount and spending for older cached summaries.

- Credit repayment flows are forecasts while future-dated. On or before today, a paid/matched occurrence is required before the liability is reduced (1.5.3); an elapsed due date alone does not clear the debt.

## Polish and cash clarity (1.5.4)

- Overspending does not by itself ask for emergency cash in Main. The cash-shortfall check still funds an actual deficit. Next payday restores only observed or confirmed fallback moves; an unperformed reimbursement never creates a top-up.
- Partner category remainders are explicitly allowances. A separate dated Main balance is included only with the existing full payment/balance-sharing permission. Planned bill and saving totals use the existing totals permission. Shared pooled bills display the partner's share of the estimate.
- Saving and payment actions have shared spacing rules. Budget figures align on the first numeric line; over captions have a reserved line. The daily guide uses each theme's hero text colour. The tour targets actual cards and keeps its history transition together.
- Saving a row acknowledges the data before rebuilding formatted budget sheets. One coalesced time trigger refreshes those views in the background; the hourly refresh remains the fallback. Read snapshots and write validation still use the script lock, and both bank feeds keep their existing read-only polling schedule.
- Theme tests cover foreground/hero/action/status contrast for all 20 light, dark and special looks. Browser polish checks cover four phone/tablet widths, larger text, the tour and separate payment actions. Private live data never goes into fixtures or the source repository.
