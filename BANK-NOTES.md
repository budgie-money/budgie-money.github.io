# Bank feeds: setup and things to check

Budgie reads Monzo (Ethan) and Starling (Sophie) **read-only** and writes what it finds into the normal tabs.
The code is `apps-script/BankFeeds.gs`. Its tests are `test/bank.test.js`, which use fake banks built from the documented API shapes.

## Deploying (once)
1. Run `node migrate/build.js`. Paste `apps-script/Budgie.gs` into Apps Script, or paste the separate files, including `BankFeeds.gs`.
2. **Deploy > Manage deployments > Edit > New version.** `doGet` changed, so this step is needed.
3. Run `installBankTrigger` once. Allow the new permissions Google asks for: connecting to external services, and sending email as you (for the notices below).
   - It reads the banks every 15 minutes.
   - `installTriggers` and the price trigger leave it alone.
4. **Where the secrets live.** Bank tokens, the Monzo client secret and sign-in states are kept in the **owner's User Properties**, not the script's properties, so they never show in Project Settings.
   - This only hides them from view. Anyone who can edit the sheet can edit its script, and code they add runs as the owner. So **share the sheet with nobody**; each of you uses Budgie through your own key.
   - Anything an older version kept in Script Properties moves over the first time the bank feed runs.
   - Budgie keys stay in Script Properties.
5. **Notices.** Whenever bank details are added, changed or removed, the sheet's owner gets a short email (nothing secret in it). At most 5 for each of you in 6 hours, so repeated changes can't use up the 100 emails a day the Sunday emails need too; the fifth says so. If it wasn't you, run `newKey("<person>")` and reconnect.

## Who can see what
- **Budgie itself can't move money.** Every bank request goes through one helper that only allows reading (GET) from Monzo and Starling, plus Monzo's sign-in and log-out. It never follows redirects.
- **Monzo's key isn't read-only at Monzo.** Monzo's developer API has no read-only option. Anyone who stole Ethan's Monzo key could move money between his current account and his pots (not to anyone else), add webhooks or annotate payments. Turn on Monzo's added security for savings pots so they can't be emptied through the API.
- **Starling's token is read-only at Starling.** Budgie refuses any token with more than the read boxes, and checks again every day.
- **The sheet's owner (Ethan) can see everything in the sheet**, including Sophie's payments and her Starling token, whatever she shares in the app. Sharing settings keep things private between your phones, not from the owner.
- **Nobody else can**: not someone who finds the web app's address, not your partner's Budgie key, not Peckish or Caledonite. Bank actions are always about the caller's own bank.
  - **An id names one thing, whatever the tab.** A new row in any tab can't take an id another tab already uses, so neither of you can make a split, goal, transfer or loan called after the other's account (which would make the bank feed skip their payments) or an income called after the other's bill (which would make the bank's amount for it yours to see). An id typed into two tabs in the sheet belongs to nobody. And the shapes a setting's id and a one-date change's id take (`ethan:…`, `x-<item>-<date>-…`) can only be used in those tabs, so neither of you can take one of the other's ahead of time and stop them mapping a pot, turning on sharing or skipping a bill on a date.
  - **One bank login is one person's.** A Monzo account or Starling account holder that's connected for one of you can't be connected for the other too (their payments would come in as the other's). The owner gets a notice if someone tries.
  - **Reading your bank only ever looks at your own rows.** Nothing your partner logs (in Budgie or Peckish) is matched, linked or changed by it, so nothing they write can tell them anything about your payments. If you both log the same shared shop, the one that isn't the payer's can simply be removed.
