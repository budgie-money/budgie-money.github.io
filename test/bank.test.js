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
    if (f.client_id !== CLIENT_ID || f.client_secret !== SECRET.clientSecret) return send(401, {code: "unauthorized.bad_client"});
    if (f.grant_type === "authorization_code") { if (f.code !== SECRET.code || f.redirect_uri !== "https://script.google.com/macros/s/TEST/exec") return send(400, {code: "bad_request"}); monzo.tokens[SECRET.access1] = true; monzo.refreshes[SECRET.refresh1] = SECRET.access2; return send(200, {access_token: SECRET.access1, refresh_token: SECRET.refresh1, expires_in: 21600, user_id: "user_00009ETHAN", client_id: CLIENT_ID, token_type: "Bearer"}); }
    if (f.grant_type === "refresh_token") { const next = monzo.refreshes[f.refresh_token]; if (!next) return send(401, {code: "unauthorized.bad_refresh_token"}); delete monzo.refreshes[f.refresh_token]; monzo.tokens[next] = true; const nextRef = f.refresh_token === SECRET.refresh1 ? SECRET.refresh2 : "ref-ETHAN-3-ffffffff"; monzo.refreshes[nextRef] = f.refresh_token === SECRET.refresh1 ? "acc-ETHAN-3-eeeeeeee" : "acc-ETHAN-4-gggggggg"; return send(200, {access_token: next, refresh_token: nextRef, expires_in: 21600, user_id: "user_00009ETHAN", client_id: CLIENT_ID, token_type: "Bearer"}); }
    return send(400, {});
  }
  if (u.pathname === "/oauth2/logout") { delete monzo.tokens[tok]; return send(200, {}); }
  if (!monzo.tokens[tok]) return send(401, {code: "unauthorized.bad_access_token"});
  if (monzo.rate) return send(429, {code: "too_many_requests"}, {"Retry-After": "120"});
  if (!monzo.approved) return send(403, {code: "forbidden.insufficient_permissions", message: "Access forbidden due to insufficient permissions"});
  // after the first few minutes Monzo only gives the last 90 days
  if (monzo.historyClosed && u.pathname === "/transactions") { const sn = q.get("since"); if (!sn || (!/^tx_/.test(sn) && (NOW - RealDate.parse(sn)) > 90 * 86400000)) return send(403, {code: "forbidden.verification_required"}); }
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
ok("the Peckish shop is linked, not added again", !bk("tx_sainsburys") && tx.find(r => r.id === "peckish-1").bankId === "tx_sainsburys" && tx.find(r => r.id === "peckish-1").review === false);
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
const freshMonzo = () => { monzo.tokens = {}; monzo.refreshes = {}; monzo.rate = false; monzo.approved = true; monzo.historyClosed = false; };
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
  ok("S4: the reasons say why", /x-<item>-<date>/.test(sq.rejected[0].error) && /your name and its key/.test(sq.rejected[2].error) && /bank feed/.test(sq.rejected[3].error));
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
  ok("C1: a half-split Peckish shop links to whoever's bank paid it", shop.bankId === "tx_sainsburys" && shop.person === "ethan" && shop.account === "e-main" && shop.amount === 62.4 && shop.split === "half" && shop.review === false && !grow(G, "transactions").some(r => r.id === "bk-monzo-tx_sainsburys"), shop);
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
  ok("C5: a phone can dismiss a bank row but not bring it back", grow(G, "transactions").find(r => r.id === "bk-monzo-tx_friend").deleted === true);
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
// the code itself: one way out, and no write method anywhere
ok("BankFeeds.gs has a single UrlFetchApp.fetch", (SRC.match(/UrlFetchApp\.fetch\s*\(/g) || []).length === 1 && /function bankHttp_[\s\S]*?UrlFetchApp\.fetch/.test(SRC.slice(SRC.indexOf("function bankHttp_"), SRC.indexOf("function bankErr_"))));
const methods = (SRC.match(/bankHttp_\(\s*"([a-z]+)"/g) || []).map(m => m.match(/"([a-z]+)"/)[1]);
ok("every request in BankFeeds.gs is a GET or POST", methods.length >= 6 && methods.every(m => m === "get" || m === "post"), methods);
ok("BankFeeds.gs never names a write endpoint", !/\/(deposit|withdraw)\b|\/attachment|transaction-receipts|\/webhooks|payments\/local|"\/feed"/.test(SRC));
const posts = (SRC.match(/bankHttp_\(\s*"post"[^)]*/g) || []);
ok("the only POSTs are Monzo token and logout", posts.length === 3 && posts.every(p => /MONZO_API_ \+ "\/oauth2\/(token|logout)"/.test(p)), posts);

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
