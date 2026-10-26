/* Budgie: read-only bank feeds (Monzo for Ethan, Starling for Sophie).

   What it does: every 15 minutes it reads each connected person's payments, pot/Space moves and balances, and
   writes them into the normal tabs (transactions, moves, valuations, exceptions) through the same row path the
   app uses, so phones get them on their next sync.

   Security:
   - Read only. Every request goes through bankHttp_, which only allows GET to api.monzo.com and
     api.starlingbank.com, plus POST to Monzo's /oauth2/token (sign in, refresh) and /oauth2/logout (disconnect).
     Nothing here can move money, write to a feed, upload anything or register a webhook.
   - Starling: only a personal access token with exactly the read scopes Budgie needs is accepted, and they're
     checked again every day.
   - Tokens, refresh tokens, the Monzo client secret and sign-in states live only in the owner's User Properties
     (BANK_TOKEN_<person>, BANK_CLIENT_<person>, BANK_OAUTH_<state>), which editors of the sheet can't open.
     Never in the sheet, a response, a log or an error message. Setting, changing or removing a bank connection
     emails the sheet's owner.
   - Each bank action works only on the caller's own bank (the person their Budgie key belongs to).
   - No webhooks (they can't be authenticated): a time trigger polls (installBankTrigger).

   Set up: see the bank section of BANK-NOTES.md. Run installBankTrigger once. */

var BANK_HOSTS_ = {"api.monzo.com": "monzo", "api.starlingbank.com": "starling"};
var BANK_POST_OK_ = ["https://api.monzo.com/oauth2/token", "https://api.monzo.com/oauth2/logout"];
var MONZO_API_ = "https://api.monzo.com", MONZO_AUTH_ = "https://auth.monzo.com/", STARLING_API_ = "https://api.starlingbank.com";
var STARLING_NEED_ = ["account-list:read", "balance:read", "transaction:read"];
var STARLING_OK_ = ["account-list:read", "balance:read", "transaction:read", "account:read", "savings-goal:read", "space:read"];
var BANK_MAX_STATES_ = 10, BANK_SCOPE_CHECK_ = 86400000, BANK_HISTORY_WINDOW_ = 5 * 60000, BANK_PENDING_DROP_DAYS_ = 7;
var BANK_DAY_ = 86400000, BANK_STATE_LIFE_ = 10 * 60000, BANK_FIRST_WINDOW_ = 20 * 60000, BANK_RECENT_DAYS_ = 35, BANK_WIDE_DAYS_ = 89;
var BANK_NAMES_ = {monzo: "Monzo", starling: "Starling"};

