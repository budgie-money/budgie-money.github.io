# Bank feeds: setup and things to check

Budgie reads Monzo (Ethan) and Starling (Sophie) **read-only** and writes what it finds into the normal tabs.
The code is `apps-script/BankFeeds.gs`. Its tests are `test/bank.test.js`, which use fake banks built from the documented API shapes.

## Deploying (once)
1. Run `node migrate/build.js`. Paste `apps-script/Budgie.gs` into Apps Script, or paste the separate files, including `BankFeeds.gs`.
2. **Deploy > Manage deployments > Edit > New version.** `doGet` changed, so this step is needed.
3. Run `installBankTrigger` once. Allow the new permissions Google asks for: connecting to external services, and sending email as you (for the notices below).
   - It reads the banks every 15 minutes.
   - `installTriggers` and the price trigger leave it alone.
4. **Where the secrets live.** Bank tokens, the Monzo client secret and sign-in states are kept in the **owner's User Properties**, not the script's properties, so editors of the sheet can't see them in Project Settings.
   - Anything an older version kept in Script Properties moves over the first time the bank feed runs.
   - Budgie keys stay in Script Properties.
5. **Notices.** Whenever bank details are added, changed or removed, the sheet's owner gets a short email (nothing secret in it). If it wasn't you, run `newKey("<person>")` and reconnect.

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
- **Ids:** bank rows use `bk-…`, and bank changes to one date use `x-<item>-<date>-bank-<person>`. If someone else already used an id, that row is skipped and logged, and the rest of the import carries on.
- **Card and other payments** become `transactions` with `review: true`.
  - Payments dated before your Budgie start date are history, so they get `review: false`.
  - A payment matching one already logged is linked instead of added:
    - logged by hand: the same amount within 1p, within 2 days;
    - posted by Peckish: within 15% or £5 (whichever is bigger), within 3 days, best if the shop's name matches. A Peckish shop split half can be linked to whichever of you paid it, and its amount becomes the bank's.
  - A rule learned from a correction sets the budget, but its split is only stored as `splitHint`. The split itself stays empty until you confirm the payment.
  - A pending payment that goes to £0, or that disappears from the feed and is more than a week old, is removed.
  - Rows the bank wrote or linked: phones can only change `budget`, `split`, `note` and `review`. A phone can dismiss one, but not bring it back.
- **Planned items aren't imported again.** These are already in Budgie: bills, regular transfers to your partner, and payments between you that you've already logged.
  - A bill that came to a different amount becomes an `amount` exception.
  - A card payment only counts as a bill if the names share a word (e.g. "Phone").
- **Pay** at a different amount becomes an `amount` exception. Money only counts as the pay if it's within 50% of the expected pay and within 3 days. Other money in is ignored, except card refunds.
- **Pot or Space moves** become `moves`. A move to a pot, Moneybox, LISA or ISA within 7 days after payday ticks the planned payday move.
  - It matches to the penny, or it's the one planned move to that place within 10%. The plan can drift after payday, e.g. when a bill comes in higher.
  - A Moneybox payment that doesn't match goes to the LISA (if it equals the LISA saving) or the ISA, with `review: true`.
- **Balances:** one `valuations` row per mapped account per day.
- **How far back each read goes:**
  - everything, the first time
  - the last 35 days, every 15 minutes
  - 89 days, on the read after you map a pot

## Check these on the first real connection
These were built from the docs. Starling's reference pages need JavaScript and couldn't be read here, so its shapes come from client libraries.

**Monzo**
- `/accounts` `type` values. Is a Flex or joint account listed, and as what?
- How pot moves look in the account's feed. Budgie expects `metadata.pot_id` (or a `description` of `pot_…`), with a negative amount into the pot.
- How a direct debit paid from a **bills pot** shows up. It might be read as a move, not a bill.
- `expand[]=merchant` gives `merchant.name`, and faster payments have `counterparty.name`.
- A pending payment keeps the same `id` when it settles.
- Paging with `since=<last id>` and `limit=100` returns the whole history.
- When the 5-minute full-history window starts: at sign-in or at approval. Budgie tries the full import from the moment you sign in. If a full read is refused more than 5 minutes after approval, it reads the last 89 days instead and notes "Monzo only lets Budgie read the last 90 days now".
- Before approval, `/accounts` returns 403. Rate limits return 429, maybe with `Retry-After`.

**Starling**
- **`GET /api/v2/identity/token` returns a `scopes` array.** If it doesn't, Budgie refuses every token, saying it can't confirm the token is read-only.
- Savings goals: is the list `savingsGoalList` and the id `savingsGoalUid` or `uid`? Is `/api/v2/account/{uid}/spaces` there, and under which scope?
- A move into a Space: Budgie expects `source: INTERNAL_TRANSFER` and `counterPartyUid` = the Space's uid. Check `counterPartyType` (CATEGORY / SAVINGS_GOAL).
- A spending Space's payments have their own category. Budgie maps a payment by its `categoryUid` when it has one: check that a spending Space's `categoryUid` is what its payments carry.
- Does `transactions-between` accept 90-day ranges?
- `effectiveBalance` is used for the balance. Status values used: PENDING, SETTLED, DECLINED, REVERSED, UPCOMING.

**Both**
- Dates are London dates, so a 23:30 payment on a summer night counts on that day.
- Moneybox payments are spotted by "Moneybox" in the name.

## Linking Peckish and Caledonite
Each app gets its own key that can only do what that app needs, so neither ever holds a full Budgie key.
- **From Budgie:** Settings links an app with `app.link` and unlinks it with `app.unlink`. A new link cuts off any older copy.
- **From the script:** `appLink("ethan", "peckish")` logs the same link.
- **What each key can do:**
  - **Peckish:** sees names, its person's budgets and accounts, the splits and food shops. It can only add or change its own `t-pk-…` shops.
  - **Caledonite:** can only ask for `app.calendar` (its person's paydays, bills and fun money).