- **The sign-in page** (the web app's address with `?code=…&state=…`) can be opened by anyone. A state Budgie isn't waiting for is turned away using the script's cache alone, so a flood of made-up ones can't use up the owner's 50,000 property reads a day, which every Budgie request needs. If the cache has lost a real one (rare), the page says the sign-in expired: start again from the Bank screen.
- **Check now** works at most every 30 seconds each, because every read uses the owner's daily allowance of Google requests, which both of you share.
- **When you stop using it**: disconnect in Budgie, then delete the OAuth client in the Monzo developer portal and revoke the Starling token in Starling's portal.

## Ethan: Monzo
1. Open https://developers.monzo.com and sign in with the email on your Monzo account. Approve the sign-in in the Monzo app.
2. Go to **Clients > New OAuth Client** and fill it in:
   - **Name:** Budgie
   - **Redirect URLs:** the sheet's web app address, ending in `/exec`. It's the same address as the Script Property `WEB_APP_URL` and the connect links, e.g. `https://script.google.com/macros/s/…/exec`. It must match exactly.
   - **Confidentiality:** **Confidential.** Only confidential clients get refresh tokens.
3. Save. Copy the **Client ID** (`oauth2client_…`) and **Client secret** into Budgie's Bank screen. The secret is kept only in the owner's User Properties.
   - The details can't be changed while Monzo is connected. Disconnect first.
4. Tap **Connect**. Sign in with the email link Monzo sends.
5. **Approve Budgie in the Monzo app straight away.**
   - Monzo only gives the full history in the first few minutes.
   - Budgie tries every minute for 20 minutes.
6. Map each pot to a Budgie pot, or to "ignore". The first current account is your Main account until you map it.
7. **Every 90 days** Monzo asks you to approve again. The Bank screen shows the date (`reapproveBy`). When it says "needs reconnecting", tap Connect again. The client details are kept, so you don't need to enter them again.

## Sophie: Starling
1. Open https://developer.starlingbank.com and sign up. Go to **Personal Access** and link your Starling account (approve it in the app).
2. Choose **Create token** and tick **only read boxes**:
   - **Needed:** `account-list:read`, `balance:read`, `transaction:read`
   - **Also useful:** `account:read`, `savings-goal:read` (Spaces you save into), `space:read` (spending Spaces), if shown
   - **Leave every other box unticked** (payments, transfers, create, edit, and other read boxes such as `payee:read`). Budgie only accepts a token with exactly these read scopes.
   - Budgie checks the token's scopes again once a day. If they've changed, it disconnects the token and says why.
3. Copy the token (it's shown once) into Budgie's Bank screen. It doesn't expire.
4. To stop it for good, revoke the token in the developer portal. Budgie's Disconnect deletes its copy, but Starling has no way for Budgie to revoke it.

## What is and isn't imported
- **Ids:** bank rows use `bk-…`, and bank changes to one date use `x-<item>-<date>-bank-<person>` (amount) and `x-<item>-<date>-bankday-<person>` (day). If someone else already used an id, that row is skipped and logged, and the rest of the import carries on.
- **Card and other payments** become `transactions` with `review: true`.
  - Payments dated before your Budgie start date are history, so they get `review: false`.
  - A payment matching one already logged is linked instead of added:
    - logged by hand: the same amount within 1p, within 2 days;
    - posted by Peckish: the bank's name for it shares a word with the shop's (e.g. "Tesco"), within 15% or £5 (whichever is bigger), within 3 days. Your own Peckish shop is linked and its amount becomes the bank's (and its account the one the bank says paid, as Peckish doesn't say), so Peckish (which you both see) learns what that shop really cost. A shop that doesn't name the same shop is never linked, so a made-up one can't take over a payment somewhere else.
    - It works the other way round too: one you log (or Peckish posts) after the bank has brought the payment in, while you haven't checked the bank's one yet, is linked the same way (and only if it names the same shop, so cash you log for the same amount stays its own payment) and the bank's copy is taken off, so it isn't counted twice. A Peckish shop posted after you've already checked the bank's one as food is linked too, and keeps what you said it was for (Peckish posts when you log the shop there, checked or not). One you log by hand after checking the bank's one is left as its own payment.
    - A payment you logged that's linked takes the bank's amount (to the penny) and date, as the bank's own copy would have had, so it counts in the week and pay period the bank says.
    - Each one you logged goes to the payment most like it over the whole read (the same name first, then the nearer day, then the nearer amount), so Thursday's Peckish shop at Tesco is Thursday's payment, not Monday's Tesco you'd already checked.
  - A rule learned from a correction sets the budget, but its split is only stored as `splitHint`. The split itself stays empty until you confirm the payment.
  - A pending payment that goes to £0, or that disappears from the feed and is more than a week old, is removed. If the bank shows it again later, it comes back (one you dismissed on your phone stays dismissed).
  - A pot, Space or Moneybox move whose payment the bank later shows as reversed or declined is taken off too.
  - A payment the bank lists twice in one read (under a Space as well as the account, say) counts once.
  - One bank payment is a payment or a move, never both. A Moneybox payment read before there was a LISA or ISA comes in as a payment; once there is one, it becomes the move if you haven't checked it yet (a checked one stays a payment). A move stays a move.
  - Rows the bank wrote or linked: phones can only change `budget`, `split`, `note` and `review`. A phone can dismiss one, and bring back only one it dismissed itself (Undo); one the bank feed removed comes back only from the bank. Peckish can't bring one back at all: sending a shop again, or taking it off in Peckish, leaves a payment you took off in Budgie off.
- **Planned items aren't imported again.** These are already in Budgie: bills, regular transfers to your partner, and payments between you that you've already logged.
  - A payment between you that your partner logged only counts if the bank's name for it has your partner's Budgie id in it (e.g. "SOPHIE …"). Their display name isn't used, because they can change it.
  - Only your own payday ticks stop a bank pot move coming in. Your partner's rows never do.
  - A bill that came to a different amount becomes an `amount` exception.
  - A bill (or a regular payment to your partner) that went out on another day than planned, inside the same pay period, becomes a `move` exception to that day (`x-<item>-<date>-bankday-<person>`), so the bank's balance, which already has it taken off, doesn't have it taken off again on the planned day. Which payment is which bill is still weighed against the planned day, and the move is taken off again if a later read finds the bill's own payment on its day.
  - Pay that comes in early (the day before payday) is moved the same way, so the new pay period starts the day it came in, and the rest of that read (payday's moves into the pots that morning) is weighed with it there. Pay that comes in late isn't moved: the period has already started, and what was ticked on payday stays.
  - A card payment only counts as a bill if the names share a word (e.g. "Phone").
  - A pooled bill (an estimate like the flat bills) is never matched as itself: its real bills come in as payments. The first payment from a new payee out of its pot asks once ("Part of the flat bills?"); after that the payee's rule (`bank.rule.<payee>` = the bill's id) counts it against the estimate straight away, already checked. Only for payments in its pooled months (from the pool date): one from before is the old way's, and isn't counted against it.
  - Each bill, regular transfer or logged payment between you goes to the payment most like it over the whole read (the same name first, then the nearer day), so £20 to a friend a couple of days before a £20 bill isn't taken for the bill.
- **Bills paid from a Monzo bills pot** (seen in Ethan's real feed). The pot pays a bill by moving the money into the current account first, so the account's feed has two payments at the same moment for the same amount:
  1. the pot's withdrawal: scheme `uk_retail_pot`, category `transfers`, money into the account, `metadata.pot_id` (and `pot_account_id`, `pot_withdrawal_id`), `trigger` `committed_spending` and `triggered_by` `direct-debit` or `monzo-paid`;
  2. the bill, money out: a direct debit (scheme `bacs`, category `bills`, `bacs_direct_debit_instruction_id`, `subscription_id` and **`bills_pot_id`**: the pot), or one Monzo pays itself (scheme `monzo_paid`, e.g. Monzo Max, `matches_billsback_bill_definition`, no `bills_pot_id`).
  - Budgie takes the pot from `bills_pot_id` when that pot's withdrawal for the same amount is there within 2 minutes (without one, the bill is the account's, as before), and otherwise from a withdrawal with that trigger for the same amount within 2 minutes.
  - A payment from the account and a pot move an older version saved (written before this first ran: meta `pot.pairFromAt`, the moment) are left exactly as they were, and remembered as such (bank status `potOld`), so the same pair is decided the same way on every read, even after you change the payment. The two are one payment from the pot, never a move as well:
    - a planned bill (or payment to your partner) that the plan takes from that pot is the bill, and its withdrawal is dropped (else the pot would be paid out of twice and the account given the money);
    - anything else (the flat bills' real bills, Monzo Max) is a payment from the pot;
    - a planned bill the plan takes from another account keeps the withdrawal as a move, as the money did leave the pot.
  - A card payment the pot covers is marked `eligible_for_pot_cover`; its shape isn't handled specially yet.
- **Pay** at a different amount becomes an `amount` exception. Money only counts as the pay if it's within 50% of the expected pay and within 3 days, and never if the bank's name for it has your partner's Budgie id in it, or it's a Monzo top-up (`is_load`) or a move from a pot or Space. Each payday goes to the money in most like it over the whole read (the amount expected, on the day), so a pay-sized transfer from savings the day before can't take its place. A payday whose pay could be before the start of a read keeps what the earlier read found. A first import read in parts carries the last week's money in from one part to the next, so a payday where a part stopped still goes to the money most like the pay on either side. Other money in is ignored, except card refunds.
- **Pot or Space moves** become `moves`. Starling lists a move to or from a spending Space in the Space's own feed too: only the account's side counts (between two Spaces, the side it left from). A move to a Space Budgie can't see (no `savings-goal:read` box) is left out, not taken for spending or pay. A move to a pot, Moneybox, LISA or ISA within 7 days after payday ticks the planned payday move.
  - It matches to the penny, or it's the one planned move to that place within 10%. The plan can drift after payday, e.g. when a bill comes in higher.
  - One bank move ticks each payday move. A second one to the same place that week (a top-up, say) comes in as a move of its own.
  - It's dated on payday, unless it landed in the next tax year (on or after 6 April for a payday before it): then it's dated when it landed, so a LISA or ISA payment counts towards the year the provider counts it in.
  - A Moneybox payment that doesn't match goes to the LISA (if it equals the LISA saving) or the ISA, with `review: true`.
- **Balances:** one `valuations` row per mapped account per day.
- **How far back each read goes:**
  - everything, the first time (over more than one run if it's long)
  - the last 35 days, every 15 minutes
  - 89 days, on the read after you map a pot, and on the first read that works after four weeks or more without one
  - A read that brings exactly what the last one did (same payments, balances and day, and nothing changed in your settings, accounts, bills, pay, budgets and the other small tabs) skips saving, so the 96 reads a day stay well inside the 90 minutes of trigger time a gmail account gets. It still saves at least once an hour.

## Check these on the first real connection
These were built from the docs. Starling's reference pages need JavaScript and couldn't be read here, so its shapes come from client libraries.

**Monzo**
- Budgie asks for `account_type=uk_retail` only, so a joint account (with your partner's card spending) or Flex is left out. Check your current account is the one listed.
- How pot moves look in the account's feed. Budgie expects `metadata.pot_id` (or a `description` of `pot_…`), with a negative amount into the pot.
- `expand[]=merchant` gives `merchant.name`, and faster payments have `counterparty.name`.
- A pending payment keeps the same `id` when it settles.
- Paging with `since=<last id>` and `limit=100` returns the whole history.
- When the 5-minute full-history window starts: at sign-in or at approval. Budgie tries the full import from the moment you sign in. If a full read is refused more than 5 minutes after approval, it reads the last 89 days instead and notes "Monzo only lets Budgie read the last 90 days now".
- A first read of a long history stops reading after 3½ minutes of a run (Apps Script stops any run at 6), saves what it has, and carries on from the last payment a minute later. A first read leaves a mark while it runs: if Apps Script cuts a run off at 6 minutes (saving a very long history, say), the next run sees the mark, reads half as many pages and counts it as a failure. If carrying on keeps failing (not just waiting for the approval), the minute runs stop after 3 failures in a row, so they can't use up the daily trigger time, and the 15-minute read carries on instead. Saving writes the new rows first; the changes to rows already there (one write each, such as linking payments you logged by hand) stop 5 minutes into the run, and the next run, a minute later, reads the same again and makes the rest. If Monzo stops sharing older payments part-way (on a page, or when carrying on), what was read is kept, the last 89 days are read too, and the note says how far the history got. Whether Monzo lets a read carry on from a payment's id after its 5 minutes is unknown: if not, the gap between the two is lost, so approve straight away.
- Before approval, `/accounts` returns 403. Rate limits return 429, maybe with `Retry-After`.

**Starling**
- **`GET /api/v2/identity/token` returns a `scopes` array.** If it doesn't, Budgie refuses every token, saying it can't confirm the token is read-only.
- Savings goals: is the list `savingsGoalList` and the id `savingsGoalUid` or `uid`? Is `/api/v2/account/{uid}/spaces` there, and under which scope?
- A move into a Space: Budgie expects `source: INTERNAL_TRANSFER` and `counterPartyUid` = the Space's uid (or a spending Space's `categoryUid`). Check `counterPartyType` (CATEGORY / SAVINGS_GOAL).
- The same move in a spending Space's own feed: Budgie expects `INTERNAL_TRANSFER` with the account (or its default category) as the counterparty, and leaves it out. Check one move each way shows once in Budgie, as a move.
- `INTERNAL_TRANSFER` is only used between your own account and its Spaces (TrueLayer's docs say so). Check a payment to another Starling customer isn't `INTERNAL_TRANSFER` with `counterPartyType` CATEGORY, or it would be left out.
- `/api/v2/identity/token` gives `accountHolderUid` (used so one Starling account can't be connected for both of you; without it, only the same token is caught).
- A spending Space's payments have their own category. Budgie maps a payment by its `categoryUid` when it has one: check that a spending Space's `categoryUid` is what its payments carry.
- Does `transactions-between` accept 90-day ranges?
- `effectiveBalance` is used for the balance. Status values used: PENDING, SETTLED, DECLINED, REVERSED, UPCOMING.

**Both**
- Apps Script doesn't document whether a web app run as the owner gets the owner's **user lock** (the one the triggers use). Budgie doesn't rely on it for safety: a disconnect always wins over a refresh happening at the same moment, two refreshes at once don't break the connection (the one Monzo turns down waits a moment for the other's new token), a read that was using an old connection never marks a new one as needing reconnecting, and rows are only written under the script lock.
- The status (no secrets) has to fit in one property (9 KB). If lots of pots with long names and lots of pending payments ever make it too big, names are cut short and the oldest pending payments stop being watched.
- Dates are London dates, so a 23:30 payment on a summer night counts on that day.
- Moneybox payments are spotted by "Moneybox" in the name.

## Linking Peckish and Caledonite
Each app gets its own key that can only do what that app needs, so neither ever holds a full Budgie key.
- **From Budgie:** Settings links an app with `app.link` and unlinks it with `app.unlink`. A new link cuts off any older copy.
- **From the script:** `appLink("ethan", "peckish")` logs the same link.
- **What each key can do:**
  - **Peckish:** sees names, its person's budgets and accounts, the splits and food shops. It can only add or change its own `t-pk-…` shops.
  - **Caledonite:** can only ask for `app.calendar` (its person's paydays, bills and fun money).
