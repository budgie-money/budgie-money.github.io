/**
 * Budgie: the backend for the "Budgie data" Google Sheet.
 * Engine.gs (the same engine.js the app uses) must sit beside this file.
 *
 * Setup (once):
 *   1. In the sheet: Extensions > Apps Script. Paste this into Code.gs and engine.js into a file called Engine.gs. Save.
 *   2. Run "setup". Allow access when Google asks. It makes every tab and a key for each person.
 *   3. Deploy > New deployment > Web app. Execute as: Me. Who has access: Anyone. Deploy and copy the URL.
 *   4. Add a Script Property WEB_APP_URL with that URL (Project Settings > Script Properties), run "connectLinks".
 *      Open each link on that person's phone.
 *
 * Keys live only in this script's properties. Run "newKey" with a name to change someone's key.
 * Other apps (Peckish) get their own narrower key: run appLink("ethan", "peckish") and open the link it logs.
 */
var WEB_APP_URL = "";   // leave blank: the Script Property WEB_APP_URL is used, so pasting new code never loses it
// the web app's own address (ending /exec): for connect links, linked apps and the bank's sign-in page
function webAppUrl_() {
  var url = WEB_APP_URL;
  if (!url) { try { url = PropertiesService.getScriptProperties().getProperty("WEB_APP_URL") || ""; } catch (e) { url = ""; } }
  if (!url) { try { url = ScriptApp.getService().getUrl() || ""; } catch (e) { url = ""; } }
  return String(url).trim();
}
var NO_URL_ = "Add a Script Property WEB_APP_URL (Project Settings > Script Properties) with your Web app URL, ending /exec (Deploy > Manage deployments), and run again.";
var APP_URL = "https://budgie-money.github.io/";
var SCHEMA_VERSION = 1;
var COMMON = ["deleted", "updated", "by"];
var SCHEMA = {
  people: ["id", "name", "bank", "potWord", "partner", "colour"],
  accounts: ["id", "owner", "name", "kind", "purpose", "fallback", "order"],
  income: ["id", "person", "name", "amount", "account", "isPay", "unit", "every", "on", "shift", "start", "end", "dates", "notes"],
  bills: ["id", "person", "name", "category", "amount", "account", "split", "variable", "unit", "every", "on", "shift", "start", "end", "dates", "notes"],
  budgets: ["id", "person", "name", "amount", "mode", "account", "carry", "start", "end", "notes"],
  splits: ["id", "name", "shares", "notes"],
  transfers: ["id", "from", "to", "name", "amount", "fromAccount", "toAccount", "purpose", "unit", "every", "on", "shift", "start", "end", "dates", "notes"],
  transactions: ["id", "date", "person", "amount", "budget", "account", "split", "note", "source", "bankId", "review", "splitHint"],
  moves: ["id", "date", "person", "from", "to", "amount", "key", "note", "review"],
  settlements: ["id", "date", "from", "to", "amount", "fromAccount", "toAccount", "loan", "key", "note"],
  loans: ["id", "lender", "borrower", "name", "amount", "date", "account", "repay", "repayFrom", "repayDay", "notes"],
  goals: ["id", "owners", "name", "target", "due", "accounts", "kind", "extra", "price", "notes"],
  valuations: ["id", "account", "date", "amount", "note"],
  amounts: ["id", "item", "start", "amount", "note"],
  exceptions: ["id", "item", "date", "action", "newDate", "amount", "note"],
  settings: ["id", "person", "key", "value"],
  gifts: ["id", "person", "name", "idea", "occasion", "date", "limit", "cost", "bought", "notes"],
  prices: ["id", "fund", "date", "price", "source"],
  meta: ["key", "value"]
};
// tables only this script writes: the app can read them but never change them
var SERVER_ONLY = {meta: true, prices: true};
var HELP = {
  people: "One row per person.", accounts: "Every bank account, pot, Space, ISA and LISA. kind: main, pot, saving, isa, lisa, pension, credit. fallback = TRUE on the one pot that covers going over budget.",
  income: "Money that comes in on a schedule. isPay = TRUE for your salary (it sets your pay periods).", bills: "Money that goes out on a schedule. split: a row id from splits if you share it.",
  budgets: "mode: daily, weekly, oneoff, saving or remainder (gets whatever is left).", splits: "shares: \"ethan:2, sophie:1\" for parts, or \"sophie=500\" for a fixed amount.",
  transfers: "One of you paying the other on a schedule, like a rent share.", transactions: "Every payment you log.", moves: "Pot moves you ticked off in the app.",
  settlements: "One-off payments between you two. loan: a row id from loans if it repays one.", loans: "Money one of you owes the other. repay: amount each month from repayFrom.",
  goals: "owners: who it belongs to. accounts: which accounts count towards it.", valuations: "A balance you checked. Everything after its date is worked out.",
  amounts: "A price or pay change for a bill, income or budget, from the start date.", exceptions: "A change to one date: skip, move (newDate) or amount (what it really was).",
  settings: "Settings for each person.", gifts: "Gift ideas and what you bought. Only you see your own list.", prices: "Fund prices for the LISA tracker, filled in by the script.", meta: "Housekeeping."
};

// ---------- setup ----------
function setup() {
  var ss = ss_();
  if (/^Untitled/.test(ss.getName())) ss.rename("Budgie data");
  try { ss.setSpreadsheetTimeZone("Europe/London"); } catch (x) {}
  Object.keys(SCHEMA).forEach(function (t) { ensureTab_(ss, t); });
  var props = PropertiesService.getScriptProperties();
  readTable_("people").rows.forEach(function (p) { if (!props.getProperty("KEY_" + p.id)) props.setProperty("KEY_" + p.id, makeKey_()); });
  keysChanged_();
  setMeta_("schemaVersion", SCHEMA_VERSION);
  var blank = ss.getSheetByName("Sheet1"); if (blank && blank.getLastRow() === 0 && ss.getSheets().length > 1) ss.deleteSheet(blank);
  Logger.log("Tabs ready. People with keys: " + readTable_("people").rows.map(function (p) { return p.id; }).join(", "));
  Logger.log("Next: Deploy > New deployment > Web app (Execute as: Me, Who has access: Anyone), add it as the Script Property WEB_APP_URL, run connectLinks.");
}
function connectLinks() {
  var url = webAppUrl_();
  if (!/\/exec$/.test(url)) throw new Error(NO_URL_);
  var props = PropertiesService.getScriptProperties();
  readTable_("people").rows.forEach(function (p) {
    var k = props.getProperty("KEY_" + p.id); if (!k) return;
    Logger.log(p.name + ": " + APP_URL + "#connect=" + Utilities.base64EncodeWebSafe(JSON.stringify({u: url, k: k})));
  });
}
// newKey("sophie") changes Sophie's Budgie key; newKey("ethan", "peckish") changes only Ethan's Peckish key
function newKey(personId, app) {
  if (!personId) throw new Error("Run newKey from another function, e.g. newKey('sophie').");
  if (app) return newAppKey(personId, app);
  var props = PropertiesService.getScriptProperties(), old = props.getProperty("KEY_" + personId);
  props.setProperty("KEY_" + personId, makeKey_()); forgetKey_(old);
  // a new Budgie key (a lost phone, say) also cuts off that person's linked apps; link them again from the app
  Object.keys(APPS_).forEach(function (a) { var ak = props.getProperty(appKeyName_(personId, a)); if (ak) { props.deleteProperty(appKeyName_(personId, a)); forgetKey_(ak); } });
  Logger.log("New key made for " + personId + " (their linked apps are unlinked too). Run connectLinks and reconnect that phone.");
}
function makeKey_() { return (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, "").toLowerCase(); }

