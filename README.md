# Budgie

One money app for two people, backed by your own Google Sheet. Lives at **https://budgie-money.github.io/**.

- **App**: `index.html`, `app.js`, `themes.js`, `demo.js` (Show and tell), `sw.js` (offline). Installs from Chrome.
- **Engine**: `engine.js` works everything out from rules (pay, bills, budgets, splits). The same file runs in Apps Script.
- **Backend** (Apps Script in the "Budgie data" Google Sheet), built into one file by `node migrate/build.js`:
  - `apps-script/Code.gs`: sync, privacy between partners, linked-app keys, budget tabs.
  - `apps-script/BankFeeds.gs`: read-only bank feeds (Monzo, Starling), polled every 15 minutes. See [BANK-NOTES.md](BANK-NOTES.md).
  - `apps-script/Prices.gs`: the LISA's fund prices from Fidelity's public factsheets, once a day.
  - `apps-script/Extras.gs`: the Sunday email, the weekly backup and the tax-year round-up.
- **Linked apps**: Peckish and Caledonite each get their own limited link (Budgie: Settings, Linked apps). Neither ever holds Budgie's full key.
- **How it fits together**: see [ARCHITECTURE.md](ARCHITECTURE.md).

Tests: `node test/engine.test.js`, `node test/backend.test.js`, `node test/scale.test.js`, `node test/bank.test.js`, `node test/extras.test.js`; browser test with `node test/server.js` then `node test/ui.test.js`.

Nothing secret lives in this repo: bank keys stay inside the sheet owner's Apps Script, and the test data is made up.
