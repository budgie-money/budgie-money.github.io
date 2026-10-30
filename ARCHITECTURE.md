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

## Daily guide card (UI 1.5.5)

The guide uses compact category tiles with icons, daily contributions, remaining/over/used states and a remaining-budget meter. A payday countdown and a contextual line connect the headline to its contributing categories. The breakdown retains negative category remainders as overspending. The headline calculation and bank/backend code remain engine 1.5.4; this is a client-only release. Theme contrast checks include the inset tile surface, and browser checks cover exhausted, over-budget and cash-capped cases.


## Accuracy and maintenance (1.5.6)

- `trust.js` installs after `clarity.js`. Its secondary screens expose Budget health, receipt lookup, saved subscription decisions, dated goals and lower-pay configuration. It does not move money. `share.balance` and `share.bills` default to false and add sanitized partner-summary fields only; raw-row permissions are unchanged and revocation forces a full snapshot.
- `saving.flexHistory` is a JSON array of `{from, on}` events. The engine evaluates it at each period start. New saving contributions reduce before emergency cover; observed allocations and daily challenge transfers are protected. Turning adaptation off later retains earlier events. `saving.flexFrom` is a compatibility fallback.
- `recordedSaving` measures net confirmed movements across the savings boundary (including configured/goal pots and daily saving). It excludes transfers between savings accounts and provider bonuses/fees. Unperformed allocations remain a plan, rather than reported saving. Saving-rate denominators remain planned income, so they are a period comparison rather than an audited earnings statement.
- `goalForecast` is a dated scenario for up to two years, separate from actual balances. It reserves full-period bills/spending, recognizes existing earmarked bill money once, includes funded contributions and the configured surplus destination, delays repayment-funded saving, and fills the Main buffer/emergency target once. It excludes interest, possible asset sales, unrecorded family loans and future underspends. Future estimates cannot guarantee bank timing, market values or provider data completeness. Actual saving remains separate. The dated scenario includes the unperformed part of a funded current-payday goal allocation once; recording it moves that part into the actual balance without changing the projected total.
- The same account can contribute to more than one goal; goal amounts must not be added together as independent assets. Net worth counts each account once.
- `bank.receipts` is an on-demand read-only 35-day lookup, authenticated as the caller. Results contain merchant/date/amount, mapped account and reconciliation labels. It exposes no token, external bank ID or partner-only ledger. It does not write or match receipts, and an empty result is not proof that a payment did not happen.
- Backups capture all tab values under the script lock, then release it before Drive work. Successful copies record `BACKUP_LAST_OK`. Bank status exposes only backup/scheduler booleans and this timestamp, never folder IDs. Existing private-folder checks and recoverable retention remain. A configured trigger is not proof a backup succeeded; check the success timestamp.
- No AI service runs any of this. Google services, bank reapproval, API changes, extraordinary holidays and private backup/recovery still need occasional human attention. Keep deployment access and a private data backup; retain the source and tests. Do not describe this as maintenance-free or certified by passing tests.

Validation: `node test/accuracy.test.js` adds independent penny-ledger and dated-scenario checks; `node test/trust-ui.test.js` checks persistent choices and privacy defaults through the fake backend. Existing engine/backend/bank/extras/experience, scale, theme and browser suites remain required for releases. Restart the fake server between mutating browser suites.


## Receipt recovery (1.5.7)

The live audit found a bank receipt with no visible receipt/bill match. Receipt lookup now also distinguishes a removed receipt from a bank-linked move. Settings / Budget health / Removed payments lets the owner recover an accidentally removed row through the ordinary row-permission path, preserving immutable bank facts and sending it for checking. Lookup never restores anything automatically; intentional deletions stay deleted. A recovered receipt can be matched to the dated bill with the existing one-payment/one-occurrence workflow.

## Payday funding and transfer returns (1.5.8–1.5.9)

Payday exposes each allocation’s positive commitments, expected contributions and existing earmarked money before confirmation. It shows the current Main balance less remaining transfers separately from category spending allowances. Bank-imported full exact returns on the allocation’s date reopen completion without deleting either ledger movement; a subsequent matching re-funding completes it again. Matching is person scoped and ignores normal reimbursement keys. Partial, differently dated or ambiguous returns still need review; this is not a claim that every transfer can be inferred automatically.

The daily guide protects pending non-spending allocations and Main payments while recognizing spending money still held in Main. Funding the corresponding pots does not create or remove affordability. Old reimbursements remain reserved across payday even when the purchase was made on the opening snapshot date. A bank snapshot on the payday itself is not proof an unrecorded saving allocation happened; later explicit manual balance checks retain their existing meaning.

Saving rules expose their effective payday. Backup status distinguishes an unloaded status from an unconfigured service, and exposes a generic failure plus last attempt/success timestamps without folder IDs or email details. A successful recovery clears the failure. Early matched payments display the receipt date in the sorted list. Goal editing shows actual saved balances by linked account rather than presenting unperformed plan allocations as money received.