// ---------- keys for other apps (Peckish) ----------
// an app key can only do what its app needs: see APP_RULES_ below
var APPS_ = {peckish: {name: "Peckish", url: "https://alertrobot.github.io/es-kitchen/"}, caledonite: {name: "Caledonite", url: "https://alertrobot.github.io/caledonite/"}};
function appKeyName_(personId, app) { return "APPKEY_" + personId + "_" + app; }
function makeAppKey_(app) { return "app_" + app + "_" + makeKey_(); }
function appCheckArgs_(personId, app) {
  if (!personId || !app) throw new Error("Run it from another function, e.g. appLink('ethan', 'peckish').");
  if (!APPS_[app]) throw new Error("Budgie doesn't know an app called " + app + ". Known: " + Object.keys(APPS_).join(", ") + ".");
  if (!readTable_("people").rows.some(function (p) { return p.id === personId; })) throw new Error("No person called " + personId + " in the people tab.");
}
function appWebUrl_() {
  var url = webAppUrl_();
  if (!/\/exec$/.test(url)) throw new Error(NO_URL_);
  return url;
}
function appLinkFor_(app, k) { return APPS_[app].url + "#connect=" + Utilities.base64EncodeWebSafe(JSON.stringify({u: appWebUrl_(), k: k})); }
/** Logs a connect link for another app (e.g. appLink("ethan", "peckish")). Makes the app's key the first time. */
function appLink(personId, app) {
  appCheckArgs_(personId, app);
  appWebUrl_();
  var props = PropertiesService.getScriptProperties(), k = props.getProperty(appKeyName_(personId, app));
  if (!k) { k = makeAppKey_(app); props.setProperty(appKeyName_(personId, app), k); keysChanged_(); }
  var who = (readTable_("people").rows.filter(function (p) { return p.id === personId; })[0] || {}).name || personId;
  var link = appLinkFor_(app, k);
  Logger.log(who + " (" + APPS_[app].name + "): " + link);
  return link;
}
// from the app (a person's own full key only): link, unlink and list their other apps
// app.link always makes a new key, so making a new link cuts off any old copy of the last one
function appKeyAction_(me, b) {
  var props = PropertiesService.getScriptProperties();
  if (b.action === "app.status") { var apps = {}; Object.keys(APPS_).forEach(function (a) { apps[a] = !!props.getProperty(appKeyName_(me, a)); }); return {ok: true, keyType: "full", apps: apps}; }
  var app = String(b.app || "");
  if (!APPS_[app]) return {ok: false, keyType: "full", error: "Budgie doesn't know that app."};
  var old = props.getProperty(appKeyName_(me, app));
  if (b.action === "app.unlink") { if (old) { props.deleteProperty(appKeyName_(me, app)); forgetKey_(old); } return {ok: true, keyType: "full"}; }
  var k = makeAppKey_(app), link = appLinkFor_(app, k);
  props.setProperty(appKeyName_(me, app), k); forgetKey_(old);
  return {ok: true, keyType: "full", link: link};
}
/** Changes one person's key for one app (the old one stops working), and logs the new link. */
function newAppKey(personId, app) {
  appCheckArgs_(personId, app);
  var props = PropertiesService.getScriptProperties(), old = props.getProperty(appKeyName_(personId, app));
  props.setProperty(appKeyName_(personId, app), makeAppKey_(app)); forgetKey_(old);
  Logger.log("New " + APPS_[app].name + " key made for " + personId + ".");
  try { return appLink(personId, app); } catch (e) { Logger.log(String(e.message || e)); return ""; }
}
function ensureTab_(ss, t) {
  var cols = SCHEMA[t].concat(t === "meta" ? [] : COMMON), sh = ss.getSheetByName(t);
  if (!sh) { sh = ss.insertSheet(t); sh.getRange(1, 1, 1, cols.length).setValues([cols]).setFontWeight("bold").setBackground("#E3ECF5"); sh.setFrozenRows(1); sh.getRange(1, 1).setNote(HELP[t] || ""); return sh; }
  var head = sh.getRange(1, 1, 1, Math.max(1, sh.getLastColumn())).getValues()[0].map(String);
  cols.forEach(function (c) { if (head.indexOf(c) < 0) { sh.getRange(1, head.length + 1).setValue(c).setFontWeight("bold").setBackground("#E3ECF5"); head.push(c); } });
  return sh;
}

