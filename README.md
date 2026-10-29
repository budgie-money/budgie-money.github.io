# Budgie

One money app for two people, backed by your own Google Sheet. Lives at **https://budgie-money.github.io/**.

- **App**: `index.html`, `app.js`, `experience.js`, `clarity.js`, `themes.js`, `demo.js` (Show and tell), `sw.js` (offline). Installs from Chrome. Today shows category balances and feasible pot actions. Money separates Budget, Activity (newest first) and Pots. More keeps the icon tiles for supporting tools.
- **Engine**: `engine.js` works everything out from rules (pay, bills, budgets, splits). The same file runs in Apps Script.
- **Backend** (Apps Script in the "Budgie data" Google Sheet), built into one file by `node scripts/build-backend.js`:
  - `apps-script/Code.gs`: sync, privacy between partners, linked-app keys, budget tabs.
  - `apps-script/BankFeeds.gs`: read-only bank feeds (Monzo, Starling), polled every 15 minutes. See [BANK-NOTES.md](BANK-NOTES.md).
  - `apps-script/Prices.gs`: the LISA's fund prices from Fidelity's public factsheets, once a day.
  - `apps-script/Extras.gs`: the Sunday email, the weekly backup and the tax-year round-up.
- **Linked apps**: Peckish and Caledonite each get their own limited link (Budgie: Settings, Linked apps). Neither ever holds Budgie's full key.
- **How it fits together**: see [ARCHITECTURE.md](ARCHITECTURE.md).

Tests: `node test/accuracy.test.js`, `node test/engine.test.js`, `node test/backend.test.js`, `node test/scale.test.js`, `node test/bank.test.js`, `node test/extras.test.js`, `node test/experience.test.js`; browser tests with `node test/server.js` then `node test/ui.test.js` and `node test/addresses.test.js` (Budgie at its real web addresses: the security policy, connect-link checks, Linked apps and the move from the old address). Set `SHOTS` to a local folder for screenshots. Playwright is needed for the browser suites. The earlier screen-specific checks are retained in `test/legacy-ui.test.js`; the default UI suite exercises the current flows, responsive screens and nine-step tour.

Nothing secret lives in this repo: bank keys stay inside the sheet owner's Apps Script, and the test data is made up.


Budget health is in Settings. It surfaces unresolved receipts, stale manually checked balances, funding gaps, sync queue and backup verification. In Bank connection, Find a bank receipt reads the last 35 days directly for a merchant and shows how a receipt was reconciled. It never marks a bill paid.

For recovery, keep the existing private backup folder and the newest successful copy. A backup contains table values, not bank tokens, app keys or the deployed script. To restore, preserve the current spreadsheet/deployment, pause imports and client edits, make a fresh copy first, and replace the damaged data tabs from the backup with matching schema/headers. Keep meta/schema and IDs intact, then run a full refresh on both phones and verify balances and matching. Reconnect the bank if its authorization is unavailable; do not paste old secrets into table cells. Have the owner perform a restore deliberately rather than overwriting live data as an automatic repair.
