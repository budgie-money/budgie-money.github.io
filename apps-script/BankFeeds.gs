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
// a food budget, as Peckish sees one (Code.gs)
var BANK_FOOD_ = typeof APP_RULES_ !== "undefined" && APP_RULES_.peckish && APP_RULES_.peckish.food ? APP_RULES_.peckish.food : /food|grocer/i;
// Apps Script stops a run after 6 minutes. A first read of years of history stops reading after this long (from the
// start of the run), saves what it has and carries on from there a minute later, so nothing read is lost
var BANK_READ_BUDGET_ = 3.5 * 60000, BANK_MAX_PAGES_ = 300, BANK_T0_ = 0;
// and saving what was read stops making changes this long after the start, so the run ends well inside the 6 minutes
var BANK_APPLY_STOP_ = 5 * 60000;
// the minute runs that carry on a first import stop after this many failures in a row
var BANK_MINUTE_TRIES_ = 3;
// a run can't last longer than this (Apps Script stops it), so a mark older than this is from a run that was cut off
var BANK_RUN_MAX_ = 6 * 60000;
function bankStart_() { BANK_T0_ = Date.now(); }

// ---------- the only way out to a bank ----------
function bankHttp_(method, url, opts) {
  method = String(method || "get").toLowerCase(); opts = opts || {};
  // the whole address is checked: just a host (no port, no user@ part, no #), then a path and a query
  var m = String(url).match(/^https:\/\/([a-z0-9.-]+)(\/[^?#@\\\s]*)?(\?[^#\s]*)?$/), host = m ? m[1] : "";
  if (!bankHas_(BANK_HOSTS_, host)) throw bankErr_("other", "Budgie only talks to Monzo and Starling");
  var bare = "https://" + host + (m[2] || "");
  if (method !== "get" && !(method === "post" && BANK_POST_OK_.indexOf(bare) >= 0)) throw bankErr_("other", "Budgie only reads from your bank");
  var params = {method: method, muteHttpExceptions: true, followRedirects: false, headers: opts.headers || {}};
  if (opts.form) { params.payload = opts.form; params.contentType = "application/x-www-form-urlencoded"; }
  var r = UrlFetchApp.fetch(url, params), code = r.getResponseCode(), text = r.getContentText(), json = null;
  try { json = text ? JSON.parse(text) : {}; } catch (e) { json = null; }
  var headers = {}; try { headers = r.getHeaders() || {}; } catch (e) {}
  return {code: code, json: json, headers: headers};
}
// Retry-After in seconds or as a date; anything else is ignored, and it's never more than a day
function bankRetryAfter_(h) {
  h = h || {}; var v = String(h["Retry-After"] || h["retry-after"] || "").trim(), n = 0;
  if (/^\d+$/.test(v)) n = +v; else if (v && !isNaN(Date.parse(v))) n = (Date.parse(v) - Date.now()) / 1000;
  return isFinite(n) ? Math.min(86400, Math.max(0, Math.round(n))) : 0;
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
  if (r.code === 429) throw bankErr_("backoff", name + " asked Budgie to slow down", {retryAfter: bankRetryAfter_(r.headers)});
  if (r.code === 404) throw bankErr_("missing", name + " couldn't find that", {status: 404});
  throw bankErr_("other", name + " had a problem (" + r.code + ")", {status: r.code});
}

// ---------- secrets (the owner's User Properties) ----------
// Tokens, client secrets and sign-in states are the owner's own: the web app and the triggers run as the owner,
// so they can read them, and they never show in Project Settings. That is not a wall against editors: anyone who
// can edit the sheet can edit this script, and code they add would run as the owner. So the sheet is shared with
// nobody (see BANK-NOTES.md, "Who can see what"). The status (no secrets) is kept with the script's properties.
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
// At most a few in 6 hours for each of you, so changing the bank details over and over (with that person's key) can't
// use up the owner's 100 emails a day, which the Sunday emails need too; the first ones always go.
var BANK_NOTICES_ = 5;
function bankNotify_(p, what) {
  try {
    var cache = null, sent = 0; try { cache = CacheService.getScriptCache(); sent = +(cache.get("banknotice:" + p) || 0); } catch (e) { cache = null; }
    if (sent >= BANK_NOTICES_) return;
    try { if (cache) cache.put("banknotice:" + p, String(sent + 1), 21600); } catch (e) {}
    var to = Session.getEffectiveUser().getEmail(); if (!to) return;
    var who = (byId_("people", p) || {}).name || p, when = Utilities.formatDate(new Date(), tz_(), "d MMM yyyy 'at' HH:mm");
    MailApp.sendEmail({to: to, name: "Budgie", subject: "Budgie: " + who + "'s bank connection changed",
      body: who + "'s bank connection in Budgie: " + what + ", on " + when + "." + (sent + 1 === BANK_NOTICES_ ? " Any more changes in the next few hours won't be emailed." : "") + "\n\nIf that wasn't " + who + ", open the sheet's Apps Script and run newKey(\"" + p + "\") to change their Budgie key, then disconnect the bank in Budgie and connect it again."});
  } catch (e) {}
}
function bankKey_(kind, p) { return "BANK_" + kind + "_" + p; }   // TOKEN, CLIENT (secrets), STATUS (no secrets)
function bankStatus_(p) { return bankGet_(bankKey_("STATUS", p)) || {}; }
// A property holds at most 9 KB, and a status that can't be saved stops every read. Lots of holds waiting, or lots of
// pots with long names, could get near that, so the oldest holds stop being watched and long names are cut short first.
var BANK_STATUS_MAX_ = 8000;
function bankBytes_(v) { var t = JSON.stringify(v); try { return encodeURIComponent(t).replace(/%[0-9A-F]{2}/gi, "x").length; } catch (e) { return t.length * 3; } }
function bankFitStatus_(s) {
  if (bankBytes_(s) <= BANK_STATUS_MAX_) return s;
  ["lastError", "note"].forEach(function (k) { if (s[k]) s[k] = String(s[k]).slice(0, 200); });
  (s.payCarry || []).forEach(function (x) { if (x) x.name = String(x.name || "").slice(0, 12); });
  var cut = function (n) { if (bankBytes_(s) > BANK_STATUS_MAX_) (s.accounts || []).forEach(function (a) { if (a && a.name) a.name = Array.from(String(a.name)).slice(0, n).join(""); }); };
  cut(32);
  var pend = s.pending || {}, ids = Object.keys(pend).sort(function (a, b) { var x = String((pend[a] || {}).date || ""), y = String((pend[b] || {}).date || ""); return x < y ? 1 : x > y ? -1 : 0; });
  while (ids.length && bankBytes_(s) > BANK_STATUS_MAX_) delete pend[ids.pop()];
  cut(16); cut(6);
  return s;
}
function bankSaveStatus_(p, s) { bankSet_(bankKey_("STATUS", p), bankFitStatus_(s)); }
// anything that could be a secret is blanked out of a message before it's kept or shown
function bankScrub_(p, msg) {
  msg = String(msg || "");
  var tok = bankGet_(bankKey_("TOKEN", p)) || {}, cl = bankGet_(bankKey_("CLIENT", p)) || {};
  [tok.access, tok.refresh, cl.secret].forEach(function (s) { if (s && String(s).length > 3) msg = msg.split(String(s)).join("•••"); });
  return msg.replace(/Bearer\s+\S+/gi, "Bearer •••").replace(/(code|token|secret|refresh_token|access_token|client_secret)=[^&\s]+/gi, "$1=•••").slice(0, 300);
}
function bankRandom_() { return (Utilities.getUuid() + Utilities.getUuid()).replace(/[^A-Za-z0-9]/g, ""); }
// Which connection a token belongs to. A disconnect leaves that connection's id behind (BANK_GONE_<person>, no
// secret in it) before it deletes anything, and a refreshed or approved token is checked against it after it's
// saved, so a disconnect always wins, without relying on the lock (LockService doesn't say whether a web app's
// user lock is the same one the triggers get).
function bankConnId_(tok) { return tok ? String(tok.conn || ("legacy-" + (tok.issuedAt || 0))) : ""; }
function bankGone_(p, tok) {
  var id = bankConnId_(tok);
  if (!id || bankGet_(bankKey_("GONE", p)) !== id) return false;
  ["TOKEN", "TOKEN_NEXT"].forEach(function (k) { if (bankConnId_(bankGet_(bankKey_(k, p))) === id) bankDel_(bankKey_(k, p)); });
  return true;
}

// ---------- requests from the app ----------
// every action works only on the caller's own bank: there is no "person" parameter
function bankAction_(me, b) {
  try {
    bankStart_(); bankMoveSecrets_();
    switch (b.action) {
      case "bank.status": return {ok: true, bank: bankStatusFor_(me)};
      case "bank.monzo.setClient": return monzoSetClient_(me, b);
      case "bank.monzo.authUrl": return monzoAuthUrl_(me);
      case "bank.starling.setToken": return starlingSetToken_(me, b);
      case "bank.map": return bankMap_(me, b);
      case "bank.syncNow": return bankSyncNow_(me);
      case "bank.disconnect": return bankDisconnectLocked_(me);
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
    accounts: (s.accounts || []).map(function (a) { return {extId: a.extId, name: a.name, kind: a.kind, balance: a.balance, mappedTo: bankHas_(maps, a.extId) ? maps[a.extId] : null}; }),
    review: review
  };
}
// (a setting called bank.map.hasOwnProperty, say, can't break the reads)
function bankHas_(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }
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
  bankStateSeen_(state, true);
  bankTidyStates_();
  return {ok: true, url: MONZO_AUTH_ + qs_({client_id: cl.id, redirect_uri: redirect, response_type: "code", state: state})};
}
// A sign-in Budgie is waiting for is also noted in the script's cache (by its hash), so the sign-in page, which anyone
// can open, turns away a made-up state without reading the properties: a flood of them can't use up the owner's
// daily allowance of property reads, which every Budgie request needs. (If the cache has lost it, the sign-in says
// it has expired and you start again.)
function bankStateSeen_(state, add) {
  var cache = null; try { cache = CacheService.getScriptCache(); } catch (e) { return true; }
  if (!cache) return true;
  var k = "bankstate:" + keyHash_(state);
  try { if (add) { cache.put(k, "1", Math.ceil(BANK_STATE_LIFE_ / 1000) + 60); return true; } if (add === false) { cache.remove(k); return true; } return !!cache.get(k); } catch (e) { return true; }
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
  bankStart_();
  var expired = "<p>That sign-in link has expired or didn't come from Budgie, so nothing was connected.</p><p>Start again from the Bank screen in Budgie.</p>";
  var state = String(q.state || ""), key = "BANK_OAUTH_" + state.replace(/[^A-Za-z0-9]/g, "");
  // anyone can open this address: one that isn't a sign-in Budgie is waiting for is turned away before it can hold up
  // the bank reads (the lock), read the properties or do anything else
  if (!/^[A-Za-z0-9]{64}$/.test(state) || !bankStateSeen_(state)) return page(expired);
  var pre = bankGet_(key);
  if (!pre || pre.state !== state || !(pre.exp > Date.now())) { if (pre) bankDel_(key); return page(expired); }
  bankMoveSecrets_();
  var lock = bankLock_();
  if (!lock.tryLock(30000)) return page("<p>Budgie is busy reading your bank. Wait a minute, then open this page again (reload it).</p>");
  var p;
  try {
  var st = bankGet_(key);   // read again under the lock, so it can only be used once
  if (st) { bankDel_(key); bankStateSeen_(state, false); }   // a state works once
  if (!st || st.state !== state || !(st.exp > Date.now())) return page(expired);
  p = st.person;
  if (q.error || !q.code) return page("<p>Monzo wasn't connected. You can close this tab and try again from Budgie.</p>");
  var cl = bankGet_(bankKey_("CLIENT", p)); if (!cl) return page("<p>Monzo wasn't connected. Add your client details in Budgie first.</p>");
  // a connection that still works isn't replaced (one that needs reconnecting is)
  var old = bankGet_(bankKey_("TOKEN", p));
  if (old && !bankStatus_(p).needsReconnect) return page("<p>Monzo is already connected. To connect it again, disconnect it in Budgie first.</p>");
  var r = bankHttp_("post", MONZO_API_ + "/oauth2/token", {form: {grant_type: "authorization_code", client_id: cl.id, client_secret: cl.secret, redirect_uri: bankRedirect_(), code: String(q.code)}});
  if (r.code !== 200 || !r.json || !r.json.access_token) {
    var s0 = bankStatus_(p); s0.lastError = "Monzo didn't accept the sign-in. Try again from Budgie."; bankSaveStatus_(p, s0);
    return page("<p>Monzo didn't connect. You can close this tab and try again from Budgie.</p>");
  }
  // reconnecting has to be the same Monzo account as before (a different person's account is turned away)
  var userId = String(r.json.user_id || "");
  if (old && old.userId && userId && old.userId !== userId) {
    try { bankHttp_("post", MONZO_API_ + "/oauth2/logout", {headers: {Authorization: "Bearer " + r.json.access_token}}); } catch (e) {}
    bankNotify_(p, "someone tried to reconnect Monzo with a different Monzo account, and Budgie turned it away");
    return page("<p>That's a different Monzo account from the one Budgie was connected to, so nothing changed.</p><p>To switch accounts, disconnect Monzo in Budgie first.</p>");
  }
  // and a Monzo account that's connected for the other one of you can't be connected for this one too
  if (bankHeldByOther_(p, "monzo", userId, "")) {
    try { bankHttp_("post", MONZO_API_ + "/oauth2/logout", {headers: {Authorization: "Bearer " + r.json.access_token}}); } catch (e) {}
    bankNotify_(p, "someone tried to connect a Monzo account that's already connected for someone else in Budgie, and Budgie turned it away");
    return page("<p>That Monzo account is already connected in Budgie for someone else, so nothing changed.</p>");
  }
  var now = Date.now();
  bankSet_(bankKey_("TOKEN", p), {provider: "monzo", conn: bankRandom_().slice(0, 32), access: r.json.access_token, refresh: r.json.refresh_token || "", expiresAt: now + (+r.json.expires_in || 21600) * 1000, issuedAt: now, approvedAt: 0, userId: userId});
  var s = {provider: "monzo", waiting: true, firstUntil: now + BANK_FIRST_WINDOW_, fullDone: false, accounts: [], lastSync: 0, lastError: ""};
  // payments still waiting for you to check whether they were a shop your partner logged keep waiting
  var s9 = bankStatus_(p); if (old && s9.pending) s.pending = s9.pending;
  bankSaveStatus_(p, s);
  bankNotify_(p, "Monzo was connected");
  bankDel_(bankKey_("TOKEN_NEXT", p));
  } finally { lock.releaseLock(); }
  // Monzo only shares data once it's approved in the Monzo app, and only gives full history in the first few
  // minutes, so try now and then every minute until it works
  try { bankRun_(p); } catch (e) {}
  if (bankStatus_(p).waiting || bankStatus_(p).cursor) bankEnsureMinuteTrigger_();
  return page("<p><b>Budgie is connected to Monzo. You can close this tab.</b></p><p>If the Monzo app asks, approve Budgie there, then Budgie brings in your payments within a minute.</p>");
}
// one bank login is one person's: is this Monzo user (or Starling account holder, or token) connected for someone else?
function bankHeldByOther_(p, provider, who, access) {
  return readTable_("people").rows.some(function (r) {
    if (!r.id || r.id === p) return false;
    return ["TOKEN", "TOKEN_NEXT"].some(function (k) {
      var t = bankGet_(bankKey_(k, r.id));
      return !!t && t.provider === provider && ((!!who && (t.userId === who || t.holder === who)) || (!!access && t.access === access));
    });
  });
}
function monzoAccess_(p) {
  var tok = bankGet_(bankKey_("TOKEN", p)), next = bankGet_(bankKey_("TOKEN_NEXT", p));
  // a refreshed token that couldn't be saved in its usual place last time
  if (next && tok && next.provider === "monzo" && bankConnId_(next) === bankConnId_(tok) && (next.refreshedAt || 0) > (tok.refreshedAt || 0)) { tok = next; try { bankSet_(bankKey_("TOKEN", p), tok); bankDel_(bankKey_("TOKEN_NEXT", p)); } catch (e) {} }
  if (!tok || tok.provider !== "monzo" || bankGone_(p, tok)) throw bankErr_("reconnect", "Monzo isn't connected");
  if (!(tok.expiresAt > Date.now() + 60000)) tok = monzoRefresh_(p, tok);
  return tok;
}
function monzoRefresh_(p, tok) {
  var cl = bankGet_(bankKey_("CLIENT", p));
  if (!cl || !tok.refresh) throw bankErr_("reconnect", "Monzo needs reconnecting");
  var r = bankHttp_("post", MONZO_API_ + "/oauth2/token", {form: {grant_type: "refresh_token", client_id: cl.id, client_secret: cl.secret, refresh_token: tok.refresh}});
  if (r.code === 429) bankCheck_(r, "monzo");
  // Monzo having a bad moment isn't a broken connection: the refresh token still works, so the next poll tries again
  if (!(r.code >= 200 && r.code < 500)) throw bankErr_("other", "Monzo had a problem (" + r.code + "). Budgie tries again soon.");
  if (r.code !== 200 || !r.json || !r.json.access_token) {
    // another read refreshed it a moment ago (each refresh token works once): use the token it saved. It may still be
    // saving it (the phone's Check now and the 15-minute read aren't sure to share a lock), so look twice
    var newer = function () { var cur = bankGet_(bankKey_("TOKEN", p)); return cur && cur.provider === "monzo" && cur.refresh && cur.refresh !== tok.refresh && cur.expiresAt > Date.now() + 60000 ? cur : null; };
    var got = newer(); if (!got) { try { Utilities.sleep(3000); } catch (e) {} got = newer(); }
    if (got && !bankGone_(p, got)) return got;
    throw bankErr_("reconnect", "Monzo needs reconnecting");
  }
  var fresh = {}; Object.keys(tok).forEach(function (k) { fresh[k] = tok[k]; });
  fresh.access = r.json.access_token; fresh.refresh = r.json.refresh_token || tok.refresh; fresh.expiresAt = Date.now() + (+r.json.expires_in || 21600) * 1000; fresh.refreshedAt = Date.now();
  // disconnected (or connected again) while this was on its way: end the new session at Monzo and keep nothing
  var endIt = function () { try { bankHttp_("post", MONZO_API_ + "/oauth2/logout", {headers: {Authorization: "Bearer " + fresh.access}}); } catch (e) {} return bankErr_("reconnect", "Monzo was disconnected"); };
  if (!bankGet_(bankKey_("CLIENT", p)) || bankConnId_(bankGet_(bankKey_("TOKEN", p))) !== bankConnId_(tok) || bankGone_(p, tok)) throw endIt();
  // the old refresh token no longer works, so the new one is saved straight away (tried a few times; the old record
  // stays until the new one is in, and if it can't be, the new one waits in TOKEN_NEXT)
  var saved = false;
  for (var i = 0; i < 3 && !saved; i++) { try { bankSet_(bankKey_("TOKEN", p), fresh); saved = (bankGet_(bankKey_("TOKEN", p)) || {}).refresh === fresh.refresh; } catch (e) { Utilities.sleep && Utilities.sleep(200); } }
  if (!saved) { try { bankSet_(bankKey_("TOKEN_NEXT", p), fresh); } catch (e) {} }
  // a disconnect that landed while it was being saved
  if (bankGone_(p, fresh)) throw endIt();
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
// A first (full) read can stop part-way and carry on next time from where it got to (cursor: account id -> the last
// payment id read, or "start" for an account not read yet; accounts not in it were read to the end). If Monzo stops
// sharing older payments part-way (its 5 minutes are up), what was read is kept (out.cut) rather than thrown away.
// maxPages: how many pages a first read takes in one run, across all accounts (fewer after a run that was cut off)
function monzoRead_(p, full, wide, cursor, deadline, maxPages) {
  var out = {provider: "monzo", accounts: [], txns: [], cursor: null, cut: false, pages: 0}, resuming = !!cursor, stopped = false, cap = maxPages || BANK_MAX_PAGES_;
  // only your own current account: a joint account (your partner's card spending too) or Flex stays out
  var accounts = (monzoGet_(p, "/accounts", {account_type: "uk_retail"}).accounts || []).filter(function (a) { return a && a.id && !a.closed && (!a.type || a.type === "uk_retail"); });
  accounts.forEach(function (a) {
    var kind = /flex|loan|credit/i.test(String(a.type || "")) ? "credit" : "main";
    var bal = monzoGet_(p, "/balance", {account_id: a.id});
    out.accounts.push({extId: a.id, name: a.description && !/^user_/.test(a.description) ? a.description : (kind === "credit" ? "Monzo Flex" : "Monzo current account"), kind: kind, balance: bal && bal.balance !== undefined && bal.balance !== null ? bankMinor_(bal.balance) : null});
    var pots = [];
    if (kind === "main") { try { pots = monzoGet_(p, "/pots", {current_account_id: a.id}).pots || []; } catch (e) { if (e.bank !== "missing") throw e; } }
    pots.forEach(function (x) { if (x && x.id && !x.deleted) out.accounts.push({extId: x.id, name: x.name || "Pot", kind: "pot", balance: x.balance !== undefined && x.balance !== null ? bankMinor_(x.balance) : null}); });
    var q = {account_id: a.id, limit: 100, "expand[]": "merchant"};
    // an account a first read already went through to the end only needs its last 35 days
    var whole = full && !(resuming && cursor[a.id] === undefined);
    var since = bankSince_(whole, wide); if (since) q.since = since.toISOString();
    if (whole && resuming && cursor[a.id] !== "start") q.since = cursor[a.id];
    // out of time before this account: it starts here next time
    if (whole && (stopped || out.cut)) { (out.cursor = out.cursor || {})[a.id] = q.since && /^tx_/.test(q.since) ? q.since : "start"; return; }
    for (var page = 0; ; page++) {
      var list;
      try { list = monzoGet_(p, "/transactions", q).transactions || []; }
      catch (e) {
        // Monzo stopped sharing older payments part-way through: keep what was read
        if (whole && e && e.bank === "reconnect" && (page > 0 || /^tx_/.test(String(q.since || "")))) { out.cut = true; break; }
        throw e;
      }
      out.pages++;
      list.forEach(function (t) { var n = monzoTxn_(t, a.id); if (n) out.txns.push(n); });
      if (list.length < 100) break;
      q.since = list[list.length - 1].id;   // Monzo pages by "since the last id"
      // out of time (or pages) for this run: carry on from here next time
      if (whole && (out.pages >= cap || (deadline && Date.now() > deadline))) { stopped = true; (out.cursor = out.cursor || {})[a.id] = q.since; break; }
      if (!whole && page + 1 >= BANK_MAX_PAGES_) break;
    }
  });
  return out;
}
function monzoTxn_(t, accId) {
  if (!t || !t.id || !t.created) return null;
  var meta = t.metadata || {}, merchant = t.merchant && typeof t.merchant === "object" ? t.merchant : null;
  // (a description is only taken for a pot when it's a pot's id: a payment with a reference like "pot_luck" is a payment)
  var desc = String(t.description || ""), pot = meta.pot_id || (/^pot_[0-9A-Za-z]{16,}$/.test(desc) && /\d/.test(desc) ? desc : "");
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
  if (bankHeldByOther_(me, "starling", chk.holder, token)) {
    bankNotify_(me, "someone tried to connect a Starling account that's already connected for someone else in Budgie, and Budgie turned it away");
    return {ok: false, error: "That Starling account is already connected in Budgie for someone else."};
  }
  bankSet_(bankKey_("TOKEN", me), {provider: "starling", conn: bankRandom_().slice(0, 32), access: token, scopes: chk.scopes, holder: chk.holder, issuedAt: Date.now()});
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
  return {ok: true, scopes: scopes.slice().sort(), holder: typeof r.json.accountHolderUid === "string" ? r.json.accountHolderUid : ""};
}
// Starling turns away requests that come too quickly. A first read is many of them (a feed window per 90 days, for the
// account and each spending Space), so they're spaced out, and a short "slow down" is waited out where it happened
// instead of giving up the whole read (which, started again from scratch, would only be turned away again)
var STARLING_GAP_MS_ = 400, STARLING_TRIES_ = 4, STARLING_WAIT_MAX_S_ = 20, STARLING_FIRST_DAYS_ = 400, STARLING_LAST_ = 0;
function starlingPace_() {
  var gap = STARLING_LAST_ + STARLING_GAP_MS_ - Date.now();
  if (gap > 0) { try { Utilities.sleep(gap); } catch (e) {} }
  STARLING_LAST_ = Date.now();
}
function starlingGet_(p, path, query, optional) {
  var tok = bankGet_(bankKey_("TOKEN", p)); if (!tok || tok.provider !== "starling") throw bankErr_("reconnect", "Starling isn't connected");
  var r;
  for (var i = 0; ; i++) {
    starlingPace_();
    r = bankHttp_("get", STARLING_API_ + path + qs_(query), {headers: {Authorization: "Bearer " + tok.access, Accept: "application/json"}});
    if (r.code !== 429 || i >= STARLING_TRIES_ - 1) break;
    // (a longer wait than that is left to the next read, as before)
    var wait = bankRetryAfter_(r.headers) || 3 * (i + 1); if (wait > STARLING_WAIT_MAX_S_) break;
    try { Utilities.sleep(wait * 1000); } catch (e) { break; }
  }
  // something the token wasn't given a box for (Spaces, say) is skipped rather than treated as a broken connection
  if (optional && (r.code === 403 || r.code === 404)) return null;
  return bankCheck_(r, "starling");
}
function starlingRead_(p, full, wide) {
  var out = {provider: "starling", accounts: [], txns: []}, now = new Date();
  // pounds only: a euro or dollar account's amounts would be read as pounds
  var accounts = (starlingGet_(p, "/api/v2/accounts").accounts || []).filter(function (a) { return a && a.accountUid && (!a.currency || String(a.currency).toUpperCase() === "GBP"); });
  accounts.forEach(function (a) {
    var uid = a.accountUid, bal = starlingGet_(p, "/api/v2/accounts/" + encodeURIComponent(uid) + "/balance") || {};
    var money = function (x) { return x && x.minorUnits !== undefined ? bankMinor_(x.minorUnits) : null; };
    var b = money(bal.effectiveBalance); if (b === null) b = money(bal.clearedBalance); if (b === null) b = money(bal.amount);
    out.accounts.push({extId: uid, name: a.name || (a.accountType === "PRIMARY" ? "Starling account" : "Starling " + String(a.accountType || "account").toLowerCase()), kind: "main", balance: b});
    // spaces: every uid a Space goes by (its own and its category's) -> the Space; own: the account's own uids
    var spaces = {}, cats = [a.defaultCategory], catExt = {}, own = {};
    own[uid] = true; if (a.defaultCategory) own[a.defaultCategory] = true;
    var goals = starlingGet_(p, "/api/v2/account/" + encodeURIComponent(uid) + "/savings-goals", null, true);
    ((goals && (goals.savingsGoalList || goals.savingsGoals)) || []).forEach(function (g) {
      var id = g.savingsGoalUid || g.uid; if (!id || /RESTORING|DELETED/i.test(String(g.state || ""))) return;
      spaces[id] = id; out.accounts.push({extId: id, name: g.name || "Space", kind: "space", balance: money(g.totalSaved)});
    });
    var sp = starlingGet_(p, "/api/v2/account/" + encodeURIComponent(uid) + "/spaces", null, true);
    ((sp && sp.spendingSpaces) || []).forEach(function (s) {
      var id = s.spaceUid || s.categoryUid; if (!id || bankHas_(spaces, id)) return;
      spaces[id] = id; if (s.categoryUid) spaces[s.categoryUid] = id;
      out.accounts.push({extId: id, name: s.name || "Space", kind: "space", balance: money(s.balance)}); cats.push(s.categoryUid || id);
      catExt[s.categoryUid || id] = id;
    });
    ((sp && sp.savingsGoals) || []).forEach(function (g) { var id = g.savingsGoalUid || g.uid; if (id && !bankHas_(spaces, id)) { spaces[id] = id; out.accounts.push({extId: id, name: g.name || "Space", kind: "space", balance: money(g.totalSaved)}); } });
    // the feed, in 90-day windows (all of it the first time, the last two weeks after that)
    // (the first time, the last 400 days at most: enough for a year's trends, and far fewer requests than all of it)
    var first = now.getTime() - STARLING_FIRST_DAYS_ * BANK_DAY_, made = a.createdAt && !isNaN(new Date(a.createdAt)) ? new Date(a.createdAt).getTime() : first;
    var from = full ? new Date(Math.max(first, made)) : bankSince_(false, wide);
    cats.forEach(function (cat, ci) {
      if (!cat) return;
      var accFor = ci === 0 ? uid : cat;   // a spending Space's payments belong to that Space
      for (var t0 = from.getTime(), guard = 0; t0 < now.getTime() && guard < 80; t0 += 90 * BANK_DAY_, guard++) {
        var t1 = Math.min(now.getTime(), t0 + 90 * BANK_DAY_);
        var feed = starlingGet_(p, "/api/v2/feed/account/" + encodeURIComponent(uid) + "/category/" + encodeURIComponent(cat) + "/transactions-between",
          {minTransactionTimestamp: new Date(t0).toISOString(), maxTransactionTimestamp: new Date(t1).toISOString()}, ci > 0);
        // a payment belongs to the Space whose category it's in, when Starling says so (else to where it was read from)
        ((feed && feed.feedItems) || []).forEach(function (f) { var at = f.categoryUid && bankHas_(catExt, f.categoryUid) ? catExt[f.categoryUid] : f.categoryUid === a.defaultCategory ? uid : accFor, n = starlingTxn_(f, at, spaces, own, at !== uid); if (n) out.txns.push(n); });
      }
    });
  });
  return out;
}
// A move between the account and one of its Spaces is listed in both feeds. The account's side (or, between two
// Spaces, the side it left from) is the move; the other side is left out, so it's never also a payment, or money in
// that could be taken for the pay. A move to a Space Budgie can't see (a box not ticked) isn't spending either.
// fromSpace: read from a spending Space's own feed (accId is that Space)
function starlingTxn_(f, accId, spaces, own, fromSpace) {
  if (!f || !f.feedItemUid) return null;
  var status = String(f.status || "").toUpperCase(), dir = String(f.direction || "").toUpperCase(), minor = Math.round(+((f.amount || {}).minorUnits) || 0);
  if (/^(UPCOMING|ACCOUNT_CHECK)$/.test(status)) return null;
  own = own || {};
  var cp = String(f.counterPartyUid || ""), internal = /INTERNAL_TRANSFER/i.test(String(f.source || "")), toSpaceType = /SAVINGS_GOAL|CATEGORY|SPACE/i.test(String(f.counterPartyType || ""));
  var other = cp && bankHas_(spaces, cp) && spaces[cp] !== accId ? spaces[cp] : "";
  var pot = other && (internal || toSpaceType) ? other : "";
  if (fromSpace && (internal || other || own[cp]) && !(pot && dir === "OUT")) return null;
  if (!pot && internal && (own[cp] || toSpaceType)) return null;
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
  // (one taken off in the sheet is brought back: it's the mapping you've just chosen)
  try { applyOne_(me, {op: "put", table: "settings", row: {id: me + ":bank.map." + extId, person: me, key: "bank.map." + extId, value: acc, deleted: false}}, Date.now(), me); SpreadsheetApp.flush(); }
  finally { lock.releaseLock(); }
  // the next read goes back further, so moves to a pot you've just mapped come in: bankRun_ sees the mapping row is
  // newer than its last wide read (the status isn't changed here, so this can't undo a read finishing meanwhile)
  return {ok: true};
}

// ---------- running an import ----------
// at most one "Check now" every 30 seconds each: every read uses the owner's daily allowance of requests, which the
// 15-minute reads of both of you share (kept in the script's cache, so it never rewrites the status)
function bankTooSoon_(me, what, gap) {
  var cache = null, last = 0, now = Date.now();
  try { cache = CacheService.getScriptCache(); last = +(cache.get("bank" + what + ":" + me) || 0); } catch (e) { cache = null; }
  if (last && now - last < gap && now >= last) return true;
  try { if (cache) cache.put("bank" + what + ":" + me, String(now), Math.ceil(gap / 1000) + 30); } catch (e) {}
  return false;
}
function bankSyncNow_(me) {
  var tok = bankGet_(bankKey_("TOKEN", me)); if (!tok) return {ok: false, error: "No bank is connected."};
  if (bankTooSoon_(me, "sync", 30000)) return {ok: false, error: "Budgie checked a moment ago. Try again in half a minute."};
  var res = bankRun_(me);
  return res.ok ? {ok: true, added: res.added, updated: res.updated} : {ok: false, error: res.error};
}
// reads the bank and writes what's new; never throws (problems go into the status)
// how far back to read is decided here, inside the lock, from the status (everything until the first full read worked)
// one lock for everything that reads or changes a bank connection (reading, signing in, disconnecting)
// It's the owner's user lock: the web app runs as the owner and so do the triggers, so phone requests and the
// 15-minute poll share it. (A document lock isn't available to a web app, so it can't be used here.)
// Google doesn't document whether "the current user" of a web app run as the owner is the owner, so nothing that
// matters for safety relies on it: a disconnect wins anyway (bankGone_), and two refreshes at once don't break the
// connection (monzoRefresh_). Rows are only ever written under the script lock (bankApply_).
function bankLock_() { return LockService.getUserLock(); }
// what a read brought, in a few bytes ("" if it can't be worked out, and then nothing is skipped)
var BANK_REAPPLY_ = 60 * 60000, BANK_CFG_TABS_ = ["people", "accounts", "income", "bills", "budgets", "splits", "transfers", "settlements", "loans", "amounts", "exceptions"];
function bankHash_(v) { try { return Utilities.base64EncodeWebSafe(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, JSON.stringify(v))); } catch (e) { return ""; } }
function bankRun_(p) {
  var lock = bankLock_(), s, conn0 = "";
  if (!lock.tryLock(30000)) return {ok: false, error: "The bank is already being read. Try again in a minute."};
  try {
    var tok = bankGet_(bankKey_("TOKEN", p)); if (!tok) return {ok: false, error: "No bank is connected."};
    conn0 = bankConnId_(tok);
    s = bankStatus_(p);
    if (s.backoffUntil && s.backoffUntil > Date.now()) return {ok: false, error: BANK_NAMES_[tok.provider] + " asked Budgie to wait. It tries again by itself at " + Utilities.formatDate(new Date(s.backoffUntil), tz_(), "HH:mm") + "."};
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
    // a pot or Space mapped since the last wide read: read further back this time
    var started = Date.now(), mappedAt = 0, setAt = 0;
    readTable_("settings").rows.forEach(function (r) { if (r.person !== p) return; if (+r.updated > setAt) setAt = +r.updated; if (/^bank\.map\./.test(String(r.key)) && +r.updated > mappedAt) mappedAt = +r.updated; });
    // (and after weeks without a read that worked, a bank that kept failing, say: the last 35 days would leave a gap)
    var full = !s.fullDone, wide = !!s.wideNext || mappedAt > (+s.wideAt || 0) || (+s.lastSync > 0 && Date.now() - s.lastSync > (BANK_RECENT_DAYS_ - 7) * BANK_DAY_), note = "", data;
    var cursor = full && s.cursor && typeof s.cursor === "object" ? s.cursor : null, deadline = (BANK_T0_ || started) + BANK_READ_BUDGET_;
    // Apps Script stops a run at 6 minutes, and then nothing after that point happens (not even counting it as a
    // failure). A first read leaves a mark when it starts, taken off when it ends: one still there from a run more than
    // 6 minutes ago was cut off, so this one reads half as much as it did, and it counts as a failed try
    if (full) {
      if (s.runStart && Date.now() - s.runStart > BANK_RUN_MAX_) { s.chunk = Math.max(1, Math.floor((+s.runPages || +s.chunk || BANK_MAX_PAGES_) / 2)); s.minuteFails = (+s.minuteFails || 0) + 1; }
      s.runStart = Date.now(); delete s.runPages; bankSaveStatus_(p, s);
    }
    var read = function (f, w) { return tok.provider === "monzo" ? monzoRead_(p, f, w, f ? cursor : null, f ? deadline : 0, f ? +s.chunk || 0 : 0) : starlingRead_(p, f, w); };
    var lastOf = function (d) { return d.txns.reduce(function (m, t) { return t.date > m ? t.date : m; }, cursor ? String(s.historyTo || "") : ""); };
    // the money in from the last week of a part of a first import that stopped part-way: a payday there could have its
    // pay on either side of where it stopped, so the next part weighs these too (else a pay-sized payment just after
    // could take the place of the pay the part before saw)
    var payTail = function (d) {
      var to = lastOf(d); if (!to) return [];
      var from = Budgie.addDays(to, -7), have = {};
      var tail = d.txns.filter(function (t) { return t && t.amount < 0 && !t.pot && !t.card && !t.load && !t.declined && !t.reversed && t.date >= from; })
        .map(function (t) { have[t.id] = true; return {id: t.id, acc: t.acc, date: t.date, amount: t.amount, name: String(t.name || "").slice(0, 40)}; });
      // (a short part, of a few days, keeps what the part before it carried from that week too)
      var before = cursor && Array.isArray(s.payCarry) ? s.payCarry.filter(function (x) { return x && x.id && !have[x.id] && String(x.date) >= from; }) : [];
      return before.concat(tail).sort(function (x, y) { return x.date < y.date ? -1 : x.date > y.date ? 1 : 0; }).slice(-10);
    };
    var cutNote = function (d) { var last = lastOf(d); return "Monzo stopped sharing older payments part-way through, so Budgie has them " + (last ? "up to " + last + " " : "") + "and the last 90 days"; };
    try { data = read(full, wide); }
    catch (e) {
      // Monzo only gives the whole history in the first minutes after approval; later, the last 90 days
      var since = tok.approvedAt || tok.issuedAt || 0;
      if (!(full && tok.provider === "monzo" && e && e.bank === "reconnect" && since && Date.now() > since + BANK_HISTORY_WINDOW_)) throw e;
      data = read(false, true); note = cursor ? cutNote({txns: []}) : "Monzo only lets Budgie read the last 90 days now";
    }
    // the older history Monzo did share is kept, with the last 90 days on top
    if (data.cut) {
      var recent = read(false, true), have = {};
      recent.txns.forEach(function (t) { have[t.id] = true; });
      note = cutNote(data); data = {provider: data.provider, accounts: recent.accounts, txns: data.txns.filter(function (t) { return !have[t.id]; }).concat(recent.txns)};
    }
    // how much this run read, in case it's cut off while saving it
    if (full && data.pages) { var s8 = bankStatus_(p); if (s8.runStart) { s8.runPages = data.pages; bankSaveStatus_(p, s8); } }
    var more = full && !note && data.cursor && Object.keys(data.cursor).length ? data.cursor : null;
    // a read that stopped part-way can't tell which pending payments have gone, so none are dropped this time; nor can
    // the last part of a carried-on first read (it only covers the time since the part before stopped)
    // (a read from a moment in time only covers part of that first day, so only the days after it count)
    var windowFrom = more || (cursor && !note) ? "9999-12-31" : full && !note ? "" : Budgie.addDays(bankDate_(bankSince_(false, wide || !!note).toISOString()), 1);
    // disconnected, or connected again, while this was reading (Check now and the 15-minute read aren't sure to share
    // the lock): what it read and its status are about a connection that has gone, so they're left out
    var gone = function () { return bankConnId_(bankGet_(bankKey_("TOKEN", p))) !== conn0; };
    if (gone()) return {ok: false, error: "The bank was disconnected while it was being read."};
    // Exactly what the last read brought (same payments and balances, same day, none of your settings changed since):
    // nothing to save, so the tabs aren't read and written again. Each read uses the owner's 90 minutes a day of
    // trigger time, which the budget tabs and the Sunday emails need too. It still saves once an hour, in case a change
    // in the sheet (a new bill, say) changes what the same payments mean. Never for a first import or a read that
    // stopped part-way.
    // (the small tabs that say what payments are: a new account, bill or pay change counts as a change straight away)
    var today0 = Utilities.formatDate(new Date(), tz_(), "yyyy-MM-dd"), fp = "";
    if (!full && !note && !s.again && !s.waiting) {
      var cfgAt = 0; BANK_CFG_TABS_.forEach(function (t) { readTable_(t).rows.forEach(function (r) { if (+r.updated > cfgAt) cfgAt = +r.updated; }); });
      // and a payment you've logged yourself since (it may be one the bank brought in already, to link)
      var txAt = 0; readTable_("transactions").rows.forEach(function (r) { if (r.person === p && !r.bankId && !/^bk-/.test(String(r.id)) && +r.updated > txAt) txAt = +r.updated; });
      fp = bankHash_([data.accounts, data.txns, windowFrom, today0, setAt, cfgAt, txAt, wide]);
    }
    var res = fp && s.applied && s.applied.fp === fp && Date.now() - (+s.applied.at || 0) < BANK_REAPPLY_ ? {added: 0, updated: 0, stopped: false, same: true} : bankApply_(p, data, windowFrom, cursor && !note && Array.isArray(s.payCarry) ? s.payCarry : null);
    if (gone()) return {ok: false, error: "The bank was disconnected while it was being read."};
    s = bankStatus_(p);
    if (!res.same) { if (fp && !res.stopped && !res.failed) s.applied = {fp: fp, at: Date.now()}; else delete s.applied; }
    s.provider = tok.provider; s.accounts = data.accounts; s.lastSync = Date.now(); s.lastError = ""; s.needsReconnect = false; s.backoffUntil = 0; s.backoffN = 0;
    delete s.again; delete s.minuteFails; delete s.runStart; delete s.runPages;
    // ran short of time saving it: the next run (in a minute) reads the same again and does what's left
    if (res.stopped) { s.again = true; if (full) s.note = "Still bringing in your history"; bankEnsureMinuteTrigger_(); }
    else if (more) { s.cursor = more; s.historyTo = lastOf(data); s.payCarry = payTail(data); s.note = "Still bringing in your history"; bankEnsureMinuteTrigger_(); }
    else if (full) { s.fullDone = true; delete s.cursor; delete s.historyTo; delete s.chunk; delete s.payCarry; if (s.note === "Still bringing in your history") s.note = ""; }
    if ((wide || full) && !more && !res.stopped) { s.wideNext = false; s.wideAt = started; }
    if (note) s.note = note;
    if (s.waiting) { s.waiting = false; tok = bankGet_(bankKey_("TOKEN", p)); if (tok && !tok.approvedAt) { tok.approvedAt = Date.now(); bankSet_(bankKey_("TOKEN", p), tok); bankGone_(p, tok); } }
    bankSaveStatus_(p, s);
    return {ok: true, added: res.added, updated: res.updated};
  } catch (e) {
    s = bankStatus_(p); delete s.runStart; delete s.runPages;
    var msg = bankScrub_(p, e && e.message || e);
    // disconnected or connected again while this read was going: it was about the old connection, so it says nothing
    // about the one there is now
    var nowConn = bankConnId_(bankGet_(bankKey_("TOKEN", p)));
    if (conn0 && nowConn !== conn0) return {ok: false, error: msg};
    if (e && e.bank === "reconnect") {
      // waiting for the first approval in the Monzo app is expected for a few minutes
      if (s.waiting && s.firstUntil > Date.now()) { s.lastError = "Waiting for you to approve Budgie in the Monzo app."; }
      else { s.needsReconnect = true; s.waiting = false; s.lastError = msg; }
    } else if (e && e.bank === "backoff") {
      s.backoffN = Math.min(6, (s.backoffN || 0) + 1);
      // (Monzo: skips at least one poll. Starling's limit is a short one, already waited out above, so it's tried again
      // after 5 minutes, then 10, 20 and so on: a "slow down" right after connecting doesn't keep the first read away for long)
      var base = tok && tok.provider === "starling" ? 5 * 60000 : 30 * 60000;
      s.backoffUntil = Date.now() + Math.max((e.retryAfter || 0) * 1000, base * Math.pow(2, s.backoffN - 1));
      s.lastError = msg + ". Budgie tries again by itself at " + Utilities.formatDate(new Date(s.backoffUntil), tz_(), "HH:mm") + ".";
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
// payCarry: money in from the end of the part of a first import before this one (only weighed for the pay)
function bankApply_(p, data, windowFrom, payCarry) {
  var lock = LockService.getScriptLock(); lock.waitLock(25000);
  try {
    CACHE_ = {};
    var today = Utilities.formatDate(new Date(), tz_(), "yyyy-MM-dd"), db = Budgie.load(allTables_(), today);
    var provider = data.provider, label = BANK_NAMES_[provider], main = Budgie.mainOf(db, p), st = Budgie.startOf(db, p), D = Budgie;
    var extKind = {}; data.accounts.forEach(function (a) { extKind[a.extId] = a.kind; });
    // Budgie's accounts by id, from the accounts tab only (not db.byId, which another tab's row could share an id with)
    var accRow = {}; db.accounts.forEach(function (a) { accRow[a.id] = a; });
    // until it's mapped, the bank's first current account stands for your main account (any others wait to be mapped)
    var primary = (data.accounts.filter(function (a) { return a.kind === "main"; })[0] || {}).extId;
    // where each bank account goes: a Budgie account, "" to ignore it, or not set yet
    var maps = {}; db.settings.forEach(function (r) { if (r.person === p && /^bank\.map\./.test(String(r.key))) maps[String(r.key).slice(9)] = String(r.value === undefined || r.value === null ? "" : r.value); });
    var accOf = function (ext, forPayment) {
      if (bankHas_(maps, ext)) { var id = maps[ext]; return id && accRow[id] && accRow[id].owner === p ? id : null; }
      return ext === primary || (forPayment && extKind[ext] !== "main") ? main : null;
    };
    var rawTx = readTable_("transactions").rows, byBank = {}, byIdRow = {};
    // only your own rows are ever linked to your bank: a row of your partner's that names one of your payments (left
    // by an older version, or typed into the sheet) is neither changed nor lets it hide that payment
    // (a payment's own row the feed took off because you'd logged it yourself as well never stands in for the one
    // you logged: the live row, and then the one you logged, comes first)
    var rank = function (r) { return (bankTrue_(r.deleted) ? 2 : 0) + (/^bk-/.test(String(r.id)) ? 1 : 0); };
    rawTx.forEach(function (r) { if (r.bankId && r.person === p) { var k = String(r.bankId), cur = byBank[k]; if (!cur || rank(r) < rank(cur)) byBank[k] = r; } byIdRow[r.id] = r; });
    var moveRows = {}; readTable_("moves").rows.forEach(function (r) { moveRows[r.id] = r; });
    var used = Object.create(null), usedOcc = {}, newRows = {transactions: [], moves: [], valuations: [], exceptions: []}, updates = [];
    var near = function (a, b) { return Math.abs(a - b) <= 0.0105; };
    // (matching allows a penny either way; what's kept is the bank's amount, to the penny)
    var same = function (a, b) { return Math.abs(a - b) < 0.005; };
    var update = function (t, id, fields) { updates.push({t: t, row: Object.assign({id: id}, fields)}); };
    var create = function (t, row) { newRows[t].push(row); };
    var st0 = bankStatus_(p), pending = st0.pending || {}, seen = {}, partnerId = partnerOf_(p);
    // rows a payment could be the same as, by date, worked out once (a first import can be thousands of payments
    // against thousands of rows). Only ever your own rows: reading your bank never looks at, links or changes
    // anything your partner wrote, so nothing they log can tell them about your payments.
    var candDays = {};
    rawTx.forEach(function (r, i) {
      if (r.bankId || bankTrue_(r.deleted) || /^bk-/.test(String(r.id)) || r.person !== p) return;
      var day = D.parseDate(r.date); if (!day) return;
      (candDays[day] = candDays[day] || []).push({r: r, i: i, pk: r.source === "peckish", a: +r.amount || 0});
    });
    // the same payment logged by hand (to the penny, within 2 days, best if the name matches) or by Peckish (a shop's
    // estimate: the shop's name, within 15% or £5, within 3 days)
    // needName: only one that names the same shop (linking one logged after the bank had it: one you log by hand then
    // is more likely cash, which a card payment of the same amount mustn't swallow)
    // pkOnly: only a Peckish shop
    // every row it could be, each with how alike they are (lower is more alike)
    var dupesOf = function (t, needName, pkOnly) {
      var out = [], words = bankMerchantKey_(t.name).split(" ").filter(function (w) { return w.length > 2; });
      for (var off = -3; off <= 3; off++) (candDays[D.addDays(t.date, off)] || []).forEach(function (c) {
        var r = c.r, a = c.a, dd = Math.abs(off); if (r.bankId || (pkOnly && !c.pk)) return;
        if (c.pk ? (dd > 3 || Math.abs(a - t.amount) > Math.max(5, t.amount * 0.15)) : (dd > 2 || !near(a, t.amount))) return;
        if (!c.noteWords) c.noteWords = bankMerchantKey_(r.note).split(" ");
        var nameHit = words.some(function (w) { return c.noteWords.indexOf(w) >= 0; });
        // a Peckish shop is only an estimate, so it has to name the shop too: otherwise one posted for any amount could
        // take over a nearby payment somewhere else, carrying the bank's amount back to Peckish and hiding the payment
        if ((c.pk || needName) && !nameHit) return;
        out.push({r: r, score: (nameHit ? 0 : 10) + dd + Math.abs(a - t.amount) / 100, i: c.i});
      });
      return out;
    };
    // Which row each payment is linked to is picked over the whole read (below, linkPick), like the bills and the pay:
    // going through the payments in date order, an earlier shop at the same place (Monday's Tesco, already checked as
    // food) would take the Peckish shop posted for Thursday's, and Thursday's payment would come in on its own
    var linkPick = {};
    var findDupe = function (t) { var d = linkPick[t.id]; return d && !used[d.r.id] ? d : null; };
    // link it instead of adding it twice
    // was: the bank's copy you'd already checked (what you said it was for stays)
    var linkDupe = function (t, dupe, was) {
      used[dupe.r.id] = true; byBank[t.id] = dupe.r;
      // the payer's own hand-logged payment is already checked; a Peckish shop still asks them
      var link = {bankId: t.id, review: dupe.r.source === "peckish"};
      if (was) { link.review = false; link.budget = was.budget || ""; link.split = was.split || ""; }
      if (!same(+dupe.r.amount, t.amount)) link.amount = t.amount;
      // and its date is the bank's, as the bank's own copy's would have been (a shop logged the day after, or a late-night
      // one the bank dates after midnight): the date decides which week and pay period it counts in
      if (t.date && String(dupe.r.date) !== t.date) link.date = t.date;
      // a shop logged without an account (Peckish's) was paid from the account the bank says (a spending Space, say)
      var acc = accOf(t.acc, true); if (acc && (dupe.r.account === undefined || dupe.r.account === null || dupe.r.account === "")) link.account = acc;
      update("transactions", dupe.r.id, link);
    };

    // a planned payday move this matches (to the same place, same amount, within 7 days after payday)
    // the plan can have moved on a little since payday (a bill came in higher), so if nothing matches to the penny,
    // the one planned move to that place within 10% counts
    var paydayMatch = function (to, amount, date, kindRe) {
      var per = D.periodAt(db, p, date), cands = [per, D.prevPeriod(db, p, per)], hit = null, close = [];
      cands.forEach(function (pk) {
        if (hit || !pk || !pk.pay || pk.opening) return; var dd = D.diff(pk.start, date); if (dd < 0 || dd > 7) return;
        D.payday(db, p, pk).moves.forEach(function (m) {
          if (hit) return; var acc = accRow[m.to] || {};
          // (only ever to one of your own accounts: a plan typed in the sheet that names your partner's LISA mustn't
          // turn your Moneybox payment into a move into theirs)
          if (acc.owner !== p || !(to ? m.to === to : kindRe.test(String(acc.kind)))) return;
          var h = {key: "pay:" + pk.start + ":" + m.to, to: m.to, start: pk.start};
          if (near(m.amount, amount)) hit = h; else if (Math.abs(m.amount - amount) <= m.amount * 0.1) close.push(h);
        });
      });
      return hit || (close.length === 1 ? close[0] : null);
    };
    // your payday ticks: "app" if one was ticked in your app (or the sheet), "bank" if only by the bank feed
    var payTicks = {}; db.moves.forEach(function (m) { if (m.person !== p || !/^pay:/.test(String(m.key || ""))) return; payTicks[m.key] = /^bk-/.test(String(m.id)) && payTicks[m.key] !== "app" ? "bank" : "app"; });
    var putMove = function (t, from, to, amount, key, review, note) {
      var id = "bk-" + provider + "-" + t.id, ex = moveRows[id];
      if (ex && ex.person !== p) { Logger.log("Bank feed skipped moves " + id + ": it isn't " + p + "'s."); return; }
      if (ex) { if (!bankTrue_(ex.deleted) && (!same(+ex.amount, amount) || ex.from !== from || ex.to !== to)) update("moves", id, {amount: amount, from: from, to: to}); return; }
      // already ticked in your app: nothing new to add (only your own ticks count: your partner can write any key on
      // a move of theirs, and that mustn't hide one of yours)
      // Ticked by another payment from the bank, though, it's a second move of its own (a top-up the same week, say):
      // it comes in as a move that isn't the payday tick, as two moves with one payday key would count as one
      if (key && /^pay:/.test(key)) {
        if (payTicks[key] === "app") return;
        if (payTicks[key] === "bank") key = "bank:" + t.id; else payTicks[key] = "bank";
      }
      // a payday move is dated on payday, unless it landed in the next tax year (a LISA or ISA payment on 6 April for a
      // 1 April payday counts towards the new year's allowance and bonus, as the provider counts it)
      var day = t.date; if (/^pay:/.test(key)) { var pd = D.moveDate(key, t.date); if (D.taxYearStart(pd) === D.taxYearStart(t.date)) day = pd; }
      create("moves", {id: id, date: day, person: p, from: from, to: to, amount: amount, key: key, note: note || "", review: !!review});
    };
    // a pot move that's one To do asked for (moving back what a pot paid for, covering going over, filling a pot or the
    // main account, the payday cover): to the same place, the same amount to the penny, within the last week. It takes
    // that move's key (one row for each part it ticks), so To do counts it as done rather than asking for it again; and
    // one you'd already ticked in your app (within 3 days) isn't added a second time
    var TODO_KEY_ = /^(back|cover|fill|lent|late|refund):|^pay:\d{4}-\d{2}-\d{2}:cover$/, openTodo = null, todoTaken = {}, appTaken = {};
    var todoMatch = function (from, to, amount, date) {
      if (D.diff(date, today) > 7) return null;
      if (openTodo === null) { try { openTodo = D.todo(db, p, today).filter(function (x) { return x.type === "move" && !x.payday && x.keys && x.keys.length && x.keys.every(function (k) { return TODO_KEY_.test(k.key); }); }); } catch (e) { openTodo = []; } }
      for (var i = 0; i < openTodo.length; i++) { var it = openTodo[i]; if (!todoTaken[i] && it.from === from && it.to === to && same(it.amount, amount)) { todoTaken[i] = true; return it; } }
      return null;
    };
    // (what one tick in the app saved: its parts, one row each, on the same day between the same two accounts)
    var appTicks = null;
    var appTicked = function (from, to, amount, date) {
      if (appTicks === null) { var g = {}; appTicks = []; db.moves.forEach(function (m) { if (m.dup || m.person !== p || /^bk-/.test(String(m.id)) || !TODO_KEY_.test(String(m.key || ""))) return; var k = m.date + "|" + m.from + "|" + m.to; if (!g[k]) { g[k] = {date: m.date, from: m.from, to: m.to, amount: 0}; appTicks.push(g[k]); } g[k].amount += +m.amount || 0; }); }
      for (var i = 0; i < appTicks.length; i++) { var x = appTicks[i]; if (!appTaken[i] && x.from === from && x.to === to && same(x.amount, amount) && Math.abs(D.diff(x.date, date)) <= 3) { appTaken[i] = true; return x; } }
      return null;
    };
    var putTodoMove = function (t, from, to, it, ex) {
      var base = "bk-" + provider + "-" + t.id;
      it.keys.forEach(function (k, i) {
        var id = i ? base + "~" + (i + 1) : base, amount = it.keys.length > 1 ? k.amount : t.amount < 0 ? -t.amount : t.amount;
        if (!i && ex) { update("moves", id, {key: k.key, amount: amount}); return; }
        if (!moveRows[id]) create("moves", {id: id, date: t.date, person: p, from: from, to: to, amount: amount, key: k.key, note: "", review: false});
      });
    };
    // a bill, a regular payment to your partner, or a payment you've already logged between you two
    // (by their id, which is set in the sheet: their name is theirs to change, so "Sam Smith" or "Tesco" could be made
    // to match anyone's payment)
    var partnerWords = bankMerchantKey_(partnerId).split(" ").filter(function (w) { return w.length > 2; });
    var namesPartner = function (t) { return !!partnerWords.length && bankMerchantKey_(t.name).split(" ").some(function (w) { return partnerWords.indexOf(w) >= 0; }); };
    // every planned item a payment could be, each with how alike they are (lower is more alike: the same name first,
    // then the nearer day, then the amount to the penny)
    var bankX = Object.create(null); db.exceptions.forEach(function (x) { if (String(x.id) === "x-" + x.item + "-" + x.date + "-bank-" + p) bankX[x.item + "|" + x.date] = true; });
    var plannedCands = function (t, needName) {
      var toPartner = namesPartner(t), out = [], words = bankMerchantKey_(t.name).split(" ").filter(function (w) { return w.length > 2; });
      var a = t.amount, win = function (item) { return D.occurrences(db, item, D.addDays(t.date, -3), D.addDays(t.date, 4)); };
      db.bills.forEach(function (b) {
        if (b.person !== p) return;
        var bw = bankMerchantKey_(b.name).split(" "), nameHit = words.some(function (w) { return bw.indexOf(w) >= 0; });
        if (needName && !nameHit) return;   // a card payment only counts as a bill if the names agree (a subscription, say)
        win(b).forEach(function (o) {
          // (an amount the bank feed itself set for that date, from the payment an earlier read took for it, isn't what
          // was expected: weighed against it, that payment would keep the bill when the bill's own payment comes in)
          var base = D.amountAt(db, b, o.orig), exact = near(a, base) || (!bankX[b.id + "|" + o.orig] && near(a, o.amount));
          if (exact || (b.variable && nameHit && Math.abs(a - base) <= base * 0.5)) out.push({kind: "bill", item: b, occ: o, score: (nameHit ? 0 : 10) + Math.abs(D.diff(o.date, t.date)) + (exact ? 0 : 1 + Math.abs(a - base) / base)});
        });
      });
      if (needName) return out;
      db.transfers.forEach(function (tr) { if (tr.from === p) win(tr).forEach(function (o) { if (near(a, o.amount)) out.push({kind: "transfer", occ: o, score: (toPartner ? 0 : 10) + Math.abs(D.diff(o.date, t.date)) + 0.001}); }); });
      // a payment between you two logged by your partner only counts if the bank names them (else a made-up one could
      // hide one of your payments)
      db.settlements.forEach(function (s) { if (s.from === p && near(a, +s.amount) && Math.abs(D.diff(s.date, t.date)) <= 2 && (/^(|sheet)$/.test(String(s.by || "")) || s.by === p || toPartner)) out.push({kind: "settlement", occ: {key: "set:" + s.id}, score: (toPartner ? 0 : 10) + Math.abs(D.diff(s.date, t.date)) + 0.002}); });
      return out;
    };
    // Which payment each planned item is: the one most like it over the whole read, as for the pay. Going through the
    // payments in date order instead, a different payment of the same amount a few days before a bill (£20 to a friend
    // before a £20 phone bill) would be taken for the bill and left out, and the bill's own payment would come in as
    // spending. Only payments that would be looked at for a planned item are weighed.
    var planPick = {};
    var plannedOut = function (t) { var h = planPick[t.id]; return h && !usedOcc[h.occ.key] ? h : null; };
    // Which money in is the pay: each payday goes to the one most like it (the amount expected, on the day), never a
    // top-up (Monzo's is_load) or money from your partner, and each payment is at most one payday. Picked over the whole
    // read at once, so a pay-sized transfer from savings a day before payday can't take the pay's place.
    // A payday whose pay could be before the start of this read was settled by an earlier read, which saw it.
    var payPick = {}, payFrom = /^\d{4}-\d{2}-\d{2}$/.test(String(windowFrom || "")) && windowFrom < "9999" ? D.addDays(windowFrom, 3) : "";
    var payPairs = [];
    var payCand = function (t) { return t.amount < 0 && !t.pot && !t.card && !t.load && !t.declined && !t.reversed && !(byBank[t.id] || byIdRow["bk-" + provider + "-" + t.id]) && !namesPartner(t) && !!accOf(t.acc, true); };
    var payScan = function (list) {
      list.forEach(function (t) {
        if (!t.date || !payCand(t)) return;
        var a = -t.amount;
        db.income.forEach(function (i) {
          if (i.person !== p || !i.isPay) return;
          D.occurrences(db, i, D.addDays(t.date, -3), D.addDays(t.date, 4)).forEach(function (o) {
            var base = D.amountAt(db, i, o.orig);
            if (payFrom && o.date < payFrom) return;
            if (!(base > 0) || Math.abs(a - base) > base * 0.5) return;   // only something pay-sized counts as the pay
            payPairs.push({t: t, i: i, o: o, score: Math.abs(a - base) / base + 0.05 * Math.abs(D.diff(o.date, t.date))});
          });
        });
      });
      payPairs.sort(function (x, y) { return x.score - y.score || (x.t.date < y.t.date ? -1 : x.t.date > y.t.date ? 1 : 0); });
      var took = {};
      payPairs.forEach(function (x) { if (took[x.o.key] || payPick[x.t.id]) return; took[x.o.key] = true; payPick[x.t.id] = {i: x.i, o: x.o}; });
    };
    var payIn = function (t) { var pk = payPick[t.id]; return pk && !usedOcc[pk.o.key] ? pk : null; };
    // the bank's own change to one date: its id names the person, and one with that id for another item isn't used
    var exception = function (itemId, orig, amount, note) {
      var id = "x-" + itemId + "-" + orig + "-bank-" + p, ex = byId_("exceptions", id);
      if (ex && ex.item !== itemId) { Logger.log("Bank feed skipped " + id + ": that id is already used for something else."); return; }
      if (ex) { if (!same(+ex.amount, amount)) update("exceptions", id, {amount: amount, deleted: false}); }
      else create("exceptions", {id: id, item: itemId, date: orig, action: "amount", amount: amount, note: note});
    };

    // each payment once, even if the read listed it twice (under a Space as well as the account, say, or in two
    // windows that meet on its time): a second copy would find its bill already used and come in as a payment too
    var last = {}; data.txns.forEach(function (t, i) { if (t && t.id) last[t.id] = i; });
    var txList = data.txns.filter(function (t, i) { return t && t.id && last[t.id] === i; }).sort(function (x, y) { return x.date < y.date ? -1 : x.date > y.date ? 1 : 0; });
    payScan(txList.concat((payCarry || []).filter(function (x) { return x && x.id && x.date && !bankHas_(last, x.id); }).map(function (x) { return {id: String(x.id), acc: x.acc, date: String(x.date), amount: +x.amount, name: String(x.name || "")}; })));
    // (the same payments the loop below would ask about a planned item: money out, not a move, no row yet)
    var lisaAcc = D.accountsOf(db, p).filter(function (a) { return a.kind === "lisa"; })[0], isaAcc = D.accountsOf(db, p).filter(function (a) { return a.kind === "isa"; })[0];
    var planPairs = [];
    txList.forEach(function (t, i) {
      if (!t.date || t.declined || t.reversed || !(t.amount > 0) || t.pot || !accOf(t.acc, true)) return;
      if (byBank[t.id] || byIdRow["bk-" + provider + "-" + t.id]) return;
      var mv = moveRows["bk-" + provider + "-" + t.id]; if (mv && mv.person === p && !bankTrue_(mv.deleted)) return;
      if (/moneybox/i.test(t.name) && (lisaAcc || isaAcc || paydayMatch(null, t.amount, t.date, /lisa|isa/))) return;
      plannedCands(t, t.card).forEach(function (h) { planPairs.push({t: t, i: i, h: h}); });
    });
    planPairs.sort(function (x, y) { return x.h.score - y.h.score || x.i - y.i; });
    var planTook = {}; planPairs.forEach(function (x) { if (planTook[x.h.occ.key] || planPick[x.t.id]) return; planTook[x.h.occ.key] = true; planPick[x.t.id] = x.h; });
    // Which row you logged (by hand, or Peckish) each payment is, over the whole read: each pair the loop below could
    // link, best first, each row and each payment at most once. Which pairs those are follows the loop exactly:
    // - a payment with no row yet (not a pot move, Moneybox move or planned item): one logged to the penny, or a
    //   Peckish shop that names the shop
    // - the bank's copy, not checked yet: one that names the shop
    // - the bank's copy, checked as food: a Peckish shop that names the shop
    var linkPairs = [];
    txList.forEach(function (t, ti) {
      if (!t.date || t.declined || t.reversed || !(t.amount > 0) || t.pot || !accOf(t.acc, true)) return;
      var mine = byBank[t.id] || byIdRow["bk-" + provider + "-" + t.id], mv = moveRows["bk-" + provider + "-" + t.id];
      if ((mine && mine.person !== p) || (mv && mv.person === p && !bankTrue_(mv.deleted))) return;
      var box = /moneybox/i.test(t.name) && !!(lisaAcc || isaAcc || paydayMatch(null, t.amount, t.date, /lisa|isa/)), mode = null;
      if (!mine) mode = box || planPick[t.id] ? null : {};
      else if (/^bk-/.test(mine.id) && !bankTrue_(mine.deleted)) {
        if (bankTrue_(mine.review)) mode = box ? null : {needName: true};
        else { var mb = db.byId[mine.budget]; mode = mb && mb.person === p && db.budgets.indexOf(mb) >= 0 && BANK_FOOD_.test(String(mb.name || "")) ? {needName: true, pkOnly: true} : null; }
      }
      if (mode) dupesOf(t, mode.needName, mode.pkOnly).forEach(function (d) { linkPairs.push({t: t, ti: ti, d: d}); });
    });
    linkPairs.sort(function (x, y) { return x.d.score - y.d.score || x.ti - y.ti || x.d.i - y.d.i; });
    var linkTook = Object.create(null); linkPairs.forEach(function (x) { if (linkTook[x.d.r.id] || linkPick[x.t.id]) return; linkTook[x.d.r.id] = true; linkPick[x.t.id] = x.d; });
    txList.forEach(function (t) {
      if (!t.date) return;
      seen[t.id] = true;
      var mine = byBank[t.id] || byIdRow["bk-" + provider + "-" + t.id];
      // a row with the bank's id that isn't this person's (typed into the sheet by someone else): left alone
      if (mine && mine.person !== p) { Logger.log("Bank feed skipped transactions " + mine.id + ": it isn't " + p + "'s."); return; }
      // a pending hold that went to nothing, or a payment refused or reversed: drop the row the bank added
      if (t.declined || t.reversed || (!t.amount && t.pending !== undefined && (t.pending || pending[t.id]))) {
        delete pending[t.id];
        if (mine && /^bk-/.test(mine.id) && !bankTrue_(mine.deleted) && (t.reversed || !t.amount || bankTrue_(mine.review))) update("transactions", mine.id, {deleted: true});
        // and a pot, Space or Moneybox move the bank feed made from it (money that went back never reached the LISA)
        var mv0 = moveRows["bk-" + provider + "-" + t.id];
        if (mv0 && mv0.person === p && !bankTrue_(mv0.deleted)) update("moves", mv0.id, {deleted: true});
        return;
      }
      if (!t.amount) return;
      // only recent holds are watched (a later read only looks back 35 days, and the status has to stay small)
      if (t.pending && D.diff(t.date, today) < BANK_RECENT_DAYS_) pending[t.id] = {date: t.date}; else delete pending[t.id];
      var ext = t.acc;
      // one bank payment is a payment or a move, never both. One read as a payment before it could be a move (a
      // Moneybox payment before there was a LISA to put it in) becomes the move if nobody has checked it yet; one
      // that's been checked stays a payment. And a move stays a move.
      var asMove = function () {
        if (!mine || bankTrue_(mine.deleted)) return true;
        if (!(/^bk-/.test(mine.id) && bankTrue_(mine.review))) return false;
        update("transactions", mine.id, {deleted: true}); return true;
      };
      var mvEx = moveRows["bk-" + provider + "-" + t.id];
      var isMove = !!mvEx && mvEx.person === p && !bankTrue_(mvEx.deleted);
      // a move between the account and a pot or Space
      if (t.pot) {
        var potAcc = accOf(t.pot, false), mainAcc = accOf(ext, false);
        if (!potAcc || !mainAcc) return;   // not mapped yet: it's listed in the status so it can be
        if (!asMove()) return;
        var into = t.amount > 0, from = into ? mainAcc : potAcc, to = into ? potAcc : mainAcc, amt = Math.abs(t.amount);
        var pm = into ? paydayMatch(to, amt, t.date) : null;
        if (!pm) {
          var exM = moveRows["bk-" + provider + "-" + t.id], loose = !exM || /^bank:/.test(String(exM.key || ""));
          if (exM && (exM.person !== p || bankTrue_(exM.deleted) || !loose)) { if (exM.person === p && !loose) return; }
          else {
            var tm = todoMatch(from, to, amt, t.date);
            if (tm) { putTodoMove(t, from, to, tm, exM); return; }
            if (!exM && appTicked(from, to, amt, t.date)) return;
          }
        }
        putMove(t, from, to, amt, pm ? pm.key : "bank:" + t.id, false);
        return;
      }
      var acc = accOf(ext, true); if (!acc) return;   // an account set to be ignored
      if (t.amount > 0) {
        // money going out: Moneybox, a planned bill or transfer, or a payment
        if (/moneybox/i.test(t.name)) {
          var lisaB = null; db.budgets.forEach(function (b) { if (!lisaB && b.person === p && b.mode === "saving" && /lisa/.test(String((db.byId[b.account] || {}).kind))) lisaB = b; });
          var pmx = paydayMatch(null, t.amount, t.date, /lisa|isa/);
          var target = lisaB && near(D.amountAt(db, lisaB, t.date), t.amount) && lisaAcc ? lisaAcc : (isaAcc || lisaAcc);
          if ((pmx || target) && asMove()) {
            if (pmx) putMove(t, acc, pmx.to, t.amount, pmx.key, false, t.name); else putMove(t, acc, target.id, t.amount, "bank:" + t.id, true, t.name);
            return;
          }
        }
        if (isMove) return;
        {
          var po = mine ? null : plannedOut(t);
          if (po) {
            usedOcc[po.occ.key] = true;
            if (po.kind === "bill" && !same(t.amount, po.occ.amount)) exception(po.item.id, po.occ.orig, t.amount, "from " + label);
            return;
          }
        }
      } else {
        // money coming in: a refund counts against its budget; your pay is checked against what was expected
        if (!t.card) {
          // money from your partner is never your pay, however much it is
          if (mine || namesPartner(t)) return;
          var pi = payIn(t);
          if (pi) { usedOcc[pi.o.key] = true; if (!same(-t.amount, pi.o.amount)) exception(pi.i.id, pi.o.orig, -t.amount, "from " + label); }
          return;   // other money in (Sophie's share, a friend paying you back) is already planned or isn't spending
        }
      }
      // a payment (or card refund)
      // One the bank brought in first that you then logged yourself as well (by hand after paying, or a Peckish shop
      // posted later) and haven't checked yet: the one you logged is linked to it and the bank's copy is taken off, so it
      // isn't counted twice. (The same rules as linking one you logged before the bank saw it, and it has to name the
      // same shop.)
      // A Peckish shop posted after you'd already checked the bank's copy as food is the same shop too (Peckish posts
      // when you log the shop there, whether or not you've checked it in Budgie yet): it's linked the same way, and
      // keeps what you said the payment was for. One you log by hand after checking the bank's copy is left as its own
      // payment (more likely cash).
      // (which ones qualify is worked out with the pairs above)
      if (mine && /^bk-/.test(mine.id) && !bankTrue_(mine.deleted) && t.amount > 0) {
        var later = findDupe(t);
        if (later) { linkDupe(t, later, bankTrue_(mine.review) ? null : mine); update("transactions", mine.id, {deleted: true}); return; }
      }
      // one payment, one row: the bank's own copy of one that's linked to a row you logged (left by a write the sheet
      // couldn't make, between linking the one you logged and taking the bank's copy off) is taken off
      var twin = byIdRow["bk-" + provider + "-" + t.id];
      if (mine && !/^bk-/.test(mine.id) && !bankTrue_(mine.deleted) && twin && twin !== mine && twin.person === p && String(twin.bankId) === String(t.id) && !bankTrue_(twin.deleted)) update("transactions", twin.id, {deleted: true});
      if (mine) {
        var f = {}, confirmed = !bankTrue_(mine.review);
        // dismissed on a phone: it stays dismissed. Taken off by the bank feed itself (a hold that seemed to have gone):
        // the bank shows it again, so it comes back
        if (bankTrue_(mine.deleted)) { if (!(String(mine.by) === "bank" && /^bk-/.test(mine.id))) return; f.deleted = false; }
        if (!same(+mine.amount, t.amount)) f.amount = t.amount;      // a pending payment settled at a different amount
        if (!confirmed) { if (mine.account !== acc && /^bk-/.test(mine.id)) f.account = acc;   // the account was mapped since
          if (!mine.note && t.name) f.note = t.name; if (!mine.budget) { var g0 = bankGuess_(db, p, t.name, t.category, t.date); if (g0.budget) { f.budget = g0.budget; if (!mine.split && g0.splitHint) f.splitHint = g0.splitHint; } } }
        if (Object.keys(f).length) update("transactions", mine.id, f);
        return;
      }
      // the same payment logged by hand (to the penny, within 2 days, best if the name matches) or by Peckish (a shop's
      // estimate: the shop's name, within 15% or £5, within 3 days): link it instead of adding it twice
      var eid = "bk-" + provider + "-" + t.id, dupe = t.amount > 0 ? findDupe(t) : null;
      if (dupe) { linkDupe(t, dupe); return; }
      var g = bankGuess_(db, p, t.name, t.category, t.date);
      var row = {id: eid, date: t.date, person: p, amount: t.amount, budget: g.budget, account: acc, split: "", splitHint: g.splitHint || "", note: t.name, source: provider, bankId: t.id,
        review: t.date >= st};   // payments from before you started Budgie are history, nothing to check
      create("transactions", row);
    });

    // one balance per mapped account per day
    data.accounts.forEach(function (a) {
      var acc = accOf(a.extId, false); if (!acc || a.balance === null || a.balance === undefined || isNaN(+a.balance)) return;   // no balance given: nothing saved, never £0
      var id = "bk-" + a.extId + "-" + today, ex = byId_("valuations", id), amount = a.kind === "credit" ? -Math.abs(a.balance) : a.balance;
      if (ex && (byId_("accounts", ex.account) || {}).owner !== p) { Logger.log("Bank feed skipped valuations " + id + ": it isn't " + p + "'s."); return; }
      if (ex) { if (!same(+ex.amount, amount) || ex.account !== acc) update("valuations", id, {amount: amount, account: acc}); }
      else create("valuations", {id: id, account: acc, date: today, amount: amount, note: "from " + label});
    });

    // a pending payment this read should have seen but didn't, more than a week old: the hold was dropped
    Object.keys(pending).forEach(function (id) {
      var x = pending[id]; if (seen[id] || !x || !x.date) return;
      if (windowFrom && x.date < windowFrom) return;   // older than this read: can't tell
      if (D.diff(x.date, today) <= BANK_PENDING_DROP_DAYS_) return;
      var row = byBank[id] || byIdRow["bk-" + provider + "-" + id];
      if (row && row.person === p && /^bk-/.test(row.id) && !bankTrue_(row.deleted)) { update("transactions", row.id, {deleted: true}); updates[updates.length - 1].pend = {id: id, x: x}; }
      delete pending[id];
    });
    Object.keys(pending).forEach(function (id) { if (!pending[id] || !pending[id].date || D.diff(pending[id].date, today) >= BANK_RECENT_DAYS_) delete pending[id]; });

    // New rows first, in one write per tab, so what was read is kept even if this run runs short of time. Then the
    // changes, every row on its own (one that can't be written is skipped and logged, and the rest go on). Each is a
    // write of its own, and a first import can link hundreds of rows you logged by hand, so they stop in good time
    // (Apps Script stops a run at 6 minutes and would lose the lot): the rest are made on the next run, which finds
    // the rows already written and only does what's left.
    var now = Date.now(), added = 0, updated = 0, failed = 0, stopAt = BANK_T0_ ? BANK_T0_ + BANK_APPLY_STOP_ : 0, stopped = false;
    Object.keys(newRows).forEach(function (t) { added += bankAppend_(p, t, newRows[t], now); });
    SpreadsheetApp.flush();
    for (var ui = 0; ui < updates.length; ui++) {
      var u = updates[ui];
      if (stopAt && Date.now() > stopAt) { stopped = true; if (u.pend) pending[u.pend.id] = u.pend.x; continue; }   // a hold not taken off yet is still watched
      try { applyOne_(p, {op: "put", table: u.t, row: u.row}, now, "bank", {sys: true}); updated++; }
      // (a hold that couldn't be taken off is still watched, and the next read doesn't skip saving, so it's tried again)
      catch (e) { failed++; if (u.pend) pending[u.pend.id] = u.pend.x; Logger.log("Bank feed skipped " + u.t + " " + u.row.id + ": " + (e && e.message || e)); }
    }
    SpreadsheetApp.flush();
    var s1 = bankStatus_(p); s1.pending = pending; delete s1.peers; bankSaveStatus_(p, s1);
    return {added: added, updated: updated, stopped: stopped, failed: failed};
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
// from the phone: waits for any read or sign-in in progress, so a token refreshed at that moment can't come back
function bankDisconnectLocked_(me, why) {
  var lock = bankLock_();
  if (!lock.tryLock(30000)) return {ok: false, error: "The bank is being read right now. Try again in a minute."};
  try { return bankDisconnect_(me, why); } finally { lock.releaseLock(); }
}
// Monzo: ends the session at Monzo too. An expired token is refreshed first, so the log-out really happens.
function monzoLogout_(me, tok) {
  var out = function (t) { try { return bankHttp_("post", MONZO_API_ + "/oauth2/logout", {headers: {Authorization: "Bearer " + t.access}}).code; } catch (e) { return 0; } };
  var code = tok.access ? out(tok) : 401;
  if (code === 401 || code === 403) { try { var fresh = monzoRefresh_(me, tok); code = out(fresh); } catch (e) {} }
  return code >= 200 && code < 300;
}
// call with the bank lock held (bankDisconnectLocked_), or from inside bankRun_
function bankDisconnect_(me, why) {
  var tok = bankGet_(bankKey_("TOKEN", me)), had = !!tok || !!bankGet_(bankKey_("CLIENT", me));
  // first, so a token refreshed at this moment is dropped as soon as it's saved (bankGone_)
  var conn = bankConnId_(tok || bankGet_(bankKey_("TOKEN_NEXT", me))); if (conn) bankSet_(bankKey_("GONE", me), conn);
  if (tok && tok.provider === "monzo") { var gone = monzoLogout_(me, tok); if (!gone) Logger.log("Monzo log-out didn't go through; Budgie has forgotten its key. To be sure, delete the client in the Monzo developer portal."); }
  bankDel_(bankKey_("TOKEN", me)); bankDel_(bankKey_("TOKEN_NEXT", me)); bankDel_(bankKey_("CLIENT", me));
  bankStates_().forEach(function (x) { if (!x.v || x.v.person === me) bankDel_(x.k); });
  bankSaveStatus_(me, {provider: "", accounts: [], lastSync: 0, lastError: why || ""});
  if (had) bankNotify_(me, why ? "Budgie disconnected the bank (" + why + ")" : "the bank was disconnected");
  return {ok: true};
}

// ---------- polling (no webhooks) ----------
function bankPeople_() { return readTable_("people").rows.map(function (r) { return r.id; }).filter(function (id) { return id && bankGet_(bankKey_("TOKEN", id)); }); }
function bankPoll() {
  CACHE_ = {}; bankStart_(); bankMoveSecrets_();
  // a first import still coming in (which can take most of a run) goes last, so the other one of you is still read
  var people = bankPeople_(), done = {}; people.forEach(function (p) { done[p] = !!bankStatus_(p).fullDone; });
  people.sort(function (a, b) { return (done[a] ? 0 : 1) - (done[b] ? 0 : 1); });
  people.forEach(function (p) {
    var s = bankStatus_(p);
    if (s.needsReconnect || (s.backoffUntil && s.backoffUntil > Date.now())) return;
    if (Date.now() - BANK_T0_ > BANK_READ_BUDGET_ / 2) return;   // the next poll reads the rest, well inside the 6 minutes
    try { bankRun_(p); } catch (e) {}
  });
}
// runs every minute only while a new Monzo connection waits to be approved, or a first read of your history has
// more to bring in, then removes itself
function bankPendingImports() {
  CACHE_ = {}; bankStart_(); bankMoveSecrets_();
  var waiting = 0;
  bankPeople_().forEach(function (p) {
    var s = bankStatus_(p), more = (s.again || (s.cursor && !s.fullDone)) && !s.needsReconnect; if (!s.waiting && !more) return;
    // (runs cut off at 6 minutes count too, so they can't go on every minute either)
    if (!s.waiting && (+s.minuteFails || 0) >= BANK_MINUTE_TRIES_) return;
    if (s.waiting && !(s.firstUntil > Date.now())) { s.waiting = false; s.needsReconnect = true; s.lastError = "Budgie wasn't approved in the Monzo app in time. Reconnect and approve it there."; bankSaveStatus_(p, s); return; }
    if (Date.now() - BANK_T0_ > BANK_READ_BUDGET_ / 2) { waiting++; return; }   // the next minute
    var res = bankRun_(p), s2 = bankStatus_(p);
    // a history that keeps failing to come in (not just waiting for the approval) stops being tried every minute
    // after a few goes, so it can't use up the owner's daily allowance of trigger time; the 15-minute read carries on
    // with it, and the next one that works starts the minute runs again
    var fails = res.ok || s2.waiting ? 0 : (+s2.minuteFails || 0) + 1;
    if (fails !== (+s2.minuteFails || 0)) { if (fails) s2.minuteFails = fails; else delete s2.minuteFails; bankSaveStatus_(p, s2); }
    if (s2.waiting || ((s2.again || (s2.cursor && !s2.fullDone)) && !s2.needsReconnect && fails < BANK_MINUTE_TRIES_)) waiting++;
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