// ---------- web ----------
// keys only travel in POST bodies, never in a URL (where they'd end up in logs and history)
function doGet(e) {
  // Monzo sends the browser back here after you sign in (BankFeeds.gs)
  var q = (e && e.parameter) || {};
  if (/^[A-Za-z0-9]{64}$/.test(String(q.state || "")) && (q.code || q.error) && typeof bankCallback_ === "function") return bankCallback_(q);
  return json_({ok: true, app: "Budgie", note: "The app talks to this with POST."});
}
function doPost(e) {
  var body = {};
  try { body = JSON.parse((e && e.postData && e.postData.contents) || "{}"); } catch (x) {}
  return handle_(body);
}
// ok:false only when the whole request fails (wrong key, the sheet busy). Changes that can't be saved come back
// in rejected [{i, table, id, error}] (i = position in the batch); every other change was saved.
function handle_(b) {
  var lock = LockService.getScriptLock(), locked = false;
  try {
    var who = whoIs_(b.key), me = who.person, app = who.app, keyType = app ? "app" : "full";
    var notAllowed = function () { return json_({ok: false, keyType: "app", app: app, error: NOT_ALLOWED_}); };
    if (b.action === "ping") return json_(app ? {ok: true, person: me, app: app, keyType: keyType} : {ok: true, person: me, keyType: keyType});
    // another app's key: only the actions its app needs (Caledonite: the calendar, nothing else)
    var rule = app ? APP_RULES_[app] : null;
    if (b.action === "app.calendar") {
      if (app && !(rule.actions || {})["app.calendar"]) return notAllowed();
      lock.waitLock(25000); locked = true;
      var csnap; try { csnap = snapshot_(); } finally { lock.releaseLock(); locked = false; }
      var cal = appCalendar_(me, csnap); cal.keyType = keyType; return json_(cal);
    }
    // linking other apps: only with a person's own full key
    if (b.action === "app.link" || b.action === "app.unlink" || b.action === "app.status") return app ? notAllowed() : json_(appKeyAction_(me, b));
    if (app && !rule.reads) return notAllowed();
    // bank feeds (BankFeeds.gs): always about the caller's own bank, and never for another app's key
    if (typeof b.action === "string" && /^bank\./.test(b.action)) {
      if (app) return notAllowed();
      if (typeof bankAction_ !== "function") return json_({ok: false, keyType: keyType, error: "Bank feeds aren't set up on this sheet"});
      var br = bankAction_(me, b); br.keyType = keyType;
      if (b.action === "bank.status" && br.ok) br.apps = appKeyAction_(me, {action: "app.status"}).apps;
      return json_(br);
    }
    if (app && b.action) return notAllowed();
    var applied = [], rejected = [], snap;
    // reads take the lock too, so a sync never sees half of another phone's batch and skips the rest;
    // the lock covers writing and taking a copy of the tables, the working out happens after it's released
    lock.waitLock(25000); locked = true;
    try {
      if (Array.isArray(b.ops) && b.ops.length) { var res = applyOps_(me, b.ops, app); applied = res.applied; rejected = res.rejected; if (applied.length) SpreadsheetApp.flush(); }
      snap = snapshot_();
    } finally { lock.releaseLock(); locked = false; }
    var out = app ? appSync_(me, app, b.since || "", !!b.full, snap) : sync_(me, b.since || "", !!b.full, snap);
    out.applied = applied; out.rejected = rejected; out.keyType = keyType;
    if (applied.length) { try { maybeRefreshViews_(); } catch (x) { out.viewError = String(x); } }
    return json_(out);
  } catch (err) {
    if (locked) { try { lock.releaseLock(); } catch (x) {} }
    return json_({ok: false, error: String(err && err.message || err)});
  }
}
var NOT_ALLOWED_ = "That's not allowed with this link";
function json_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }
// who a key belongs to: {person, app} (app is "" for a person's own Budgie key)
// A key that isn't the right shape is turned away before anything is read, and answers are kept for 10 minutes,
// so a flood of made-up keys can't use up the script's quota.
var KEY_RE_ = /^[0-9a-f]{64}$/, APPKEY_RE_ = /^app_[a-z]+_[0-9a-f]{64}$/;
function keyHash_(k) { try { return Utilities.base64EncodeWebSafe(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(k))); } catch (e) { return String(k); } }
function keyCache_() { try { return typeof CacheService !== "undefined" ? CacheService.getScriptCache() : null; } catch (e) { return null; } }
// Every key's owner is kept in the cache as one list (by the key's hash, never the key), so a key that isn't on it,
// made up or old, is turned away without reading the properties again. The list is read again at most once a minute
// when a key isn't found, and straight away after any key changes.
function forgetKey_(k) { try { var c = keyCache_(); if (c && c.remove) c.remove("keys:all"); } catch (e) {} }
function keysChanged_() { forgetKey_("all"); }
function keyList_(force) {
  var cache = keyCache_(), hit = null;
  if (!force) { try { hit = cache ? cache.get("keys:all") : null; } catch (e) { hit = null; } if (hit) { try { return JSON.parse(hit); } catch (e) {} } }
  var all = PropertiesService.getScriptProperties().getProperties(), list = {at: Date.now(), who: {}};
  for (var name in all) {
    var k = String(all[name]), m = name.match(/^KEY_(.+)$/), who = null;
    if (m && KEY_RE_.test(k)) who = {person: m[1], app: ""};
    else if ((m = name.match(/^APPKEY_(.+)_([a-z]+)$/)) && APPKEY_RE_.test(k) && APPS_[m[2]]) who = {person: m[1], app: m[2]};
    if (who) list.who[keyHash_(k)] = who;
  }
  try { if (cache) cache.put("keys:all", JSON.stringify(list), 600); } catch (e) {}
  return list;
}
function whoIs_(k) {
  if (!k) throw new Error("No app key");
  k = String(k);
  if (!KEY_RE_.test(k) && !APPKEY_RE_.test(k)) throw new Error("Wrong app key");
  var h = keyHash_(k), list = keyList_(false), who = list.who[h];
  if (!who && Date.now() - (+list.at || 0) > 60000) who = keyList_(true).who[h];
  if (!who) throw new Error("Wrong app key");
  // the list only says whose key it might be; the key itself is checked against the properties every time (one read),
  // so a key that was changed, unlinked or deleted by hand stops working straight away
  var name = who.app ? appKeyName_(who.person, who.app) : "KEY_" + who.person;
  if (PropertiesService.getScriptProperties().getProperty(name) !== k) { keysChanged_(); throw new Error("Wrong app key"); }
  return {person: who.person, app: who.app};
}