## Planning workflows (1.6.0)

`planning.js` installs after Trust. It provides the complete Payday, purchase preview, monthly reconciliation and private car-scenario screens. The financial functions live in `engine.js` and run identically on the client and in Apps Script. No schema columns or bank permissions were added.

`payday.netFrom.history` and `lisa.guardFrom.history` are effective-dated `{from,on}` events; legacy single-date keys remain compatible. Enable these through Saving rules / Payday protection. Older periods keep their prior rule. The income-adaptation history remains independent.

A combined transfer is **one actual moves row**, carrying a `net:` JSON key with version, period, target account, previous allocation offset and signed allocation parts. `netParts` validates account ownership, key shape, integer pennies and exact signed conservation against the actual transfer. Loading derives completion evidence in `moveKeysBy` and `moveTicks`; it does not create fictional cash flows. Two £60 transfers can fulfil a £200 allocation less an £80 reimbursement. Each partial has a distinct offset. A zero-net allocation has a zero-cash record. One manual net row matches one bank receipt; full exact same-day returns reopen completion and have distinct re-funding evidence. Original gross funding plus a separate reimbursement is also recognised. Partial or ambiguous returns still require review.

The 1.6.1 live check exposed an older pot/carry mismatch. Spending pots now also have a minimum cash target: remaining category allowances plus upcoming net commitments and the plan's protected reserves. Any funding gap is an explicit positive `fill:budget:<period>:<account>` allocation part. It can share the same real net bank transfer with an allocation and reimbursement, including a reverse-direction or partial transfer. This also covers a pot with no original payday allocation that later becomes underfunded. Saving stays blocked until funding is resolved; a checkpoint never invents a balancing entry or silently cuts the category allowance. Additional Main funding needs are shown before final saving.

## Comprehensive review (1.6.2)

- A newer bank valuation does not prove an outstanding payday transfer happened. Future plans still simulate the unperformed allocation unless a matching movement is recorded. The day before payday remains an upcoming period, so the current allowance is not released as hypothetical underspending.
- The Main buffer protects both the daily guide and purchase checks, including opening periods with no salary rule. Car scenarios use only the owner's accessible linked balances and contributions; LISA, pension, credit and partner-owned assets are excluded and the excluded amount is shown. General house/goal forecasts retain their full goal balances.
- Monthly checkpoints flag a closing valuation that stops before the review-through date. Their fingerprint includes the underlying period receipts, moves and settlements, so cancelling net-zero edits still require another review. No balancing rows are invented.
- Planning form labels explicitly name their controls. Editing purchase/scenario inputs hides the old result and retains the current draft through a render; the user must recalculate. Shared goal account rows name their owner. Dialogs keep Tab/Shift+Tab inside, close with Escape and return focus to the trigger when it still exists.
- A payment due today remains reserved but does not become a missing-receipt health warning until its date has passed. This avoids overnight false alarms for a daily challenge that may post later in the day.
- `node test/review.test.js` adds independent penny expectations and date/valuation invariance cases alongside the existing suites. Private live facts remain outside the repository.

The LISA guard aggregates confirmed contributions across that person's LISAs, excludes bonuses, fees and transfers between LISAs, and never restores contribution room for a withdrawal. It reserves earlier planned and known future direct contributions before capping a new saving line. Recorded allocations stay intact, including an actual overpayment. A provider statement representing multiple partial transfers is reconciled once. The guard's accuracy depends on complete provider history and the paid-before-tracking figure; it does not connect Moneybox or change provider instructions.

`purchaseCheck` distinguishes an existing spending allowance from taking money directly from a goal. An in-budget purchase does not reduce a forecast that already reserves the full budget again. Cash belonging to another category is protected. A purchase over allowance shows the conditional impact of funding the excess from the chosen goal. Goal cash excludes LISA, pension and credit balances.

`goalScenario` adds dated hypothetical purchase, deposit, finance, additional running costs, extra future-payday saving, sale and family-loan events to the existing forecast. It shows upfront and intermediate cash gaps, remaining finance and family debt. Effective-APR annuity payments are illustrations, not lender quotes. `scenario.car` stores a private draft, not transactions, loans or a changed target.

`reconcile` compares earlier opening and closing valuations with **confirmed** recorded cash movements, not unreceived planned salary or unpaid bills. Investment and credit balances require provider confirmation rather than a false cash-ledger comparison. It retains discrepancies, missing anchors and unreviewed payments. A private `reconcile.<period>` setting stores a fingerprint, through-date, unresolved count and optional note. Later data invalidates the checkpoint. Saving a review with open items does not mark it reconciled or write a balancing entry.

Additional checks: `node test/planning.test.js` and, on a fresh fake server, `node test/planning-ui.test.js`. All data is invented. Bank tests include net transfers, returns, re-funding, loose-move reconciliation, manual partial deduplication, old gross-transfer compatibility and private scenario/review settings.