// ---------- the only way out to a bank ----------
function bankHttp_(method, url, opts) {
  method = String(method || "get").toLowerCase(); opts = opts || {};
  var m = String(url).match(/^https:\/\/([^\/?#:@]+)(\/[^?#]*)?/), host = m ? m[1] : "";
  if (!BANK_HOSTS_[host]) throw bankErr_("other", "Budgie only talks to Monzo and Starling");
  var bare = "https://" + host + (m[2] || "");
  if (method !== "get" && !(method === "post" && BANK_POST_OK_.indexOf(bare) >= 0)) throw bankErr_("other", "Budgie only reads from your bank");
  var params = {method: method, muteHttpExceptions: true, followRedirects: false, headers: opts.headers || {}};
  if (opts.form) { params.payload = opts.form; params.contentType = "application/x-www-form-urlencoded"; }
  var r = UrlFetchApp.fetch(url, params), code = r.getResponseCode(), text = r.getContentText(), json = null;
  try { json = text ? JSON.parse(text) : {}; } catch (e) { json = null; }
  var headers = {}; try { headers = r.getHeaders() || {}; } catch (e) {}
  return {code: code, json: json, headers: headers};
}
function bankErr_(kind, message, extra) { var e = new Error(message); e.bank = kind; if (extra) for (var k in extra) e[k] = extra[k]; return e; }
function qs_(q) {
  var out = [];
  Object.keys(q || {}).forEach(function (k) { var v = q[k]; if (v === undefined || v === null || v === "") return; (Array.isArray(v) ? v : [v]).forEach(function (x) { out.push(encodeURIComponent(k) + "=" + encodeURIComponent(x)); }); });
  return out.length ? "?" + out.join("&") : "";
}
// an HTTP answer as a bank problem: 401/403 mean reconnect, 429 means slow down
function bankCheck_(r, provider) {
  if (r.code >= 200 && r.code < 300 && r.json) return r.json;
  var name = BANK_NAMES_[provider] || "The bank";
  if (r.code === 401 || r.code === 403) throw bankErr_("reconnect", name + " needs reconnecting", {status: r.code});
  if (r.code === 429) { var ra = +((r.headers || {})["Retry-After"] || (r.headers || {})["retry-after"] || 0); throw bankErr_("backoff", name + " asked Budgie to slow down", {retryAfter: ra}); }
  if (r.code === 404) throw bankErr_("missing", name + " couldn't find that", {status: 404});
  throw bankErr_("other", name + " had a problem (" + r.code + ")", {status: r.code});
}

// ---------- secrets (the owner's User Properties) ----------
// Tokens, client secrets and sign-in states are the owner's own: the web app and the triggers run as the owner,
// so they can read them, but an editor of the sheet looking in Project Settings can't. The status (no secrets) is
// kept with the script's properties.
var BANK_SECRET_RE_ = /^BANK_(TOKEN|TOKEN_NEXT|CLIENT|OAUTH)_/;
function bankProps_(k) { return BANK_SECRET_RE_.test(String(k || "")) ? PropertiesService.getUserProperties() : PropertiesService.getScriptProperties(); }
function bankGet_(k) { var v = bankProps_(k).getProperty(k); if (!v) return null; try { return JSON.parse(v); } catch (e) { return null; } }
function bankSet_(k, v) { bankProps_(k).setProperty(k, JSON.stringify(v)); }
function bankDel_(k) { bankProps_(k).deleteProperty(k); }
// once: secrets an earlier version kept with the script's properties move to the owner's
function bankMoveSecrets_() {
  var sp = PropertiesService.getScriptProperties(), all = sp.getProperties(), up = null;
  Object.keys(all).forEach(function (k) {
    if (!BANK_SECRET_RE_.test(k)) return;
    up = up || PropertiesService.getUserProperties();
    if (!up.getProperty(k)) up.setProperty(k, all[k]);
    sp.deleteProperty(k);
  });
}
function bankStates_() { var all = PropertiesService.getUserProperties().getProperties(), out = []; Object.keys(all).forEach(function (k) { if (/^BANK_OAUTH_/.test(k)) { var v = null; try { v = JSON.parse(all[k]); } catch (e) {} out.push({k: k, v: v}); } }); return out; }
// a short email to the sheet's owner when a bank connection is set, changed or removed (nothing secret in it)
function bankNotify_(p, what) {
  try {
    var to = Session.getEffectiveUser().getEmail(); if (!to) return;
    var who = (byId_("people", p) || {}).name || p, when = Utilities.formatDate(new Date(), tz_(), "d MMM yyyy 'at' HH:mm");
    MailApp.sendEmail({to: to, name: "Budgie", subject: "Budgie: " + who + "'s bank connection changed",
      body: who + "'s bank connection in Budgie: " + what + ", on " + when + ".\n\nIf that wasn't " + who + ", open the sheet's Apps Script and run newKey(\"" + p + "\") to change their Budgie key, then disconnect the bank in Budgie and connect it again."});
  } catch (e) {}
}
function bankKey_(kind, p) { return "BANK_" + kind + "_" + p; }   // TOKEN, CLIENT (secrets), STATUS (no secrets)
function bankStatus_(p) { return bankGet_(bankKey_("STATUS", p)) || {}; }
function bankSaveStatus_(p, s) { bankSet_(bankKey_("STATUS", p), s); }
// anything that could be a secret is blanked out of a message before it's kept or shown
function bankScrub_(p, msg) {
  msg = String(msg || "");
  var tok = bankGet_(bankKey_("TOKEN", p)) || {}, cl = bankGet_(bankKey_("CLIENT", p)) || {};
  [tok.access, tok.refresh, cl.secret].forEach(function (s) { if (s && String(s).length > 3) msg = msg.split(String(s)).join("•••"); });
  return msg.replace(/Bearer\s+\S+/gi, "Bearer •••").replace(/(code|token|secret|refresh_token|access_token|client_secret)=[^&\s]+/gi, "$1=•••").slice(0, 300);
}
function bankRandom_() { return (Utilities.getUuid() + Utilities.getUuid()).replace(/[^A-Za-z0-9]/g, ""); }

// ---------- requests from the app ----------
// every action works only on the caller's own bank: there is no "person" parameter
function bankAction_(me, b) {
  try {
    bankMoveSecrets_();
    switch (b.action) {
      case "bank.status": return {ok: true, bank: bankStatusFor_(me)};
      case "bank.monzo.setClient": return monzoSetClient_(me, b);
      case "bank.monzo.authUrl": return monzoAuthUrl_(me);
      case "bank.starling.setToken": return starlingSetToken_(me, b);
      case "bank.map": return bankMap_(me, b);
      case "bank.syncNow": return bankSyncNow_(me);
      case "bank.disconnect": return bankDisconnect_(me);
      default: return {ok: false, error: "Unknown bank action"};
    }
  } catch (e) {
    return {ok: false, error: bankScrub_(me, e && e.message || e)};
  }
}
function bankStatusFor_(p) {
  var s = bankStatus_(p), tok = bankGet_(bankKey_("TOKEN", p)), cl = bankGet_(bankKey_("CLIENT", p));
  var provider = tok ? tok.provider : cl ? "monzo" : "";
  var maps = {}; readTable_("settings").rows.forEach(function (r) { if (r.person === p && !bankTrue_(r.deleted) && /^bank\.map\./.test(String(r.key))) maps[String(r.key).slice(9)] = String(r.value === undefined || r.value === null ? "" : r.value); });
  var review = 0; readTable_("transactions").rows.forEach(function (r) { if (r.person === p && bankTrue_(r.review) && !bankTrue_(r.deleted)) review++; });
  var approved = tok && tok.provider === "monzo" ? (tok.approvedAt || tok.issuedAt) : 0;
  return {
    provider: provider, connected: !!tok && !s.needsReconnect, needsSetup: !tok, needsReconnect: !!(tok && s.needsReconnect),
    lastSync: s.lastSync || 0, lastError: s.lastError || "", note: s.note || "", waitingForApproval: !!(tok && s.waiting),
    reapproveBy: approved ? Utilities.formatDate(new Date(approved + 90 * BANK_DAY_), tz_(), "yyyy-MM-dd") : "",
    accounts: (s.accounts || []).map(function (a) { return {extId: a.extId, name: a.name, kind: a.kind, balance: a.balance, mappedTo: maps.hasOwnProperty(a.extId) ? maps[a.extId] : null}; }),
    review: review
  };
}
function bankTrue_(v) { return v === true || /^(true|yes|1)$/i.test(String(v === undefined || v === null ? "" : v)); }

// ---------- Monzo: sign in ----------
function bankRedirect_() { return webAppUrl_(); }
function monzoSetClient_(me, b) {
  var id = String(b.clientId || "").trim(), secret = String(b.clientSecret || "").trim();
  if (!/^oauth2client_[A-Za-z0-9]+$/.test(id)) return {ok: false, error: "That client ID doesn't look right. It starts with oauth2client_."};
  if (!secret || secret.length > 500 || /\s/.test(secret)) return {ok: false, error: "That client secret doesn't look right."};
  // a connection that's working can't be pointed somewhere else: disconnect first
  var tok = bankGet_(bankKey_("TOKEN", me)); if (tok) return {ok: false, error: "Disconnect " + BANK_NAMES_[tok.provider] + " first."};
  var had = !!bankGet_(bankKey_("CLIENT", me));
  bankSet_(bankKey_("CLIENT", me), {id: id, secret: secret});
  bankNotify_(me, had ? "the Monzo app details were changed" : "Monzo app details were added");
  return {ok: true};
}
function monzoAuthUrl_(me) {
  var cl = bankGet_(bankKey_("CLIENT", me)); if (!cl) return {ok: false, error: "Add your Monzo client ID and secret first."};
  var tok = bankGet_(bankKey_("TOKEN", me)); if (tok && (tok.provider !== "monzo" || !bankStatus_(me).needsReconnect)) return {ok: false, error: "Disconnect " + BANK_NAMES_[tok.provider] + " first."};
  var redirect = bankRedirect_(); if (!/\/exec$/.test(redirect)) return {ok: false, error: "The sheet's web app address isn't set up yet."};
  // a one-time random state, kept here for 10 minutes and tied to you (asking again replaces your last one)
  bankStates_().forEach(function (x) { if (!x.v || x.v.person === me) bankDel_(x.k); });
  var state = bankRandom_();
  bankSet_("BANK_OAUTH_" + state, {person: me, state: state, exp: Date.now() + BANK_STATE_LIFE_});
  bankTidyStates_();
  return {ok: true, url: MONZO_AUTH_ + qs_({client_id: cl.id, redirect_uri: redirect, response_type: "code", state: state})};
}
// expired states go; and there are never more than a handful waiting
function bankTidyStates_() {
  var now = Date.now(), live = [];
  bankStates_().forEach(function (x) { if (!x.v || !(x.v.exp > now)) bankDel_(x.k); else live.push(x); });
  live.sort(function (a, b) { return a.v.exp - b.v.exp; });
  while (live.length > BANK_MAX_STATES_) bankDel_(live.shift().k);
}
// Monzo sends the browser back here (doGet) with ?code=…&state=…
function bankCallback_(q) {
  var page = function (msg) {
    return HtmlService.createHtmlOutput('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><title>Budgie</title>' +
      '<div style="font:17px/1.5 system-ui,sans-serif;max-width:28em;margin:48px auto;padding:0 20px">' + msg + "</div>").setTitle("Budgie");
  };
  bankMoveSecrets_();
  var state = String(q.state || ""), key = "BANK_OAUTH_" + state.replace(/[^A-Za-z0-9]/g, ""), st = /^[A-Za-z0-9]{64}$/.test(state) ? bankGet_(key) : null;
  if (st) bankDel_(key);   // a state works once
  if (!st || st.state !== state || !(st.exp > Date.now())) return page("<p>That sign-in link has expired or didn't come from Budgie, so nothing was connected.</p><p>Start again from the Bank screen in Budgie.</p>");
  var p = st.person;
  if (q.error || !q.code) return page("<p>Monzo wasn't connected. You can close this tab and try again from Budgie.</p>");
  var cl = bankGet_(bankKey_("CLIENT", p)); if (!cl) return page("<p>Monzo wasn't connected. Add your client details in Budgie first.</p>");
  // a connection that still works isn't replaced (one that needs reconnecting is)
  if (bankGet_(bankKey_("TOKEN", p)) && !bankStatus_(p).needsReconnect) return page("<p>Monzo is already connected. To connect it again, disconnect it in Budgie first.</p>");
  var r = bankHttp_("post", MONZO_API_ + "/oauth2/token", {form: {grant_type: "authorization_code", client_id: cl.id, client_secret: cl.secret, redirect_uri: bankRedirect_(), code: String(q.code)}});
  if (r.code !== 200 || !r.json || !r.json.access_token) {
    var s0 = bankStatus_(p); s0.lastError = "Monzo didn't accept the sign-in. Try again from Budgie."; bankSaveStatus_(p, s0);
    return page("<p>Monzo didn't connect. You can close this tab and try again from Budgie.</p>");
  }
  var now = Date.now();
  bankSet_(bankKey_("TOKEN", p), {provider: "monzo", access: r.json.access_token, refresh: r.json.refresh_token || "", expiresAt: now + (+r.json.expires_in || 21600) * 1000, issuedAt: now, approvedAt: 0});
  var s = {provider: "monzo", waiting: true, firstUntil: now + BANK_FIRST_WINDOW_, fullDone: false, accounts: [], lastSync: 0, lastError: ""};
  bankSaveStatus_(p, s);
  bankNotify_(p, "Monzo was connected");
  bankDel_(bankKey_("TOKEN_NEXT", p));
  // Monzo only shares data once it's approved in the Monzo app, and only gives full history in the first few
  // minutes, so try now and then every minute until it works
  try { bankRun_(p); } catch (e) {}
  if (bankStatus_(p).waiting) bankEnsureMinuteTrigger_();
  return page("<p><b>Budgie is connected to Monzo. You can close this tab.</b></p><p>If the Monzo app asks, approve Budgie there, then Budgie brings in your payments within a minute.</p>");
}
function monzoAccess_(p) {
  var tok = bankGet_(bankKey_("TOKEN", p)), next = bankGet_(bankKey_("TOKEN_NEXT", p));
  // a refreshed token that couldn't be saved in its usual place last time
  if (next && tok && next.provider === "monzo" && (next.refreshedAt || 0) > (tok.refreshedAt || 0)) { tok = next; try { bankSet_(bankKey_("TOKEN", p), tok); bankDel_(bankKey_("TOKEN_NEXT", p)); } catch (e) {} }
  if (!tok || tok.provider !== "monzo") throw bankErr_("reconnect", "Monzo isn't connected");
  if (!(tok.expiresAt > Date.now() + 60000)) tok = monzoRefresh_(p, tok);
  return tok;
}
function monzoRefresh_(p, tok) {
  var cl = bankGet_(bankKey_("CLIENT", p));
  if (!cl || !tok.refresh) throw bankErr_("reconnect", "Monzo needs reconnecting");
  var r = bankHttp_("post", MONZO_API_ + "/oauth2/token", {form: {grant_type: "refresh_token", client_id: cl.id, client_secret: cl.secret, refresh_token: tok.refresh}});
  if (r.code === 429) bankCheck_(r, "monzo");
  if (r.code !== 200 || !r.json || !r.json.access_token) throw bankErr_("reconnect", "Monzo needs reconnecting");
  var fresh = {}; Object.keys(tok).forEach(function (k) { fresh[k] = tok[k]; });
  fresh.access = r.json.access_token; fresh.refresh = r.json.refresh_token || tok.refresh; fresh.expiresAt = Date.now() + (+r.json.expires_in || 21600) * 1000; fresh.refreshedAt = Date.now();
  // the old refresh token no longer works, so the new one is saved straight away (tried a few times; the old record
  // stays until the new one is in, and if it can't be, the new one waits in TOKEN_NEXT)
  var saved = false;
  for (var i = 0; i < 3 && !saved; i++) { try { bankSet_(bankKey_("TOKEN", p), fresh); saved = (bankGet_(bankKey_("TOKEN", p)) || {}).refresh === fresh.refresh; } catch (e) { Utilities.sleep && Utilities.sleep(200); } }
  if (!saved) { try { bankSet_(bankKey_("TOKEN_NEXT", p), fresh); } catch (e) {} }
  return fresh;
}
function monzoGet_(p, path, query) {
  var tok = monzoAccess_(p), url = MONZO_API_ + path + qs_(query);
  var r = bankHttp_("get", url, {headers: {Authorization: "Bearer " + tok.access}});
  if (r.code === 401) { tok = monzoRefresh_(p, tok); r = bankHttp_("get", url, {headers: {Authorization: "Bearer " + tok.access}}); }
  return bankCheck_(r, "monzo");
}

// ---------- Monzo: reading ----------
function bankMinor_(v) { return Math.round(+v || 0) / 100; }
function bankDate_(iso) { var d = new Date(iso); return isNaN(d.getTime()) ? "" : Utilities.formatDate(d, tz_(), "yyyy-MM-dd"); }
// how far back to read: everything (first import), 89 days (after a pot or Space is mapped), or the last 35 days
function bankSince_(full, wide) { return full ? null : new Date(Date.now() - (wide ? BANK_WIDE_DAYS_ : BANK_RECENT_DAYS_) * BANK_DAY_); }
function monzoRead_(p, full, wide) {
  var out = {provider: "monzo", accounts: [], txns: []};
  var accounts = (monzoGet_(p, "/accounts").accounts || []).filter(function (a) { return a && a.id && !a.closed; });
  accounts.forEach(function (a) {
    var kind = /flex|loan|credit/i.test(String(a.type || "")) ? "credit" : "main";
    var bal = monzoGet_(p, "/balance", {account_id: a.id});
    out.accounts.push({extId: a.id, name: a.description && !/^user_/.test(a.description) ? a.description : (kind === "credit" ? "Monzo Flex" : "Monzo current account"), kind: kind, balance: bankMinor_(bal.balance)});
    var pots = [];
    if (kind === "main") { try { pots = monzoGet_(p, "/pots", {current_account_id: a.id}).pots || []; } catch (e) { if (e.bank !== "missing") throw e; } }
    pots.forEach(function (x) { if (x && x.id && !x.deleted) out.accounts.push({extId: x.id, name: x.name || "Pot", kind: "pot", balance: bankMinor_(x.balance)}); });
    var q = {account_id: a.id, limit: 100, "expand[]": "merchant"};
    var since = bankSince_(full, wide); if (since) q.since = since.toISOString();
    for (var page = 0; page < 300; page++) {
      var list = monzoGet_(p, "/transactions", q).transactions || [];
      list.forEach(function (t) { var n = monzoTxn_(t, a.id); if (n) out.txns.push(n); });
      if (list.length < 100) break;
      q.since = list[list.length - 1].id;   // Monzo pages by "since the last id"
    }
  });
  return out;
}
function monzoTxn_(t, accId) {
  if (!t || !t.id || !t.created) return null;
  var meta = t.metadata || {}, merchant = t.merchant && typeof t.merchant === "object" ? t.merchant : null;
  var pot = meta.pot_id || (/^pot_/.test(String(t.description || "")) ? String(t.description) : "");
  var minor = Math.round(+t.amount || 0);
  return {
    id: String(t.id), acc: accId, date: bankDate_(t.created), amount: -minor / 100, pending: !t.settled, declined: !!t.decline_reason,
    name: (merchant && merchant.name) || (t.counterparty && t.counterparty.name) || (pot ? "" : String(t.description || "")),
    category: String(t.category || ""), pot: pot, card: !!t.merchant, load: !!t.is_load
  };
}

// ---------- Starling ----------
function starlingSetToken_(me, b) {
  var token = String(b.token || "").trim();
  if (!token || token.length < 20 || token.length > 4000 || /\s/.test(token)) return {ok: false, error: "That doesn't look like a Starling access token."};
  var tok = bankGet_(bankKey_("TOKEN", me)); if (tok) return {ok: false, error: "Disconnect " + BANK_NAMES_[tok.provider] + " first."};
  var chk = starlingScopes_(token);
  if (!chk.ok) return {ok: false, error: chk.error};
  bankSet_(bankKey_("TOKEN", me), {provider: "starling", access: token, scopes: chk.scopes, issuedAt: Date.now()});
  bankSaveStatus_(me, {provider: "starling", accounts: [], lastSync: 0, lastError: "", fullDone: false, scopeCheckedAt: Date.now()});
  bankNotify_(me, "Starling was connected");
  // the token is fine and kept; if the first read fails, the next one (every 15 minutes, or Sync now) tries again
  var res = bankRun_(me);
  return res.ok ? {ok: true} : {ok: true, note: res.error};
}
// what a Starling token can do: only the read scopes Budgie uses, each one exactly
function starlingScopes_(token) {
  var r = bankHttp_("get", STARLING_API_ + "/api/v2/identity/token", {headers: {Authorization: "Bearer " + token, Accept: "application/json"}});
  if (r.code === 401 || r.code === 403) return {ok: false, gone: true, error: "Starling didn't accept that token. Check you copied all of it."};
  if (r.code !== 200 || !r.json) return {ok: false, error: "Couldn't check that token with Starling (" + r.code + "). Try again in a minute."};
  var scopes = r.json.scopes;
  if (!Array.isArray(scopes) || !scopes.length) return {ok: false, error: "Starling didn't say what that token can do, so Budgie can't be sure it's read-only. Make a new token with only the read boxes ticked."};
  var extra = scopes.filter(function (s) { return typeof s !== "string" || !/^[a-z-]+:read$/.test(s) || STARLING_OK_.indexOf(s) < 0; });
  if (extra.length) return {ok: false, error: "That token can do more than Budgie needs (" + extra.map(String).join(", ").slice(0, 200) + "). For safety make a new one with only these boxes ticked: " + STARLING_OK_.join(", ") + "."};
  var missing = STARLING_NEED_.filter(function (s) { return scopes.indexOf(s) < 0; });
  if (missing.length) return {ok: false, error: "That token is missing " + missing.join(", ") + ". Make a new one with those boxes ticked too."};
  return {ok: true, scopes: scopes.slice().sort()};
}
function starlingGet_(p, path, query, optional) {
  var tok = bankGet_(bankKey_("TOKEN", p)); if (!tok || tok.provider !== "starling") throw bankErr_("reconnect", "Starling isn't connected");
  var r = bankHttp_("get", STARLING_API_ + path + qs_(query), {headers: {Authorization: "Bearer " + tok.access, Accept: "application/json"}});
  // something the token wasn't given a box for (Spaces, say) is skipped rather than treated as a broken connection
  if (optional && (r.code === 403 || r.code === 404)) return null;
  return bankCheck_(r, "starling");
}
function starlingRead_(p, full, wide) {
  var out = {provider: "starling", accounts: [], txns: []}, now = new Date();
  var accounts = (starlingGet_(p, "/api/v2/accounts").accounts || []).filter(function (a) { return a && a.accountUid; });
  accounts.forEach(function (a) {
    var uid = a.accountUid, bal = starlingGet_(p, "/api/v2/accounts/" + encodeURIComponent(uid) + "/balance") || {};
    var money = function (x) { return x && x.minorUnits !== undefined ? bankMinor_(x.minorUnits) : null; };
    var b = money(bal.effectiveBalance); if (b === null) b = money(bal.clearedBalance); if (b === null) b = money(bal.amount);
    out.accounts.push({extId: uid, name: a.name || (a.accountType === "PRIMARY" ? "Starling account" : "Starling " + String(a.accountType || "account").toLowerCase()), kind: "main", balance: b || 0});
    var spaces = {}, cats = [a.defaultCategory], catExt = {};
    var goals = starlingGet_(p, "/api/v2/account/" + encodeURIComponent(uid) + "/savings-goals", null, true);
    ((goals && (goals.savingsGoalList || goals.savingsGoals)) || []).forEach(function (g) {
      var id = g.savingsGoalUid || g.uid; if (!id || /RESTORING|DELETED/i.test(String(g.state || ""))) return;
      spaces[id] = true; out.accounts.push({extId: id, name: g.name || "Space", kind: "space", balance: money(g.totalSaved) || 0});
    });
    var sp = starlingGet_(p, "/api/v2/account/" + encodeURIComponent(uid) + "/spaces", null, true);
    ((sp && sp.spendingSpaces) || []).forEach(function (s) {
      var id = s.spaceUid || s.categoryUid; if (!id || spaces[id]) return;
      spaces[id] = true; out.accounts.push({extId: id, name: s.name || "Space", kind: "space", balance: money(s.balance) || 0}); cats.push(s.categoryUid || id);
      catExt[s.categoryUid || id] = id;
    });
    ((sp && sp.savingsGoals) || []).forEach(function (g) { var id = g.savingsGoalUid || g.uid; if (id && !spaces[id]) { spaces[id] = true; out.accounts.push({extId: id, name: g.name || "Space", kind: "space", balance: money(g.totalSaved) || 0}); } });
    // the feed, in 90-day windows (all of it the first time, the last two weeks after that)
    var from = full ? new Date(a.createdAt && !isNaN(new Date(a.createdAt)) ? a.createdAt : now.getTime() - 3 * 365 * BANK_DAY_) : bankSince_(false, wide);
    cats.forEach(function (cat, ci) {
      if (!cat) return;
      var accFor = ci === 0 ? uid : cat;   // a spending Space's payments belong to that Space
      for (var t0 = from.getTime(), guard = 0; t0 < now.getTime() && guard < 80; t0 += 90 * BANK_DAY_, guard++) {
        var t1 = Math.min(now.getTime(), t0 + 90 * BANK_DAY_);
        var feed = starlingGet_(p, "/api/v2/feed/account/" + encodeURIComponent(uid) + "/category/" + encodeURIComponent(cat) + "/transactions-between",
          {minTransactionTimestamp: new Date(t0).toISOString(), maxTransactionTimestamp: new Date(t1).toISOString()}, ci > 0);
        // a payment belongs to the Space whose category it's in, when Starling says so (else to where it was read from)
        ((feed && feed.feedItems) || []).forEach(function (f) { var n = starlingTxn_(f, f.categoryUid && catExt[f.categoryUid] ? catExt[f.categoryUid] : f.categoryUid === a.defaultCategory ? uid : accFor, spaces); if (n) out.txns.push(n); });
      }
    });
  });
  return out;
}
function starlingTxn_(f, accId, spaces) {
  if (!f || !f.feedItemUid) return null;
  var status = String(f.status || "").toUpperCase(), dir = String(f.direction || "").toUpperCase(), minor = Math.round(+((f.amount || {}).minorUnits) || 0);
  if (/^(UPCOMING|ACCOUNT_CHECK)$/.test(status)) return null;
  var pot = spaces[f.counterPartyUid] && /INTERNAL_TRANSFER/i.test(String(f.source || "")) || (spaces[f.counterPartyUid] && /SAVINGS_GOAL|CATEGORY|SPACE/i.test(String(f.counterPartyType || ""))) ? f.counterPartyUid : "";
  return {
    id: String(f.feedItemUid), acc: accId, date: bankDate_(f.transactionTime || f.settlementTime || f.updatedAt), amount: (dir === "IN" ? -1 : 1) * minor / 100,
    pending: status === "PENDING", declined: status === "DECLINED", reversed: status === "REVERSED",
    name: pot ? "" : String(f.counterPartyName || f.reference || ""), category: String(f.spendingCategory || "").toLowerCase(), pot: pot,
    card: /MASTER_CARD|CARD/i.test(String(f.source || "")), load: false
  };
}

// ---------- mapping ----------
function bankMap_(me, b) {
  var extId = String(b.extId || ""), acc = b.account === null || b.account === undefined ? "" : String(b.account);
  var s = bankStatus_(me);
  if (!extId || !(s.accounts || []).some(function (a) { return a.extId === extId; })) return {ok: false, error: "That isn't one of your bank accounts."};
  if (acc) { var a = byId_("accounts", acc); if (!a || a.owner !== me || bankTrue_(a.deleted)) return {ok: false, error: "That isn't one of your accounts in Budgie."}; }
  var lock = LockService.getScriptLock(); lock.waitLock(25000);
  try { applyOne_(me, {op: "put", table: "settings", row: {id: me + ":bank.map." + extId, person: me, key: "bank.map." + extId, value: acc}}, Date.now(), me); SpreadsheetApp.flush(); }
  finally { lock.releaseLock(); }
  // the next read goes back further, so moves to a pot you've just mapped come in
  var s2 = bankStatus_(me); s2.wideNext = true; bankSaveStatus_(me, s2);
  return {ok: true};
}

// ---------- running an import ----------
function bankSyncNow_(me) {
  var tok = bankGet_(bankKey_("TOKEN", me)); if (!tok) return {ok: false, error: "No bank is connected."};
  var res = bankRun_(me);
  return res.ok ? {ok: true, added: res.added, updated: res.updated} : {ok: false, error: res.error};
}
// reads the bank and writes what's new; never throws (problems go into the status)
// how far back to read is decided here, inside the lock, from the status (everything until the first full read worked)
function bankRun_(p) {
  var lock = (LockService.getDocumentLock && LockService.getDocumentLock()) || LockService.getUserLock(), s;
  if (!lock.tryLock(30000)) return {ok: false, error: "The bank is already being read. Try again in a minute."};
  try {
    var tok = bankGet_(bankKey_("TOKEN", p)); if (!tok) return {ok: false, error: "No bank is connected."};
    s = bankStatus_(p);
    if (s.backoffUntil && s.backoffUntil > Date.now()) return {ok: false, error: BANK_NAMES_[tok.provider] + " asked Budgie to wait. It'll try again soon."};
    // a Starling token is checked once a day: if what it can do has changed, it's disconnected
    if (tok.provider === "starling" && !(s.scopeCheckedAt > Date.now() - BANK_SCOPE_CHECK_)) {
      var chk = starlingScopes_(tok.access);
      if (chk.gone) throw bankErr_("reconnect", "Starling needs reconnecting");
      if (chk.ok && JSON.stringify(chk.scopes) === JSON.stringify((tok.scopes || []).slice().sort())) { s.scopeCheckedAt = Date.now(); bankSaveStatus_(p, s); }
      else if (chk.ok || /more than Budgie needs|missing|didn't say/.test(chk.error)) {
        var why = "Starling's token can do something different now, so Budgie disconnected it. Make a new read-only token to connect again.";
        bankDisconnect_(p, why); return {ok: false, error: why};
      }
    }
    var full = !s.fullDone, wide = !!s.wideNext, note = "", data;
    var read = function (f, w) { return tok.provider === "monzo" ? monzoRead_(p, f, w) : starlingRead_(p, f, w); };
    try { data = read(full, wide); }
    catch (e) {
      // Monzo only gives the whole history in the first minutes after approval; later, the last 90 days
      var since = tok.approvedAt || tok.issuedAt || 0;
      if (!(full && tok.provider === "monzo" && e && e.bank === "reconnect" && since && Date.now() > since + BANK_HISTORY_WINDOW_)) throw e;
      data = read(false, true); note = "Monzo only lets Budgie read the last 90 days now";
    }
    var windowFrom = full && !note ? "" : bankDate_(bankSince_(false, wide || !!note).toISOString());
    var res = bankApply_(p, data, windowFrom);
    s = bankStatus_(p);
    s.provider = tok.provider; s.accounts = data.accounts; s.lastSync = Date.now(); s.lastError = ""; s.needsReconnect = false; s.backoffUntil = 0; s.backoffN = 0;
    if (full) s.fullDone = true;
    if (wide) s.wideNext = false;
    if (note) s.note = note;
    if (s.waiting) { s.waiting = false; tok = bankGet_(bankKey_("TOKEN", p)); if (tok && !tok.approvedAt) { tok.approvedAt = Date.now(); bankSet_(bankKey_("TOKEN", p), tok); } }
    bankSaveStatus_(p, s);
    return {ok: true, added: res.added, updated: res.updated};
  } catch (e) {
    s = bankStatus_(p);
    var msg = bankScrub_(p, e && e.message || e);
    if (e && e.bank === "reconnect") {
      // waiting for the first approval in the Monzo app is expected for a few minutes
      if (s.waiting && s.firstUntil > Date.now()) { s.lastError = "Waiting for you to approve Budgie in the Monzo app."; }
      else { s.needsReconnect = true; s.waiting = false; s.lastError = msg; }
    } else if (e && e.bank === "backoff") {
      s.backoffN = Math.min(6, (s.backoffN || 0) + 1);
      s.backoffUntil = Date.now() + Math.max((e.retryAfter || 0) * 1000, 30 * 60000 * Math.pow(2, s.backoffN - 1));   // skips at least one poll
      s.lastError = msg;
    } else s.lastError = msg;
    bankSaveStatus_(p, s);
    return {ok: false, error: s.lastError || msg};
  } finally { lock.releaseLock(); }
}

// ---------- turning bank data into Budgie rows ----------
// store numbers and references are dropped, so "TESCO STORES 2345" and "TESCO STORES 6789" learn as one
function bankMerchantKey_(name) { return String(name || "").toLowerCase().replace(/[^a-z]+/g, " ").replace(/\b(stores?|ltd|limited|plc|uk|gb|london|www|com|co)\b/g, " ").replace(/\s+/g, " ").trim(); }
var BANK_CATS_ = {
  groceries: /food|grocer/i, eating_out: /eat|takeaway|restaurant|dining|fun/i, transport: /fuel|petrol|car|transport|travel/i,
  fuel: /fuel|petrol|car/i, entertainment: /fun|entertain|going out/i, shopping: /household|home|shopping|fun/i, lifestyle: /fun|personal/i,
  personal_care: /personal|fun/i, holidays: /holiday|travel/i, gifts: /gift|christmas|birthday/i, family: /family|gift/i, home: /household|home/i,
  bills: /bill/i, bills_and_services: /bill/i, charity: /charity|gift/i, pets: /pet/i
};
function bankGuess_(db, p, name, category, date) {
  var rule = Budgie.setting(db, p, "bank.rule." + bankMerchantKey_(name), "");
  if (rule) {
    var parts = String(rule).split("|"), b = db.byId[parts[0]], sp = parts[1] ? db.byId[parts[1]] : null;
    // the split is only a hint until you confirm the payment (splitting shares it with your partner)
    if (b && b.person === p && db.budgets.indexOf(b) >= 0) return {budget: b.id, split: "", splitHint: sp && db.splits.indexOf(sp) >= 0 ? sp.id : ""};
  }
  var re = BANK_CATS_[String(category || "").toLowerCase()];
  if (re) {
    var buds = Budgie.budgetsIn(db, p, Budgie.periodAt(db, p, date)).filter(function (b) { return b.mode !== "saving"; });
    for (var i = 0; i < buds.length; i++) if (re.test(String(buds[i].name))) return {budget: buds[i].id, split: "", splitHint: ""};
  }
  return {budget: "", split: "", splitHint: ""};
}
// windowFrom: the first date this read covered ("" for everything), so a pending payment that has vanished from it
// can be told apart from one that's simply older than the read
function bankApply_(p, data, windowFrom) {
  var lock = LockService.getScriptLock(); lock.waitLock(25000);
  try {
    CACHE_ = {};
    var today = Utilities.formatDate(new Date(), tz_(), "yyyy-MM-dd"), db = Budgie.load(allTables_(), today);
    var provider = data.provider, label = BANK_NAMES_[provider], main = Budgie.mainOf(db, p), st = Budgie.startOf(db, p), D = Budgie;
    var extKind = {}; data.accounts.forEach(function (a) { extKind[a.extId] = a.kind; });
    // until it's mapped, the bank's first current account stands for your main account (any others wait to be mapped)
    var primary = (data.accounts.filter(function (a) { return a.kind === "main"; })[0] || {}).extId;
    // where each bank account goes: a Budgie account, "" to ignore it, or not set yet
    var maps = {}; db.settings.forEach(function (r) { if (r.person === p && /^bank\.map\./.test(String(r.key))) maps[String(r.key).slice(9)] = String(r.value === undefined || r.value === null ? "" : r.value); });
    var accOf = function (ext, forPayment) {
      if (maps.hasOwnProperty(ext)) { var id = maps[ext]; return id && db.byId[id] && db.byId[id].owner === p ? id : null; }
      return ext === primary || (forPayment && extKind[ext] !== "main") ? main : null;
    };
    var rawTx = readTable_("transactions").rows, byBank = {}, byIdRow = {};
    rawTx.forEach(function (r) { if (r.bankId) byBank[String(r.bankId)] = r; byIdRow[r.id] = r; });
    var moveRows = {}; readTable_("moves").rows.forEach(function (r) { moveRows[r.id] = r; });
    var used = {}, usedOcc = {}, newRows = {transactions: [], moves: [], valuations: [], exceptions: []}, updates = [];
    var near = function (a, b) { return Math.abs(a - b) <= 0.0105; };
    var update = function (t, id, fields) { updates.push({t: t, row: Object.assign({id: id}, fields)}); };
    var create = function (t, row) { newRows[t].push(row); };
    var st0 = bankStatus_(p), pending = st0.pending || {}, seen = {};

    // a planned payday move this matches (to the same place, same amount, within 7 days after payday)
    // the plan can have moved on a little since payday (a bill came in higher), so if nothing matches to the penny,
    // the one planned move to that place within 10% counts
    var paydayMatch = function (to, amount, date, kindRe) {
      var per = D.periodAt(db, p, date), cands = [per, D.prevPeriod(db, p, per)], hit = null, close = [];
      cands.forEach(function (pk) {
        if (hit || !pk || !pk.pay || pk.opening) return; var dd = D.diff(pk.start, date); if (dd < 0 || dd > 7) return;
        D.payday(db, p, pk).moves.forEach(function (m) {
          if (hit) return; var acc = db.byId[m.to] || {};
          if (!(to ? m.to === to : kindRe.test(String(acc.kind)))) return;
          var h = {key: "pay:" + pk.start + ":" + m.to, to: m.to, start: pk.start};
          if (near(m.amount, amount)) hit = h; else if (Math.abs(m.amount - amount) <= m.amount * 0.1) close.push(h);
        });
      });
      return hit || (close.length === 1 ? close[0] : null);
    };
    var putMove = function (t, from, to, amount, key, review, note) {
      var id = "bk-" + provider + "-" + t.id, ex = moveRows[id];
      if (ex && ex.person !== p) { Logger.log("Bank feed skipped moves " + id + ": it isn't " + p + "'s."); return; }
      if (ex) { if (!bankTrue_(ex.deleted) && (!near(+ex.amount, amount) || ex.from !== from || ex.to !== to)) update("moves", id, {amount: amount, from: from, to: to}); return; }
      // already ticked in the app: nothing new to add
      if (key && /^pay:/.test(key) && db.moveKeys[key]) return;
      create("moves", {id: id, date: /^pay:/.test(key) ? D.moveDate(key, t.date) : t.date, person: p, from: from, to: to, amount: amount, key: key, note: note || "", review: !!review});
    };
    // a bill, a regular payment to your partner, or a payment you've already logged between you two
    var plannedOut = function (t, needName) {
      var a = t.amount, win = function (item) { return D.occurrences(db, item, D.addDays(t.date, -3), D.addDays(t.date, 4)); }, hit = null;
      db.bills.forEach(function (b) {
        if (hit || b.person !== p) return;
        win(b).forEach(function (o) {
          if (hit || usedOcc[o.key]) return;
          var base = D.amountAt(db, b, o.orig), nameHit = bankMerchantKey_(t.name).split(" ").some(function (w) { return w.length > 2 && bankMerchantKey_(b.name).split(" ").indexOf(w) >= 0; });
          if (needName && !nameHit) return;   // a card payment only counts as a bill if the names agree (a subscription, say)
          if (near(a, o.amount) || near(a, base) || (b.variable && nameHit && Math.abs(a - base) <= base * 0.5)) hit = {kind: "bill", item: b, occ: o};
        });
      });
      if (!hit && needName) return null;
      if (!hit) db.transfers.forEach(function (tr) { if (!hit && tr.from === p) win(tr).forEach(function (o) { if (!hit && !usedOcc[o.key] && near(a, o.amount)) hit = {kind: "transfer", occ: o}; }); });
      if (!hit) db.settlements.forEach(function (s) { if (!hit && s.from === p && !usedOcc["set:" + s.id] && near(a, +s.amount) && Math.abs(D.diff(s.date, t.date)) <= 2) hit = {kind: "settlement", occ: {key: "set:" + s.id}}; });
      return hit;
    };
    var payIn = function (t) {
      var a = -t.amount, best = null;
      db.income.forEach(function (i) {
        if (i.person !== p || !i.isPay) return;
        D.occurrences(db, i, D.addDays(t.date, -3), D.addDays(t.date, 4)).forEach(function (o) {
          var base = D.amountAt(db, i, o.orig);
          if (usedOcc[o.key] || Math.abs(a - base) > base * 0.5) return;   // only something pay-sized counts as the pay
          if (!best || Math.abs(D.diff(o.date, t.date)) < Math.abs(D.diff(best.o.date, t.date))) best = {i: i, o: o};
        });
      });
      return best;
    };
    // the bank's own change to one date: its id names the person, and one with that id for another item isn't used
    var exception = function (itemId, orig, amount, note) {
      var id = "x-" + itemId + "-" + orig + "-bank-" + p, ex = byId_("exceptions", id);
      if (ex && ex.item !== itemId) { Logger.log("Bank feed skipped " + id + ": that id is already used for something else."); return; }
      if (ex) { if (!near(+ex.amount, amount)) update("exceptions", id, {amount: amount, deleted: false}); }
      else create("exceptions", {id: id, item: itemId, date: orig, action: "amount", amount: amount, note: note});
    };

    data.txns.slice().sort(function (x, y) { return x.date < y.date ? -1 : x.date > y.date ? 1 : 0; }).forEach(function (t) {
      if (!t.date) return;
      seen[t.id] = true;
      var mine = byBank[t.id] || byIdRow["bk-" + provider + "-" + t.id];
      // a row with the bank's id that isn't this person's (typed into the sheet by someone else): left alone
      if (mine && mine.person !== p && !(mine.source === "peckish" && mine.bankId === t.id)) { Logger.log("Bank feed skipped transactions " + mine.id + ": it isn't " + p + "'s."); return; }
      // a pending hold that went to nothing, or a payment refused or reversed: drop the row the bank added
      if (t.declined || t.reversed || (!t.amount && t.pending !== undefined && (t.pending || pending[t.id]))) {
        delete pending[t.id];
        if (mine && /^bk-/.test(mine.id) && !bankTrue_(mine.deleted) && (t.reversed || !t.amount || bankTrue_(mine.review))) update("transactions", mine.id, {deleted: true});
        return;
      }
      if (!t.amount) return;
      if (t.pending) pending[t.id] = {date: t.date}; else delete pending[t.id];
      var ext = t.acc;
      // a move between the account and a pot or Space
      if (t.pot) {
        var potAcc = accOf(t.pot, false), mainAcc = accOf(ext, false);
        if (!potAcc || !mainAcc) return;   // not mapped yet: it's listed in the status so it can be
        var into = t.amount > 0, from = into ? mainAcc : potAcc, to = into ? potAcc : mainAcc, amt = Math.abs(t.amount);
        var pm = into ? paydayMatch(to, amt, t.date) : null;
        putMove(t, from, to, amt, pm ? pm.key : "bank:" + t.id, false);
        return;
      }
      var acc = accOf(ext, true); if (!acc) return;   // an account set to be ignored
      if (t.amount > 0) {
        // money going out: Moneybox, a planned bill or transfer, or a payment
        if (/moneybox/i.test(t.name)) {
          var lisaB = null; db.budgets.forEach(function (b) { if (!lisaB && b.person === p && b.mode === "saving" && /lisa/.test(String((db.byId[b.account] || {}).kind))) lisaB = b; });
          var pmx = paydayMatch(null, t.amount, t.date, /lisa|isa/);
          var lisaAcc = D.accountsOf(db, p).filter(function (a) { return a.kind === "lisa"; })[0], isaAcc = D.accountsOf(db, p).filter(function (a) { return a.kind === "isa"; })[0];
          if (pmx) { putMove(t, acc, pmx.to, t.amount, pmx.key, false, t.name); return; }
          var target = lisaB && near(D.amountAt(db, lisaB, t.date), t.amount) && lisaAcc ? lisaAcc : (isaAcc || lisaAcc);
          if (target) { putMove(t, acc, target.id, t.amount, "bank:" + t.id, true, t.name); return; }
        }
        {
          var po = mine ? null : plannedOut(t, t.card);
          if (po) {
            usedOcc[po.occ.key] = true;
            if (po.kind === "bill" && !near(t.amount, po.occ.amount)) exception(po.item.id, po.occ.orig, t.amount, "from " + label);
            return;
          }
        }
      } else {
        // money coming in: a refund counts against its budget; your pay is checked against what was expected
        if (!t.card) {
          if (mine) return;
          var pi = payIn(t);
          if (pi) { usedOcc[pi.o.key] = true; if (!near(-t.amount, pi.o.amount)) exception(pi.i.id, pi.o.orig, -t.amount, "from " + label); }
          return;   // other money in (Sophie's share, a friend paying you back) is already planned or isn't spending
        }
      }
      // a payment (or card refund)
      if (mine) {
        if (bankTrue_(mine.deleted)) return;
        var f = {}, confirmed = !bankTrue_(mine.review);
        if (!near(+mine.amount, t.amount)) f.amount = t.amount;      // a pending payment settled at a different amount
        if (!confirmed) { if (mine.account !== acc && /^bk-/.test(mine.id)) f.account = acc;   // the account was mapped since
          if (!mine.note && t.name) f.note = t.name; if (!mine.budget) { var g0 = bankGuess_(db, p, t.name, t.category, t.date); if (g0.budget) { f.budget = g0.budget; if (!mine.split && g0.splitHint) f.splitHint = g0.splitHint; } } }
        if (Object.keys(f).length) update("transactions", mine.id, f);
        return;
      }
      // the same payment logged by hand (to the penny, within 2 days) or by Peckish (a shop's estimate: within 15% or
      // £5, within 3 days, best if the shop's name matches): link it instead of adding it twice
      var dupe = null, words = bankMerchantKey_(t.name).split(" ").filter(function (w) { return w.length > 2; });
      rawTx.forEach(function (r) {
        if (r.bankId || used[r.id] || bankTrue_(r.deleted) || /^bk-/.test(r.id) || !(t.amount > 0)) return;
        var pk = r.source === "peckish", a = +r.amount || 0, dd = Math.abs(D.diff(D.parseDate(r.date), t.date));
        // a shop split half in Peckish can be linked to whichever of you paid it
        if (r.person !== p && !(pk && r.split && partnerOf_(p) === r.person && D.shareOf(db, r.split, p, 100, r.person) === 50)) return;
        if (pk ? (dd > 3 || Math.abs(a - t.amount) > Math.max(5, t.amount * 0.15)) : (dd > 2 || !near(a, t.amount))) return;
        var nameHit = words.some(function (w) { return bankMerchantKey_(r.note).split(" ").indexOf(w) >= 0; });
        var score = (nameHit ? 0 : 10) + dd + Math.abs(a - t.amount) / 100;
        if (!dupe || score < dupe.score) dupe = {r: r, score: score};
      });
      if (dupe) {
        used[dupe.r.id] = true; byBank[t.id] = dupe.r;
        var link = {bankId: t.id, review: false};
        if (!near(+dupe.r.amount, t.amount)) link.amount = t.amount;
        if (dupe.r.person !== p) { link.person = p; link.account = acc; }
        update("transactions", dupe.r.id, link); return;
      }
      var g = bankGuess_(db, p, t.name, t.category, t.date);
      create("transactions", {id: "bk-" + provider + "-" + t.id, date: t.date, person: p, amount: t.amount, budget: g.budget, account: acc, split: "", splitHint: g.splitHint || "", note: t.name, source: provider, bankId: t.id,
        review: t.date >= st});   // payments from before you started Budgie are history, nothing to check
    });

    // one balance per mapped account per day
    data.accounts.forEach(function (a) {
      var acc = accOf(a.extId, false); if (!acc) return;
      var id = "bk-" + a.extId + "-" + today, ex = byId_("valuations", id), amount = a.kind === "credit" ? -Math.abs(a.balance) : a.balance;
      if (ex && (byId_("accounts", ex.account) || {}).owner !== p) { Logger.log("Bank feed skipped valuations " + id + ": it isn't " + p + "'s."); return; }
      if (ex) { if (!near(+ex.amount, amount) || ex.account !== acc) update("valuations", id, {amount: amount, account: acc}); }
      else create("valuations", {id: id, account: acc, date: today, amount: amount, note: "from " + label});
    });

    // a pending payment this read should have seen but didn't, more than a week old: the hold was dropped
    Object.keys(pending).forEach(function (id) {
      var x = pending[id]; if (seen[id] || !x || !x.date) return;
      if (windowFrom && x.date < windowFrom) return;   // older than this read: can't tell
      if (D.diff(x.date, today) <= BANK_PENDING_DROP_DAYS_) return;
      var row = byBank[id] || byIdRow["bk-" + provider + "-" + id];
      if (row && /^bk-/.test(row.id) && !bankTrue_(row.deleted)) update("transactions", row.id, {deleted: true});
      delete pending[id];
    });
    var s1 = bankStatus_(p); s1.pending = pending; bankSaveStatus_(p, s1);

    // every row on its own: one that can't be written (its id is taken) is skipped and logged, and the rest go on
    var now = Date.now(), added = 0, updated = 0;
    updates.forEach(function (u) {
      try { applyOne_(p, {op: "put", table: u.t, row: u.row}, now, "bank", {sys: true}); updated++; }
      catch (e) { Logger.log("Bank feed skipped " + u.t + " " + u.row.id + ": " + (e && e.message || e)); }
    });
    Object.keys(newRows).forEach(function (t) { added += bankAppend_(p, t, newRows[t], now); });
    SpreadsheetApp.flush();
    return {added: added, updated: updated};
  } finally { lock.releaseLock(); }
}
// new rows in one write per tab (a first import can be thousands of payments), checked like any other change
function bankAppend_(p, t, rows, now) {
  var tab = readTable_(t), sh = tab.sheet || ensureTab_(ss_(), t), head = tab.head.length ? tab.head : SCHEMA[t].concat(COMMON), seenId = {};
  rows = rows.filter(function (row) {
    var who = owner_(t, row);
    if (who !== null && who.indexOf(p) < 0) { Logger.log("Bank feed skipped " + t + " " + row.id + ": not " + p + "'s."); return false; }
    if (byId_(t, row.id) || seenId[row.id]) { Logger.log("Bank feed skipped " + t + " " + row.id + ": that id is already used."); return false; }
    seenId[row.id] = true; return true;
  });
  if (!rows.length) return 0;
  rows.forEach(function (row) {
    row.updated = now; row.by = "bank";
    Object.keys(row).forEach(function (k) { if (head.indexOf(k) < 0 && (SCHEMA[t].indexOf(k) >= 0 || COMMON.indexOf(k) >= 0)) { sh.getRange(1, head.length + 1).setValue(k); head.push(k); } });
  });
  tab.head = head;
  var first = sh.getLastRow() + 1, lines = rows.map(function (row) { return head.map(function (h) { return cell_(row[h]); }); });
  sh.getRange(first, 1, lines.length, head.length).setValues(lines);
  var idx = index_(t);
  rows.forEach(function (row, i) { var r = {_row: first + i}; Object.keys(row).forEach(function (k) { r[k] = row[k]; }); tab.rows.push(r); idx[row.id] = r; });
  return rows.length;
}

// ---------- disconnecting ----------
// why: shown in the status afterwards (when Budgie disconnected it itself)
function bankDisconnect_(me, why) {
  var tok = bankGet_(bankKey_("TOKEN", me)), had = !!tok || !!bankGet_(bankKey_("CLIENT", me));
  if (tok && tok.provider === "monzo" && tok.access) { try { bankHttp_("post", MONZO_API_ + "/oauth2/logout", {headers: {Authorization: "Bearer " + tok.access}}); } catch (e) {} }
  bankDel_(bankKey_("TOKEN", me)); bankDel_(bankKey_("TOKEN_NEXT", me)); bankDel_(bankKey_("CLIENT", me));
  bankStates_().forEach(function (x) { if (!x.v || x.v.person === me) bankDel_(x.k); });
  bankSaveStatus_(me, {provider: "", accounts: [], lastSync: 0, lastError: why || ""});
  if (had) bankNotify_(me, why ? "Budgie disconnected the bank (" + why + ")" : "the bank was disconnected");
  return {ok: true};
}

// ---------- polling (no webhooks) ----------
function bankPeople_() { return readTable_("people").rows.map(function (r) { return r.id; }).filter(function (id) { return id && bankGet_(bankKey_("TOKEN", id)); }); }
function bankPoll() {
  CACHE_ = {}; bankMoveSecrets_();
  bankPeople_().forEach(function (p) {
    var s = bankStatus_(p);
    if (s.needsReconnect || (s.backoffUntil && s.backoffUntil > Date.now())) return;
    try { bankRun_(p); } catch (e) {}
  });
}
// runs every minute only while a new Monzo connection waits to be approved, then removes itself
function bankPendingImports() {
  CACHE_ = {}; bankMoveSecrets_();
  var waiting = 0;
  bankPeople_().forEach(function (p) {
    var s = bankStatus_(p); if (!s.waiting) return;
    if (!(s.firstUntil > Date.now())) { s.waiting = false; s.needsReconnect = true; s.lastError = "Budgie wasn't approved in the Monzo app in time. Reconnect and approve it there."; bankSaveStatus_(p, s); return; }
    bankRun_(p);
    if (bankStatus_(p).waiting) waiting++;
  });
  if (!waiting) ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === "bankPendingImports") ScriptApp.deleteTrigger(t); });
}
function bankEnsureMinuteTrigger_() {
  if (ScriptApp.getProjectTriggers().some(function (t) { return t.getHandlerFunction() === "bankPendingImports"; })) return;
  ScriptApp.newTrigger("bankPendingImports").timeBased().everyMinutes(1).create();
}
function installBankTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === "bankPoll") ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger("bankPoll").timeBased().everyMinutes(15).create();
  Logger.log("Bank feeds are read every 15 minutes.");
}