// ---------- reading ----------
var SS_ = null, TZ_ = null, CACHE_ = {};
function ss_() { if (!SS_) SS_ = SpreadsheetApp.getActiveSpreadsheet() || SpreadsheetApp.openById(PropertiesService.getScriptProperties().getProperty("SHEET_ID")); return SS_; }
function tz_() { if (!TZ_) TZ_ = ss_().getSpreadsheetTimeZone() || "Europe/London"; return TZ_; }
function out_(v) { return v instanceof Date ? Utilities.formatDate(v, tz_(), "yyyy-MM-dd") : v; }
function readTable_(t) {
  if (CACHE_[t]) return CACHE_[t];
  var sh = ss_().getSheetByName(t); if (!sh) return {head: [], rows: [], sheet: null};
  var vals = sh.getDataRange().getValues(), head = (vals[0] || []).map(String), rows = [];
  for (var r = 1; r < vals.length; r++) {
    var o = {_row: r + 1}, any = false;
    for (var c = 0; c < head.length; c++) { if (!head[c]) continue; var v = out_(vals[r][c]); o[head[c]] = v; if (v !== "" && v !== null) any = true; }
    if (any) rows.push(o);
  }
  CACHE_[t] = {head: head, rows: rows, sheet: sh}; return CACHE_[t];
}
function allTables_() { var t = {}; Object.keys(SCHEMA).forEach(function (k) { t[k] = readTable_(k).rows.map(strip_); }); return t; }
// rows by id, built once per read of a tab (the first row wins if an id is ever repeated)
function index_(t) { var tab = readTable_(t); if (!tab.idx) { tab.idx = {}; tab.rows.forEach(function (r) { if (r.id !== undefined && r.id !== "" && !tab.idx[r.id]) tab.idx[r.id] = r; }); } return tab.idx; }
function strip_(r) { var o = {}; for (var k in r) if (k !== "_row") o[k] = r[k]; return o; }
function setMeta_(k, v) { var t = readTable_("meta"), row = t.rows.filter(function (r) { return r.key === k; })[0]; if (row) t.sheet.getRange(row._row, 2).setValue(v); else t.sheet.appendRow([k, v]); CACHE_.meta = null; }

// ---------- who may see and change what ----------
function owner_(t, r) {
  switch (t) {
    case "people": return [r.id];
    case "accounts": return [r.owner];
    case "income": case "bills": case "budgets": case "transactions": case "moves": case "settings": case "gifts": return [r.person];
    case "transfers": case "settlements": return [r.from, r.to];
    case "loans": return [r.lender, r.borrower];
    case "goals": return String(r.owners || "").split(/[,\s]+/);
    case "valuations": var a = byId_("accounts", r.account); return a ? [a.owner] : [];
    case "amounts": case "exceptions": var it = itemOwner_(r.item); return it;
    default: return null; // splits, prices, meta: shared
  }
}
function byId_(t, id) { return index_(t)[id] || null; }
var ITEM_TABS_ = ["income", "bills", "budgets", "transfers", "loans"];
function findItem_(id) {
  for (var i = 0; i < ITEM_TABS_.length; i++) { var r = byId_(ITEM_TABS_[i], id); if (r) return {t: ITEM_TABS_[i], row: r}; }
  return null;
}
function itemOwner_(id) { var it = findItem_(id); return it ? owner_(it.t, it.row) : []; }
function isLisa_(accId) { var a = accId ? byId_("accounts", accId) : null; return !!a && /lisa/.test(String(a.kind)); }
function canSee_(me, t, r, sharing) {
  if (t === "meta" || t === "prices") return true;
  var o = owner_(t, r); if (o === null || o.indexOf(me) >= 0) return true;
  // the partner's own things: names, shared items, and their LISA (it counts towards the house)
  if (t === "accounts" || t === "people") return true;
  if (t === "transactions") return !!r.split || !!sharing.payments;
  if (t === "settings") return /^(share\.|theme|colour|start$|lisa\.)/.test(String(r.key));
  if (t === "bills") return !!r.split || !!sharing.payments;
  if (t === "valuations") return !!sharing.payments || isLisa_(r.account);
  if (t === "income" || t === "budgets") return !!sharing.payments || isLisa_(r.account);
  if (t === "moves") return isLisa_(r.to) || isLisa_(r.from);
  // a price change or a one-off change is only as visible as the thing it changes (an actual pay, a private bill)
  if (t === "amounts" || t === "exceptions") { var it = findItem_(r.item); return !!it && canSee_(me, it.t, it.row, sharing); }
  return false;
}

// ---------- writing ----------
// each change is saved or refused on its own, so one refused change never holds up the rest
function applyOps_(me, ops, app) {
  var now = Date.now(), applied = [], rejected = [];
  ops.forEach(function (op, i) {
    var t = op && op.table, id = op && (op.id || (op.row && op.row.id));
    try { applyOne_(me, op || {}, now, "", {app: app || ""}); applied.push({table: t, id: id || (op && op.row && t === "settings" && op.row.person && op.row.key ? op.row.person + ":" + op.row.key : id)}); }
    catch (e) { rejected.push({i: i, table: t || "", id: id || "", error: String(e && e.message || e)}); }
  });
  return {applied: applied, rejected: rejected};
}
// text that a sheet would read as a formula (or would lose a leading apostrophe from) is stored as plain text.
// Leading spaces and control characters are looked past, so " =HYPERLINK(…)" is caught too.
// Numbers, true/false, dates and ids are left as they are.
function cell_(v) {
  if (v === undefined || v === null) return "";
  if (typeof v !== "string") return v;
  if (/^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(v)) return v;
  var t = v.replace(/^[\s\u0000-\u001f\u007f-\u009f\u00a0\u1680\u180e\u2000-\u200f\u2028-\u202f\u205f-\u206f\u3000\ufeff]+/, "");
  return /^[=+\-@']/.test(t) ? "'" + v : v;
}
// what only the server may change on a row the bank wrote or linked (a phone that's behind can't undo it)
var BANK_OWNED_ = ["amount", "date", "bankId", "deleted", "account", "from", "to", "person", "source", "key"];
function isBankRow_(t, r) { return !!r && ((t === "transactions" && !!r.bankId) || ((t === "moves" || t === "valuations") && /^bk-/.test(String(r.id)))); }
// ids that tell a payday tick or an occurrence change apart: "x-<item>-<yyyy-mm-dd>…" for exceptions
function exceptionIdOk_(id, item) {
  var pre = "x-" + item + "-";
  return !!item && String(id).indexOf(pre) === 0 && /^\d{4}-\d{2}-\d{2}(-[A-Za-z0-9_-]+)?$/.test(String(id).slice(pre.length));
}
// opts: {app: "peckish" for another app's key, sys: true for the server's own writes (the bank feed)}
function applyOne_(me, op, now, by, opts) {
  opts = opts || {};
  var t = op.table, sys = !!opts.sys, app = opts.app || "";
  if (!SCHEMA[t]) throw new Error("Unknown table " + t);
  if (SERVER_ONLY[t]) throw new Error("The sheet fills in " + t + " itself");
  if (app) appAllowed_(app, me, t, op);
  var src = op.row || op.fields || {};
  var id = op.id || src.id || (t === "settings" && op.op !== "delete" && src.person && src.key ? src.person + ":" + src.key : ""); if (!id) throw new Error("Missing id");
  id = String(id);
  var tab = readTable_(t), sh = tab.sheet || ensureTab_(ss_(), t);
  var existing = byId_(t, id);
  var row = existing ? strip_(existing) : {};
  // a new row can't take an id that belongs to someone else's kind of row
  if (!existing && !sys) {
    if (/^bk-/.test(id)) throw new Error("That id is kept for the bank feed");
    if (/^t-pk-/.test(id) && app !== "peckish") throw new Error("That id is kept for Peckish");
    if (t === "settings" && (String(src.person) !== String(me) || id !== me + ":" + src.key)) throw new Error("A setting's id is your name and its key");
    if (t === "exceptions" && !exceptionIdOk_(id, src.item)) throw new Error("A change to one date needs an id like x-<item>-<date>");
  }
  if (existing && t === "settings" && !sys && src.key !== undefined && String(src.key) !== String(existing.key)) throw new Error("A setting's key can't change");
  var bankRow = !sys && isBankRow_(t, existing);
  if (op.op === "delete") { if (!existing) return; row.deleted = true; }
  else {
    for (var k in src) {
      if (k === "updated" || k === "by" || k === "_row") continue;
      if (!sys && k === "bankId") continue;   // only the bank feed links a payment to the bank
      // a phone may only change these on a bank row: what it's for, the split, the note, and that it's checked
      if (bankRow && BANK_OWNED_.indexOf(k) >= 0) { if (k === "deleted" && toBoolCell_(src[k]) && !toBoolCell_(existing.deleted)) row.deleted = true; continue; }
      row[k] = src[k];
    }
    row.id = id;
  }
  if (app && existing && existing.bankId && (op.op === "delete" || toBoolCell_(row.deleted))) {
    // the bank has matched this shop to a real payment: Peckish taking it off only unlinks it from Peckish, and the
    // payment stays in Budgie for its person to check, so a real payment can't vanish
    if (existing.person !== me || existing.source !== app) throw new Error(NOT_ALLOWED_);
    row = strip_(existing); row.source = ""; row.review = true; row.deleted = false;
    row.note = String(existing.note || "").replace(/ \(Peckish\)$/, "") + " (taken off in Peckish)";
  } else if (app) appRowOk_(app, me, t, row, existing);
  // the app and the bank both ticking the same payday move: the second one is kept, marked as a copy
  if (!existing && !sys && t === "moves" && /^pay:/.test(String(row.key || "")) && !toBoolCell_(row.deleted)) {
    var same = tab.rows.filter(function (r) { return r.key === row.key && r.person === row.person && !toBoolCell_(r.deleted); })[0];
    if (same) { row.deleted = true; row.note = "Same payday move as " + same.id; }
  }
  // people are set up in the sheet; you can change your own name or colour, never who your partner is
  if (t === "people") {
    if (!existing) throw new Error("People are added in the sheet");
    if (op.op === "delete") throw new Error("You can't delete a person");
    if (String(row.partner || "") !== String(existing.partner || "")) throw new Error("Partners are set in the sheet");
  }
  if (!sys) {
    var who = owner_(t, row);
    if (who !== null && who.indexOf(me) < 0) throw new Error("You can't change that (" + t + ")");
    if (existing) { var ow = owner_(t, existing); if (ow !== null && ow.indexOf(me) < 0) throw new Error("You can't change that (" + t + ")"); }
  }
  row.updated = now; row.by = by || me;
  var head = tab.head.length ? tab.head : SCHEMA[t].concat(COMMON);
  Object.keys(row).forEach(function (k) { if (head.indexOf(k) < 0 && (SCHEMA[t].indexOf(k) >= 0 || COMMON.indexOf(k) >= 0)) { sh.getRange(1, head.length + 1).setValue(k); head.push(k); } });
  tab.head = head;
  var line = head.map(function (h) { return cell_(row[h]); });
  // keep the copy of the tab in step, rather than reading the whole tab again after every change
  if (existing && HIDE_ROWS_[t]) noteHidden_(t, existing, row);
  if (existing) {
    sh.getRange(existing._row, 1, 1, line.length).setValues([line]);
    Object.keys(row).forEach(function (k) { existing[k] = row[k]; });
  } else {
    sh.appendRow(line);
    var added = {_row: sh.getLastRow()}; Object.keys(row).forEach(function (k) { added[k] = row[k]; });
    tab.rows.push(added); if (tab.idx) tab.idx[id] = added;
  }
}

function toBoolCell_(v) { return v === true || /^(true|yes|1)$/i.test(String(v === undefined || v === null ? "" : v)); }

// ---------- what another app's key may do ----------
// Peckish: sees names, its person's budgets and accounts, the splits, and food shops; adds and changes only its own
// food shops (ids t-pk-…, source peckish, for its person). Nothing else: no settings, no bank, no other tabs.
var APP_RULES_ = {
  peckish: {
    write: {transactions: true},
    reads: {people: ["id", "name"], budgets: ["id", "person", "name", "account", "mode"], splits: null, accounts: ["id", "owner", "name", "kind"], transactions: null},
    food: /food|grocer/i
  },
  // Caledonite: no sync, no tables; only app.calendar (the person's own paydays, bills and fun money)
  caledonite: {write: {}, reads: null, actions: {"app.calendar": true}}
};
// app.calendar: what Caledonite shows from Budgie, worked out here from exactly the rows the person's own phone gets
// (so the partner's private bills and pay never come into it), and only the person's own items
var CAL_FUN_RE_ = /fun|entertain|going out|leisure|social|date|treat/i;
function calMoney_(n) {
  var v = Math.round((+n || 0) * 100) / 100, neg = v < 0, a = Math.abs(v), whole = Math.floor(a), frac = Math.round((a - whole) * 100);
  var w = String(whole).replace(/\B(?=(\d{3})+(?!\d))/g, ","), f = frac ? "." + (frac < 10 ? "0" + frac : String(frac)).replace(/0$/, "") : "";
  return (neg ? "-£" : "£") + w + f;
}
function appCalendar_(me, snap) {
  var today = Utilities.formatDate(new Date(), tz_(), "yyyy-MM-dd"), db = Budgie.load(sync_(me, "", true, snap).rows, today), days = {};
  (Budgie.coming(db, me, Budgie.addDays(today, -14), 120) || []).forEach(function (c) {
    if (!c || !c.date) return;
    var isPay = /payday/i.test(c.name || "") || c.table === "income";
    if (!isPay && c.table !== "bills") return;
    (days[c.date] = days[c.date] || []).push({name: isPay ? (c.name || "Payday") : String(c.name), sub: isPay ? (c.amount ? calMoney_(c.amount) : "") : c.amount ? "Bill, " + calMoney_(c.amount) : "Bill", pay: isPay, amount: c.amount || 0});
  });
  var fun = null;
  try {
    var per = Budgie.periodAt(db, me, today), plan = Budgie.planFor(db, me, per), st = Budgie.budgetState(db, me, per), left = 0, names = [];
    (plan.lines || []).forEach(function (l) { if (l.kind !== "spend" || !CAL_FUN_RE_.test(l.name || "")) return; var x = st[l.id]; if (!x) return; left += Math.max(0, +x.left || 0); names.push(l.name); });
    if (names.length) fun = {left: Math.round(left * 100) / 100, names: names, until: per.next || null};
  } catch (e) { fun = null; }
  return {ok: true, person: me, name: (Budgie.person(db, me) || {}).name || me, days: days, fun: fun, synced: snap.at};
}
function appAllowed_(app, me, t, op) {
  var rule = APP_RULES_[app]; if (!rule || !rule.write[t]) throw new Error(NOT_ALLOWED_);
  var id = String(op.id || (op.row && op.row.id) || "");
  if (!/^t-pk-[A-Za-z0-9_-]+$/.test(id)) throw new Error(NOT_ALLOWED_);
}
// what a Peckish food shop may hold: its person's own food budget, their own account (or none), split half each or not
// at all, and nothing a phone or the bank sets (no review flags, no bank link)
var APP_FIELDS_ = {peckish: ["id", "date", "person", "amount", "budget", "account", "split", "note", "source", "deleted"]};
function appRowOk_(app, me, t, row, existing) {
  if (existing && (existing.person !== me || existing.source !== app)) throw new Error(NOT_ALLOWED_);
  if (row.person !== me || row.source !== app) throw new Error(NOT_ALLOWED_);
  var rule = APP_RULES_[app], fields = APP_FIELDS_[app] || [];
  var blank = function (v) { return v === "" || v === undefined || v === null; };
  // anything outside its fields must stay exactly as it was (or blank on a new shop)
  for (var k in row) {
    if (k === "updated" || k === "by" || fields.indexOf(k) >= 0) continue;
    var was = existing ? existing[k] : undefined;
    if (!(was === row[k] || (blank(row[k]) && blank(was)))) throw new Error(NOT_ALLOWED_ + " (" + k + ")");
  }
  if (toBoolCell_(row.deleted)) return;   // taking its own shop off again is always fine
  var bud = byId_("budgets", row.budget);
  if (!bud || bud.person !== me || toBoolCell_(bud.deleted) || !rule.food.test(String(bud.name || ""))) throw new Error(NOT_ALLOWED_ + " (only your food budget)");
  if (row.account !== undefined && row.account !== "") { var acc = byId_("accounts", row.account); if (!acc || acc.owner !== me) throw new Error(NOT_ALLOWED_ + " (only your own account)"); }
  if (row.split !== undefined && row.split !== "" && String(row.split).toLowerCase() !== "half") throw new Error(NOT_ALLOWED_ + " (split half each or not at all)");
  var amt = +row.amount;
  var day = String(row.date || "").slice(0, 10), today = Utilities.formatDate(new Date(), tz_(), "yyyy-MM-dd");
  if (!(amt > 0 && amt <= 2000) || !/^\d{4}-\d{2}-\d{2}$/.test(day) || day < Budgie.addDays(today, -400) || day > Budgie.addDays(today, 31)) throw new Error(NOT_ALLOWED_ + " (amount or date)");
}
function appSync_(me, app, since, full, snap) {
  // always the whole (small) picture, never changes since last time: a row that stops being a food shop, or stops
  // being shared, simply isn't in the next answer, and the app never hears about rows it was never allowed to see
  var rule = APP_RULES_[app], at = snap.at, tables = snap.tables, recent = function () { return true; };
  full = true;
  var personRow = function (id) { return tables.people.filter(function (p) { return p.id === id; })[0] || null; };
  var partner = (personRow(me) || {}).partner || "", pr = personRow(partner);
  if (!partner || partner === me || !pr || pr.partner !== me) partner = "";
  var sharing = {}, mine = {}; tables.settings.forEach(function (r) { if (!/^share\./.test(r.key)) return; var on = /^(true|yes|on|1)$/i.test(String(r.value)); if (r.person === partner) sharing[r.key.slice(6)] = on; if (r.person === me) mine[r.key.slice(6)] = on; });
  var budName = {}; tables.budgets.forEach(function (b) { budName[b.id] = String(b.name || ""); });
  var pick = function (r, cols) { if (!cols) return r; var o = {}; cols.concat(["deleted", "updated"]).forEach(function (c) { if (r[c] !== undefined) o[c] = r[c]; }); return o; };
  var mineOnly = {budgets: "person", accounts: "owner"}, rows = {}, count = 0;
  if (!full && tables.people.some(recent)) full = true;
  Object.keys(rule.reads).forEach(function (t) {
    rows[t] = [];
    tables[t].forEach(function (r) {
      if (!(full || recent(r))) return;
      if (mineOnly[t] && r[mineOnly[t]] !== me) return;
      if (t === "budgets" && !rule.food.test(String(r.name || ""))) return;   // only the food budgets: Peckish never needs the rest
      if (t === "transactions") {
        if (!canSee_(me, t, r, sharing) || toBoolCell_(r.deleted)) return;
        // Peckish's shop list is shared by both of you, so your own food payments only go there if your partner
        // could see them in Budgie anyway: split ones, ones Peckish logged, or all of them if you share each payment
        if (r.person === me && !(r.split || r.source === app || mine.payments)) return;
        if (r.source === app || rule.food.test(budName[r.budget] || "")) rows[t].push(pick(r, ["id", "date", "person", "amount", "budget", "split", "note", "source"]));
        return;
      }
      rows[t].push(pick(r, rule.reads[t]));
    });
    count += rows[t].length;
  });
  var today = Utilities.formatDate(new Date(), tz_(), "yyyy-MM-dd");
  return {ok: true, person: me, app: app, keyType: "app", now: at, today: today, full: full, rows: rows, count: count, partnerSummary: null, engine: Budgie.VERSION, schema: SCHEMA_VERSION};
}

// ---------- sync ----------
// a copy of every tab, and the time it was taken (before reading, so nothing written after it is missed)
function snapshot_() { var at = Date.now(); return {at: at, tables: allTables_()}; }
// tables where one row can stop being visible on its own (a split taken off, a budget moved off a LISA)
var HIDE_ROWS_ = {transactions: true, bills: true, budgets: true, income: true, moves: true, amounts: true, exceptions: true};
// what someone shares, as their partner sees it
function sharingOf_(p) { var s = {}; readTable_("settings").rows.forEach(function (r) { if (r.person === p && /^share\./.test(r.key)) s[r.key.slice(6)] = /^(true|yes|on|1)$/i.test(String(r.value)); }); return s; }
function partnerOf_(p) {
  var me = byId_("people", p), q = me && me.partner ? byId_("people", me.partner) : null;
  return q && q.id !== p && q.partner === p ? q.id : "";
}
// a row someone could see that they now can't (a split taken off, a budget moved off a LISA): their phone is told to
// drop it on its next sync. Only these are sent, so a partner never learns that private rows exist.
// Kept in Script Properties, newest 60, for 60 days.
function hiddenLog_() { try { return JSON.parse(PropertiesService.getScriptProperties().getProperty("HIDDEN_ROWS") || "[]"); } catch (e) { return []; } }
function noteHidden_(t, before, after) {
  var owners = owner_(t, before) || [], now = Date.now(), add = [];
  readTable_("people").rows.forEach(function (q) {
    if (!q.id || owners.indexOf(q.id) >= 0) return;
    var o = owners.filter(function (x) { return partnerOf_(q.id) === x; })[0]; if (!o) return;
    var sh = sharingOf_(o);
    if (canSee_(q.id, t, before, sh) && !canSee_(q.id, t, after, sh)) {
      add.push({t: t, i: before.id, q: q.id, a: now});
      // the changes to a bill or budget go with it
      if (t === "bills" || t === "budgets" || t === "income") ["amounts", "exceptions"].forEach(function (k) { readTable_(k).rows.forEach(function (r) { if (r.item === before.id) add.push({t: k, i: r.id, q: q.id, a: now}); }); });
    }
  });
  if (!add.length) return;
  var props = PropertiesService.getScriptProperties(), log = hiddenLog_().concat(add), cut = now - 60 * 86400000, dropped = 0;
  log = log.filter(function (e) { if (e.a > cut) return true; return false; });
  while (log.length > 60 || JSON.stringify(log).length > 8000) { dropped = Math.max(dropped, log[0].a); log.shift(); }
  props.setProperty("HIDDEN_ROWS", JSON.stringify(log));
  if (dropped) props.setProperty("HIDDEN_ROWS_DROPPED", String(Math.max(dropped, +props.getProperty("HIDDEN_ROWS_DROPPED") || 0)));
}
function sync_(me, since, full, snap) {
  snap = snap || snapshot_();
  var at = snap.at, tables = snap.tables, recent = function (r) { return (+r.updated || 0) > +since - 5000; };
  var sharingOf = function (p) { var s = {}; tables.settings.forEach(function (r) { if (r.person === p && /^share\./.test(r.key)) s[r.key.slice(6)] = /^(true|yes|on|1)$/i.test(String(r.value)); }); return s; };
  var personRow = function (id) { return tables.people.filter(function (p) { return p.id === id; })[0] || null; };
  // your partner is whoever your row names, as long as their row names you back (and it isn't you)
  var partner = (personRow(me) || {}).partner || "", pr = personRow(partner);
  if (!partner || partner === me || !pr || pr.partner !== me) partner = "";
  var sharing = partner ? sharingOf(partner) : {};
  full = full || !since;
  // the list of rows to drop was trimmed past this phone's last sync: send everything instead
  if (!full && (+PropertiesService.getScriptProperties().getProperty("HIDDEN_ROWS_DROPPED") || 0) > +since - 5000) full = true;
  // what your partner shares, who is whose partner, or what kind an account is changed: send everything again,
  // so rows that just became visible arrive and rows that just became private go
  if (!full && (tables.settings.some(function (r) { return r.person === partner && /^share\./.test(r.key) && recent(r); }) || tables.people.some(recent) || tables.accounts.some(recent))) full = true;
  var rows = {}, count = 0, needStub = {};
  Object.keys(tables).forEach(function (t) {
    rows[t] = [];
    tables[t].forEach(function (r) {
      if (!(full || recent(r) || t === "meta")) return;
      if (canSee_(me, t, r, sharing)) {
        rows[t].push(r);
        // your partner's split payment names their budget, so the app can match it to yours ("Food")
        if (t === "transactions" && r.person !== me && r.budget) needStub[r.budget] = true;
      }
    });
  });
  // rows you could see before and now can't
  if (!full) {
    var hid = {}; hiddenLog_().forEach(function (e) { if (e.q === me && e.a > +since - 5000 && rows[e.t]) hid[e.t + "|" + e.i] = e; });
    Object.keys(hid).forEach(function (k) {
      var e = hid[k], r = tables[e.t].filter(function (x) { return x.id === e.i; })[0];
      if (!r || canSee_(me, e.t, r, sharing) || rows[e.t].some(function (x) { return x.id === e.i; })) return;
      rows[e.t].push({id: e.i, deleted: true});
    });
  }
  // the partner's budgets you can't see, cut down to what matching needs
  var sent = {}; rows.budgets.forEach(function (r) { if (!r.deleted) sent[r.id] = true; });
  rows.budgets = rows.budgets.filter(function (r) { return !(r.deleted && needStub[r.id]); });
  tables.budgets.forEach(function (b) { if (needStub[b.id] && !sent[b.id]) rows.budgets.push({id: b.id, person: b.person, name: b.name, hidden: true, updated: b.updated, deleted: b.deleted}); });
  Object.keys(rows).forEach(function (t) { count += rows[t].length; });
  var today = Utilities.formatDate(new Date(), tz_(), "yyyy-MM-dd"), summary = null;
  if (partner) summary = partnerSummary_(tables, partner, today);
  return {ok: true, person: me, keyType: "full", now: at, today: today, full: full, rows: rows, count: count, partnerSummary: summary, engine: Budgie.VERSION, schema: SCHEMA_VERSION};
}
// worked out once per change and day, then kept for a few hours (each phone asks every minute)
function partnerSummary_(tables, partner, today) {
  var latest = 0; Object.keys(tables).forEach(function (t) { tables[t].forEach(function (r) { var u = +r.updated || 0; if (u > latest) latest = u; }); });
  var key = "sum:" + Budgie.VERSION + ":" + partner + ":" + today + ":" + latest, cache = null;
  try { cache = typeof CacheService !== "undefined" ? CacheService.getScriptCache() : null; var hit = cache && cache.get(key); if (hit) return JSON.parse(hit); } catch (x) { cache = null; }
  var summary;
  try { summary = Budgie.summary(Budgie.load(tables, today), partner, today); } catch (x) { return {error: String(x)}; }
  try { if (cache) cache.put(key, JSON.stringify(summary), 21600); } catch (x) {}
  return summary;
}

// edits typed straight into the sheet get a new "updated" time, so phones pick them up on their next sync
// (a simple trigger: Apps Script runs it by itself, nothing to install)
function onEdit(e) {
  try {
    if (!e || !e.range) return;
    var sh = e.range.getSheet(), t = sh.getName(); if (!SCHEMA[t] || t === "meta") return;
    var head = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(String), uc = head.indexOf("updated") + 1, bc = head.indexOf("by") + 1;
    if (!uc) return;
    var r0 = Math.max(2, e.range.getRow()), r1 = e.range.getLastRow(); if (r1 < r0) return;
    if (e.range.getColumn() >= uc && e.range.getLastColumn() <= uc) return;   // only the updated column itself
    var now = Date.now(), times = [], who = [];
    for (var r = r0; r <= r1; r++) { times.push([now]); who.push(["sheet"]); }
    sh.getRange(r0, uc, times.length, 1).setValues(times);
    if (bc && !(e.range.getColumn() <= bc && e.range.getLastColumn() >= bc)) sh.getRange(r0, bc, who.length, 1).setValues(who);
  } catch (x) {}
}

// ---------- the official budget tabs ("Ethan budget", "Sophie budget") ----------
function maybeRefreshViews_() {
  var props = PropertiesService.getScriptProperties(), last = +props.getProperty("VIEWS_AT") || 0;
  if (Date.now() - last < 60000) return;
  refreshBudgetTabs(); props.setProperty("VIEWS_AT", String(Date.now()));
}
function refreshBudgetTabs() {
  CACHE_ = {};
  var today = Utilities.formatDate(new Date(), tz_(), "yyyy-MM-dd"), db = Budgie.load(allTables_(), today), ss = ss_();
  db.people.forEach(function (p) {
    var name = p.name + " budget", sh = ss.getSheetByName(name) || ss.insertSheet(name, 0);
    var cur = Budgie.periodAt(db, p.id, today), list = [cur], per = cur;
    for (var i = 0; i < 5; i++) { per = Budgie.nextPeriod(db, p.id, per); list.push(per); }
    var views = list.map(function (pk) { return Budgie.monthView(db, p.id, pk); });
    var head = ["", ].concat(list.map(function (pk) { return pk.name; }));
    var out = [[p.name + "'s budget (worked out by Budgie, don't type here)"].concat(list.map(function () { return ""; })), head,
      ["Starts"].concat(list.map(function (pk) { return Budgie.nice(pk.start); })), ["Next payday"].concat(list.map(function (pk) { return Budgie.nice(pk.next); }))];
    var sections = [["in", "Money in"], ["bill", "Bills"], ["spend", "Spending"], ["save", "Savings"], ["topup", "Top-ups"]];
    sections.forEach(function (sec) {
      var names = [];
      views.forEach(function (v) { v.lines.forEach(function (l) { if (l.kind === sec[0] && names.indexOf(l.name) < 0) names.push(l.name); }); });
      if (!names.length) return;
      out.push([""].concat(list.map(function () { return ""; })), [sec[1]].concat(list.map(function () { return ""; })));
      names.forEach(function (n) {
        out.push([n].concat(views.map(function (v) { var t = 0; v.lines.forEach(function (l) { if (l.kind === sec[0] && l.name === n) t += l.amount; }); return Budgie.round(t); })));
        if (sec[0] === "spend") out.push(["   spent so far"].concat(views.map(function (v) { var l = v.lines.filter(function (x) { return x.kind === "spend" && x.name === n; })[0]; return l && l.spent !== undefined ? l.spent : ""; })));
      });
      out.push(["Total " + sec[1].toLowerCase()].concat(views.map(function (v) { var t = 0; v.lines.forEach(function (l) { if (l.kind === sec[0]) t += l.amount; }); return Budgie.round(t); })));
    });
    out.push([""].concat(list.map(function () { return ""; })), ["Short of money"].concat(views.map(function (v) { return v.plan.shortfall || ""; })));
    out.push(["", "Updated " + Utilities.formatDate(new Date(), tz_(), "d MMM yyyy HH:mm")].concat(list.slice(1).map(function () { return ""; })));
    sh.clear(); sh.getRange(1, 1, out.length, out[0].length).setValues(out);
    sh.getRange(1, 1).setFontWeight("bold").setFontSize(13); sh.getRange(2, 1, 1, out[0].length).setFontWeight("bold");
    sh.getRange(3, 2, out.length - 2, out[0].length - 1).setNumberFormat("£#,##0.00;-£#,##0.00;-");
    sh.getRange(3, 2, 2, out[0].length - 1).setNumberFormat("@");
    out.forEach(function (r, i) { if (/^(Money in|Bills|Spending|Savings|Top-ups)$/.test(r[0]) || /^Total /.test(r[0])) sh.getRange(i + 1, 1, 1, r.length).setFontWeight("bold"); if (/^   spent/.test(r[0])) sh.getRange(i + 1, 1, 1, r.length).setFontColor("#566273"); });
    sh.setColumnWidth(1, 260); sh.setFrozenColumns(1); sh.setFrozenRows(2);
    sh.getRange(1, 1, out.length, out[0].length).protect().setWarningOnly(true);
  });
}
// replaces only its own trigger, so the daily fund prices trigger (Prices.gs) keeps running
function installTriggers() {
  // (the bank feed's 15-minute trigger, installBankTrigger, and the prices trigger are left as they are)
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === "refreshBudgetTabs") ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger("refreshBudgetTabs").timeBased().everyHours(1).create();
  Logger.log("The budget tabs now refresh every hour, and a minute after any change from the app.");
}
