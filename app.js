/* Budgie app: screens, syncing and offline queue. The maths lives in engine.js. */
(function () {
  "use strict";
  var B = window.Budgie, TH = window.BudgieThemes, APP_VERSION = "1.4.17";
  var $ = function (s) { return document.querySelector(s); };
  var esc = function (s) { return String(s === undefined || s === null ? "" : s).replace(/[&<>"']/g, function (c) { return {"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"}[c]; }); };
  // wiped: Budgie's copy at the old address has been wiped (it's moving across), so nothing is saved here again
  var wiped = false;
  var LS = {get: function (k, d) { try { var v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } }, set: function (k, v) { if (wiped) return; try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }};
  var todayIso = function () { var d = new Date(); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); };
  var newId = function (p) { return (p || "r") + "-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); };
  var ICON = {
    home: '<path d="M4 11l8-7 8 7v9a1 1 0 0 1-1 1h-4v-6H9v6H5a1 1 0 0 1-1-1z"/>', chart: '<path d="M5 20V10M12 20V4M19 20v-7"/>', plus: '<path d="M12 5v14M5 12h14"/>',
    people: '<circle cx="9" cy="8" r="3.5"/><circle cx="17" cy="9.5" r="2.5"/><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6M15 14.5c3 0 6 1.8 6 5"/>',
    grid: '<rect x="4" y="4" width="6.5" height="6.5" rx="1.5"/><rect x="13.5" y="4" width="6.5" height="6.5" rx="1.5"/><rect x="4" y="13.5" width="6.5" height="6.5" rx="1.5"/><rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.5"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.5"/>', back: '<path d="M15 6l-6 6 6 6"/>', chev: '<path d="M9 6l6 6-6 6"/>', close: '<path d="M6 6l12 12M18 6L6 18"/>', eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
    pay: '<rect x="3" y="6" width="18" height="12" rx="2"/><circle cx="12" cy="12" r="2.5"/>', pot: '<path d="M5 9h14l-1.5 10a2 2 0 0 1-2 1.7h-7a2 2 0 0 1-2-1.7z"/><path d="M8 9V6a4 4 0 0 1 8 0v3"/>',
    cal: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>', target: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="4"/><circle cx="12" cy="12" r="1"/>',
    lisa: '<path d="M4 18l5-6 4 3 7-9"/><path d="M15 6h5v5"/>', house: '<path d="M3 11l9-7 9 7"/><path d="M5 10v10h14V10"/><path d="M10 20v-5h4v5"/>', scale: '<path d="M12 3v18M5 7h14M7 7l-3 7a3 3 0 0 0 6 0zM17 7l-3 7a3 3 0 0 0 6 0z"/>',
    debt: '<path d="M4 7h16M4 12h16M4 17h10"/>', spark: '<path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5L18 18M6 18l2.5-2.5M15.5 8.5L18 6"/>',
    gift: '<rect x="3" y="9" width="18" height="12" rx="1.5"/><path d="M3 13h18M12 9v12M12 9c-2-4-6-4-6-1.5S10 9 12 9zM12 9c2-4 6-4 6-1.5S14 9 12 9z"/>', gear: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1"/>'
  };
  var icon = function (n, size) { return '<svg width="' + (size || 22) + '" height="' + (size || 22) + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (ICON[n] || "") + "</svg>"; };

  // ---------- storage (IndexedDB, falling back to localStorage) ----------
  var store = {
    db: null,
    open: function () { return new Promise(function (res) { try { var r = indexedDB.open("budgie", 1); r.onupgradeneeded = function () { r.result.createObjectStore("kv"); }; r.onsuccess = function () { store.db = r.result; res(); }; r.onerror = function () { res(); }; } catch (e) { res(); } }); },
    get: function (k) { return new Promise(function (res) { if (!store.db) return res(LS.get("budgie.kv." + k, null)); try { var q = store.db.transaction("kv").objectStore("kv").get(k); q.onsuccess = function () { res(q.result || null); }; q.onerror = function () { res(null); }; } catch (e) { res(null); } }); },
    set: function (k, v) { if (wiped) return; if (!store.db) { LS.set("budgie.kv." + k, v); return; } try { store.db.transaction("kv", "readwrite").objectStore("kv").put(v, k); } catch (e) { LS.set("budgie.kv." + k, v); } }
  };

  // ---------- state ----------
  var S = {
    cfg: LS.get("budgie.cfg", null),
    prefs: Object.assign({mode: "system", colour: "", special: "", easy: null, size: "normal", hide: false, demo: false}, LS.get("budgie.prefs", {})),
    data: {tables: {}, since: 0, me: "", summary: null, queue: []},
    demo: null, stack: [], view: {s: "today", p: {}},
    ui: {money: "month", monthOff: 0, calOff: 0, keys: "", add: {}, reveal: false, house: {}},
    syncing: false, lastError: "", lastSync: 0
  };
  var DB = null, last = {todo: [], coming: {}};
  var demoOn = function () { return !!S.prefs.demo; };
  var tables = function () { return demoOn() ? S.demo.tables : S.data.tables; };
  var me = function () { return demoOn() ? S.demo.me : S.data.me; };
  // worked out again once the date changes, so a phone left open overnight (or offline) isn't a day behind
  var db = function () { var t = todayIso(); if (!DB || DB.today !== t) DB = B.load(tables(), t); return DB; };
  var dirty = function () { DB = null; };
  var savePrefs = function () { LS.set("budgie.prefs", S.prefs); };
  var persist = function () { if (!demoOn()) store.set("data", S.data); };
  var person = function (id) { return B.person(db(), id || me()); };
  var partner = function () { return B.partnerOf(db(), me()); };
  var potWord = function (plural) { var w = person().potWord || "pot"; return plural ? w + "s" : w; };

  // ---------- money display ----------
  var M = function (n) { return S.prefs.hide && !S.ui.reveal ? "£••••" : B.money(n); };
  // the engine's own sentences ("Pay Sophie £40.00") are covered too
  var MT = function (s) { return S.prefs.hide && !S.ui.reveal ? String(s === undefined || s === null ? "" : s).replace(/-?£\d[\d,]*(\.\d+)?/g, "£••••") : s; };
  var M0 = function (n) { var r = Math.round(+n || 0); return S.prefs.hide && !S.ui.reveal ? "£••••" : (r < 0 ? "-£" : "£") + Math.abs(r).toLocaleString("en-GB"); };

  // ---------- changes ----------
  function upsert(t, row) {
    var list = tables()[t] = tables()[t] || [], key = t === "meta" ? "key" : "id";
    var i = list.findIndex(function (r) { return r[key] === row[key]; });
    if (i >= 0) list[i] = Object.assign({}, list[i], row); else list.push(row);
  }
  function put(t, row, quiet) {
    row = Object.assign({}, row, {updated: Date.now(), by: me()});
    // a setting, or a change to one date, has an id made from what it is: making it again after it was taken off
    // (Undo, or in the sheet) brings it back, rather than leaving it off on the phone and in the sheet
    if ((t === "settings" || t === "exceptions") && row.deleted === undefined) row.deleted = false;
    upsert(t, row);
    if (!demoOn()) { S.data.queue.push({op: "put", table: t, row: row}); persist(); syncSoon(); }
    dirty(); if (!quiet) render();
    return row;
  }
  function del(t, id, quiet) {
    upsert(t, {id: id, deleted: true, updated: Date.now()});
    if (!demoOn()) { S.data.queue.push({op: "delete", table: t, id: id}); persist(); syncSoon(); }
    dirty(); if (!quiet) render();
  }
  function setting(key, value) { var id = me() + ":" + key; put("settings", {id: id, person: me(), key: key, value: String(value)}, true); }
  function getSetting(key, d) { return B.setting(db(), me(), key, d); }
  function getSettingFor(p, key, d) { return B.setting(db(), p, key, d); }

  // ---------- sync ----------
  var syncTimer = null;
  function syncSoon() { clearTimeout(syncTimer); syncTimer = setTimeout(function () { sync(false); }, 400); }
  function merge(rows, full) {
    var T = S.data.tables;
    if (full) { T = S.data.tables = {}; }
    Object.keys(rows || {}).forEach(function (t) {
      T[t] = T[t] || [];
      rows[t].forEach(function (r) { var k = rowKey(t, r), i = T[t].findIndex(function (x) { return rowKey(t, x) === k; }); if (i >= 0) T[t][i] = r; else T[t].push(r); });
    });
    // changes still waiting to go up stay applied on top
    S.data.queue.forEach(function (op) {
      var list = T[op.table] = T[op.table] || [], id = op.op === "put" ? op.row.id : op.id, i = list.findIndex(function (x) { return x.id === id; });
      if (op.op === "put") { if (i >= 0) list[i] = Object.assign({}, list[i], op.row); else list.push(op.row); }
      else if (op.op === "delete" && i >= 0) list[i] = Object.assign({}, list[i], {deleted: true});
    });
  }
  // what one row is known by: its id (a setting typed into the sheet without one is known by whose it is and its key,
  // so two of them don't overwrite each other on the phone)
  function rowKey(t, r) { if (t === "meta") return "m:" + r.key; var id = r.id; return id === undefined || id === null || id === "" ? (t === "settings" ? "s:" + r.person + ":" + r.key : "") : "i:" + id; }
  function newer(a, b) { var x = String(a).split(".").map(Number), y = String(b).split(".").map(Number); for (var i = 0; i < 3; i++) { if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0); } return false; }
  // one request to the sheet. A phone signal that drops, or Google answering with a page of its own instead of Budgie's
  // answer (busy, or signed out), says so in plain words rather than the browser's own
  async function askSheet(body, signal) {
    var res;
    try { res = await fetch(S.cfg.u, {method: "POST", headers: {"Content-Type": "text/plain;charset=utf-8"}, body: JSON.stringify(body), signal: signal}); }
    catch (e) { if (e && e.name === "AbortError") throw e; throw new Error("Couldn't reach your Google Sheet. Check your signal and try again."); }
    try { return await res.json(); } catch (e) { if (e && e.name === "AbortError") throw e; throw new Error("Your Google Sheet didn't answer properly (Google may be busy). Try again in a minute."); }
  }
  // what the sheet said no with, in plain words (a key that's been changed, after a lost phone, says what to do)
  function sheetSaid(j) { var e = String(j && j.error || ""); return /^(Wrong|No) app key$/.test(e) ? "This phone's connect link has stopped working, as a new one was made. Open the newest connect link from your Google Sheet." : e || "The sheet said no"; }
  async function sync(full) {
    if (demoOn() || !S.cfg) return;
    // one at a time: a full one asked for meanwhile (Full refresh, a new link) runs as soon as this one is done
    // (changes made meanwhile go up straight after a sync anyway)
    if (S.syncing) { if (full) S.syncAgain = true; return; }
    S.syncing = true; renderTop();
    var cfgAt = S.cfg, dataAt = S.data;
    // a request that never answers (a phone signal that drops mid-way) mustn't leave Budgie "Syncing…" for good;
    // anything it carried is sent again next time, and the sheet only ever saves a change once
    var ctl = typeof AbortController === "function" ? new AbortController() : null, slow = ctl ? setTimeout(function () { ctl.abort(); }, 90000) : null;
    try {
      var ops = S.data.queue.slice(0, 40);
      var j = await askSheet({key: S.cfg.k, since: full ? 0 : S.data.since, full: !!full || !S.data.since, ops: ops}, ctl ? ctl.signal : undefined);
      if (S.cfg !== cfgAt || S.data !== dataAt) return; // disconnected or switched sheets while this was on its way
      if (!j.ok) throw new Error(sheetSaid(j));
      // a change the sheet couldn't save for a passing reason (retry) goes back in the queue. It's only given up on once
      // it has failed a few times over several hours, so a Google hiccup (which can last a while, with a few things
      // logged during it) never loses anything; changes the sheet turned down are dropped (the sheet's copy comes back
      // in a full refresh) so they can't block the rest
      var tNow = Date.now(), keepTrying = function (op) { return (op.tries || 0) < 4 || tNow - (op.failedAt || tNow) < 6 * 3600000; };
      var again = [], rej = (j.rejected || []).filter(function (r) { var op = ops[r.i]; if (r.retry && op && (r.notTried || keepTrying(op))) { if (!r.notTried) { op.tries = (op.tries || 0) + 1; op.failedAt = op.failedAt || tNow; } again.push(op); return false; } return true; });
      S.data.queue = again.concat(S.data.queue.slice(ops.length));
      // changes made on this phone before it was given a new link for the same person and sheet go up now
      if (S.data.carry) { var cr = S.data.carry; delete S.data.carry; if (cr.me === j.person) S.data.queue = S.data.queue.concat(cr.queue); else { S.ui.carryNote = cr.queue.length + " change" + (cr.queue.length === 1 ? "" : "s") + " made as " + (cr.name || cr.me) + " weren't sent, because this link is for someone else."; toast(S.ui.carryNote); } }
      if (rej.length) { S.lastRejected = rej.map(function (r) { return r.error || "A change was turned down"; }); toast(rej.length === 1 ? "The sheet turned down a change: " + S.lastRejected[0] : rej.length + " changes were turned down by the sheet"); }
      merge(j.rows, j.full);
      S.data.since = rej.length && !j.full ? 0 : j.now; S.data.me = j.person; S.data.summary = j.partnerSummary;
      S.newVersion = j.engine && newer(j.engine, B.VERSION) ? j.engine : null; // only when the sheet is ahead of this phone
      // when the sheet's code is updated, fetch everything once: it may now send things it didn't before (new tabs, say)
      var upgraded = !!(j.engine && S.data.serverEngine !== j.engine && !j.full); if (j.engine) S.data.serverEngine = j.engine;
      persist(); dirty(); S.lastSync = Date.now(); S.lastError = "";
      applyPersonPrefs();
      if (!S.bank && !S.bankAsked) { S.bankAsked = true; setTimeout(bankRefresh, 300); }
      // (what's waiting to be tried again waits for the next sync, a minute or the next change, rather than straight away)
      if (S.data.queue.length > again.length || ((rej.length || upgraded) && !j.full)) setTimeout(function () { sync((rej.length || upgraded) && !j.full); }, 60); // a full refresh puts back the sheet's copy of anything turned down
    } catch (e) { S.lastError = navigator.onLine === false ? "Offline: changes will sync when you're back online" : e && e.name === "AbortError" ? "Your sheet took too long to answer. Budgie will try again." : String(e && e.message || e); }
    finally {
      clearTimeout(slow); S.syncing = false; render(true);
      if (S.syncAgain) { S.syncAgain = false; setTimeout(function () { sync(true); }, 0); }
    }
  }

  // ---------- themes ----------
  function applyPersonPrefs() {
    if (demoOn() || !me()) return;
    var d = db(), s = d.set[me()] || {};
    if (s["theme.mode"] && !S.prefs._local) { S.prefs.mode = s["theme.mode"]; S.prefs.colour = s["theme.colour"] || ""; S.prefs.special = s["theme.special"] || ""; }
    if (S.prefs.easy === null && s.easy !== undefined) S.prefs.easy = /^true$/i.test(String(s.easy));
    applyTheme();
  }
  function applyTheme() {
    var col = S.prefs.colour || (me() === "sophie" || me() === "sam" ? "green" : "blue");
    var easy = S.prefs.easy === null ? (demoOn() ? me() === "sam" : false) : S.prefs.easy;
    TH.apply({mode: S.prefs.mode, colour: col, special: S.prefs.special, easy: easy, size: S.prefs.size});
  }
  var isEasy = function () { return document.body.classList.contains("easy"); };

  // ---------- navigation ----------
  // History: the phone's Back button walks back through screens and sheets. `depth` counts the history
  // entries Budgie has added above the first one, so Back never needs more presses than there are steps.
  var TABS = ["today", "money", "add", "partner", "more"];
  var NAV = {depth: 0, sheet: false, ignore: 0};
  function histPush() { try { history.pushState({b: 1}, ""); NAV.depth++; } catch (e) {} }
  function histBack(n) { n = Math.min(n, NAV.depth); if (n <= 0) return; NAV.ignore++; NAV.depth -= n; try { history.go(-n); } catch (e) { NAV.ignore--; } }
  function go(s, p) {
    var hadSheet = NAV.sheet; $("#sheets").innerHTML = ""; NAV.sheet = false;
    if (TABS.indexOf(s) >= 0) {
      S.stack = [];
      if (s === "today") histBack(NAV.depth); else if (NAV.depth === 0) histPush(); else histBack(NAV.depth - 1);
    } else {
      S.stack.push(S.view);
      if (!hadSheet) histPush(); // the sheet's history entry becomes this screen's
    }
    S.view = {s: s, p: p || {}};
    render(); window.scrollTo(0, 0);
  }
  // one step back: closes a sheet, or goes back a screen (header Back button, or after saving)
  function back() { if (sheetOpen() || NAV.sheet) { closeSheet(); return; } leave(); }
  // closes any sheet and goes back a screen, in one step
  function leave() {
    var n = 0;
    if (NAV.sheet) n++; $("#sheets").innerHTML = ""; NAV.sheet = false;
    if (S.stack.length) { S.view = S.stack.pop(); n++; } else if (S.view.s !== "today") { S.view = {s: "today", p: {}}; n++; }
    histBack(n); render(); window.scrollTo(0, 0);
  }
  window.addEventListener("popstate", function () {
    if (NAV.ignore) { NAV.ignore--; return; }
    NAV.depth = Math.max(0, NAV.depth - 1);
    if (sheetOpen() || NAV.sheet) { $("#sheets").innerHTML = ""; NAV.sheet = false; return; }
    if (S.stack.length) { S.view = S.stack.pop(); render(); window.scrollTo(0, 0); }
    else if (S.view.s !== "today") { S.view = {s: "today", p: {}}; render(); window.scrollTo(0, 0); }
    else { try { history.back(); } catch (e) {} } // nothing left in Budgie: let the phone leave the app
  });
  document.addEventListener("keydown", function (e) { if (e.key === "Escape" && sheetOpen()) closeSheet(); });

  // ---------- sheets and toasts ----------
  var sheetOpen = function () { return !!$("#sheets").firstChild; };
  // explanations that are good to know but needn't always be on show: a small (i) beside a heading opens them
  var INFO = {
    pace: ["Paced week by week", "Budgets like Food are paced week by week, so a big shop at the start of a week isn't counted as over."],
    between: ["How it's worked out", "Shared bills are split by your rules and settled by month. Split payments count straight away. Money lent between you is paid back as each loan says."],
    sheet: ["Where your pay goes", "This is your budget for one pay period, payday to payday: what comes in, the bills it pays, what you can spend and what you save. It's the same as your budget tab in the Google Sheet, worked out from the same rules."],
    bankmap: ["Which is which", "Tell Budgie which of its accounts each one is. Moves between them tick off your payday list by themselves."],
    modes: ["How budgets work", "Day to day builds up each day. Weekly is paced week by week, good for food shops. One-offs have no daily pace. Saving is moved on payday. Whatever is left gets what's left after everything else."],
    pots: ["Where this comes from", "Budgie works out what should be in each one from your rules and what you've logged. Tap one if your bank app shows something different, and tell Budgie what it says."]
  };
  function infoBtn(k) { return '<button type="button" class="info" data-a="info" data-v="' + k + '" aria-label="' + esc(INFO[k][0]) + '">' + icon("info", 18) + "</button>"; }
  function openSheet(html) {
    var t = (html.match(/<h2[^>]*>([\s\S]*?)<\/h2>/) || [])[1];
    $("#sheets").innerHTML = '<div class="sheet-bg" data-a="sheetbg"><div class="sheet" role="dialog" aria-modal="true"' + (t ? ' aria-label="' + esc(t.replace(/<[^>]+>/g, "")) + '"' : "") + ">" + html + "</div></div>";
    if (!NAV.sheet) { histPush(); NAV.sheet = true; }
    var f = $("#sheets").querySelector("input,select,button.btn"); if (f && f.tagName !== "BUTTON") setTimeout(function () { f.focus(); }, 60); else if (f) setTimeout(function () { f.focus({preventScroll: true}); }, 60);
  }
  // closing a sheet ourselves undoes the history entry it added, without going back a screen
  function closeSheet() { if (!sheetOpen() && !NAV.sheet) return; $("#sheets").innerHTML = ""; if (NAV.sheet) { NAV.sheet = false; histBack(1); } }
  var toastTimer = null;
  function toast(msg, undo) {
    var el = $("#toast"); el.innerHTML = '<div class="toast"><span>' + esc(msg) + "</span>" + (undo ? '<button type="button" data-a="undo">Undo</button>' : "") + "</div>";
    S.ui.undo = undo || null; clearTimeout(toastTimer); toastTimer = setTimeout(function () { el.innerHTML = ""; S.ui.undo = null; }, undo ? 6000 : 3000);
  }

  // ---------- small building blocks ----------
  var card = function (inner, cls) { return '<section class="card ' + (cls || "") + '">' + inner + "</section>"; };
  var bar = function (pct, mark, col) { return '<div class="bar wrap" aria-hidden="true"><i style="width:' + Math.max(0, Math.min(100, pct)) + "%" + (col ? ";background:" + col : "") + '"></i>' + (mark !== undefined && mark !== null ? '<b style="left:calc(' + Math.min(100, mark) + '% - 1px)"></b>' : "") + "</div>"; };
  var dateBox = function (iso, k) { var p = B.nice(iso).split(" "); return '<span class="date' + (k ? " k-" + k : "") + '">' + esc(p[0]) + "<br>" + esc(p[1]) + "</span>"; };
  var chev = function () { return '<span class="chev">' + icon("chev", 18) + "</span>"; };
  var li = function (what, why, right, act, val) {
    var inner = '<span class="grow"><span class="what">' + what + "</span>" + (why ? '<span class="why">' + why + "</span>" : "") + "</span>" + (right || "");
    return act ? '<button type="button" class="li" data-a="' + act + '" data-v="' + esc(val || "") + '">' + inner + chev() + "</button>" : '<div class="li">' + inner + "</div>";
  };
  // A group of buttons is never ragged: each .fit group takes the first of these in which every label fits on one
  // line: all side by side; equal lines of three or two (only when they come out even); or one under another.
  // data-lead puts the first one on a line of its own, above the rest side by side or in even lines.
  function fitRows() {
    var groups = document.querySelectorAll(".fit");
    for (var gi = 0; gi < groups.length; gi++) {
      var g = groups[gi], kids = [].filter.call(g.children, function (k) { return k.getClientRects().length > 0; }), n = kids.length;
      if (!n || !g.getClientRects().length) continue;
      var gap = parseFloat(getComputedStyle(g).columnGap) || 0, lead = g.hasAttribute("data-lead") && n > 2, plans = [[n]];
      var even = function (m, k) { var r = []; for (var i = 0; i < m / k; i++) r.push(k); return r; };
      if (lead) plans.push([1, n - 1]);
      [3, 2].forEach(function (k) { if (k < n && n % k === 0) plans.push(even(n, k)); if (lead && k < n - 1 && (n - 1) % k === 0) plans.push([1].concat(even(n - 1, k))); });
      plans.push(even(n, 1));
      g.classList.remove("loose");
      for (var pi = 0; pi < plans.length; pi++) {
        var i = 0;
        plans[pi].forEach(function (c) { for (var j = 0; j < c; j++, i++) kids[i].style.flex = "0 0 calc((100% - " + (c - 1) * gap + "px) / " + c + " - .1px)"; });
        if (kids.every(roomFor)) break;
        if (pi === plans.length - 1) g.classList.add("loose"); // (one under another and still too long: it wraps)
      }
    }
  }
  // a label has room when it stays inside the button's padding (it may use a few pixels of it)
  function roomFor(k) {
    var cs = getComputedStyle(k), r = document.createRange(); r.selectNodeContents(k);
    return k.scrollWidth <= k.clientWidth && r.getBoundingClientRect().width <= k.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight) + 4;
  }
  var fitSoon = 0;
  new MutationObserver(function () { fitRows(); }).observe(document.body, {childList: true, subtree: true});
  window.addEventListener("resize", function () { cancelAnimationFrame(fitSoon); fitSoon = requestAnimationFrame(fitRows); });
  try { document.fonts.ready.then(fitRows); document.fonts.addEventListener("loadingdone", fitRows); } catch (e) {}
  // a short name for tight places (the tab bar, a button): the first name
  var shortName = function (n) { return String(n || "").trim().split(/\s+/)[0]; };
  var num = function (n, cls) { return '<span class="num ' + (cls || "") + '">' + n + "</span>"; };
  var accOptions = function (sel, owner, kinds) {
    return B.accountsOf(db(), owner || me()).filter(function (a) { return !kinds || kinds.test(a.kind || "pot"); }).map(function (a) { return '<option value="' + esc(a.id) + '"' + (a.id === sel ? " selected" : "") + ">" + esc(a.name) + "</option>"; }).join("");
  };
  function chart(vals, w, h, opts) {
    opts = opts || {};
    if (!vals.length) return "";
    var max = Math.max.apply(null, vals.concat(opts.extra || [])), min = Math.min.apply(null, vals.concat(opts.extra || []));
    if (max === min) { max += 1; min -= 1; }
    var y = function (v) { return 8 + (h - 16) * (1 - (v - min) / (max - min)); }, x = function (i, n) { return (i / Math.max(1, n - 1)) * w; };
    var line = function (vs) { return "M" + vs.map(function (v, i) { return x(i, vs.length).toFixed(1) + " " + y(v).toFixed(1); }).join(" L"); };
    var l = line(vals);
    return '<svg viewBox="0 0 ' + w + " " + h + '" width="100%" height="' + h + '" preserveAspectRatio="none" role="img" aria-label="' + esc(opts.label || "Chart") + '"><path d="' + l + " L" + w + " " + h + " L0 " + h + ' Z" fill="var(--soft)"/>' +
      (opts.second ? '<path d="' + line(opts.second) + '" fill="none" stroke="var(--muted)" stroke-width="1.5" stroke-dasharray="4 4" vector-effect="non-scaling-stroke"/>' : "") +
      '<path d="' + l + '" fill="none" stroke="var(--accent)" stroke-width="2.5" stroke-linejoin="round" vector-effect="non-scaling-stroke"/></svg>';
  }

  // ---------- header and nav ----------
  var TITLES = {
    today: function () { return ["Hi " + (person().name || ""), B.nice(todayIso()).replace(/^(\w+)/, function (d) { return {Mon: "Monday", Tue: "Tuesday", Wed: "Wednesday", Thu: "Thursday", Fri: "Friday", Sat: "Saturday", Sun: "Sunday"}[d] || d; })]; },
    money: function () { return ["Money", S.ui.money === "year" ? "Your plan for the year" : "Your plan, payday to payday"]; }, add: function () { return ["Add", "Log a payment or a bill"]; }, partner: function () { return [person(partner()).name || "Partner", "How you're both doing"]; },
    more: function () { return ["More", "All your money tools"]; }, payday: function () { return ["Payday", "Sort your pay"]; }, pots: function () { return [cap(potWord(true)), "What should be where"]; },
    bills: function () { return ["Bills", "Calendar and subscriptions"]; }, goals: function () { return ["Goals", "Saving for things"]; }, lisa: function () { return ["LISA tracker", "Lifetime ISA"]; },
    house: function () { return ["House", "Deposit and mortgage"]; }, networth: function () { return ["Net worth", "Own minus owe"]; }, debts: function () { return ["Debts and IOUs", "Who owes what"]; },
    insights: function () { return ["Insights", "How your spending is going"]; }, gifts: function () { return ["Gifts", "Ideas and what you've bought"]; }, settings: function () { return ["Settings", person().name]; },
    checks: function () { return ["Things to check", fromTitle()]; },
    edit: function () { return [S.view.p.title || "Edit", fromTitle()]; }, list: function () { return [S.view.p.title || "", fromTitle()]; }, themes: function () { return ["Themes", "How Budgie looks"]; },
    payments: function () { var d = db(), pp = S.view.p, b = pp.budget ? d.byId[pp.budget] : null, per = B.periodAt(d, me(), pp.start || todayIso()); return ["Payments", (b ? b.name.replace(/ \(what's left\)/, "") + " · " : "") + per.name]; },
    emailset: function () { return ["Sunday email", "Settings"]; }, linked: function () { return ["Linked apps", "Settings"]; },
    bank: function () { return ["Bank connection", "Settings"]; }, review: function () { return ["New payments", "From " + bankName()]; },
    sharing: function () { return ["Partner and sharing", "What " + (person(partner()).name || "your partner") + " sees"]; }, sync: function () { return ["Google Sheet", "Sync and backup"]; }, importcsv: function () { return ["Import", "Bank statement"]; },
    connect: function () { return ["Budgie", "Connect your sheet"]; }
  };
  function fromTitle() { var v = S.stack[S.stack.length - 1]; if (!v || v.s === S.view.s || !TITLES[v.s]) return "Settings"; try { return TITLES[v.s]()[0]; } catch (e) { return "Settings"; } }
  var cap = function (s) { s = String(s || ""); return s.charAt(0).toUpperCase() + s.slice(1); };
  function renderTop() {
    var t = (TITLES[S.view.s] || TITLES.today)(), back = S.stack.length > 0;
    var status = demoOn() ? "Show and tell" : S.syncing ? "Syncing…" : S.data.queue.length ? S.data.queue.length + " change" + (S.data.queue.length > 1 ? "s" : "") + " waiting" : S.lastError ? "Not synced" : "";
    $("#top").innerHTML = (back ? '<button type="button" class="round" data-a="back" aria-label="Back">' + icon("back", 20) + "</button>" : "") +
      '<div class="t"><div class="sub">' + esc(t[1]) + (status ? ' · <span class="' + (S.lastError && !S.syncing ? "warn" : "") + '">' + esc(status) + "</span>" : "") + "</div><h1>" + esc(t[0]) + "</h1></div>" +
      (S.prefs.hide ? '<button type="button" class="round" data-a="reveal" aria-label="' + (S.ui.reveal ? "Hide amounts" : "Show amounts") + '" aria-pressed="' + S.ui.reveal + '">' + icon("eye", 20) + "</button>" : "") +
      (me() ? '<button type="button" class="round avatar" data-a="who" aria-label="Account">' + esc((person().name || "?").charAt(0)) + "</button>" : "");
  }
  function renderNav() {
    if (!me()) { $("#nav").innerHTML = ""; return; }
    var cur = S.view.s, inMore = TABS.indexOf(cur) < 0 || cur === "more";
    var b = function (s, label, ic, on) { return '<button type="button" data-a="tab" data-v="' + s + '"' + (on ? ' aria-current="page"' : "") + ">" + icon(ic, 24) + esc(label) + "</button>"; };
    $("#nav").innerHTML = '<div class="in">' + b("today", "Today", "home", cur === "today") + b("money", "Money", "chart", cur === "money") +
      '<button type="button" data-a="tab" data-v="add" aria-label="Add a payment"' + (cur === "add" ? ' aria-current="page"' : "") + '><span class="plus">' + icon("plus", 26) + "</span></button>" +
      b("partner", shortName(person(partner()).name) || "Partner", "people", cur === "partner") + b("more", "More", "grid", inMore && cur !== "today" && cur !== "money" && cur !== "add" && cur !== "partner") + "</div>";
  }
  // a background refresh (sync, coming back to the app) mustn't wipe a half-filled form or close the keyboard
  function formBusy() {
    if (S.view.s === "edit" || S.view.s === "importcsv") return true;
    var a = document.activeElement; return !!(a && $("#main").contains(a) && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName));
  }
  function render(background) {
    if (isOldHome()) { movedScreen(); return; }   // even after a sync while moving across: no app at the old address
    applyTheme();
    if (LOCK.locked) { $("#main").innerHTML = ""; $("#nav").innerHTML = ""; $("#top").innerHTML = ""; $("#sheets").innerHTML = ""; return; } // nothing on screen until it's you
    if (!me()) { S.view = {s: "connect", p: {}}; } else if (S.view.s === "connect") S.view = {s: "today", p: {}};
    renderTop(); renderNav();
    if (background && formBusy() && S.view.s !== "connect") return;
    if (S.view.s === "edit" && $("#main").querySelector("[data-f]")) readForm();
    var fn = SCREENS[S.view.s] || SCREENS.today, html = "";
    try { html = fn(S.view.p); } catch (e) { html = card('<h2>Something went wrong</h2><p class="muted small">' + esc(e && e.message) + '</p><button class="btn ghost sm" type="button" data-a="tab" data-v="today">Back to Today</button>'); console.error(e); }
    $("#main").innerHTML = (S.newVersion && !demoOn() ? '<button type="button" class="banner li" data-a="reload" style="padding:10px 14px;border:0"><span class="grow"><span class="what">A new version of Budgie is ready</span><span class="why">Tap to update. It takes a second.</span></span></button>' : "") + (demoOn() ? '<button type="button" class="banner demo li" data-a="demoinfo" style="padding:10px 14px;border:0;color:var(--accent-ink)"><span class="grow"><span class="what">Show and tell is on</span><span class="why" style="color:inherit;opacity:.9">Made-up people and money. Tap to switch person or turn it off.</span></span></button>' : "") + html;
    // once a day, until they're all confirmed, pop up the figures Budgie guessed
    if (S.view.s === "today" && !S.ui.checkShown && !sheetOpen() && S.lastSync && LS.get("budgie.checkSeen", "") !== todayIso() && checkList().length) {
      S.ui.checkShown = true; LS.set("budgie.checkSeen", todayIso()); setTimeout(function () { if (!sheetOpen() && S.view.s === "today") checksSheet(); }, 500);
    }
  }

  // ---------- screens ----------
  var SCREENS = {};

  SCREENS.connect = function () {
    return card('<h2 style="font-size:22px">Welcome to Budgie</h2><p class="muted">Budgie works from your own Google Sheet. Open the connect link from your sheet on this phone, or paste it here.</p>' +
      '<label class="f">Connect link<input id="connectLink" type="url" placeholder="https://budgie-money.github.io/#connect=…" autocomplete="off"></label>' +
      '<button type="button" class="btn wide" style="margin-top:12px" data-a="connect">Connect</button>' + (S.lastError ? '<p class="bad small">' + esc(S.lastError) + "</p>" : "")) +
      card('<h2>Just looking?</h2><p class="muted">Try Budgie with a made-up household. Nothing is saved.</p><button type="button" class="btn ghost wide" data-a="demo" data-v="on">Show me sample data</button>');
  };

  // ----- Today
  SCREENS.today = function () {
    var d = db(), p = me(), now = todayIso();
    // first run: nothing to work from yet, so say what to set up rather than invent a payday
    if (!d.income.some(function (x) { return x.person === p && (x.isPay === true || /^true$/i.test(String(x.isPay))); })) {
      var hasBud = d.budgets.some(function (b) { return b.person === p; });
      return card('<h2 style="font-size:20px">Let\'s set up Budgie</h2><p class="muted">Budgie works everything out from your pay, bills and budgets. Add these and Today fills itself in.</p><div class="list">' +
        li("1. Your pay", "How much and when it lands", "", "new", "income") + li("2. Your bills", "Rent, phone, subscriptions", "", "go", "bills") + li("3. Your budgets", hasBud ? "Done: change them any time" : "Food, fuel, fun and the rest", "", "go", "list:budgets") + "</div>");
    }
    var t = B.today(d, p, now), html = "";
    var spendNames = t.tiles.filter(function (x) { return x.day !== null; }).map(function (x) { return x.name.toLowerCase().replace(/ \(what's left\)/, ""); });
    var daysTo = B.diff(now, t.nextPay);
    // (a budget gone over that's been covered says which, so it doesn't read as something to fix)
    var covered = t.status === "Over, but covered", pill = covered ? (t.overs.length === 1 ? esc(t.overs[0].name) + " covered" : "Overs covered") : esc(t.status);
    var heroNotes = [];
    if (t.period.opening) heroNotes.push("A short month: you started Budgie on " + esc(B.nice(B.startOf(d, p))) + ".");
    if (t.spare && t.spare.amount > 0.5) heroNotes.push(M(t.spare.amount) + " spare in your " + esc(B.accName(d, B.mainOf(d, p))) + " goes to your " + esc(t.spare.toName) + " on payday.");
    // tapping it shows where your money is: each pot now, and where Budgie says it should be
    html += '<button type="button" class="hero card" data-a="go" data-v="pots" style="display:block;width:100%;text-align:left"><div class="row"><span class="small" style="opacity:.92">You can spend today</span><span class="pill">' + pill + "</span></div>" +
      '<div class="big">' + M(t.safe) + '</div><div class="small" style="opacity:.92">' + (spendNames.length ? "for " + esc(joinWords(spendNames)) : "") + "</div>" +
      (heroNotes.length ? '<div class="small" style="opacity:.92;margin-top:6px">' + heroNotes.join(" ") + "</div>" : "") +
      '<div class="line"><span>' + (daysTo === 0 ? "Payday is today" : "Payday in " + daysTo + " day" + (daysTo === 1 ? "" : "s") + " · " + esc(B.nice(t.nextPay))) + "</span><span class=\"num\">" + (t.nextPayAmount ? M(t.nextPayAmount) : "") + "</span></div></button>";
    if (t.plan.shortfall > 0.5) html += card('<div class="what bad" style="font-weight:700">This month is ' + M(t.plan.shortfall) + " short</div><p class=\"small muted\" style=\"margin:4px 0 0\">Bills, budgets and savings add up to more than is coming in. Lower a budget or saving in Settings.</p>");
    else if (daysTo <= 7) {
      // (what the pot only covers until money comes in later that month isn't short)
      var nextPd = B.payday(d, p, B.periodAt(d, p, t.nextPay)), gap = Math.max((nextPd.cover ? nextPd.cover.amount : 0) + (nextPd.uncovered || 0) - (nextPd.soon || 0), nextPd.plan.shortfall || 0);
      if (gap > 0.5) html += '<button type="button" class="card li" style="display:block;text-align:left;padding:14px 16px" data-a="go" data-v="payday"><div class="what warn" style="font-weight:700">Next month looks ' + M(gap) + " short</div><div class=\"small muted\">Tap to see your payday plan and what covers it.</div></button>";
    }
    // to do
    var items = t.todo, payItems = items.filter(function (x) { return x.payday; }), rest = items.filter(function (x) { return !x.payday; });
    last.todo = rest;
    var rows = "";
    var reN = reviewRows().length;
    if (reN) rows += li(reN + " new payment" + (reN === 1 ? "" : "s") + " from " + esc(bankName()), "Check what " + (reN === 1 ? "it was" : "they were") + " for", "", "go", "review");
    if (S.bank && S.bank.reapproveBy && B.diff(todayIso(), String(S.bank.reapproveBy).slice(0, 10)) <= 7) rows += li("Approve Budgie again in the Monzo app", "Monzo asks every 90 days. Do it by " + esc(B.nice(String(S.bank.reapproveBy).slice(0, 10))), "", "go", "bank");
    if (payItems.length) rows += li("Sort your pay into " + esc(potWord(true)), payItems.length + " " + esc(payItems.length === 1 ? potWord() : potWord(true)) + " still to move", "", "go", "payday");
    rest.forEach(function (it, i) {
      var right = num(it.type === "warn" ? "" : M(it.amount));
      var why = esc(MT(it.why)) + (it.short ? ' <span class="warn">Only ' + M(Math.max(0, it.amount - it.short)) + " is there right now.</span>" : "");
      if (it.type === "warn") rows += '<div class="li"><span class="grow"><span class="what warn">' + esc(MT(it.what)) + '</span><span class="why">' + why + '</span></span><button type="button" class="btn ghost sm" data-a="tick" data-v="' + i + '">Got it</button></div>';
      else if (it.info) rows += '<div class="li"><span class="grow"><span class="what">' + esc(MT(it.what)) + '</span><span class="why">' + why + '</span></span><button type="button" class="btn ghost sm" data-a="tick" data-v="' + i + '">I\'ve paid</button></div>';
      else rows += '<label class="li" style="cursor:pointer"><input type="checkbox" class="tick" data-c="tick" data-v="' + i + '" aria-label="Done: ' + esc(MT(it.what)) + '"><span class="grow"><span class="what">' + esc(MT(it.what)) + '</span><span class="why">' + why + "</span></span>" + right + "</label>";
    });
    var leftN = rest.length + (payItems.length ? 1 : 0) + (reN ? 1 : 0);
    html += card('<div class="row"><h2>To do</h2><span class="small muted">' + (leftN ? leftN + " left" : "") + "</span></div>" + (rows ? '<div class="list">' + rows + "</div>" : '<p class="muted" style="margin:8px 0 0">All done. Everything is where it should be.</p>'));
    // tiles
    if (t.tiles.length) {
      html += '<h2 class="h2">' + (isEasy() ? "What you can spend" : "Each day until payday") + (t.tiles.some(function (x) { return x.mode === "weekly"; }) ? infoBtn("pace") : "") + '</h2><div class="grid2">';
      t.tiles.forEach(function (x) {
        var name = esc(x.name.replace(/ \(what's left\)/, "")), v, sub;
        if (x.mode === "weekly") { v = M(x.weekLeft) + "<small> left</small>"; sub = "This week · " + M(Math.max(0, x.left)) + " left this month"; }
        else if (x.day !== null) { v = M(x.day) + "<small> a day</small>"; sub = M(Math.max(0, x.left)) + " left of " + M(x.amount); }
        else { v = M(Math.max(0, x.left)) + "<small> left</small>"; sub = "For one-offs this month"; }
        var pace = x.over > 0.004 ? '<span class="bad">' + M(x.over) + " over</span>" : x.pace < -0.5 ? '<span class="warn">' + M(-x.pace) + " over pace</span>" : x.mode === "oneoff" ? "" : '<span class="good">' + (x.pace > 0.5 ? M(x.pace) + " under pace" : "On pace") + "</span>";
        html += '<button type="button" class="tile" data-a="go" data-v="money" style="text-align:left;color:var(--ink)"><div class="n">' + name + '</div><div class="v">' + v + "</div>" + bar(x.pct, x.mode === "oneoff" ? null : x.paceMark, "var(--k-spend)") + '<div class="small" style="margin-top:6px">' + sub + '</div><div class="tiny hide-easy" style="font-weight:600">' + pace + "</div></button>";
      });
      html += "</div>";
    }
    html += comingCard(t.coming);
    // just after 6 April: last tax year at a glance
    if (now.slice(5) >= "04-06" && now.slice(5) <= "04-30") html += yearCard(taxYearStart(B.addDays(now, -40)), false);
    return html;
  };
  // "food, fuel and fun", but "food, fuel, fun and spending" when the last one already has an "and" in it
  function joinWords(a) { if (a.length < 2) return a.join(""); var last = a[a.length - 1]; return a.slice(0, -1).join(", ") + (/ and /.test(last) ? ", " : " and ") + last; }
  function comingCard(list) {
    last.coming = {};
    var rows = list.slice(0, 8).map(function (c) {
      last.coming[c.key] = c;
      // a loan repayment has no "didn't happen" or "change": tapping it asks if it's been paid
      var mine = c.table !== "loans" && canEditItem(c);
      return '<div class="swipe">' + (mine ? '<div class="acts" aria-hidden="true"><button type="button" class="skip" tabindex="-1" data-a="occskip" data-v="' + esc(c.key) + '">Didn\'t happen</button><button type="button" class="chg" tabindex="-1" data-a="occ" data-v="' + esc(c.key) + '">Change</button></div>' : "") +
        '<button type="button" class="face li" data-a="occ" data-v="' + esc(c.key) + '">' + dateBox(c.date, c.sign > 0 ? "in" : "bill") + '<span class="grow"><span class="what">' + esc(c.name) + '</span><span class="why hide-easy">' + esc(c.account || "") + (c.changed ? " · changed" : "") + "</span></span>" + num((c.sign > 0 ? "+" : "−") + M(c.amount), c.sign > 0 ? "good" : "") + "</button></div>";
    }).join("");
    return card('<div class="row"><h2>Coming up</h2><span class="tiny muted hide-easy">Swipe or tap to change</span></div>' + (rows ? '<div class="list">' + rows + "</div>" : '<p class="muted">Nothing in the next two weeks.</p>'));
  }
  // whose is it: only the person a row belongs to can change it (loans and splits belong to both of you)
  function canEditRow(table, r) {
    if (!r) return false;
    if (table === "loans" || table === "splits") return true;
    if (table === "transfers") return r.from === me();
    if (table === "accounts") return r.owner === me();
    if (table === "goals") return String(r.owners || "").split(/[,\s]+/).indexOf(me()) >= 0;
    return r.person === me();
  }
  function canEditItem(c) { var it = db().byId[c.item]; if (!it) return false; if (c.table === "loans") return true; return it.person === me() || it.from === me(); }

  // ----- Money (month / year)
  // The plan for one pay period, payday to payday (the same as the budget tab in the Google Sheet), by kind of money:
  // what's coming in, the bills it pays, what you can spend and what's saved. Each kind has its own colour (themes.js),
  // the same wherever it shows. Money put by for a yearly bill is bills money; a top-up of the pot that covers going
  // over is saving. What comes in always equals what goes out plus what's left over (or short).
  var KINDS = {in: "pay", bill: "cal", spend: "basket", save: "pot"};
  var kchip = function (k) { return '<span class="kchip k-' + k + '" aria-hidden="true">' + icon(KINDS[k], 18) + "</span>"; };
  var kindOf = function (l) { return l.kind === "topup" ? "save" : l.kind === "save" && l.setAside ? "bill" : l.kind; };
  // new money: pay, other income and what your partner or a loan pays you (not money carried over from last month)
  var newMoney = function (l) { return l.kind === "in" && !l.already && !l.leftover && !l.setAside && l.id !== "opening"; };
  function sortPlan(lines) {
    var g = {in: [], bill: [], spend: [], save: []}, t = {in: 0, bill: 0, spend: 0, save: 0, fresh: 0};
    lines.forEach(function (l) { var k = kindOf(l); if (!g[k]) return; g[k].push(l); t[k] += l.amount; if (newMoney(l)) t.fresh += l.amount; });
    Object.keys(t).forEach(function (k) { t[k] = B.round(t[k]); });
    t.left = B.round(t.in - t.bill - t.spend - t.save);
    return {lines: g, tot: t};
  }
  // a bar of what goes where: bills, spending and saving, out of what comes in (or out of what goes out, when it's more)
  function kindBar(t, cls) {
    var base = Math.max(t.in, t.bill + t.spend + t.save, 0.01), seg = function (k) { return t[k] > 0.004 ? '<i class="k-' + k + '" style="width:' + (t[k] / base * 100).toFixed(2) + '%;background:var(--kc)"></i>' : ""; };
    return '<div class="split2 ' + (cls || "") + '" aria-hidden="true">' + seg("bill") + seg("spend") + seg("save") + "</div>";
  }
  SCREENS.money = function () {
    var d = db(), p = me(), now = todayIso(), html = '<div class="seg" role="group" aria-label="View"><button type="button" data-a="moneyview" data-v="month" aria-pressed="' + (S.ui.money === "month") + '">Month</button><button type="button" data-a="moneyview" data-v="year" aria-pressed="' + (S.ui.money === "year") + '">Year</button></div>';
    if (S.ui.money === "year") return html + yearView(d, p, now);
    var per = B.periodAt(d, p, now), st = B.startOf(d, p);
    for (var i = 0; i < Math.abs(S.ui.monthOff); i++) per = S.ui.monthOff > 0 ? B.nextPeriod(d, p, per) : B.prevPeriod(d, p, per);
    var mv = B.monthView(d, p, per), pl = mv.plan, g = sortPlan(mv.lines), t = g.tot, end = B.addDays(per.next, -1);
    // the first month is short (it starts when you started Budgie): the dates say so
    var dates = per.opening ? "Started " + B.nice(st > per.start ? st : per.start) + " · ends " + B.nice(end) : B.nice(per.start) + " to " + B.nice(end);
    html += '<div class="row" style="margin:14px 0 0;align-items:center"><button type="button" class="round" data-a="month" data-v="-1" aria-label="Earlier month">' + icon("back", 18) + '</button><div style="text-align:center"><div style="font-weight:800">' + esc(per.name) + '</div><div class="small muted">' + esc(dates) + '</div></div><button type="button" class="round" data-a="month" data-v="1" aria-label="Later month" style="transform:scaleX(-1)">' + icon("back", 18) + "</button></div>";
    // at a glance: what comes in, and where it goes
    var item = function (k, label, v) { return '<div class="k-' + k + '"><span class="kdot"></span><span>' + label + "<b>" + M(v) + "</b></span></div>"; };
    html += card('<div class="row" style="align-items:center"><h2>Where it goes' + infoBtn("sheet") + "</h2></div>" + kindBar(t, "big") +
      '<div class="legend">' + item("in", "Coming in", t.in) + item("bill", "Bills", t.bill) + item("spend", "Spending", t.spend) + item("save", "Saving", t.save) + "</div>" +
      (t.left > 0.004 ? '<p class="small muted" style="margin:10px 0 0">' + M(t.left) + " left over, carried into next month.</p>" : "") +
      (pl.shortfall > 0.004 ? '<p class="small bad" style="margin:10px 0 0;font-weight:700">' + M(pl.shortfall) + " short: more goes out than comes in.</p>" : ""));
    var row = function (l) {
      var right = num(M(l.amount)), why = "", tbl = l.kind === "in" ? (l.id === "opening" ? "" : (d.byId[l.id] && d.income.indexOf(d.byId[l.id]) >= 0 ? "income" : "transfers")) : l.kind === "bill" ? (l.transfer ? "transfers" : l.loan ? "loans" : "bills") : l.kind === "topup" || l.setAside ? "" : "budgets", name = l.name;
      if (l.kind === "spend" && l.spent !== undefined) {
        var left = B.round(l.avail - l.spent); name = budName(l);
        why = M(l.spent) + " spent · " + (left < -0.004 ? '<span class="bad">' + M(-left) + " over</span>" : M(left) + " left") + bar(l.avail ? l.spent / l.avail * 100 : (l.spent > 0 ? 100 : 0), null, "var(--k-spend)");
      }
      else if (l.id === "opening") { name = "What you started with"; why = "In your account and " + esc(potWord(true)) + " on " + esc(B.nice(l.date)); }
      else if (l.date) why = esc(B.nice(l.date)) + (l.actual ? " · actual" : "");
      else if (l.setAside && l.due) why = "Due " + esc(B.nice(l.due));
      else if (l.kind === "topup") why = "Puts back what covered going over budget";
      else if (l.catchup) why = "It ended last month short";
      else if (l.remainder && l.amount < 0.005) why = per.opening ? "Starts on payday" : "Nothing left over this month";
      if (l.kind === "spend" && l.id && d.byId[l.id]) return li(esc(name), why, right, "payments", per.start + "|" + l.id);
      return tbl && l.id && d.byId[l.id] && canEditRow(tbl, d.byId[l.id]) ? li(esc(name), why, right, "edit", tbl + ":" + l.id) : li(esc(name), why, right);
    };
    var sec = function (k, title, extra) {
      var ls = g.lines[k]; if (!ls.length && !extra) return "";
      return card('<div class="row" style="align-items:center"><span class="khead">' + kchip(k) + "<h2>" + title + "</h2></span>" + num(M(t[k])) + '</div><div class="list" style="margin-top:6px">' + ls.map(row).join("") + (extra || "") + "</div>");
    };
    var nPay = d.transactions.filter(function (x) { return x.person === p && x.date >= per.start && x.date < per.next; }).length;
    html += sec("in", "Coming in") + sec("bill", "Bills to pay") +
      sec("spend", "What you can spend", nPay ? li("See all " + nPay + " payment" + (nPay === 1 ? "" : "s"), "", "", "payments", per.start + "|") : "") + savedCard(d, p, per, g, now);
    return html;
  };
  // what's saved: each savings account (and any pot a saving goes into) with what it's worth, what goes in this month,
  // and an Update for when the provider's app says something different
  function savedCard(d, p, per, g, now) {
    var date = per.next <= now ? B.addDays(per.next, -1) : now, bal = B.balances(d, date), into = {};
    g.lines.save.forEach(function (l) { var a = l.account || B.mainOf(d, p); into[a] = (into[a] || 0) + l.amount; });
    var accs = B.accountsOf(d, p).filter(function (a) { return /saving|isa|lisa|pension/.test(a.kind || "") || into[a.id] !== undefined; });
    if (!accs.length) return "";
    var tot = 0, nextPl = null;
    var rows = accs.map(function (a) {
      var v = bal[a.id] || 0;
      if (a.kind === "lisa" && date === now) { var Mo = lisaModel(a); if (Mo.value) v = Mo.value(now); }
      tot += v;
      var inn = B.round(into[a.id] || 0), why = "", rl = g.lines.save.filter(function (l) { return l.remainder && l.account === a.id; })[0];
      if (inn > 0.004) why = "+" + M(inn) + " this month";
      else if (rl && per.opening) { nextPl = nextPl || B.planFor(d, p, B.nextPeriod(d, p, per)); var nl = nextPl.lines.filter(function (x) { return x.remainder; })[0]; why = "Starts on payday" + (nl && nl.amount > 0.004 ? ": " + M(nl.amount) : ""); }
      else if (rl) why = "Nothing left over for it this month";
      else { var lv = d.valuations.filter(function (x) { return x.account === a.id && x.date <= date; }).map(function (x) { return x.date; }).sort().pop(); if (lv) why = "Checked " + esc(B.nice(lv)); }
      return '<div class="li"><span class="grow"><span class="what">' + esc(a.name) + "</span>" + (why ? '<span class="why">' + why + "</span>" : "") + '</span><span class="valup">' + num(M(v)) + '<button type="button" class="linkbtn" data-a="potcheck" data-v="' + esc(a.id) + '" aria-label="Update ' + esc(a.name) + '">Update</button></span></div>';
    }).join("");
    return card('<div class="row" style="align-items:center"><span class="khead">' + kchip("save") + "<h2>What's saved</h2></span>" + num(M(tot)) + '</div><div class="list" style="margin-top:6px">' + rows + "</div>");
  }
  function yearView(d, p, now) {
    var ys = B.year(d, p, now).map(function (y) { return Object.assign({k: sortPlan(B.planFor(d, p, y.period).lines).tot}, y); }), cur = 0;
    ys.forEach(function (y, i) { if (y.current) cur = i; });
    var max = Math.max.apply(null, ys.map(function (y) { return y.k.save; }).concat([1])), totSave = 0, totIn = 0, totSpent = 0;
    ys.forEach(function (y) { totSave += y.k.save; totIn += y.k.fresh; totSpent += y.past || y.current ? y.spent : 0; });
    var bars = ys.map(function (y) { return '<div title="' + esc(y.period.name + ": " + M(y.k.save)) + '"><i class="' + (y.past ? "" : "plan") + '" style="height:' + Math.max(2, Math.round(y.k.save / max * 110)) + 'px"></i><span>' + esc(y.period.name.slice(0, 1)) + "</span></div>"; }).join("");
    var key = function (k, label) { return '<span class="k-' + k + '" style="display:inline-flex;align-items:center;gap:5px"><span class="kdot"></span>' + label + "</span>"; };
    return card('<div class="row" style="align-items:center"><span class="khead">' + kchip("save") + "<h2>Saved each month</h2></span>" + num(M0(totSave)) + '</div><div class="bars k-save">' + bars + '</div><p class="tiny muted" style="margin:8px 0 0">Lighter bars are still to come.</p>') +
      card('<h2>Over these 12 months</h2><div class="list" style="margin-top:6px">' + li("Coming in", "Pay and money paid to you", num(M0(totIn))) + li("Saved", totIn ? Math.round(totSave / totIn * 100) + "% of what comes in" : "", num(M0(totSave))) + li("Spent so far (day to day)", "", num(M0(totSpent))) + "</div>") +
      card('<div class="row"><h2>Month by month</h2></div><div class="chart-key" style="margin-top:4px">' + key("bill", "Bills") + key("spend", "Spending") + key("save", "Saved") + '</div><div class="list" style="margin-top:4px">' + ys.map(function (y, i) {
        return '<button type="button" class="li" style="display:block" data-a="moneyjump" data-v="' + (i - cur) + '"><span class="row" style="align-items:center"><span class="what">' + esc(y.period.name) + "</span><span style=\"display:flex;align-items:center;gap:6px\">" + num(M0(y.k.save)) + chev() + '</span></span><span style="display:block;margin-top:6px">' + kindBar(y.k) + "</span></button>";
      }).join("") + "</div>");
  }

  // ----- Add
  // Logging a payment should take a few seconds: type the amount, tap what it was for, log it. Everything else
  // (where it came from, the date, splitting, a note) is worked out and shown as one line you only touch if it's wrong.
  var BUD_ICON = [[/food|grocer|shop/i, "basket"], [/fuel|petrol|car|travel|train|bus/i, "car"], [/fun|spend|entertain|treat|going out/i, "spark"], [/house|home/i, "house"], [/gift|birthday|christmas/i, "gift"], [/health|gym|beauty/i, "heart"], [/eat|takeaway|lunch|coffee/i, "cup"]];
  ICON.basket = '<path d="M4 9h16l-1.6 9.2a2 2 0 0 1-2 1.8H7.6a2 2 0 0 1-2-1.8z"/><path d="M8.5 9l3.5-5 3.5 5"/>';
  ICON.car = '<path d="M3 15v-3l2-5h9l4 5h2a1 1 0 0 1 1 1v2h-2"/><path d="M8 15h7"/><circle cx="6" cy="16" r="2"/><circle cx="17" cy="16" r="2"/><path d="M5.5 12h12"/>';
  ICON.heart = '<path d="M12 20s-7-4.5-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.5-7 10-7 10z"/>';
  ICON.cup = '<path d="M5 8h11v5a5 5 0 0 1-5 5h-1a5 5 0 0 1-5-5z"/><path d="M16 10h2a2 2 0 0 1 0 4h-2"/>';
  ICON.tag = '<path d="M4 4h7l9 9-7 7-9-9z"/><circle cx="8" cy="8" r="1.5"/>';
  function budIcon(name) { var m = BUD_ICON.filter(function (x) { return x[0].test(name); })[0]; return m ? m[1] : "tag"; }
  var budName = function (b) { return String(b.name || "").replace(/ \(what's left\)/, ""); };
  // the budgets you use most come first; the rest are one tap away
  function addBudgets(date) {
    var d = db(), p = me(), buds = spendBudgets(date), since = B.addDays(todayIso(), -90), use = {};
    d.transactions.forEach(function (x) { if (x.person === p && x.date >= since && x.budget) use[x.budget] = (use[x.budget] || 0) + 1; });
    return buds.map(function (b, i) { return {b: b, i: i, n: use[b.id] || 0}; }).sort(function (x, y) { return y.n - x.n || x.i - y.i; }).map(function (x) { return x.b; });
  }
  // where a payment for this budget usually comes from, and whether it's usually split
  function addDefaults(budId) {
    var d = db(), p = me(), b = d.byId[budId] || {}, acc = d.byId[b.account], recent = d.transactions.filter(function (x) { return x.person === p && x.budget === budId && x.source !== "import"; }).sort(function (x, y) { return x.date < y.date ? 1 : -1; }).slice(0, 5);
    var from = acc && /main|pot|saving|credit/.test(acc.kind || "pot") && acc.owner === p ? acc.id : B.mainOf(d, p);
    var counts = {}; recent.forEach(function (x) { if (x.account) counts[x.account] = (counts[x.account] || 0) + 1; });
    var top = Object.keys(counts).sort(function (x, y) { return counts[y] - counts[x]; })[0]; if (top && counts[top] >= 2 && d.byId[top]) from = top;
    var splitN = recent.filter(function (x) { return x.split; }).length, lastSplit = (recent.filter(function (x) { return x.split; })[0] || {}).split;
    return {account: from, split: !!partner() && recent.length >= 2 && splitN * 2 > recent.length, splitId: lastSplit || "half"};
  }
  SCREENS.add = function () {
    var a = S.ui.add, d = db(), p = me(), mode = a.mode || "spend", date = a.date || todayIso();
    var amount = '<label class="amount-in"><span class="sr">Amount</span><span class="cur" aria-hidden="true">£</span><input id="addAmt" type="text" inputmode="decimal" enterkeyhint="done" autocomplete="off" placeholder="0.00" data-c="addamt" value="' + esc(S.ui.keys || "") + '"></label>';
    if (mode === "bill") return addBillScreen(amount);
    var buds = addBudgets(date);
    if (!buds.length) return amount + card('<h2>Set up a budget first</h2><p class="muted small">Budgie needs at least one budget (like Food or Fun) to log a payment against.</p><button type="button" class="btn wide" data-a="new" data-v="budgets">Add a budget</button>');
    if (!a.budget || !buds.some(function (b) { return b.id === a.budget; })) { a.budget = buds[0].id; a.touched = {}; }
    a.touched = a.touched || {};
    var def = addDefaults(a.budget);
    if (!a.touched.account) a.account = def.account;
    if (!a.touched.split) { a.split = def.split; a.splitId = def.splitId; }
    var shownN = buds.length <= 6 ? buds.length : 5, shown = buds.slice(0, shownN);
    if (buds.indexOf(d.byId[a.budget]) >= shownN) shown[shownN - 1] = d.byId[a.budget]; // keep the chosen one in view
    var html = amount + '<div class="budgrid' + (shown.length + (buds.length > shownN ? 1 : 0) <= 4 ? " two" : "") + '" role="group" aria-label="What for">' + shown.map(function (b) {
      return '<button type="button" class="budtile" data-a="addbud" data-v="' + esc(b.id) + '" aria-pressed="' + (a.budget === b.id) + '">' + icon(budIcon(b.name), 22) + budLabel(b) + "</button>";
    }).join("") + (buds.length > shownN ? '<button type="button" class="budtile others" data-a="addmorebud">' + icon("grid", 22) + "<span>More</span></button>" : "") + "</div>";
    // the details, as one line of things you can tap
    var q = shortName(person(partner()).name) || "partner", accName = B.accName(d, a.account);
    var bits = ['<button type="button" class="detail" data-a="addfrom">' + "From " + esc(accName) + "</button>",
      '<button type="button" class="detail" data-a="adddatepick">' + esc(date === todayIso() ? "Today" : date === B.addDays(todayIso(), -1) ? "Yesterday" : B.nice(date)) + "</button>"];
    if (partner()) bits.push('<button type="button" class="detail' + (a.split ? " on" : "") + '" data-a="addsplit2" aria-pressed="' + !!a.split + '">' + (a.split ? "Split with " + esc(q) : "Not split") + "</button>");
    bits.push('<button type="button" class="detail" data-a="addnotepick">' + (a.note ? "“" + esc(a.note.length > 18 ? a.note.slice(0, 17) + "…" : a.note) + "”" : "Add a note") + "</button>");
    html += '<div class="details fit" data-lead>' + bits.join("") + "</div>";
    html += '<button type="button" class="btn wide logit" data-a="addsave">Log it</button>';
    html += '<p style="text-align:center;margin:14px 0 0"><button type="button" class="linkbtn" data-a="addmode" data-v="bill">Log a bill\'s real amount</button></p>';
    return html;
  };
  function addBillScreen(amount) {
    var a = S.ui.add, d = db(), p = me();
    // bills that change (energy, water) first; nothing picked until you choose, so the rent can't be overwritten by accident
    var isVar = function (b) { return b.variable === true || /^true$/i.test(String(b.variable)); };
    var myBills = d.bills.filter(function (b) { return b.person === p; }).sort(function (x, y) { return (isVar(y) ? 1 : 0) - (isVar(x) ? 1 : 0); });
    var varBills = myBills.filter(isVar), showAll = a.allBills || !varBills.length, shown = showAll ? myBills : varBills;
    if (a.bill && !shown.some(function (b) { return b.id === a.bill; })) a.bill = "";
    var html = '<p class="small muted" style="margin:0 4px 10px">The real amount of a bill that changes, like energy. It replaces the estimate (and re-splits it if it\'s shared).</p>' + amount;
    if (!myBills.length) return html + '<p class="empty">You don\'t have any bills yet.</p><button type="button" class="btn dash" data-a="new" data-v="bills">Add a bill</button>';
    html += '<div style="font-weight:700;margin:14px 4px 8px">Which bill</div><div class="chips fit">' + shown.map(function (b) { return '<button type="button" class="chip" data-a="addpick" data-v="bill:' + esc(b.id) + '" aria-pressed="' + (a.bill === b.id) + '">' + esc(b.name) + "</button>"; }).join("") +
      (!showAll ? '<button type="button" class="chip" data-a="addallbills" style="border-style:dashed">Another bill…</button>' : "") + "</div>";
    html += '<div class="details" style="margin-top:12px"><button type="button" class="detail" data-a="adddatepick">' + esc((a.date || todayIso()) === todayIso() ? "Today" : B.nice(a.date)) + "</button></div>";
    html += '<button type="button" class="btn wide logit" data-a="addsave">Save the bill</button>';
    html += '<p style="text-align:center;margin:14px 0 0"><button type="button" class="linkbtn" data-a="addmode" data-v="spend">Back to logging a payment</button></p>';
    return html;
  }

  // ----- Partner
  SCREENS.partner = function () {
    var d = db(), p = me(), q = partner(), now = todayIso();
    if (!q) return card("<p>No partner is linked yet. Add them on the people tab of your Google Sheet.</p>");
    var sm = demoOn() ? B.summary(d, q, now) : (S.data.summary || {});
    var qp = person(q), col = q === "sophie" || q === "sam" ? "#2F7D6D" : "#2E5E8C", html = "";
    var statusWord = sm.status ? sm.status.toLowerCase() : "";
    html += card('<div style="display:flex;gap:12px;align-items:center"><span class="round avatar" style="background:' + col + ';color:#fff;width:48px;height:48px;border-radius:24px">' + esc((qp.name || "?").charAt(0)) + '</span><div class="grow"><div style="font-weight:800;font-size:19px">' + esc(qp.name) + (statusWord ? " is " + esc(statusWord) : "") + '</div><div class="small muted">' + (sm.nextPay ? (function (n) { return n < 0 ? "" : n === 0 ? "Paid today" : n === 1 ? "Paid tomorrow" : "Paid in " + n + " days (" + esc(B.nice(sm.nextPay)) + ")"; })(B.diff(now, sm.nextPay)) : "") + "</div></div></div>" +
      (sm.safe !== undefined ? '<div class="two" style="margin-top:14px"><div class="tile" style="background:var(--bg)"><div class="n">Can spend today</div><div class="v">' + M(sm.safe) + '</div></div><div class="tile" style="background:var(--bg)"><div class="n">Saving this month</div><div class="v">' + M(sm.saved || 0) + "</div></div></div>" : "") +
      (sm.tiles ? sm.tiles.map(function (x) { return '<div style="margin-top:12px"><div class="row small"><span style="font-weight:600">' + esc(x.name.replace(/ \(what's left\)/, "")) + '</span><span class="num">' + M(x.spent) + " of " + M(x.amount) + "</span></div>" + '<div style="margin-top:5px">' + bar(x.pct, x.mode === "oneoff" ? null : x.paceMark, col) + "</div></div>"; }).join("") + '<p class="tiny muted" style="margin:12px 0 0">The black line is where they\'d expect to be by today.</p>' : '<p class="small muted">' + esc(qp.name) + " isn't sharing their budget details.</p>"));
    // their own goals and payments, when they've chosen to share them
    (sm.goals || []).forEach(function (g) { html += card('<div class="row"><span style="font-weight:700">' + esc(g.name) + '</span><span class="tiny muted">' + esc(qp.name) + "'s goal</span></div>" + '<div style="margin:8px 0 6px">' + bar(g.pct, null, col) + '</div><div class="row small"><span class="num" style="font-weight:600">' + M0(g.saved) + " of " + M0(g.target) + "</span>" + num(g.pct + "%") + "</div>"); });
    var theirPays = d.transactions.filter(function (x) { return x.person === q && x.date >= B.addDays(now, -31); }).sort(function (a, b) { return a.date < b.date ? 1 : -1; });
    if (theirPays.some(function (x) { return !x.split; }) && !demoOn()) html += card('<div class="row"><h2>' + esc(qp.name) + "'s payments</h2>" + '<span class="tiny muted">The last month</span></div><div class="list" style="margin-top:6px">' + theirPays.slice(0, 12).map(function (x) { var b = d.byId[x.budget]; return li(esc(x.note || (b ? b.name.replace(/ \(what's left\)/, "") : "Payment")), esc(B.nice(x.date)) + (x.split ? " · split with you" : ""), num(M(x.amount))); }).join("") + "</div>" + '');
    // between you two
    var bt = B.between(d, p, now), mo = bt.month;
    // money lent between you counts too, so "all square" is only said of what it's about (shared bills) when a loan is
    // still being paid back, and what's left on the loans each way is said with the next repayment
    var lns = B.loans(d, p, now).filter(function (l) { return l.left > 0.004; }), loanLines = "";
    [[true, function (a) { return esc(qp.name) + " owes you " + a; }], [false, function (a) { return "You owe " + esc(qp.name) + " " + a; }]].forEach(function (w) {
      var ls = lns.filter(function (l) { return (l.lender === p) === w[0]; }); if (!ls.length) return;
      var left = ls.reduce(function (t, l) { return t + l.left; }, 0), nd = ls.map(function (l) { return l.plan[0] ? l.plan[0].date : ""; }).filter(Boolean).sort()[0], na = 0;
      ls.forEach(function (l) { l.plan.forEach(function (r) { if (r.date === nd) na += r.amount; }); });
      loanLines += '<div style="font-weight:700;margin-top:6px">' + w[1](M(left)) + " in loans</div>" + (nd ? '<div class="small ' + (nd < now ? "warn" : "muted") + '">' + (nd < now ? M(na) + " was due " + esc(B.nice(nd)) : "Next " + M(na) + " " + esc(whenWord(nd))) + "</div>" : "");
    });
    var bills = lns.length ? " for shared bills" : "", line = bt.owedToMe > 0.004 ? esc(qp.name) + " owes you " + M(bt.owedToMe) + bills : bt.iOwe > 0.004 ? "You owe " + esc(qp.name) + " " + M(bt.iOwe) + bills : lns.length ? "All square on shared bills" : "You're all square";
    html += '<h2 class="h2">Between you two' + infoBtn("between") + "</h2>" + card('<div class="row"><span style="font-weight:800;font-size:18px">' + line + "</span></div>" + loanLines +
      (mo && (mo.bills || mo.paidIn || mo.paidOut) ? '<div class="banner small">This month so far: shared bills ' + M(mo.bills) + ". " + (mo.theirShare ? esc(qp.name) + "'s share " + M(mo.theirShare) + ", paid " + M(mo.paidIn) + ". " : "") + (mo.myShare ? "Your share " + M(mo.myShare) + ", paid " + M(mo.paidOut) + "." : "") + "</div>" : "") +
      (bt.owedToMe > 0.004 ? '<button type="button" class="btn ghost sm" style="margin-top:10px" data-a="settle" data-v="in">' + esc(shortName(qp.name)) + " has paid me</button>" : bt.iOwe > 0.004 ? '<button type="button" class="btn ghost sm" style="margin-top:10px" data-a="settle" data-v="out">I\'ve paid ' + esc(shortName(qp.name)) + "</button>" : ""));
    B.loans(d, p, now).forEach(function (l) {
      if (l.left <= 0.004) return;
      var next = l.plan[0];
      html += card('<div class="row"><span style="font-weight:700">' + esc(l.name) + "</span>" + num(M(l.left) + " left") + '</div><div class="small muted">' + (l.lender === p ? esc(qp.name) + " pays you" : "You pay " + esc(qp.name)) + (next ? " " + M(next.amount) + " on " + esc(B.nice(next.date)) : "") + '</div><div style="margin-top:8px">' + bar(l.pct) + "</div>");
    });
    var shared = d.bills.filter(function (b) { return b.split; });
    if (shared.length) html += card('<h2>Shared bills</h2><div class="list" style="margin-top:6px">' + shared.map(function (b) {
      var amt = B.amountAt(d, b, now), parts = d.people.map(function (x) { return esc(x.name) + " " + M(B.shareOf(d, b.split, x.id, amt, b.person)); }).join(" · ");
      return li(esc(b.name), parts, num(M(amt)));
    }).join("") + "</div>");
    B.goals(d, p, now).filter(function (g) { return String((d.byId[g.id] || {}).owners || "").split(/[,\s]+/).filter(Boolean).length > 1; }).forEach(function (g) { html += goalCard(g); });
    return html;
  };

  // ----- More
  // a category button's name: a long word ("Subscriptions") is set a little smaller, so it fits without breaking
  function budLabel(b) { var n = budName(b), long = String(n).split(/\s+/).some(function (w) { return w.length > 11; }); return "<span" + (long ? ' class="long"' : "") + ">" + esc(n) + "</span>"; }
  SCREENS.more = function () {
    var items = [["payday", "pay", "Payday", "Sort your pay into " + potWord(true)], ["pots", "pot", cap(potWord(true)), "What should be where"], ["bills", "cal", "Bills", "Calendar and subscriptions"], ["goals", "target", "Goals", "House, car, holidays"],
      ["lisa", "lisa", "LISA tracker", "Balance, bonus, allowance"], ["house", "house", "House", "Deposit and mortgage"], ["networth", "scale", "Net worth", "Own minus owe"], ["debts", "debt", "Debts and IOUs", "Who owes what"],
      ["insights", "spark", "Insights", "Trends and nudges"], ["gifts", "gift", "Gifts", "Christmas and birthdays"], ["settings", "gear", "Settings", "Bills, pay, budgets, themes"]];
    return '<div class="more">' + items.map(function (x) { return '<button type="button" data-a="go" data-v="' + x[0] + '"><span class="ic">' + icon(x[1], 20) + '</span><span style="font-weight:700">' + esc(x[2]) + '</span><span class="tiny muted">' + esc(x[3]) + "</span></button>"; }).join("") + "</div>";
  };

  // ----- Payday
  SCREENS.payday = function () {
    var d = db(), p = me(), now = todayIso(), per = B.periodAt(d, p, now);
    // this payday's list stays until every move on it is ticked (Today keeps asking), then the next payday shows
    var curLeft = per.pay && !per.opening && B.payday(d, p, per).moves.some(function (m) { return !B.ticked(d, p, "pay:" + per.start + ":" + m.to); });
    var upcoming = !(per.pay && !per.opening && (B.diff(per.start, now) <= 7 || curLeft));
    if (upcoming) per = B.periodAt(d, p, B.today(d, p, now).nextPay);
    var pd = B.payday(d, p, per), pay = pd.pay, html = "";
    var payOcc = pay && pay.occ ? pay.occ.split("@") : null;
    html += '<section class="hero card"><div class="small" style="opacity:.92">' + (upcoming ? "Next payday: " : "Payday: ") + esc(B.nice(per.start)) + '</div><div class="big">' + (pay ? M(pay.amount) : "–") + "</div>" +
      (pay && payOcc ? '<button type="button" class="btn sm" style="background:color-mix(in srgb, var(--hero-ink) 18%, transparent);color:var(--hero-ink)" data-a="payedit" data-v="' + esc(pay.occ) + '">' + (pay.actual ? "Change the amount" : "Paid a different amount?") + "</button>" : "") + "</section>";
    S.ui.payLeft = remainderName(pd.plan);
    var rows = pd.moves.map(function (m) {
      var key = "pay:" + per.start + ":" + m.to, done = !!B.ticked(d, p, key);
      return '<label class="li" style="cursor:pointer"><input type="checkbox" class="tick" data-c="paytick" data-v="' + esc(key) + "|" + esc(m.from) + "|" + esc(m.to) + "|" + m.amount + '"' + (done ? " checked" : "") + (upcoming ? " disabled" : "") + '><span class="grow"><span class="what">' + esc(B.accName(d, m.to)) + '</span><span class="why">' + esc(MT(m.why)) + "</span></span>" + num(M(m.amount)) + "</label>";
    }).join("");
    if (pd.cover) {
      var ckey = "pay:" + per.start + ":cover", cdone = !!B.ticked(d, p, ckey);
      // (money that only comes in later in the month isn't a gap in the plan: the pot covers it until then)
      var gapAll = pd.cover.amount + (pd.uncovered || 0), until = pd.soonFor ? esc(pd.soonFor.names.join(" and ")) + " comes in on " + esc(B.nice(pd.soonFor.date)) : "", onlyUntil = until && pd.soon >= gapAll - 0.004;
      html += card('<div class="warn" style="font-weight:700">' + (onlyUntil ? "This pay is " + M(gapAll) + " short until " + until : "This pay is " + M(gapAll) + " short of everything planned") + "</div><p class=\"small muted\" style=\"margin:4px 0 8px\">Your " + esc(B.accName(d, pd.cover.from)) + " covers the gap so your " + esc(B.accName(d, pd.payAccount)) + " doesn't go under" + (onlyUntil ? ", and your next pay tops it back up." : ". To avoid it, lower a budget or saving this month." + (until && pd.soon > 0.004 ? " " + M(pd.soon) + " of it is only until " + until + "." : "")) + "</p>" +
        (pd.uncovered > 0.004 ? '<p class="small bad" style="margin:0 0 8px;font-weight:600">Your ' + esc(B.accName(d, pd.cover.from)) + " only has enough for " + M(pd.cover.amount) + ", so " + M(pd.uncovered) + " is still short. Lower a budget or saving this month, or move money in from elsewhere.</p>" : "") +
        '<label class="li" style="cursor:pointer"><input type="checkbox" class="tick" data-c="paytick" data-v="' + esc(ckey) + "|" + esc(pd.cover.from) + "|" + esc(pd.cover.to) + "|" + pd.cover.amount + '"' + (cdone ? " checked" : "") + (upcoming ? " disabled" : "") + '><span class="grow"><span class="what">' + esc(B.accName(d, pd.cover.from)) + " to " + esc(B.accName(d, pd.cover.to)) + "</span></span>" + num(M(pd.cover.amount)) + "</label>");
    }
    var doneN = pd.moves.filter(function (m) { return B.ticked(d, p, "pay:" + per.start + ":" + m.to); }).length;
    html += card('<div class="row"><h2>Move from ' + esc(B.accName(d, pd.payAccount)) + '</h2><span class="small muted">' + (upcoming ? "On payday" : doneN + " of " + pd.moves.length + " done") + '</span></div><div class="list" style="margin-top:6px">' + (rows || '<p class="muted">Nothing to move.</p>') + "</div>" +
      '<div class="row" style="padding-top:10px;border-top:1px solid var(--line2);margin-top:4px"><span>Stays in ' + esc(B.accName(d, pd.payAccount)) + ' <span class="tiny muted">for spending from there</span></span>' + num(M(pd.keeps)) + "</div>");
    var left = pd.plan.lines.filter(function (l) { return l.leftover; })[0];
    if (pd.already.length || left) html += '<div class="banner small">Less to move: ' + pd.already.map(function (a) { return M(a.amount) + " is already in your " + esc(a.name); }).concat(left ? [M(left.amount) + " still in your " + esc(B.accName(d, pd.payAccount)) + " from last month counts towards it"] : []).join(", ") + ".</div>";
    if (pd.plan.owe > 0.004) html += '<div class="banner small">' + M(pd.plan.owe) + " you owe " + esc(person(partner()).name || "your partner") + " stays in your " + esc(B.accName(d, B.mainOf(d, p))) + " for settling up.</div>";
    (pd.later || []).forEach(function (m) { html += '<div class="banner small">' + M(m.amount) + " more goes to your " + esc(B.accName(d, m.to)) + " once " + esc(m.names.join(" and ")) + " has come in" + (m.date > per.start ? ", after payday" : "") + ". To do asks for it then.</div>"; });
    if (upcoming && pd.estimate) html += '<p class="tiny muted" style="margin:8px 4px">Estimates until payday, from what should be in your ' + esc(potWord(true)) + " then.</p>";
    if (pd.plan.shortfall > 0.004) html += card('<div class="bad" style="font-weight:700">This pay is ' + M(pd.plan.shortfall) + " short of the plan.</div><p class=\"small muted\">Lower a budget or saving for this month in Settings.</p>");
    return html;
  };
  // "on Thursday" within the week ahead, else "on Thu 26 Nov"
  function whenWord(iso) { var n = B.diff(todayIso(), iso); return n === 0 ? "today" : n === 1 ? "tomorrow" : n > 0 && n < 7 ? "on " + ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][new Date(iso + "T12:00:00").getDay()] : "on " + B.nice(iso); }
  function remainderName(pl) { return pl.remainderBudget ? pl.remainderBudget.name.replace(/ \(what's left\)/, "") : "savings"; }

  // ----- Payments you've logged (tap one to fix or delete it)
  SCREENS.payments = function (pp) {
    var d = db(), p = me(), per = B.periodAt(d, p, pp.start || todayIso()), bud = pp.budget ? d.byId[pp.budget] : null;
    var list = d.transactions.filter(function (x) { return x.person === p && x.date >= per.start && x.date < per.next && (!bud || x.budget === bud.id); })
      .sort(function (a, b) { return a.date < b.date ? 1 : a.date > b.date ? -1 : (+b.updated || 0) - (+a.updated || 0); });
    var tot = list.reduce(function (t, x) { return t + (+x.amount || 0); }, 0), html = "";
    if (bud) { var st = B.budgetState(d, p, per)[bud.id]; if (st) html += card('<div class="row"><span style="font-weight:700">' + esc(bud.name.replace(/ \(what's left\)/, "")) + "</span>" + num(M(st.spent) + " of " + M(st.avail)) + '</div><div style="margin-top:8px">' + bar(st.avail ? st.spent / st.avail * 100 : 0, null, "var(--k-spend)") + "</div>" + (canEditRow("budgets", bud) ? '<button type="button" class="btn ghost sm" style="margin-top:10px" data-a="edit" data-v="budgets:' + esc(bud.id) + '">Change this budget</button>' : "")); }
    var byDay = {}; list.forEach(function (x) { (byDay[x.date] = byDay[x.date] || []).push(x); });
    html += Object.keys(byDay).map(function (day) {
      return '<h2 class="h2" style="font-size:15px">' + esc(B.nice(day)) + "</h2>" + card('<div class="list">' + byDay[day].map(function (x) {
        var b = d.byId[x.budget], sp = x.split ? (d.byId[x.split] || {}).name || "Half each" : "", early = x.date < B.startOf(d, p);
        return li(esc(x.note || (b ? b.name.replace(/ \(what's left\)/, "") : "Payment")), esc([x.note && b ? b.name.replace(/ \(what's left\)/, "") : "", B.accName(d, x.account), sp ? "split: " + sp : "", x.source === "import" ? "imported" : "", early ? "before Budgie started, so not counted" : ""].filter(Boolean).join(" · ")), num(M(x.amount)), "payedit1", x.id);
      }).join("") + "</div>", "flush");
    }).join("");
    if (!list.length) html += '<p class="empty">No payments logged ' + (bud ? "for this " : "this ") + "month yet.</p>";
    else html += '<div class="row" style="margin:14px 4px 0;font-weight:700"><span>Total</span>' + num(M(tot)) + "</div>";
    html += '<div class="row fit" style="margin-top:14px;gap:10px"><button type="button" class="btn ghost sm" data-a="paymonth" data-v="-1">Earlier month</button>' + (per.next <= todayIso() ? '<button type="button" class="btn ghost sm" data-a="paymonth" data-v="1">Later month</button>' : "") + "</div>";
    return html;
  };
  function paymentSheet(id) {
    var x = (tables().transactions || []).filter(function (r) { return r.id === id; })[0], d = db(), p = me(); if (!x) return;
    S.ui.payEdit = id;
    var buds = d.budgets.filter(function (b) { return b.person === p && b.mode !== "saving"; });
    var accs = B.accountsOf(d, p).filter(function (a) { return /main|pot|saving|credit/.test(a.kind || "pot"); });
    // one from the bank: the amount, the date and the account are the bank's, so only what it was for and the note change
    var bk = isBankTx(x), lock = bk ? " disabled" : "";
    openSheet("<h2>Change this payment</h2>" + (bk ? '<p class="small muted" style="margin:4px 0 0">From ' + esc(bankName()) + ": the amount, date and account come from your bank.</p>" : "") +
      '<label class="f">Amount<input type="text" inputmode="decimal" id="peAmt" value="' + esc(x.amount) + '"' + lock + "></label>" +
      '<label class="f">What for<select id="peBud">' + buds.map(function (b) { return '<option value="' + esc(b.id) + '"' + (b.id === x.budget ? " selected" : "") + ">" + esc(b.name.replace(/ \(what's left\)/, "")) + "</option>"; }).join("") + "</select></label>" +
      '<label class="f">Paid from<select id="peAcc"' + lock + ">" + accs.map(function (a) { return '<option value="' + esc(a.id) + '"' + (a.id === x.account ? " selected" : "") + ">" + esc(a.name) + "</option>"; }).join("") + "</select></label>" +
      '<div class="two"><label class="f">Date<input type="date" id="peDate" value="' + esc(x.date) + '"' + lock + '></label><label class="f">Note<input type="text" id="peNote" value="' + esc(x.note || "") + '"></label></div>' +
      (x.split ? '<p class="small muted" style="margin:8px 0 0">Split with ' + esc(person(partner()).name) + ": " + esc((d.byId[x.split] || {}).name || "half each") + "</p>" : "") +
      '<button type="button" class="btn wide" style="margin-top:14px" data-a="pesave">Save</button><button type="button" class="btn danger wide" style="margin-top:10px" data-a="pedel">Delete this payment</button>');
  }
  function isBankTx(x) { return !!x && (!!x.bankId || /^bk-/.test(String(x.id || ""))); }

  // ----- Pots
  SCREENS.pots = function () {
    var d = db(), list = B.pots(d, me(), todayIso()), tot = list.reduce(function (s, x) { return s + x.should; }, 0);
    var html = '<section class="hero card"><div class="small" style="opacity:.92">Should be across your account and ' + esc(potWord(true)) + '</div><div class="big">' + M(tot) + '</div><div class="small" style="opacity:.92">Once your To do is done</div></section>';
    // a budget you've gone over: what it was, and whether it's been covered
    B.today(d, me(), todayIso()).overs.forEach(function (o) {
      html += '<div class="banner small">' + (o.covered ? "You went " + M(o.over) + " over your " + esc(o.name) + " budget. Your " + esc(o.from) + " covered it, and your next pay tops it back up." : "You're " + M(o.over) + " over your " + esc(o.name) + " budget" + (o.from ? ". Your To do says what covers it." : ".")) + "</div>";
    });
    // each one now, against where it should be once your To do is done
    list.forEach(function (x) {
      var acc = d.byId[x.id] || {}, off = x.pending;
      html += '<button type="button" class="card li" style="display:block;padding:14px 16px;text-align:left" data-a="potcheck" data-v="' + esc(x.id) + '"><div class="row"><span style="font-weight:700">' + esc(x.name) + (x.fallback ? ' <span class="tiny muted">covers going over</span>' : "") + "</span>" + num(M(x.now)) + "</div>" +
        (acc.purpose ? '<div class="small muted">' + esc(acc.purpose) + "</div>" : "") +
        (Math.abs(off) > 0.004 ? '<div class="small ' + (off > 0 ? "warn" : "muted") + '">Should be ' + M(x.should) + ": " + M(Math.abs(off)) + (off > 0 ? " below" : " above") + ", see To do</div>" : '<div class="small good">Where it should be</div>') + "</button>";
    });
    html += '<p class="small muted" style="margin:12px 4px">Tap a ' + esc(potWord()) + " to set what your " + esc(person().bank || "bank") + " app shows." + infoBtn("pots") + "</p>";
    return html;
  };

  // ----- Bills (calendar + list)
  SCREENS.bills = function () {
    var d = db(), p = me(), now = todayIso(), y = +now.slice(0, 4), m = +now.slice(5, 7) - 1 + S.ui.calOff;
    var first = new Date(y, m, 1), Y = first.getFullYear(), Mo = first.getMonth(), cal = B.calendar(d, p, Y, Mo), dim = new Date(Y, Mo + 1, 0).getDate();
    var lead = (new Date(Y, Mo, 1).getDay() + 6) % 7, cells = "";
    for (var i = 0; i < lead; i++) cells += "<span></span>";
    for (var dd = 1; dd <= dim; dd++) {
      var iso = Y + "-" + String(Mo + 1).padStart(2, "0") + "-" + String(dd).padStart(2, "0"), items = cal[iso] || [];
      var cls = (iso === now ? "today " : "") + (items.length ? "has " : "") + (items.length && items.every(function (x) { return x.sign > 0; }) ? "in" : "");
      cells += '<button type="button" class="' + cls + '" data-a="calday" data-v="' + iso + '" aria-label="' + esc(B.nice(iso) + (items.length ? ", " + items.length + " things" : "")) + '">' + dd + (items.length ? "<i></i>" : "") + "</button>";
    }
    var monthName = first.toLocaleDateString("en-GB", {month: "long", year: "numeric"});
    var html = card('<div class="row" style="align-items:center"><button type="button" class="round" data-a="cal" data-v="-1" aria-label="Earlier month">' + icon("back", 18) + '</button><b>' + esc(monthName) + '</b><button type="button" class="round" data-a="cal" data-v="1" aria-label="Later month" style="transform:scaleX(-1)">' + icon("back", 18) + "</button></div>" +
      '<div class="cal">' + ["M", "T", "W", "T", "F", "S", "S"].map(function (x) { return '<span class="h">' + x + "</span>"; }).join("") + cells + '</div><p class="tiny muted" style="margin:8px 0 0">Green dots are money coming in.</p>');
    var mine = d.bills.filter(function (b) { return b.person === p; }), subs = 0;
    mine.forEach(function (b) { if (/sub/i.test(b.category || "")) { B.occurrences(d, b, now, B.addDays(now, 365)).forEach(function (o) { subs += o.amount; }); } });
    var nextOf = function (it) { var o = B.occurrences(d, it, now, B.addDays(now, 400))[0]; return o ? B.nice(o.date) : "no more dates"; };
    html += '<h2 class="h2">Your bills</h2>';
    html += card('<div class="list">' + mine.map(function (b) { return li(esc(b.name) + (b.split ? ' <span class="tiny muted">shared</span>' : ""), esc(B.describe(b)) + " · next " + esc(nextOf(b)), num(M(B.amountAt(d, b, now))), "edit", "bills:" + b.id); }).join("") + "</div>" +
      (subs ? '<div class="row" style="padding-top:10px;border-top:1px solid var(--line2);font-weight:700"><span>Subscriptions over a year</span>' + num(M0(subs)) + "</div>" : ""), "flush");
    html += '<button type="button" class="btn dash" data-a="new" data-v="bills">Add a bill</button>';
    var yr = B.yearly ? B.yearly(d, p, now) : [];
    if (yr.length) {
      var perMonth = yr.reduce(function (t, y) { return t + (+y.monthly || 0); }, 0);
      html += '<h2 class="h2">Yearly costs</h2>' + card('<p class="small muted" style="margin:0 0 6px">Budgie puts a bit by each payday so these are covered when they come.' + (perMonth > 0.004 ? " " + M(perMonth) + " this month in all." : " It starts from your next payday.") + "</p>" + '<div class="list">' + yr.map(function (y) {
        var pct = y.amount ? Math.min(100, (+y.saved || 0) / y.amount * 100) : 0;
        var how = y.monthly > 0.004 ? M(y.monthly) + " this month · " + M(y.saved) + " put by" : y.saved > 0.004 ? M(y.saved) + " put by" : "Starts next payday";
        return '<button type="button" class="li" data-a="edit" data-v="bills:' + esc(y.id) + '" style="display:block"><div class="row"><span class="what">' + esc(y.name) + "</span>" + num(M(y.amount)) + '</div><div class="small muted">' + (y.next ? "Next " + esc(B.nice(y.next)) + " · " : "") + how + (y.onTrack === false ? ' · <span class="warn">behind</span>' : "") + '</div><div style="margin-top:6px">' + bar(pct, null, "var(--k-bill)") + "</div></button>";
      }).join("") + "</div>", "flush");
    }
    var tr = d.transfers.filter(function (t) { return t.from === p; });
    if (tr.length) html += '<h2 class="h2">You pay ' + esc(person(partner()).name || "") + "</h2>" + card('<div class="list">' + tr.map(function (t) { return li(esc(t.name), esc(B.describe(t)) + " · next " + esc(nextOf(t)), num(M(B.amountAt(d, t, now))), "edit", "transfers:" + t.id); }).join("") + "</div>", "flush");
    return html;
  };

  // ----- Goals
  function goalCard(g) {
    var extra = "";
    if (g.kind === "emergency") { var ess = essentials(); if (ess) extra = '<div class="small muted">Three months of essentials would be about ' + M0(ess * 3) + ".</div>"; }
    return '<button type="button" class="card li" style="display:block;text-align:left;padding:16px" data-a="edit" data-v="goals:' + esc(g.id) + '"><div class="row"><span style="font-weight:700">' + esc(g.name) + "</span>" + num(g.pct + "%") + '</div><div style="margin:8px 0 6px">' + bar(g.pct, null, "var(--k-save)") + '</div><div class="row small"><span class="num" style="font-weight:600">' + M0(g.saved) + " of " + M0(g.target) + '</span><span class="muted">' + (g.due ? "by " + esc(new Date(String(g.due).slice(0, 10) + "T12:00:00").toLocaleDateString("en-GB", {month: "short", year: "numeric"})) : "") + "</span></div>" + extra + "</button>";
  }
  function essentials() {
    var d = db(), p = me(), per = B.periodAt(d, p, todayIso()), pl = B.planFor(d, p, per), t = 0;
    pl.lines.forEach(function (l) { if (l.kind === "bill" || (l.kind === "spend" && /food|fuel|travel/i.test(l.name))) t += l.amount; });
    return B.round(t);
  }
  SCREENS.goals = function () {
    var gs = B.goals(db(), me(), todayIso());
    return (gs.length ? gs.map(goalCard).join("") : '<p class="empty">No goals yet.</p>') + '<button type="button" class="btn dash" data-a="new" data-v="goals">Add a goal</button>';
  };

  // ----- LISA
  // What it's worth between balance checks: the split across funds (from the provider's app) turned into
  // units, moved along each day by the fund prices the sheet fetches. Money paid in buys more units in the same mix.
  var LISA_FUNDS = [{re: /bond/i, fund: "GB00B58YKH53"}, {re: /propert/i, fund: "GB00B5BFJG71"}, {re: /share|equit|world/i, fund: "GB00BJS8SJ34"}];
  function priceBook() {
    var book = {};
    (tables().prices || []).forEach(function (r) { if (r.deleted || !r.fund || !(+r.price > 0)) return; (book[r.fund] = book[r.fund] || []).push({date: String(r.date).slice(0, 10), price: +r.price, est: /^est/.test(String(r.source || ""))}); });
    Object.keys(book).forEach(function (k) { book[k].sort(function (a, b) { return a.date < b.date ? -1 : 1; }); });
    return book;
  }
  function priceAt(list, date) {
    if (!list || !list.length) return null;
    if (date <= list[0].date) return list[0].price;
    var lastP = list[list.length - 1]; if (date >= lastP.date) return lastP.price;
    for (var i = 1; i < list.length; i++) if (list[i].date >= date) { var a = list[i - 1], b = list[i], span = B.diff(a.date, b.date) || 1; return a.price + (b.price - a.price) * B.diff(a.date, date) / span; }
    return lastP.price;
  }
  function lisaModel(acc) {
    var hold = null; try { hold = JSON.parse(getSettingFor(acc.owner, "lisa.holdings." + acc.id, "") || "null"); } catch (e) {}
    var now = todayIso(), vals = (tables().valuations || []).filter(function (v) { return v.account === acc.id && !v.deleted && v.amount !== "" && v.amount !== undefined; }).map(function (v) { return {date: String(v.date).slice(0, 10), amount: +v.amount}; }).sort(function (a, b) { return a.date < b.date ? -1 : 1; });
    var flows = (tables().moves || []).filter(function (m) { return !m.deleted && +m.amount && (m.to === acc.id) !== (m.from === acc.id); })
      .map(function (m) { return {date: String(m.date).slice(0, 10), amount: (m.to === acc.id ? 1 : -1) * (+m.amount), bonus: /^lisa:bonus/.test(m.key || ""), fee: /^lisa:fee/.test(m.key || "")}; }).sort(function (a, b) { return a.date < b.date ? -1 : 1; });
    var out = {vals: vals, flows: flows};
    if (!hold || !hold.items || !hold.items.length || !vals.length) return out;
    var book = priceBook(), items = hold.items.map(function (x) { var f = LISA_FUNDS.filter(function (y) { return y.re.test(x[0]); })[0]; return {name: x[0], amount: +x[1] || 0, fund: f && f.fund}; });
    var tot = items.reduce(function (t, x) { return t + x.amount; }, 0);
    if (!tot || items.some(function (x) { return !x.fund || !book[x.fund]; })) return out;
    var hd = String(hold.date || vals[vals.length - 1].date).slice(0, 10), w = items.map(function (x) { return x.amount / tot; });
    var base = items.map(function (x) { return x.amount / priceAt(book[x.fund], hd); });
    var unitsAt = function (t) {
      var u = base.slice();
      flows.forEach(function (f) {
        var sign = f.date > hd && f.date <= t ? 1 : f.date <= hd && f.date > t ? -1 : 0; if (!sign) return;
        items.forEach(function (x, i) { u[i] += sign * f.amount * w[i] / priceAt(book[x.fund], f.date); });
      });
      return u;
    };
    var raw = function (t) { var u = unitsAt(t); return items.reduce(function (s2, x, i) { return s2 + u[i] * priceAt(book[x.fund], t); }, 0); };
    // the latest balance check is the truth on its day; everything else is scaled to match it
    var lastV = vals[vals.length - 1], k = raw(lastV.date) ? lastV.amount / raw(lastV.date) : 1;
    out.k = k; out.items = items; out.book = book;
    out.value = function (t) { return raw(t) * k; };
    out.perFund = function (t) { var u = unitsAt(t); return items.map(function (x, i) { return {name: x.name, amount: u[i] * k * priceAt(book[x.fund], t)}; }); };
    out.priceDate = items.map(function (x) { var l = book[x.fund].filter(function (q) { return q.date <= now && !q.est; }); return l.length ? l[l.length - 1].date : ""; }).sort()[0] || "";
    out.lastCheck = lastV;
    return out;
  }
  // a line chart of value against everything paid in (a dashed line), over time
  function lisaChart(pts) {
    var W = 320, H = 150, P = 8, xs = pts.map(function (q) { return B.diff(pts[0].date, q.date); }), span = Math.max(1, xs[xs.length - 1]);
    var all = []; pts.forEach(function (q) { all.push(q.v, q.p); });
    var mx = Math.max.apply(null, all), mn = Math.min.apply(null, all), pad = (mx - mn) * 0.08 || 50; mx += pad; mn = Math.max(0, mn - pad);
    var X = function (i) { return (xs[i] / span * (W - 2)).toFixed(1); }, Y = function (v) { return (P + (H - 2 * P) * (1 - (v - mn) / (mx - mn))).toFixed(1); };
    var line = function (k) { return pts.map(function (q, i) { return (i ? "L" : "M") + X(i) + " " + Y(q[k]); }).join(" "); };
    var lastI = pts.length - 1;
    return '<div style="position:relative;margin-top:10px"><span class="tiny muted" style="position:absolute;left:2px;top:-2px">' + M0(mx) + '</span><span class="tiny muted" style="position:absolute;left:2px;bottom:2px">' + M0(mn) + "</span>" +
      '<svg viewBox="0 0 ' + W + " " + H + '" width="100%" height="' + H + '" preserveAspectRatio="none" role="img" aria-label="Value over time against money paid in" style="display:block">' +
      '<path d="' + line("v") + " L" + X(lastI) + " " + H + " L0 " + H + ' Z" fill="var(--soft)"/>' +
      '<path d="' + line("p") + '" fill="none" stroke="var(--muted)" stroke-width="1.5" stroke-dasharray="4 3" vector-effect="non-scaling-stroke"/>' +
      '<path d="' + line("v") + '" fill="none" stroke="var(--accent)" stroke-width="2.5" stroke-linejoin="round" vector-effect="non-scaling-stroke"/></svg></div>' +
      '<div class="row tiny muted" style="margin-top:2px"><span>' + esc(monthYear(pts[0].date)) + "</span><span>Today</span></div>";
  }
  function monthYear(iso) { return new Date(iso + "T12:00:00").toLocaleDateString("en-GB", {month: "short", year: "numeric"}); }
  SCREENS.lisa = function () {
    var d = db(), now = todayIso(), accs = d.accounts.filter(function (a) { return a.kind === "lisa"; }), html = "";
    if (!accs.length) return '<p class="empty">Add your Lifetime ISA under Settings, ' + esc(cap(potWord(true))) + ' (kind: LISA).</p>';
    var mineFirst = accs.sort(function (a, b) { return (a.owner === me() ? 0 : 1) - (b.owner === me() ? 0 : 1); });
    var together = 0;
    mineFirst.forEach(function (a) {
      var L = B.lisa(d, a.id, now), Mo = lisaModel(a), whose = a.owner === me() ? "Your" : esc(person(a.owner).name) + "'s";
      var live = Mo.value ? Mo.value(now) : null, value = live !== null ? live : L.balance; together += value;
      // the chart: from the first money we know about (at most two years back) to today
      var chartHtml = "", first = [Mo.flows[0] && Mo.flows[0].date, Mo.vals[0] && Mo.vals[0].date].filter(Boolean).sort()[0];
      if (first && first < now) {
        var from = first < B.addDays(now, -730) ? B.addDays(now, -730) : B.addDays(first, -3), days = B.diff(from, now), step = Math.max(1, Math.round(days / 60)), dates = [];
        for (var i = 0; i <= days; i += step) dates.push(B.addDays(from, i));
        Mo.flows.forEach(function (f) { if (f.date > from && f.date < now) { dates.push(B.addDays(f.date, -1)); dates.push(f.date); } });
        if (dates[dates.length - 1] !== now) dates.push(now);
        dates = dates.filter(function (x, j, arr) { return arr.indexOf(x) === j; }).sort();
        // without fund prices yet, the value line is the balance with no growth (it fills in once prices arrive)
        var lastV = Mo.vals.length ? Mo.vals[Mo.vals.length - 1] : {date: now, amount: L.balance};
        var noGrowth = function (t) { var v = lastV.amount; Mo.flows.forEach(function (f) { if (f.date > t && f.date <= lastV.date) v -= f.amount; if (f.date > lastV.date && f.date <= t) v += f.amount; }); return v; };
        var V = Mo.value || noGrowth, v0 = V(from), paid = 0;
        var pts = dates.map(function (t) { paid = v0; Mo.flows.forEach(function (f) { if (f.date > from && f.date <= t && f.amount > 0) paid += f.amount; }); return {date: t, v: Math.max(0, V(t)), p: paid}; });
        var endP = pts[pts.length - 1], gain = endP.v - endP.p;
        if (pts.length > 2 && Mo.flows.length) {
          chartHtml = '<div class="small" style="font-weight:600;margin-top:14px">Since ' + esc(monthYear(from)) + "</div>" + lisaChart(pts) +
            '<div class="chart-key"><span><i></i>What it\'s worth</span><span><i class="dash"></i>What went in (paid in plus bonuses)</span></div>' +
            (Mo.value ? '<div class="small" style="margin-top:8px">Put in since then: ' + M0(endP.p - v0) + " · " + (gain >= 0 ? '<span class="good">up ' + M0(gain) + "</span>" : '<span class="bad">down ' + M0(-gain) + "</span>") + " on what went in" + (endP.p ? " (" + (gain >= 0 ? "+" : "−") + Math.abs(gain / endP.p * 100).toFixed(1) + "%)" : "") + ", after fees</div>" : '<div class="tiny muted" style="margin-top:6px">The growth line fills in once fund prices arrive from your Google Sheet.</div>');
        }
      }
      var hold = null; try { hold = JSON.parse(getSettingFor(a.owner, "lisa.holdings." + a.id, "") || "null"); } catch (e) {}
      var holdHtml = "";
      if (hold && hold.items && hold.items.length) {
        var parts = Mo.perFund ? Mo.perFund(now) : hold.items.map(function (x) { return {name: x[0], amount: +x[1] || 0}; }), tot = parts.reduce(function (t, x) { return t + x.amount; }, 0);
        holdHtml = '<div class="small" style="font-weight:600;margin-top:14px">What it\'s invested in</div>' +
          parts.map(function (x) { var pc = tot ? Math.round(x.amount / tot * 100) : 0; return '<div style="margin-top:6px"><div class="row small"><span>' + esc(x.name) + '</span><span class="num">' + M0(x.amount) + " · " + pc + "%</span></div>" + bar(pc, null, "var(--k-save)") + "</div>"; }).join("");
      }
      var sub = Mo.value ? "Worth about this today" + (Mo.priceDate ? ", from fund prices on " + esc(B.nice(Mo.priceDate)) : "") + ". Last checked " + M(Mo.lastCheck.amount) + " on " + esc(B.nice(Mo.lastCheck.date)) + "." : Mo.vals.length ? "Last checked " + esc(B.nice(Mo.vals[Mo.vals.length - 1].date)) + ", plus anything paid in since." : "";
      html += card('<div class="small muted">' + whose + " Lifetime ISA</div>" + '<div class="row" style="align-items:center"><span style="font-size:32px;font-weight:800;font-family:var(--head)">' + M0(value) + "</span>" + (a.owner === me() ? '<button type="button" class="btn ghost sm" data-a="potcheck" data-v="' + esc(a.id) + '">Update</button>' : "") + "</div>" +
        (sub ? '<div class="tiny muted">' + sub + "</div>" : "") + chartHtml + holdHtml +
        (L.bonusReceived || L.feesThisYear ? '<div class="small muted" style="margin-top:10px">This tax year: ' + M(L.bonusReceived) + " bonus received · " + M(L.feesThisYear) + " fees</div>" : "") +
        (L.expectedBonus && L.expectedBonus.length ? '<div class="small" style="margin-top:6px">Bonus on its way: about <b>' + M(L.expectedBonusTotal || L.expectedBonus.reduce(function (t, x) { return t + x.amount; }, 0)) + "</b>" + (L.expectedBonus[0].due ? (L.expectedBonus[0].due < now ? ", the first was due by " : ", the first by ") + esc(B.nice(L.expectedBonus[0].due)) : "") + ". Moneybox claims it for you.</div>" : "") +
        '<div style="margin-top:12px"><div class="row small"><span style="font-weight:600">This tax year (6 Apr to 5 Apr)</span><span class="num">' + M0(L.paidThisYear) + " of £4,000</span></div>" + '<div style="margin-top:6px">' + bar(L.paidThisYear / 40, null, "var(--k-save)") + '</div><div class="small muted" style="margin-top:4px">' + M0(L.allowanceLeft) + " left you can pay in · bonus on this year's payments about " + M(L.bonusThisYear) + "</div>" +
        (L.planned ? '<div class="small" style="margin-top:8px">On course for ' + M0(L.onCourse) + " by 5 April" + (L.overBy ? '. <span class="warn">That\'s ' + M(L.overBy) + " over the £4,000 limit, and your provider turns away anything over it. Pay in a little less before then.</span>" : L.onCourse >= 3999.5 ? '. <span class="good">That\'s the full £1,000 bonus.</span>' : ".") + "</div>" : "") +
        (a.owner === me() && (L.paidBefore || !Mo.flows.length) ? '<button type="button" class="btn ghost sm" style="margin-top:8px" data-a="lisapaid" data-v="' + esc(a.id) + '">' + (L.paidBefore ? "Paid in before Budgie: " + M0(L.paidBefore) : "Add what's already paid in") + "</button>" : "") + "</div>");
    });
    if (mineFirst.length > 1) html += card('<div class="row"><span style="font-weight:700">Together</span>' + num(M0(together)) + "</div>");
    html += '<div class="banner small"><b>The rules Budgie keeps an eye on.</b> Up to £4,000 a year, plus a 25% government bonus (up to £1,000). For a first home up to £450,000. Taking money out for anything else costs 25%. The government plans to replace the LISA with a new first-time-buyer account from April 2028; existing LISAs carry on for now.</div>';
    return html;
  };

  // ----- House
  SCREENS.house = function () {
    var d = db(), now = todayIso(), g = B.goals(d, me(), now).filter(function (x) { return x.kind === "house"; })[0], raw = g ? d.byId[g.id] : null, h = S.ui.house;
    if (!g) return '<p class="empty">Add a goal with the kind "House" to plan your first home.</p><button type="button" class="btn dash" data-a="new" data-v="goals">Add a house goal</button>';
    var price = h.price || +raw.price || 250000, depPct = h.dep || 0, rate = h.rate || 4.5, term = h.term || 30;
    var deposit = depPct ? price * depPct / 100 : Math.max(price * 0.05, g.target - 5000), fees = 5000, need = deposit + fees, borrow = Math.max(0, price - deposit);
    var r = rate / 1200, n = term * 12, monthly = r ? borrow * r / (1 - Math.pow(1 + r, -n)) : borrow / n;
    var monthlyIn = 0; d.budgets.forEach(function (b) { if (b.mode === "saving" && String(raw.accounts || "").indexOf(b.account) >= 0) monthlyIn += B.amountAt(d, b, now) * ((d.byId[b.account] || {}).kind === "lisa" ? 1.25 : 1); });
    var monthsTo = monthlyIn > 0 ? Math.max(0, Math.ceil((need - g.saved) / monthlyIn)) : null, ready = monthsTo !== null ? new Date(new Date().getFullYear(), new Date().getMonth() + monthsTo, 1).toLocaleDateString("en-GB", {month: "short", year: "numeric"}) : "";
    var ltv = Math.round(borrow / price * 100);
    var chips = function (list, cur, act, fmt, lead) { return '<div class="chips fit" style="margin-top:6px"' + (lead ? " data-lead" : "") + ">" + list.map(function (v) { return '<button type="button" class="chip" data-a="' + act + '" data-v="' + v + '" aria-pressed="' + (v === cur) + '">' + fmt(v) + "</button>"; }).join("") + "</div>"; };
    var html = card('<div class="small muted">Your first home' + (g.parts.length > 1 ? ", together" : "") + '</div><div style="font-size:24px;font-weight:800;font-family:var(--head)">' + (ready ? "Ready around " + esc(ready) : M0(g.saved) + " saved") + "</div>" +
      '<div style="margin:10px 0 6px">' + bar(need ? g.saved / need * 100 : 0, null, "var(--k-save)") + '</div><div class="small">' + M0(g.saved) + " saved of " + M0(need) + " needed</div>" +
      (g.parts.length ? '<div class="small muted">' + g.parts.map(function (x) { return esc(x.owner === me() ? "Your " : person(x.owner).name + "'s ") + esc(x.name) + " " + M0(x.amount); }).join(" · ") + "</div>" : "") +
      (monthlyIn ? '<div class="small muted">Going in each month: about ' + M0(monthlyIn) + " including the LISA bonus</div>" : ""));
    html += card("<h2>Try the numbers</h2>" + '<div class="small muted" style="margin-top:8px">House price</div>' + chips([200000, 250000, 300000, 350000], price, "hprice", function (v) { return "£" + v / 1000 + "k"; }) +
      '<div class="small muted" style="margin-top:12px">Deposit</div>' + chips([0, 10, 15, 25, 40], depPct, "hdep", function (v) { return v ? v + "%" : "Your goal"; }, true) +
      '<div class="two"><label class="f">Interest rate %<input type="number" step="0.1" inputmode="decimal" data-c="hrate" value="' + rate + '"></label><label class="f">Years<input type="number" inputmode="numeric" data-c="hterm" value="' + term + '"></label></div>' +
      '<div class="list" style="margin-top:10px">' + li("Deposit", Math.round(deposit / price * 100) + "% of the price", num(M0(deposit))) + li("Fees and moving", "Survey, solicitor, moving van", num(M0(fees))) + li("You need", "", num(M0(need))) +
      li("You borrow", ltv + "% loan to value" + (ltv <= 60 ? ": the cheapest rates" : ltv <= 75 ? ": good rates" : ltv <= 85 ? "" : ": fewer, pricier deals"), num(M0(borrow))) + li("Mortgage each month", rate + "% over " + term + " years", num(M0(monthly))) +
      li("Can you use your LISA?", price <= 450000 ? "Yes: the home is under £450,000" : "No: LISAs only work for homes up to £450,000", num(price <= 450000 ? "Yes" : "No", price <= 450000 ? "good" : "bad")) + "</div>" +
      '<p class="tiny muted" style="margin:10px 0 0">Estimates only. A mortgage broker will give you the real figures.</p>');
    return html;
  };

  // ----- Net worth
  SCREENS.networth = function () {
    var d = db(), p = me(), now = todayIso(), nw = B.netWorth(d, p, now), vals = [];
    for (var i = 11; i >= 0; i--) { var dt = new Date(); dt.setMonth(dt.getMonth() - i, 1); var iso = i ? dt.getFullYear() + "-" + String(dt.getMonth() + 1).padStart(2, "0") + "-01" : now; if (iso >= B.startOf(d, p)) vals.push(B.netWorth(d, p, iso).total); }
    var own = nw.rows.filter(function (r) { return !r.owe; }), owe = nw.rows.filter(function (r) { return r.owe; });
    return card('<div class="small muted">Everything you own, minus what you owe</div><div style="font-size:34px;font-weight:800;font-family:var(--head)">' + M0(nw.total) + "</div>" + (vals.length > 1 ? chart(vals, 320, 110, {label: "Net worth over the year"}) : "")) +
      card('<div class="row"><h2>You own</h2>' + num(M0(nw.own)) + '</div><div class="list" style="margin-top:6px">' + own.map(function (r) { return li(esc(r.name), "", num(M0(r.amount))); }).join("") + "</div>") +
      (owe.length ? card('<div class="row"><h2>You owe</h2>' + num(M0(nw.owe)) + '</div><div class="list" style="margin-top:6px">' + owe.map(function (r) { return li(esc(r.name), "", num(M0(-r.amount))); }).join("") + "</div>") : "");
  };

  // ----- Debts
  SCREENS.debts = function () {
    var d = db(), p = me(), now = todayIso(), html = "", ls = B.loans(d, p, now);
    ls.forEach(function (l) {
      var who = l.lender === p ? esc(person(l.borrower).name) + " owes you" : "You owe " + esc(person(l.lender).name);
      // what it's made of, when the notes list it ("Dress £30; Shoes £20", or a line each)
      var parts = l.notes.split(/\s*[;\n]\s*/).filter(Boolean);
      html += '<button type="button" class="card li" style="display:block;text-align:left;padding:16px" data-a="edit" data-v="loans:' + esc(l.id) + '"><div class="row"><span style="font-weight:700">' + esc(l.name) + "</span>" + num(M(l.left)) + '</div><div class="small muted">' + who + " · " + M(l.paid) + " paid so far</div>" +
        (parts.length ? '<div class="tiny muted" style="margin-top:4px">' + parts.map(esc).join("<br>") + "</div>" : "") + '<div style="margin:8px 0">' + bar(l.pct) + "</div>" +
        l.plan.slice(0, 4).map(function (r) { return '<div class="row small" style="padding:4px 0"><span>' + esc(B.nice(r.date)) + "</span>" + num(M(r.amount)) + "</div>"; }).join("") + "</button>";
    });
    B.accountsOf(d, p).filter(function (a) { return a.kind === "credit"; }).forEach(function (a) { var v = B.balances(d, now)[a.id] || 0; html += card('<div class="row"><span style="font-weight:700">' + esc(a.name) + "</span>" + num(M(-v)) + '</div><div class="small muted">' + esc(a.purpose || "") + "</div>"); });
    return (html || '<p class="empty">No debts or IOUs. Nice.</p>') + '<button type="button" class="btn dash" data-a="new" data-v="loans">Add money owed</button>';
  };

  // ----- Insights
  SCREENS.insights = function () {
    var d = db(), p = me(), now = todayIso(), st = B.startOf(d, p), per = B.periodAt(d, p, now), pers = [per], html = "";
    for (var i = 0; i < 5; i++) { var pv = B.prevPeriod(d, p, pers[0]); if (!pv || pv.start >= pers[0].start || pv.next <= st) break; pers.unshift(pv); }
    var buds = d.budgets.filter(function (b) { return b.person === p && b.mode !== "saving"; });
    var focus = buds.filter(function (b) { return /food/i.test(b.name); })[0] || buds[0];
    if (focus) {
      // (the month still going is the lighter bar)
      var vals = pers.map(function (pk) { var s = B.budgetState(d, p, pk)[focus.id]; return s ? s.spent : 0; }), max = Math.max.apply(null, vals.concat([1]));
      html += card('<div class="row" style="align-items:center"><span class="khead">' + kchip("spend") + "<h2>" + esc(budName(focus)) + ' each month</h2></span></div><div class="bars k-spend" style="height:150px">' + vals.map(function (v, i) { return '<div><span class="num" style="font-size:11px">' + M0(v) + '</span><i class="' + (i === vals.length - 1 ? "plan" : "") + '" style="height:' + Math.max(2, Math.round(v / max * 100)) + 'px"></i><span>' + esc(pers[i].name.slice(0, 3)) + "</span></div>"; }).join("") + "</div>");
    }
    var tips = [];
    // days are counted from when you started Budgie, so the first month isn't counted from before then
    var from = st > per.start ? st : per.start, stt = B.budgetState(d, p, per), dayNo = B.diff(from, now) + 1, days = B.diff(from, per.next);
    buds.forEach(function (b) {
      var s = stt[b.id]; if (!s || !s.avail) return;
      // "usual" is a full month: the short first one would make any normal month look high
      var prev = pers.slice(0, -1).filter(function (pk) { return !pk.opening; }).map(function (pk) { var x = B.budgetState(d, p, pk)[b.id]; return x ? x.spent : 0; }).filter(function (v) { return v > 0; });
      var avg = prev.length ? prev.reduce(function (a, c) { return a + c; }, 0) / prev.length : 0, proj = s.spent / Math.max(1, dayNo) * days;
      if (per.opening) return;
      if (avg && proj > avg * 1.15 && s.spent > 20) tips.push({t: esc(budName(b)) + " is running high", d: "On course for about " + M0(proj) + " this month; your usual is " + M0(avg) + "."});
      else if (avg && proj < avg * 0.85 && dayNo > 7) tips.push({t: esc(budName(b)) + " is lower than usual", d: "On course for about " + M0(proj) + " against your usual " + M0(avg) + ". Nice."});
    });
    // a day you logged a payment counts as a spending day (a refund doesn't)
    var spentDays = {}; d.transactions.forEach(function (x) { if (x.person === p && +x.amount > 0 && x.date >= from && x.date <= now) spentDays[x.date] = 1; });
    var noSpend = Math.max(0, dayNo - Object.keys(spentDays).length);
    tips.push({t: noSpend + " no-spend day" + (noSpend === 1 ? "" : "s") + " this month", d: "Days you didn't log any spending."});
    var subs = 0, subNames = []; d.bills.forEach(function (b) { if (b.person === p && /sub/i.test(b.category || "")) { var y = 0; B.occurrences(d, b, now, B.addDays(now, 365)).forEach(function (o) { y += o.amount; }); subs += y; subNames.push([b.name, y]); } });
    if (subs) { subNames.sort(function (a, b) { return b[1] - a[1]; }); tips.push({t: "Subscriptions cost " + M0(subs) + " a year", d: esc(subNames[0][0]) + " is the biggest at " + M0(subNames[0][1]) + "."}); }
    // saving out of new money in (pay and money paid to you), not counting money put by for yearly bills
    var kt = sortPlan(B.planFor(d, p, per).lines).tot; if (kt.fresh > 0 && !per.opening) tips.push({t: "You're saving " + Math.round(kt.save / kt.fresh * 100) + "% of what comes in", d: M0(kt.save) + " this month."});
    html += tips.map(function (x) { return card('<div style="font-weight:700">' + x.t + '</div><div class="small muted">' + x.d + "</div>"); }).join("");
    html += yearCard(taxYearStart(now), true);
    return html;
  };
  function taxYearStart(iso) { var y = +iso.slice(0, 4); return (iso.slice(5) >= "04-06" ? y : y - 1) + "-04-06"; }
  // the tax year in money: in Insights all year ("so far"), and on Today for the first weeks after 6 April
  function yearCard(start, soFar) {
    if (!B.yearReview) return "";
    var r; try { r = B.yearReview(db(), me(), start); } catch (e) { return ""; }
    if (!r || !(r.in > 0)) return ""; // nothing to show until a payday has happened in the year
    var y = +start.slice(0, 4), label = y + "/" + String(y + 1).slice(2);
    var top = (r.spent || []).slice().sort(function (a, b) { return b.amount - a.amount; }).slice(0, 3);
    return '<h2 class="h2">' + (soFar ? "This tax year so far" : "Your " + label + " in money") + "</h2>" + card('<div class="list">' +
      li("Money in", soFar ? esc(label) + ", from " + esc(B.nice(r.from)) : "", num(M0(r.in))) +
      (r.saved >= 0 ? li("Saved", r.savedPct !== undefined ? r.savedPct + "% of what came in" : "", num(M0(r.saved))) : li("Took out of savings", "More came out of savings than went in", num(M0(-r.saved), "warn"))) +
      (top.length ? li("Where most of it went", top.map(function (x) { return esc(x.name) + " " + M0(x.amount); }).join(" · "), "") : "") +
      (r.lisa && (r.lisa.paidIn || r.lisa.bonus) ? li("Lifetime ISA", "Paid in " + M0(r.lisa.paidIn) + " · bonus " + M0(r.lisa.bonus), "") : "") +
      (r.biggestMonth ? li("Biggest month", esc(r.biggestMonth.name || r.biggestMonth.month), num(M0(r.biggestMonth.amount))) : "") +
      (r.noSpendDays ? li("No-spend days", "", num(String(r.noSpendDays))) : "") + "</div>", "flush");
  }

  // ----- Gifts
  SCREENS.gifts = function () {
    var d = db(), gs = (tables().gifts || []).filter(function (g) { return g.person === me() && !g.deleted; }), by = {}, html = "";
    gs.forEach(function (g) { (by[g.occasion || "Other"] = by[g.occasion || "Other"] || []).push(g); });
    Object.keys(by).forEach(function (occ) {
      var list = by[occ], plan = 0, spent = 0; list.forEach(function (g) { plan += +g.limit || 0; if (g.bought === true || g.bought === "TRUE" || g.bought === "true") spent += +g.cost || +g.limit || 0; });
      html += '<h2 class="h2">' + esc(occ) + ' <span class="small muted" style="font-weight:500">' + M0(spent) + " of " + M0(plan) + "</span></h2>" + card('<div class="list">' + list.map(function (g) { var bought = g.bought === true || /^true$/i.test(String(g.bought)); return li(esc(g.name) + (bought ? ' <span class="tiny good">bought</span>' : ""), esc(g.idea || "") + (g.date ? " · " + esc(B.nice(B.parseDate(g.date))) : ""), num(M0(bought ? (+g.cost || +g.limit || 0) : (+g.limit || 0))), "edit", "gifts:" + g.id); }).join("") + "</div>", "flush");
    });
    return (html || '<p class="empty">No gift ideas yet. Only you can see your list, so surprises stay surprises.</p>') + '<button type="button" class="btn dash" data-a="new" data-v="gifts">Add a gift idea</button>';
  };

  // ----- Things to check (figures Budgie had to guess when it was set up)
  function checkList() { return demoOn() || !me() ? [] : B.checks(db(), me(), todayIso()); }
  function checkRows(list) {
    return list.map(function (c) {
      return '<div class="li" style="flex-wrap:wrap;gap:8px"><span class="grow" style="min-width:200px"><span class="what">' + esc(MT(c.text)) + "</span></span>" +
        '<span style="display:flex;gap:8px;margin-left:auto">' + (c.action ? '<button type="button" class="btn sm" data-a="chk" data-v="' + esc(c.id) + '">' + (c.action === "go" ? "Check" : "Change") + "</button>" : "") +
        '<button type="button" class="btn ghost sm" data-a="chkok" data-v="' + esc(c.id) + '">' + (c.action ? "It's right" : "Done") + "</button></span></div>";
    }).join("");
  }
  SCREENS.checks = function () {
    var list = checkList();
    if (!list.length) return '<p class="empty">All checked. Nice. Everything Budgie guessed has been confirmed.</p>';
    return '<p class="small muted" style="margin:0 4px 10px">When Budgie was set up it had to guess a few figures. Change them, or tell Budgie they\'re right.</p>' + card('<div class="list">' + checkRows(list) + "</div>", "flush");
  };
  function checksSheet() {
    var list = checkList(); if (!list.length) return;
    openSheet('<h2>A few things to check</h2><p class="muted">Budgie guessed these when it was set up. Change any that are wrong, or tell it they\'re right. You can find them later in Settings.</p><div class="list">' + checkRows(list) + '</div><button type="button" class="btn ghost wide" style="margin-top:12px" data-a="sheetclose">Later</button>');
  }
  function markChecked(id) { if (id && !demoOn() && /^\{/.test(String(getSetting("check:" + id, "")))) setting("check:" + id, "done"); }

  // ----- Settings
  SCREENS.settings = function () {
    var w = cap(potWord(true)), todo = checkList(), groups = [
      ["You", [["list:income", "Pay and money coming in", "Paydays, pay rises, one-offs"], ["account", "Your account", (person().name || "") + " · " + (person().bank || "")], ["bank", "Bank connection", bankLabel()], ["emailset", "Sunday money email", /^true$/i.test(String(getSetting("email.sunday", ""))) ? "On: to " + getSetting("email.to", "") : "A weekly round-up in your inbox"]]],
      ["Your money", [["bills", "Bills and subscriptions", "Add, change or stop a bill"], ["list:budgets", "Budgets", "Food, fun and the rest"], ["list:accounts", w, "What each one is for"], ["goals", "Goals", "House, car, holidays"], ["gifts", "Gifts", "Ideas and spending"]]],
      ["Together", [["sharing", "Partner and sharing", "What " + (person(partner()).name || "your partner") + " can see"], ["list:splits", "How you split things", "For example 2 parts to 1"], ["list:transfers", "Regular payments to " + (person(partner()).name || "partner"), "Like your rent share"], ["debts", "Money owed between you", "Furniture and the like"]]],
      ["Linked apps", [["linked", "Peckish and Caledonite", "Food shops both ways; paydays and bills in your calendar"]]],
      ["App", [["themes", "Themes", themeLabel()], ["toggle:easy", "Easy read", isEasy() ? "On: simpler screens in an easy-to-read font" : "Simpler screens in an easy-to-read font"], ["toggle:lock", "Fingerprint lock", lockOn() ? "On: Budgie checks it's you when you open it" : "Check it's you before showing anything"], ["toggle:hide", "Hide amounts", S.prefs.hide ? "On: tap the eye to peek" : "Cover numbers with £••••"], ["toggle:demo", "Show and tell", demoOn() ? "On: sample data" : "Show the app off with made-up money"], ["sync", "Google Sheet and sync", demoOn() ? "Not used in Show and tell" : syncLabel()], ["importcsv", "Import a bank statement", "Add payments from a CSV file"]]]
    ];
    if (todo.length) groups.unshift(["To check", [["checks", todo.length + " thing" + (todo.length === 1 ? "" : "s") + " Budgie guessed", "Confirm or change them"]]]);
    return groups.map(function (g) {
      return '<div class="secthead">' + esc(g[0]) + "</div>" + card('<div class="list">' + g[1].map(function (it) {
        if (/^toggle:/.test(it[0])) { var k = it[0].slice(7), on = k === "easy" ? isEasy() : k === "hide" ? S.prefs.hide : k === "lock" ? lockOn() : demoOn(); return '<label class="li check" style="padding:12px 0"><span class="grow"><span class="what">' + esc(it[1]) + '</span><span class="why">' + esc(it[2]) + '</span></span><input type="checkbox" data-c="toggle" data-v="' + k + '"' + (on ? " checked" : "") + "></label>"; }
        return li(esc(it[1]), esc(it[2]), "", "go", it[0]);
      }).join("") + "</div>", "flush");
    }).join("") + '<p class="tiny muted" style="text-align:center;margin:18px 0">Budgie ' + APP_VERSION + " · engine " + B.VERSION + " · Google Calendar coming soon</p>";
  };
  function themeLabel() { var sp = Object.prototype.hasOwnProperty.call(TH.SPECIAL, S.prefs.special) ? TH.SPECIAL[S.prefs.special] : null; return sp ? sp.name : (S.prefs.mode === "dark" ? "Dark" : S.prefs.mode === "light" ? "Light" : "Matches your phone") + ", " + ((Object.prototype.hasOwnProperty.call(TH.COLOURS, S.prefs.colour) ? TH.COLOURS[S.prefs.colour] : {}).name || "standard colour"); }
  function syncLabel() { return S.lastError ? "Not synced: " + S.lastError : S.lastSync ? "Synced " + ago(S.lastSync) : "Connected"; }
  function ago(t) { var s = Math.round((Date.now() - t) / 1000); return s < 60 ? "just now" : s < 3600 ? Math.round(s / 60) + " min ago" : Math.round(s / 3600) + " h ago"; }

  SCREENS.themes = function () {
    var p = S.prefs, html = card('<h2>Light or dark</h2><div class="seg" style="margin-top:10px" role="group">' + [["light", "Light"], ["dark", "Dark"], ["system", "Auto", "Match your phone"]].map(function (m) { return '<button type="button" data-a="tmode" data-v="' + m[0] + '"' + (m[2] ? ' aria-label="' + m[2] + '"' : "") + ' aria-pressed="' + (p.mode === m[0] && !p.special) + '">' + m[1] + "</button>"; }).join("") + "</div>" +
      '<h2 style="margin-top:16px">Colour</h2><div class="swatches">' + Object.keys(TH.COLOURS).map(function (k) { var c = TH.COLOURS[k]; return '<button type="button" data-a="tcolour" data-v="' + k + '" aria-label="' + c.name + '" aria-pressed="' + (p.colour === k && !p.special) + '" style="background:' + c.light + '"></button>'; }).join("") + "</div>");
    html += '<h2 class="h2">Special themes</h2>' + Object.keys(TH.SPECIAL).map(function (k) { var t = TH.SPECIAL[k]; return '<button type="button" class="theme-card" data-a="tspecial" data-v="' + k + '" aria-pressed="' + (p.special === k) + '"><span class="sw" style="background:' + t.vars.hero + ";border:3px solid " + t.vars.accent + '"></span><span class="grow"><span class="what" style="font-family:' + t.vars.head + '">' + esc(t.name) + '</span><span class="why">' + esc(t.note) + "</span></span></button>"; }).join("") +
      (p.special ? '<button type="button" class="btn ghost wide" style="margin-top:10px" data-a="tspecial" data-v="">Back to the standard look</button>' : "");
    html += card('<h2>Text size</h2><div class="seg fit" style="margin-top:10px" role="group">' + [["small", "Small"], ["normal", "Normal"], ["large", "Large"], ["larger", "Larger"]].map(function (s) { return '<button type="button" data-a="tsize" data-v="' + s[0] + '" aria-pressed="' + ((p.size || "normal") === s[0]) + '">' + s[1] + "</button>"; }).join("") + "</div>" +
      '<label class="li check" style="margin-top:6px"><span class="grow"><span class="what">Easy read</span><span class="why">The Lexend font, simpler screens, fewer extra numbers</span></span><input type="checkbox" data-c="toggle" data-v="easy"' + (isEasy() ? " checked" : "") + "></label>");
    return html;
  };

  // ----- Bank connection (read-only: balances, payments, pots or Spaces)
  async function bankCall(action, extra) {
    if (demoOn() || !S.cfg) throw new Error("Not connected to your sheet");
    var j = await askSheet(Object.assign({key: S.cfg.k, action: action}, extra || {})); if (!j.ok) throw new Error(sheetSaid(j));
    return j;
  }
  function bankRefresh() { return bankCall("bank.status").then(function (j) { S.bank = j.bank || {}; S.bank.at = Date.now(); render(true); return S.bank; }, function (e) { S.bank = Object.assign(S.bank || {}, {err: e.message}); render(true); }); }
  function bankName() { var b = (S.bank && S.bank.provider) || (/starling/i.test(person().bank || "") ? "starling" : "monzo"); return b === "starling" ? "Starling" : "Monzo"; }
  function bankLabel() { var b = S.bank; if (demoOn()) return "Not used in Show and tell"; if (!b || !b.provider) return "Payments and balances from " + (person().bank || "your bank") + ", read-only"; if (b.needsReconnect) return bankName() + ": needs reconnecting"; return bankName() + (b.connected ? ": connected" + (b.lastSync ? ", checked " + ago(b.lastSync) : "") : ": not finished setting up"); }
  function reviewRows() { var p = me(); return (tables().transactions || []).filter(function (x) { return x.person === p && !x.deleted && (x.review === true || /^true$/i.test(String(x.review))); }).sort(function (a, b) { return a.date < b.date ? 1 : -1; }); }
  SCREENS.bank = function () {
    if (demoOn()) return card("<p>Show and tell is on, so there's no bank to connect.</p>");
    var b = S.bank, name = person().bank || "your bank", isStarling = /starling/i.test(name) || (b && b.provider === "starling");
    if (!b) { bankRefresh(); return '<p class="empty">Checking…</p>'; }
    var safety = '<div class="banner small"><b>Read-only.</b> Budgie only reads your balances, payments and ' + (isStarling ? "Spaces" : "pots") + ". It can't move or send money. Your " + (isStarling ? "key" : "sign-in") + " is kept inside your Google Sheet's script, never on this phone or anywhere else, and you can switch it off at any time" + (isStarling ? " by deleting the key on Starling's developer site." : " by disconnecting here or in the Monzo app.") + "</div>";
    if (b.err && !b.provider) return card('<p class="bad small">' + esc(b.err) + '</p><button type="button" class="btn ghost sm" data-a="bankre">Try again</button>');
    if (b.waitingForApproval) return safety + card('<h2>Nearly there</h2><p class="muted">Open the Monzo app and approve Budgie. Once you have, Budgie brings in your payments within a minute or two.</p><button type="button" class="btn ghost wide" data-a="bankre">I\'ve approved it</button>');
    // needing reconnecting isn't the same as never connected: that screen has Reconnect (Monzo) and Disconnect
    if (!b.connected && !b.needsReconnect) {
      var url = esc((S.cfg || {}).u || "");
      if (isStarling) return safety + card('<h2>Connect Starling</h2><ol class="steps">' +
        '<li>On a computer or your phone\'s browser, go to <b>developer.starlingbank.com</b> and sign up with the email you use for Starling.</li>' +
        '<li>Open <b>Personal access</b>, link your account and approve it in the Starling app.</li>' +
        '<li>Create a <b>personal access token</b>. Tick only boxes that end in <b>:read</b>: you need <b>account-list:read</b>, <b>balance:read</b> and <b>transaction:read</b>, and <b>account:read</b>, <b>savings-goal:read</b> and <b>space:read</b> help with Spaces. Leave everything else unticked. Budgie turns away a key that could move money.</li>' +
        '<li>Copy the token and paste it here.</li></ol>' +
        '<label class="f">Your token<input type="text" class="secret" id="stTok" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" placeholder="Paste it here"></label><button type="button" class="btn wide" style="margin-top:12px" data-a="bankstarling">Connect</button><p class="tiny muted" style="margin:8px 0 0">The token goes straight to your Google Sheet\'s script and is never shown again. Afterwards, clear your keyboard\'s clipboard history so it isn\'t kept there.</p>');
      return safety + card('<h2>Connect Monzo</h2><ol class="steps">' +
        '<li>Go to <b>developers.monzo.com</b> and sign in with your Monzo email, then approve it in the Monzo app.</li>' +
        '<li>Open <b>Clients</b> and make a <b>New OAuth Client</b>. Name: Budgie. Logo: leave empty. Redirect URL: <span class="copy">' + url + '</span> <button type="button" class="linkbtn" data-a="bankcopy">Copy</button>. Confidentiality: <b>Confidential</b>.</li>' +
        '<li>Copy the <b>Client ID</b> and <b>Client secret</b> into the boxes below and tap Connect.</li>' +
        '<li>Monzo opens: sign in, then approve Budgie in the Monzo app. Budgie fetches your history straight away.</li></ol>' +
        '<label class="f">Client ID<input type="text" id="mzId" autocomplete="off" autocapitalize="off" spellcheck="false"></label><label class="f">Client secret<input type="text" class="secret" id="mzSecret" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false"></label>' +
        '<button type="button" class="btn wide" style="margin-top:12px" data-a="bankmonzo">Connect Monzo</button><p class="tiny muted" style="margin:8px 0 0">Every 90 days Monzo asks you to approve Budgie again in the Monzo app. Budgie reminds you a week before.</p>');
    }
    var d = db(), accs = B.accountsOf(d, me());
    // not matched yet: suggest the Budgie account with the same name ("Food" and "Food pot")
    var words = function (n) { return String(n || "").toLowerCase().replace(/\b(pot|space|account|the|my)\b/g, " ").replace(/[^a-z0-9]+/g, " ").trim(); };
    var guess = function (x) { if (x.kind === "main") return B.mainOf(d, me()); var w = words(x.name), hit = accs.filter(function (a) { return w && words(a.name) === w; })[0] || accs.filter(function (a) { var aw = words(a.name); return w && aw && (aw.indexOf(w) >= 0 || w.indexOf(aw) >= 0); })[0]; return hit ? hit.id : ""; };
    S.ui.bankGuess = {};
    var rows = (b.accounts || []).map(function (x) {
      var unset = x.mappedTo === null || x.mappedTo === undefined, sug = unset ? guess(x) : "", cur = unset ? null : x.mappedTo, suggested = !!sug;
      if (suggested) S.ui.bankGuess[x.extId] = sug;
      return '<div class="li" style="flex-wrap:wrap;gap:6px"><span class="grow"><span class="what">' + esc(x.name) + '</span><span class="why">' + esc(({main: "Main account", pot: "Pot", space: "Space", credit: "Credit"})[x.kind] || "") + (x.balance !== undefined && x.balance !== null ? " · " + M(x.balance) : "") + (suggested ? ' · <span class="warn">looks like ' + esc(B.accName(d, sug)) + "</span>" : unset ? ' · <span class="warn">not matched yet</span>' : "") + "</span></span>" +
        '<select data-c="bankmap" data-v="' + esc(x.extId) + '" aria-label="Which Budgie account is ' + esc(x.name) + '" style="flex:1 1 100%;min-width:0;min-height:44px;border-radius:10px;border:1px solid var(--line);background:var(--card);padding:0 8px;max-width:100%">' + (unset ? '<option value="" selected disabled>Choose…</option>' : "") + '<option value=""' + (cur === "" ? " selected" : "") + ">Ignore it</option>" + accs.map(function (a) { return '<option value="' + esc(a.id) + '"' + (cur === a.id ? " selected" : "") + ">" + esc(a.name) + "</option>"; }).join("") + "</select></div>";
    }).join("");
    var nGuess = Object.keys(S.ui.bankGuess).length;
    var reN = reviewRows().length;
    return card('<div class="row"><h2>' + esc(bankName()) + '</h2><span class="small ' + (b.needsReconnect ? "bad" : "good") + '" style="font-weight:700">' + (b.needsReconnect ? "Needs reconnecting" : "Connected") + "</span></div>" +
        '<div class="small muted">' + (b.lastSync ? "Last checked " + esc(ago(b.lastSync)) + ". " : "") + "Budgie checks every 15 minutes." + (b.reapproveBy ? " Approve it again in the Monzo app by " + esc(B.nice(String(b.reapproveBy).slice(0, 10))) + "." : "") + "</div>" +
        (b.lastError ? '<p class="small bad">' + esc(b.lastError) + "</p>" : "") +
        (reN ? '<button type="button" class="btn wide" style="margin-top:12px" data-a="go" data-v="review">Check ' + reN + " new payment" + (reN === 1 ? "" : "s") + "</button>" : "") +
        '<div class="two fit" style="margin-top:12px"><button type="button" class="btn ghost" data-a="banksync">Check now</button>' + (b.needsReconnect && b.provider === "monzo" ? '<button type="button" class="btn" data-a="bankmonzo2">Reconnect</button>' : "") + "</div>") +
      (rows ? '<h2 class="h2">Which is which' + infoBtn("bankmap") + "</h2>" + card('<div class="list">' + rows + "</div>", "flush") + (nGuess ? '<button type="button" class="btn wide" style="margin-top:10px" data-a="bankguess">Match ' + (nGuess === 1 ? "it" : "all " + nGuess) + " as suggested</button>" : "") : "") +
      safety + '<button type="button" class="btn danger wide" style="margin-top:14px" data-a="bankoff">Disconnect ' + esc(bankName()) + "</button>";
  };
  // new payments from the bank: check what they were for
  SCREENS.review = function () {
    var d = db(), list = reviewRows(), buds = spendBudgets(), q = shortName(person(partner()).name);
    if (!list.length) return '<p class="empty">All checked. Nice.</p>';
    var all = addBudgets(todayIso()), top = all.length > 4 ? all.slice(0, 3) : all;
    return '<p class="small muted" style="margin:0 4px 10px">Tap what each one was for. Budgie remembers for next time.</p>' + list.slice(0, 30).map(function (x) {
      // (what it's down as now is always one of them)
      var opts = top.slice(); if (x.budget && !opts.some(function (b) { return b.id === x.budget; }) && d.byId[x.budget]) { if (all.length > 4) opts.pop(); opts.unshift(d.byId[x.budget]); }
      return card('<div class="row"><span style="font-weight:700">' + esc(x.note || "Payment") + "</span>" + num(M(x.amount)) + '</div><div class="small muted">' + esc(B.nice(x.date)) + " · " + esc(B.accName(d, x.account)) + "</div>" +
        '<div class="chips fit" style="margin-top:8px">' + opts.map(function (b) { return '<button type="button" class="chip" data-a="revbud" data-v="' + esc(x.id) + "|" + esc(b.id) + '" aria-pressed="' + (x.budget === b.id) + '">' + esc(budName(b)) + "</button>"; }).join("") +
        (buds.length > opts.length ? '<button type="button" class="chip" style="border-style:dashed" data-a="revmore" data-v="' + esc(x.id) + '">Other…</button>' : "") + "</div>" +
        '<div class="row' + (partner() ? " fit" : "") + '" style="margin-top:8px;align-items:center;gap:8px">' + (partner() ? '<button type="button" class="detail' + (revSplit(x) ? " on" : "") + '" data-a="revsplit" data-v="' + esc(x.id) + '">' + (revSplit(x) ? "Split with " + esc(q) : "Not split") + "</button>" : "<span></span>") +
        '<button type="button" class="btn sm" data-a="revok" data-v="' + esc(x.id) + '"' + (x.budget ? "" : " disabled") + ">Right</button></div>");
    }).join("") + (list.some(function (x) { return x.budget; }) ? '<button type="button" class="btn ghost wide" style="margin-top:12px" data-a="revall">All the rest look right</button>' : "");
  };
  // the same as the sheet's bankMerchantKey_: store numbers and the like are dropped
  // the split a learned rule suggests for this payment ("budget|split"), applied only when you confirm it
  function splitHint(x) { if (x.splitHint) return String(x.splitHint); var r = String(getSetting("bank.rule." + merchantKey(x.note), "") || ""), k = r.split("|"); return k[1] || ""; }
  function revSplit(x) { var o = (S.ui.revSplit || {})[x.id]; return o !== undefined ? o : (x.split || splitHint(x)); }
  function merchantKey(name) { return String(name || "").toLowerCase().replace(/[^a-z]+/g, " ").replace(/\b(stores?|ltd|limited|plc|uk|gb|london|www|com|co)\b/g, " ").replace(/\s+/g, " ").trim(); }
  function reviewSave(id, patch, learn) {
    var x = (tables().transactions || []).filter(function (r) { return r.id === id; })[0]; if (!x) return;
    var row = put("transactions", Object.assign({}, x, patch), true);
    if (learn && row.budget && x.note) setting("bank.rule." + merchantKey(x.note), row.budget + (row.split ? "|" + row.split : ""));
    return row;
  }

  // ----- Linked apps: each gets its own limited link, never Budgie's full one
  var APPS = [["peckish", "Peckish", "Food shops you log in either app show in both, split half each. Peckish can only add food shops and see your food budget, nothing else.", "https://alertrobot.github.io/es-kitchen/", "Settings, then Linked apps, then Budgie"],
    ["caledonite", "Caledonite", "Your paydays and bills show in your calendar, plus what's left for fun until payday. Caledonite can only see those, and can't change anything.", "https://alertrobot.github.io/caledonite/", "Settings, then Linked apps, then Budgie"]];
  SCREENS.linked = function () {
    if (demoOn()) return card("<p>Show and tell is on, so there's nothing to link.</p>");
    var st = S.appsState || {};
    if (!S.appsState) bankCall("app.status").then(function (j) { S.appsState = j.apps || {}; render(true); }, function () { S.appsState = {}; render(true); });
    return '<p class="small muted" style="margin:0 4px 10px">Each app gets its own link that only lets it do its one job. Making a new link switches off the old one.</p>' + APPS.map(function (a) {
      var on = !!st[a[0]], made = S.ui.appLink && S.ui.appLink.app === a[0] ? S.ui.appLink.link : "";
      return card('<div class="row"><h2>' + a[1] + '</h2><span class="small ' + (on ? "good" : "muted") + '" style="font-weight:700">' + (on ? "Linked" : "Not linked") + '</span></div><p class="small muted">' + esc(a[2]) + "</p>" +
        (made ? '<label class="f">Your link for ' + a[1] + '<input type="text" class="secret" readonly value="' + esc(made) + '" id="appLinkOut"></label><div class="two fit" style="margin-top:8px"><button type="button" class="btn" data-a="applinkcopy">Copy it</button><a class="btn ghost fitlink" href="' + a[3] + '" target="_blank" rel="noopener">Open ' + a[1] + '</a></div><p class="tiny muted" style="margin:8px 0 0">In ' + a[1] + ": " + esc(a[4]) + ", and paste it. Then clear your clipboard.</p>" :
          '<div class="two fit" style="margin-top:8px"><button type="button" class="btn' + (on ? " ghost" : "") + '" data-a="applink" data-v="' + a[0] + '">' + (on ? "Make a new link" : "Link " + a[1]) + "</button>" + (on ? '<button type="button" class="btn danger" data-a="appunlink" data-v="' + a[0] + '">Unlink</button>' : "") + "</div>"));
    }).join("");
  };

  SCREENS.emailset = function () {
    var on = /^true$/i.test(String(getSetting("email.sunday", ""))), to = getSetting("email.to", "");
    return '<p class="small muted" style="margin:0 4px 10px">Every Sunday evening: your week, what\'s left until payday, bills coming up and anything to sort. Only what you\'d see in the app.</p>' +
      card('<label class="li check"><span class="grow"><span class="what">Send me the Sunday email</span></span><input type="checkbox" data-c="emailon"' + (on ? " checked" : "") + '></label><label class="f">Your email address<input type="email" id="emailTo" inputmode="email" autocomplete="email" value="' + esc(to) + '" placeholder="you@example.com"></label><button type="button" class="btn wide" style="margin-top:12px" data-a="emailsave">Save</button>');
  };
  SCREENS.sharing = function () {
    var keys = [["totals", "How much is left", "Your can-spend-today and what you're saving"], ["cats", "Your budgets", "Food, fun and the rest, against plan"], ["goals", "Your own goals", "Progress on goals that are just yours"], ["payments", "Each payment", "Every payment you log with its note, and your pay, bills, budgets and balances"]];
    return '<p class="small muted" style="margin:0 4px 10px">Shared bills, split payments, money between you and joint goals are always shared. Gift lists never are.</p>' + card('<div class="list">' + keys.map(function (k) {
      var on = /^(true|yes|on|1)$/i.test(String(getSetting("share." + k[0], k[0] === "payments" ? "false" : "true")));
      return '<label class="li check"><span class="grow"><span class="what">' + k[1] + '</span><span class="why">' + k[2] + '</span></span><input type="checkbox" data-c="share" data-v="' + k[0] + '"' + (on ? " checked" : "") + "></label>";
    }).join("") + "</div>", "flush");
  };

  SCREENS.sync = function () {
    if (demoOn()) return card("<p>Show and tell is on, so nothing is synced. Turn it off in Settings to go back to your own data.</p>");
    var c = S.cfg || {};
    return card('<div class="list">' + li("Status", esc(syncLabel()), "") + li("Waiting to sync", S.data.queue.length + " change" + (S.data.queue.length === 1 ? "" : "s"), "") + li("Signed in as", esc(person().name || "?"), "") + "</div>" +
      '<div class="two fit" style="margin-top:10px"><button type="button" class="btn" data-a="syncnow">Sync now</button><button type="button" class="btn ghost" data-a="syncfull">Full refresh</button></div>') +
      '<div class="banner small">Your data lives in the <b>Budgie data</b> Google Sheet. Each tab is a table you can read, sort or back up. Your budget tab fills itself in. This phone keeps a copy so the app works offline.</div>' +
      card('<h2>Move to another phone</h2><p class="small muted">Open your connect link on the new phone. Keep it private: it lets anyone with it see your budget.</p><button type="button" class="btn danger sm" data-a="disconnect">Disconnect this phone</button>');
  };

  SCREENS.account = function () {
    var p = person();
    return card('<div class="list">' + li("Name", esc(p.name), "") + li("Bank", esc(p.bank || ""), "") + li("Calls them", esc(cap(potWord(true))), "") + li("Partner", esc(person(partner()).name || "None"), "") + "</div>") + '<p class="small muted" style="margin:10px 4px">Change these on the people tab of your Google Sheet.</p>';
  };

  // ----- generic lists and editors
  var LISTS = {
    income: {title: "Pay and money coming in", filter: function (r) { return r.person === me(); }, row: function (r) { return [r.name + (r.isPay ? " (payday)" : ""), B.describe(r), M(B.amountAt(db(), r, todayIso()))]; }, add: "Add money coming in"},
    budgets: {title: "Budgets", filter: function (r) { return r.person === me(); }, row: function (r) { return [r.name, ({daily: "Builds up each day", weekly: "Paced week by week", oneoff: "For one-offs", saving: "Saved on payday", remainder: "Gets whatever is left"})[r.mode || "daily"] + " · " + B.accName(db(), r.account), r.mode === "remainder" ? "What's left" : M(B.amountAt(db(), r, todayIso()))]; }, add: "Add a budget"},
    accounts: {title: "Accounts and " + "pots", filter: function (r) { return r.owner === me(); }, row: function (r) { return [r.name + (r.fallback ? " (covers going over)" : ""), ({main: "Main account", pot: "Pot or Space", saving: "Savings", isa: "ISA", lisa: "Lifetime ISA", pension: "Pension", credit: "Credit or overdraft"})[r.kind || "pot"] + (r.purpose ? " · " + r.purpose : ""), ""]; }, add: "Add an account"},
    splits: {title: "How you split things", filter: function () { return true; }, row: function (r) { return [r.name, describeShares(r.shares), ""]; }, add: "Add a split"},
    transfers: {title: "Regular payments", filter: function (r) { return r.from === me(); }, row: function (r) { return [r.name, B.describe(r) + " · to " + person(r.to).name, M(B.amountAt(db(), r, todayIso()))]; }, add: "Add a regular payment"}
  };
  function describeShares(s) {
    var d = db(), names = function (id) { return person(id).name || id; }, txt = String(s || "");
    var fixed = txt.match(/([a-z]+)\s*=\s*([\d.]+)/i); if (fixed) return names(fixed[1].toLowerCase()) + " pays " + M(+fixed[2]) + ", the rest by the other";
    var parts = []; txt.replace(/([a-z]+)\s*:\s*([\d.]+)/gi, function (_, a, b) { parts.push(names(a.toLowerCase()) + " " + b); }); return parts.length ? parts.join(" : ") + " parts" : "Half each";
  }
  SCREENS.list = function (p) {
    var L = LISTS[p.table], rows = (db()[p.table] || []).filter(L.filter);
    S.view.p.title = L.title.replace("pots", potWord(true));
    return card('<div class="list">' + (rows.length ? rows.map(function (r) { var x = L.row(r); return li(esc(x[0]), esc(x[1]), x[2] ? num(x[2]) : "", "edit", p.table + ":" + r.id); }).join("") : '<p class="muted">Nothing here yet.</p>') + "</div>", "flush") + '<button type="button" class="btn dash" data-a="new" data-v="' + p.table + '">' + esc(L.add) + "</button>";
  };

  var SCHED = function () { return [{k: "unit", t: "how"}, {k: "start", t: "date", l: "Starts (or the first date)"}, {k: "end", t: "date", l: "Ends (leave empty for never)"}]; };
  var FORMS = {
    bills: {title: "Bill", fields: function () { return [{k: "name", t: "text", l: "Name"}, {k: "amount", t: "money", l: "Amount"}].concat(SCHED()).concat([{k: "account", t: "account", l: "Comes out of"}, {k: "category", t: "select", l: "Type", o: [["home", "Home and flat bills"], ["subscription", "Subscription"], ["phone", "Phone"], ["car", "Car"], ["health", "Health"], ["work", "Work and fees"], ["insurance", "Insurance"], ["other", "Other"]]}, {k: "split", t: "split", l: "Shared with your partner?"}, {k: "variable", t: "check", l: "The amount changes each time (like energy)"}, {k: "setAside", t: "setaside"}, {k: "notes", t: "text", l: "Notes"}]); }, owner: "person"},
    income: {title: "Money coming in", fields: function () { return [{k: "name", t: "text", l: "Name"}, {k: "amount", t: "money", l: "Amount (after tax)"}].concat(SCHED()).concat([{k: "account", t: "account", l: "Goes into"}, {k: "isPay", t: "check", l: "This is my pay (it sets my pay periods)"}, {k: "notes", t: "text", l: "Notes"}]); }, owner: "person"},
    budgets: {title: "Budget", fields: function () { return [{k: "name", t: "text", l: "Name"}, {k: "amount", t: "money", l: "Amount each pay period (leave empty for whatever is left)"}, {k: "mode", t: "select", l: "How it works", info: "modes", o: [["daily", "Day to day"], ["weekly", "Weekly (food shops)"], ["oneoff", "One-offs"], ["saving", "Saving on payday"], ["remainder", "Whatever is left"]]}, {k: "account", t: "account", l: "Kept in", all: true}, {k: "carry", t: "check", l: "Carry anything unspent into next month"}, {k: "start", t: "date", l: "Starts (optional)"}, {k: "end", t: "date", l: "Ends (optional)"}]; }, owner: "person"},
    accounts: {title: "Account", fields: function () { return [{k: "name", t: "text", l: "Name"}, {k: "kind", t: "select", l: "Kind", o: [["main", "Main account"], ["pot", "Pot or Space"], ["saving", "Savings pot"], ["isa", "ISA"], ["lisa", "Lifetime ISA"], ["pension", "Pension"], ["credit", "Credit or overdraft"]]}, {k: "purpose", t: "text", l: "What it's for"}, {k: "fallback", t: "check", l: "Covers going over budget (only one should)"}, {k: "order", t: "number", l: "Order on screen"}]; }, owner: "owner"},
    goals: {title: "Goal", fields: function () { return [{k: "name", t: "text", l: "Name"}, {k: "target", t: "money", l: "Target"}, {k: "due", t: "date", l: "Target date (optional)"}, {k: "kind", t: "select", l: "Kind", o: [["savings", "Saving for something"], ["house", "House deposit"], ["emergency", "Emergency fund"], ["car", "Car"], ["holiday", "Holiday"], ["other", "Other"]]}, {k: "accounts", t: "accounts", l: "Which accounts count towards it"}, {k: "extra", t: "money", l: "Plus money kept elsewhere (optional)"}, {k: "owners", t: "owners", l: "Whose goal"}, {k: "price", t: "money", l: "House price you're aiming for (house goals)"}, {k: "notes", t: "text", l: "Notes"}]; }, owner: "owners"},
    splits: {title: "Split", fields: function () { return [{k: "name", t: "text", l: "Name (for example Flat bills)"}, {k: "shares", t: "shares", l: "How it's shared"}]; }, owner: null},
    transfers: {title: "Regular payment", fields: function () { return [{k: "name", t: "text", l: "Name (for example Rent share)"}, {k: "amount", t: "money", l: "Amount"}].concat(SCHED()).concat([{k: "fromAccount", t: "account", l: "From your"}, {k: "toAccount", t: "account", l: "Into their", owner: partner()}, {k: "notes", t: "text", l: "Notes"}]); }, owner: "from"},
    loans: {title: "Money owed", fields: function () { return [{k: "name", t: "text", l: "What for"}, {k: "amount", t: "money", l: "Total"}, {k: "direction", t: "select", l: "Who owes who", o: [["in", shortName(person(partner()).name) + " owes me"], ["out", "I owe " + shortName(person(partner()).name)]]}, {k: "date", t: "date", l: "Date"}, {k: "account", t: "account", l: "Paid from (optional)", optional: true}, {k: "repay", t: "money", l: "Paid back each month"}, {k: "repayFrom", t: "date", l: "First repayment"}, {k: "repayDay", t: "number", l: "Day of the month"}, {k: "notes", t: "text", l: "Notes"}]; }, owner: "loan"},
    gifts: {title: "Gift", fields: function () { return [{k: "name", t: "text", l: "Who for"}, {k: "idea", t: "text", l: "Idea"}, {k: "occasion", t: "text", l: "Occasion (for example Christmas)"}, {k: "date", t: "date", l: "When"}, {k: "limit", t: "money", l: "Spend up to"}, {k: "bought", t: "check", l: "Bought"}, {k: "cost", t: "money", l: "What it cost"}, {k: "notes", t: "text", l: "Notes"}]; }, owner: "person"}
  };
  var EDIT = {};
  var DATED = /^(bills|income|transfers|budgets)$/;
  function openEditor(table, id) {
    var row = id ? Object.assign({}, (tables()[table] || []).filter(function (r) { return r.id === id; })[0] || {}) : {};
    if (id && !canEditRow(table, row)) { toast("That belongs to " + (person(row.person || row.from || row.owner).name || "your partner") + ", so only they can change it"); return; }
    if (table === "loans" && row.id) row.direction = row.lender === me() ? "in" : "out";
    // show what it costs today, which may come from a dated price change rather than the first amount
    var nowAmt = null;
    if (id && DATED.test(table) && row.amount !== "" && row.amount !== undefined) { var live = db().byId[id]; nowAmt = live ? B.amountAt(db(), live, todayIso()) : +row.amount; row.amount = nowAmt; }
    EDIT = {table: table, id: id, row: row, orig: JSON.parse(JSON.stringify(row)), nowAmt: nowAmt}; S.ui.onTouched = false;
    go("edit", {title: (id ? "Change " : "New ") + FORMS[table].title.toLowerCase()});
  }
  SCREENS.edit = function () {
    var F = FORMS[EDIT.table], r = EDIT.row, html = "";
    F.fields().forEach(function (f) { html += field(f, r); });
    var canStop = EDIT.id && /bills|income|transfers|budgets/.test(EDIT.table);
    html += '<button type="button" class="btn wide" style="margin-top:18px" data-a="editsave">Save</button>';
    if (EDIT.id) html += '<div class="two fit" style="margin-top:10px">' + (canStop ? '<button type="button" class="btn line" data-a="editstop">' + (EDIT.table === "budgets" ? "Stop at next payday" : "Stop from today") + "</button>" : "") + '<button type="button" class="btn danger" data-a="editdelete">Delete</button></div>';
    return card(html);
  };
  function field(f, r) {
    var v = r[f.k] === undefined || r[f.k] === null ? "" : r[f.k], id = "fe-" + f.k, L = '<label class="f" for="' + id + '">' + esc(f.l || "") + "</label>";
    var input = function (type, extra) { return '<label class="f">' + esc(f.l) + '<input id="' + id + '" type="' + type + '" data-f="' + f.k + '" value="' + esc(v) + '"' + (extra || "") + "></label>"; };
    switch (f.t) {
      case "text": return input("text");
      case "number": return input("number", ' inputmode="numeric"');
      case "money": return input("text", ' inputmode="decimal" placeholder="£"');
      case "date": return input("date");
      case "setaside":
        // only for bills that come round once a year or every few months
        var rare = r.unit === "year" || r.unit === "once" ? r.unit === "year" : r.unit === "month" && +r.every >= 3;
        if (!rare) return "";
        var sa = !(r.setAside === false || /^false$/i.test(String(r.setAside)));
        return '<label class="check"><input type="checkbox" data-f="setAside"' + (sa ? " checked" : "") + '>Put a bit by each month so it\'s there when it comes</label>';
      case "check": return '<label class="check"><input type="checkbox" data-f="' + f.k + '"' + (v === true || /^true$/i.test(String(v)) ? " checked" : "") + ">" + esc(f.l) + "</label>";
      case "select": return '<label class="f">' + esc(f.l) + (f.info ? infoBtn(f.info) : "") + '<select data-f="' + f.k + '">' + f.o.map(function (o) { return '<option value="' + o[0] + '"' + (String(v || f.o[0][0]) === o[0] ? " selected" : "") + ">" + esc(o[1]) + "</option>"; }).join("") + "</select></label>";
      case "account":
        // a loan is paid from the lender's account: only theirs to choose, so it's asked only when you lent it
        if (EDIT.table === "loans" && r.direction === "out") return "";
        var own = f.owner || me(); return '<label class="f">' + esc(f.l) + '<select data-f="' + f.k + '">' + (f.optional ? '<option value="">None</option>' : "") + accOptions(v || (f.optional ? "" : B.mainOf(db(), own)), own, f.all ? null : /main|pot|saving|credit|isa|lisa|pension/) + "</select></label>";
      case "accounts": var sel = String(v).split(/[,\s]+/); return '<div class="f" style="font-size:13px;font-weight:600;color:var(--muted);margin-top:12px">' + esc(f.l) + "</div>" + db().accounts.map(function (a) { return '<label class="check" style="padding:6px 0"><input type="checkbox" data-fm="' + f.k + '" value="' + esc(a.id) + '"' + (sel.indexOf(a.id) >= 0 ? " checked" : "") + ">" + esc((a.owner === me() ? "" : person(a.owner).name + "'s ") + a.name) + "</label>"; }).join("");
      case "owners": var both = String(v || me()).split(/[,\s]+/).filter(Boolean).length > 1; return '<label class="f">' + esc(f.l) + '<select data-f="owners"><option value="' + esc(me()) + '">Just mine</option><option value="' + esc(me() + ", " + partner()) + '"' + (both ? " selected" : "") + ">Ours together</option></select></label>";
      case "split": return '<label class="f">' + esc(f.l) + '<select data-f="split"><option value="">No, it\'s just mine</option>' + db().splits.map(function (s) { return '<option value="' + esc(s.id) + '"' + (v === s.id ? " selected" : "") + ">" + esc(s.name) + "</option>"; }).join("") + "</select></label>";
      case "shares":
        var ppl = db().people, fixed = /=/.test(v), vals = {}; String(v).replace(/([a-z]+)\s*[:=]\s*([\d.]+)/gi, function (_, a, b) { vals[a.toLowerCase()] = b; });
        return '<label class="f">How<select data-sh="mode"><option value="parts">In parts (like 2 to 1)</option><option value="fixed"' + (fixed ? " selected" : "") + ">A fixed amount</option></select></label>" +
          '<div class="two">' + ppl.map(function (x) { return '<label class="f">' + esc(x.name) + '<input type="text" inputmode="decimal" data-sh="' + esc(x.id) + '" value="' + esc(vals[x.id] || "") + '" placeholder="' + (fixed ? "£ or empty" : "parts") + '"></label>'; }).join("") + "</div>";
      case "how":
        var unit = r.unit || "month", every = +r.every || 1, how = unit === "month" && every === 3 ? "quarter" : unit === "week" ? "week" : unit;
        var onV = r.on !== undefined && r.on !== "" ? String(r.on) : String(+(r.start || todayIso()).slice(8, 10));
        var days = ""; for (var i = 1; i <= 31; i++) days += '<option value="' + i + '"' + (onV === String(i) ? " selected" : "") + ">" + ordinal(i) + "</option>";
        var specials = ["last", "last working day", "first working day", "last friday", "last thursday", "first monday"].map(function (o) { return '<option value="' + o + '"' + (onV.toLowerCase() === o ? " selected" : "") + ">The " + o + "</option>"; }).join("");
        return '<label class="f">How often<select data-f="how"><option value="month"' + (how === "month" ? " selected" : "") + '>Every month</option><option value="quarter"' + (how === "quarter" ? " selected" : "") + '>Every 3 months</option><option value="week"' + (how === "week" ? " selected" : "") + '>Every few weeks</option><option value="year"' + (how === "year" ? " selected" : "") + '>Every year</option><option value="once"' + (how === "once" ? " selected" : "") + '>Just once</option><option value="dates"' + (how === "dates" ? " selected" : "") + ">On set dates</option></select></label>" +
          (how === "month" || how === "quarter" ? '<label class="f">On<select data-f="on">' + days + specials + "</select></label>" : "") +
          (how === "week" ? '<label class="f">Every how many weeks<input type="number" inputmode="numeric" data-f="every" value="' + every + '"></label>' : "") +
          (how === "dates" ? '<label class="f">Dates (one per line)<textarea data-f="dates">' + esc(String(r.dates || "").split(/[,;]\s*/).join("\n")) + "</textarea></label>" : "") +
          (how !== "dates" && how !== "once" ? '<label class="f">If it lands on a weekend or bank holiday<select data-f="shift"><option value="">Stays on that day</option><option value="next working day"' + (/next/.test(r.shift || "") ? " selected" : "") + '>Next working day</option><option value="previous working day"' + (/prev/.test(r.shift || "") ? " selected" : "") + ">Working day before</option></select></label>" : "");
    }
    return "";
  }
  function ordinal(n) { return n + (n % 10 === 1 && n !== 11 ? "st" : n % 10 === 2 && n !== 12 ? "nd" : n % 10 === 3 && n !== 13 ? "rd" : "th"); }
  function readForm() {
    var r = EDIT.row, root = $("#main");
    root.querySelectorAll("[data-f]").forEach(function (el) {
      var k = el.dataset.f, v = el.type === "checkbox" ? el.checked : el.value;
      if (k === "how") { r.unit = v === "quarter" ? "month" : v; if (v === "quarter") r.every = 3; else if (v !== "week") r.every = ""; return; }
      if (k === "dates") v = v.split(/\n+/).map(function (x) { return B.parseDate(x.trim()) || x.trim(); }).filter(Boolean).join(", ");
      r[k] = v;
    });
    var multi = {}; root.querySelectorAll("[data-fm]").forEach(function (el) { multi[el.dataset.fm] = multi[el.dataset.fm] || []; if (el.checked) multi[el.dataset.fm].push(el.value); });
    Object.keys(multi).forEach(function (k) { r[k] = multi[k].join(", "); });
    var sh = root.querySelector('[data-sh="mode"]');
    if (sh) { var fixed = sh.value === "fixed", bits = []; root.querySelectorAll("[data-sh]").forEach(function (el) { if (el.dataset.sh !== "mode" && el.value.trim()) bits.push(el.dataset.sh + (fixed ? "=" : ":") + el.value.trim().replace(/[£,]/g, "")); }); r.shares = bits.join(", "); }
    ["amount", "target", "extra", "limit", "cost", "repay", "price"].forEach(function (k) { if (r[k] !== undefined && r[k] !== "") r[k] = B.round(+String(r[k]).replace(/[£,\s]/g, "") || 0); });
    return r;
  }
  function saveEditor() {
    var t = EDIT.table, r = readForm(), F = FORMS[t], now = todayIso();
    if (!r.name && t !== "splits") { toast("Give it a name first"); return; }
    if (!EDIT.id) r.id = newId(t.slice(0, 3));
    if (F.owner === "person") r.person = r.person || me();
    if (F.owner === "owner") r.owner = r.owner || me();
    if (F.owner === "owners") r.owners = r.owners || me();
    if (F.owner === "from" && !EDIT.id) { r.from = me(); r.to = partner(); }
    if (t === "loans") { if (r.direction === "out") { r.lender = partner(); r.borrower = me(); } else { r.lender = me(); r.borrower = partner(); } delete r.direction; if (r.account && (db().byId[r.account] || {}).owner !== r.lender) r.account = ""; }
    if (/bills|income|transfers/.test(t) && !r.start) r.start = now;
    if (/bills|income|transfers/.test(t) && r.unit === "month" && (!r.on || (!EDIT.id && !S.ui.onTouched))) r.on = String(+r.start.slice(8, 10));
    // a day picked for "every month" means nothing once it's yearly, weekly or on set dates (a yearly one follows its start date)
    if (/bills|income|transfers/.test(t) && r.unit && r.unit !== "month" && (!EDIT.id || String(EDIT.orig.unit || "month") !== r.unit)) r.on = "";
    // a new amount on something that's been running: keep history, change from today
    var was = EDIT.nowAmt, base = (tables()[t] || []).filter(function (x) { return x.id === r.id; })[0] || {};
    var amountChanged = EDIT.id && DATED.test(t) && was !== null && r.amount !== "" && Math.abs(+was - +r.amount) > 0.004 && (EDIT.orig.start || "2000-01-01") < now;
    // the dated change (if any) that today's amount comes from
    var current = (tables().amounts || []).filter(function (x) { return x.item === r.id && !x.deleted && x.start <= now; }).sort(function (a, b) { return a.start < b.start ? 1 : -1; })[0];
    var finish = function (fromToday) {
      if (EDIT.id && DATED.test(t) && was !== null && r.amount !== "") {
        var newAmt = r.amount, differs = Math.abs(+was - +newAmt) > 0.004;
        r.amount = base.amount; // the first amount stays as it was unless it's the one being corrected
        if (!differs) {}
        else if (fromToday) put("amounts", {id: newId("amt"), item: r.id, start: now, amount: newAmt}, true);
        else if (current) put("amounts", Object.assign({}, current, {amount: newAmt}), true);
        else r.amount = newAmt;
      }
      put(t, r, true); markChecked(r.id); toast("Saved" + (fromToday ? ": the new amount counts from today" : "")); leave();
    };
    if (amountChanged) {
      openSheet('<h2>From when?</h2><p class="muted">You changed it from ' + M(was) + " to " + M(r.amount) + ". From today, earlier months keep " + M(was) + ". If " + M(was) + " was a mistake, it\'s corrected " + (current ? "from " + esc(B.nice(current.start)) : "for every month") + '.</p><button type="button" class="btn wide" data-a="amtwhen" data-v="today">From today</button><button type="button" class="btn ghost wide" style="margin-top:10px" data-a="amtwhen" data-v="always">It was a mistake</button>');
      S.ui.amtFinish = finish; return;
    }
    finish(false);
  }

  // budgets you can log a payment against (not savings, and not a "what's left" that goes into an ISA)
  function spendBudgets(onDate) {
    var d = db(), p = me(), per = onDate ? B.periodAt(d, p, onDate) : null;
    // which budgets apply in a period is the engine's call (it uses the middle of the period)
    var list = per ? B.budgetsIn(d, p, per) : d.budgets;
    return list.filter(function (b) { return b.person === p && !b.hidden && b.mode !== "saving" && !(b.mode === "remainder" && /isa|lisa|saving|pension/.test((d.byId[b.account] || {}).kind || "")); });
  }
  // ----- import a bank statement
  SCREENS.importcsv = function () {
    var im = S.ui.imp, html = card('<p class="small muted" style="margin-top:0">Export a CSV from your ' + esc(person().bank || "bank") + ' app, then choose it here. Budgie skips anything you\'ve already logged and any bill it already knows about.</p><label class="f">CSV file<input type="file" accept=".csv,text/csv" data-c="csvfile"></label><label class="f">Which account is it from<select data-c="csvacc">' + accOptions((im && im.account) || B.mainOf(db(), me()), me(), /main|pot|credit/) + "</select></label>");
    if (im && im.rows) {
      var buds = spendBudgets();
      html += card('<div class="row"><h2>' + im.rows.length + " new payment" + (im.rows.length === 1 ? "" : "s") + '</h2><span class="small muted">' + im.skipped + " already in</span></div>" + '<div class="list" style="margin-top:6px">' + im.rows.map(function (r, i) {
        return '<div style="padding:8px 0"><label class="li" style="cursor:pointer;padding:4px 0"><input type="checkbox" class="tick" data-c="impon" data-v="' + i + '"' + (r.on ? " checked" : "") + '><span class="grow"><span class="what">' + esc(r.name) + '</span><span class="why">' + esc(B.nice(r.date)) + (r.why ? ' · <span class="warn">' + esc(r.why) + "</span>" : "") + "</span></span>" + num(M(r.amount)) + '</label><select data-c="impbud" data-v="' + i + '" aria-label="Budget for ' + esc(r.name) + '" style="width:calc(100% - 36px);min-height:44px;border-radius:10px;border:1px solid var(--line);background:var(--card);margin-left:36px;padding:0 8px">' + buds.map(function (b) { return '<option value="' + esc(b.id) + '"' + (b.id === r.budget ? " selected" : "") + ">" + esc(b.name.replace(/ \(what's left\)/, "")) + "</option>"; }).join("") + "</select></div>";
      }).join("") + '</div><button type="button" class="btn wide" style="margin-top:12px" data-a="impsave">Add the ticked ones</button>');
    }
    return html;
  };
  function parseCsv(text) {
    var rows = [], row = [], cur = "", q = false;
    for (var i = 0; i < text.length; i++) { var c = text[i]; if (q) { if (c === '"' && text[i + 1] === '"') { cur += '"'; i++; } else if (c === '"') q = false; else cur += c; } else if (c === '"') q = true; else if (c === ",") { row.push(cur); cur = ""; } else if (c === "\n" || c === "\r") { if (c === "\r" && text[i + 1] === "\n") i++; row.push(cur); rows.push(row); row = []; cur = ""; } else cur += c; }
    if (cur || row.length) { row.push(cur); rows.push(row); }
    return rows.filter(function (r) { return r.some(function (x) { return x.trim(); }); });
  }
  function readStatement(text, account) {
    var rows = parseCsv(text), head = (rows.shift() || []).map(function (h) { return h.trim().toLowerCase(); });
    var col = function (re) { return head.findIndex(function (h) { return re.test(h); }); };
    var cD = col(/^date$|transaction date/), cA = col(/^amount|amount \(gbp\)|^value/), cN = col(/^name$|counter ?party|description|merchant|payee/), cT = col(/^type$|transaction type/);
    if (cD < 0 || cA < 0) throw new Error("Couldn't find the date and amount columns in that file");
    var d = db(), p = me(), out = [], skipped = 0, buds = spendBudgets();
    // money moving between your own pots, or to your partner, isn't spending: show it but leave it unticked
    var mine = B.accountsOf(d, p).map(function (a) { return a.name.toLowerCase(); }), q = (person(partner()).name || "").toLowerCase();
    var notSpend = function (name, type) { var n = String(name || "").toLowerCase(), t = String(type || "").toLowerCase(); return /pot transfer|space transfer|savings? transfer|flex|round.?up/.test(t + " " + n) || mine.some(function (m) { return m && n === m; }) || (q && (n === q || n.indexOf(q + " ") === 0)); };
    var guess = function (name) { var n = name.toLowerCase(), pick = function (re) { var b = buds.filter(function (x) { return re.test(x.name); })[0]; return b && b.id; }; return (/tesco|aldi|lidl|sainsbury|asda|morrisons|co-?op|waitrose|iceland|m&s|greggs/.test(n) && pick(/food/i)) || (/shell|bp |esso|texaco|fuel|petrol/.test(n) && pick(/fuel|car/i)) || (/uber|trainline|bus|rail|tfl/.test(n) && pick(/travel/i)) || (/deliveroo|just eat|uber eats|cinema|netflix/.test(n) && pick(/fun|entertain/i)) || (buds[0] || {}).id; };
    rows.forEach(function (r) {
      var date = B.parseDate(r[cD]), amt = +String(r[cA]).replace(/[£,\s]/g, ""); if (!date || !(amt < 0)) return;
      amt = B.round(-amt); var name = cN >= 0 ? r[cN] : "Payment";
      var dup = d.transactions.some(function (x) { return x.person === p && Math.abs((+x.amount || 0) - amt) < 0.005 && Math.abs(B.diff(x.date, date)) <= 1; }) ||
        d.bills.some(function (b) { return b.person === p && B.occurrences(d, b, B.addDays(date, -3), B.addDays(date, 4)).some(function (o) { return Math.abs(o.amount - amt) < 0.5; }); });
      if (dup) { skipped++; return; }
      var skip = notSpend(name, cT >= 0 ? r[cT] : "");
      out.push({date: date, amount: amt, name: name, budget: guess(name), on: !skip, why: skip ? "Looks like a move between accounts, not spending" : ""});
    });
    return {rows: out, skipped: skipped, account: account};
  }

  // ----- the occurrence sheet (Coming up, calendar)
  function occSheet(key) {
    var c = last.coming[key]; if (!c) return;
    var it = db().byId[c.item], orig = key.split(/[@+]/)[1] || c.date, mine = canEditItem(c), html = "<h2>" + esc(c.name) + '</h2><p class="muted" style="margin:4px 0 10px">' + esc(B.nice(c.date)) + " · " + M(c.amount) + (c.account ? " · " + esc(c.account) : "") + "</p>";
    if (c.table === "loans") {
      var l = db().byId[c.item];
      html += '<button type="button" class="btn wide" data-a="loanpaid" data-v="' + esc(key) + '">' + (l.lender === me() ? "It's been paid to me" : "I've paid it") + "</button>";
    } else if (mine) {
      html += '<div class="list">' + li("It didn't happen", "Just this one; the rest carry on", "", "occdo", "skip|" + key) + li("It was a different amount", "Just this one", "", "occdo", "amount|" + key) + li("It's on a different day", "Just this one", "", "occdo", "move|" + key) +
        li("Change the " + (c.table === "income" ? "income" : c.table === "transfers" ? "regular payment" : "bill"), "Amount, dates, where it comes from", "", "occdo", "edit|" + key) + li("Stop it from today", "No more after today", "", "occdo", "stop|" + key) + "</div>";
    } else html += '<p class="small muted">This one belongs to ' + esc(person((it || {}).person || (it || {}).from).name) + ", so only they can change it.</p>";
    S.ui.occ = {key: key, c: c, orig: orig, it: it};
    openSheet(html + '<button type="button" class="btn ghost wide" style="margin-top:12px" data-a="sheetclose">Close</button>');
  }
  function occDo(kind) {
    var o = S.ui.occ, c = o.c, id = "x-" + c.item + "-" + o.orig;
    if (kind === "skip") { put("exceptions", {id: id + "-skip", item: c.item, date: o.orig, action: "skip"}); closeSheet(); toast(c.name + " on " + B.nice(c.date) + " won't count", {t: "exceptions", ids: [id + "-skip"]}); return; }
    if (kind === "amount") { openSheet("<h2>" + esc(c.name) + '</h2><label class="f">What it really was<input type="text" inputmode="decimal" id="occAmt" value="' + c.amount + '"></label><button type="button" class="btn wide" style="margin-top:12px" data-a="occsave" data-v="amount">Save</button>'); return; }
    if (kind === "move") { openSheet("<h2>" + esc(c.name) + '</h2><label class="f">New date<input type="date" id="occDate" value="' + c.date + '"></label><button type="button" class="btn wide" style="margin-top:12px" data-a="occsave" data-v="move">Save</button>'); return; }
    if (kind === "edit") { openEditor(c.table, c.item); return; }
    if (kind === "stop") { var r = Object.assign({}, db().byId[c.item]); var row = (tables()[c.table] || []).filter(function (x) { return x.id === c.item; })[0]; put(c.table, Object.assign({}, row, {end: B.addDays(todayIso(), 0)})); closeSheet(); toast(c.name + " stopped"); }
  }
  function calDay(iso) {
    var items = B.calendar(db(), me(), +iso.slice(0, 4), +iso.slice(5, 7) - 1)[iso] || [];
    items.forEach(function (c) { last.coming[c.key] = c; });
    openSheet("<h2>" + esc(B.nice(iso)) + "</h2>" + (items.length ? '<div class="list" style="margin-top:8px">' + items.map(function (c) { return li(esc(c.name), esc(c.account || ""), num((c.sign > 0 ? "+" : "−") + M(c.amount), c.sign > 0 ? "good" : ""), "occ", c.key); }).join("") + "</div>" : '<p class="muted">Nothing due.</p>') + '<button type="button" class="btn ghost wide" style="margin-top:12px" data-a="sheetclose">Close</button>');
  }

  // ---------- actions ----------
  var ACT = {
    tab: function (v) { go(v); if (v === "add") { var el = $("#addAmt"); if (el && !el.value) try { el.focus({preventScroll: true}); } catch (e) {} } }, // Add goes straight to typing the amount
    go: function (v) { if (/^list:/.test(v)) go("list", {table: v.slice(5)}); else go(v); }, back: back,
    sheetbg: function (v, el, e) { if (e.target === el) closeSheet(); }, sheetclose: function () { closeSheet(); },
    info: function (v) { var x = INFO[v]; if (x) openSheet("<h2>" + esc(x[0]) + '</h2><p class="muted">' + esc(x[1]) + '</p><button type="button" class="btn wide" data-a="sheetclose">Got it</button>'); },
    reveal: function () { S.ui.reveal = !S.ui.reveal; render(); },
    who: function () {
      if (demoOn()) { ACT.demoinfo(); return; }
      openSheet("<h2>" + esc(person().name) + '</h2><p class="muted">Signed in on this phone. ' + esc(syncLabel()) + '</p><button type="button" class="btn ghost wide" data-a="sheetgo" data-v="settings">Settings</button><button type="button" class="btn ghost wide" style="margin-top:10px" data-a="sheetgo" data-v="sync">Sync and backup</button>');
    },
    sheetgo: function (v) { go(v); },
    demoinfo: function () { openSheet('<h2>Show and tell</h2><p class="muted">Everything here is made up. Switch who you\'re looking at, or turn it off to go back to your own money.</p><div class="two fit"><button type="button" class="btn ghost" data-a="demoas" data-v="alex">See Alex</button><button type="button" class="btn ghost" data-a="demoas" data-v="sam">See Sam</button></div><button type="button" class="btn wide" style="margin-top:10px" data-a="demo" data-v="off">Turn off Show and tell</button>'); },
    demoas: function (v) { S.demo.me = v; dirty(); S.prefs.easy = null; go("today"); },
    demo: function (v) { setDemo(v === "on"); go("today"); },
    connect: function () { var v = ($("#connectLink") || {}).value || ""; connectFrom(v); },
    connectswitch: function () { closeSheet(); S.ui.connectOk = true; connectFrom(S.ui.pendingLink || ""); },
    moneyview: function (v) { S.ui.money = v; render(); }, moneyjump: function (v) { S.ui.money = "month"; S.ui.monthOff = +v || 0; render(); window.scrollTo(0, 0); }, month: function (v) { S.ui.monthOff += +v; render(); }, cal: function (v) { S.ui.calOff += +v; render(); },
    calday: function (v) { calDay(v); }, occ: function (v) { occSheet(v); }, occskip: function (v) { occSheet(v); occDo("skip"); }, occdo: function (v) { var k = v.split("|"); occDo(k[0]); },
    occsave: function (v) {
      var o = S.ui.occ, c = o.c, id = "x-" + c.item + "-" + o.orig;
      if (v === "amount") { var raw = String(($("#occAmt") || {}).value || "").replace(/[£,\s]/g, ""), a = +raw; if (raw === "" || !(a >= 0)) return; put("exceptions", {id: id + "-amount", item: c.item, date: o.orig, action: "amount", amount: B.round(a)}); }
      if (v === "move") { var nd = ($("#occDate") || {}).value; if (!nd) return; put("exceptions", {id: id + "-move", item: c.item, date: o.orig, action: "move", newDate: nd}); }
      closeSheet(); toast("Saved. Your budget has updated.");
    },
    loanpaid: function (v) {
      var c = last.coming[v], l = db().byId[c.item];
      put("settlements", {id: newId("set"), date: todayIso(), from: l.borrower, to: l.lender, amount: c.amount, loan: l.id, key: v, note: l.name}); closeSheet(); toast("Marked as paid");
    },
    tick: function (v) { tickItem(last.todo[+v]); },
    payments: function (v) { var k = v.split("|"); go("payments", {start: k[0], budget: k[1] || ""}); },
    paymonth: function (v) { var d = db(), per = B.periodAt(d, me(), S.view.p.start || todayIso()); per = +v > 0 ? B.nextPeriod(d, me(), per) : B.prevPeriod(d, me(), per); if (per) { S.view.p.start = per.start; render(); window.scrollTo(0, 0); } },
    payedit1: function (v) { paymentSheet(v); },
    pesave: function () {
      var x = (tables().transactions || []).filter(function (r) { return r.id === S.ui.payEdit; })[0]; if (!x) return;
      if (isBankTx(x)) { put("transactions", Object.assign({}, x, {budget: $("#peBud").value, note: $("#peNote").value}), true); closeSheet(); toast("Payment changed"); render(); return; }
      var a = +String(($("#peAmt") || {}).value || "").replace(/[£,\s]/g, ""); if (!(a > 0)) { toast("Type the amount first"); return; }
      put("transactions", Object.assign({}, x, {amount: B.round(a), budget: $("#peBud").value, account: $("#peAcc").value, date: $("#peDate").value || x.date, note: $("#peNote").value}), true);
      closeSheet(); toast("Payment changed"); render();
    },
    pedel: function () { var id = S.ui.payEdit; del("transactions", id, true); closeSheet(); toast("Payment deleted", {t: "transactions", ids: [id], restore: true}); render(); },
    settle: function (v) {
      var bt = B.between(db(), me(), todayIso()), q = person(partner()).name || "your partner", amt = v === "in" ? bt.owedToMe : bt.iOwe;
      openSheet("<h2>" + (v === "in" ? esc(q) + " has paid you " + M(amt) + "?" : "You've paid " + esc(q) + " " + M(amt) + "?") + '</h2><p class="muted">Only tap yes once the money has actually moved. It resets what you owe each other to nothing.</p><button type="button" class="btn wide" data-a="settle2" data-v="' + v + '">Yes, ' + (v === "in" ? "it's arrived" : "I've sent it") + '</button><button type="button" class="btn ghost wide" style="margin-top:10px" data-a="sheetclose">Not yet</button>');
    },
    settle2: function (v) {
      var bt = B.between(db(), me(), todayIso()), q = partner(), row;
      // (keyed like To do's settling up, so the sheet can tell if you both ticked the same one)
      if (v === "in") row = put("settlements", {id: newId("set"), date: todayIso(), from: q, to: me(), amount: bt.owedToMe, key: "split:" + todayIso(), note: "Settled up"}, true);
      else row = put("settlements", {id: newId("set"), date: todayIso(), from: me(), to: q, amount: bt.iOwe, key: "split:" + todayIso(), note: "Settled up"}, true);
      closeSheet(); toast("All square", {t: "settlements", ids: [row.id]}); render();
    },
    payedit: function (v) {
      // the occurrence by its own date, even when it moved (Christmas pay comes early), so a pay rise shows
      var bits = v.split("@"), inc = db().byId[bits[0]], cur = (B.occurrences(db(), inc, B.addDays(bits[1], -40), B.addDays(bits[1], 41)).filter(function (o) { return o.orig === bits[1]; })[0] || {}).amount || inc.amount;
      S.ui.payOcc = {item: bits[0], date: bits[1]};
      openSheet('<h2>What did you get paid?</h2><p class="muted">Check your payslip or ' + esc(person().bank || "bank") + ' app. Everything re-sorts around it, and what\'s left (' + esc(S.ui.payLeft || "savings") + ') goes up or down.</p><label class="f">Amount<input type="text" inputmode="decimal" id="payAmt" value="' + cur + '"></label><button type="button" class="btn wide" style="margin-top:12px" data-a="paysave">Save</button>');
    },
    paysave: function () {
      var a = +String(($("#payAmt") || {}).value || "").replace(/[£,\s]/g, ""), o = S.ui.payOcc; if (!(a > 0)) return;
      put("exceptions", {id: "x-" + o.item + "-" + o.date + "-amount", item: o.item, date: o.date, action: "amount", amount: B.round(a)}); closeSheet(); toast("Pay set to " + M(a) + ". Everything has re-sorted.");
    },
    // a pot or account: what the bank's app shows. An ISA, LISA or pension: what it's worth in the provider's app
    potcheck: function (v) {
      var a = db().byId[v]; if (!a) return; S.ui.potCheck = v;
      var inv = /lisa|isa|pension/.test(a.kind || ""), dated = inv || /saving/.test(a.kind || ""), now = B.balances(db(), todayIso())[v];
      openSheet("<h2>" + esc(a.name) + '</h2><p class="muted">' + (inv ? "What's it worth in your provider's app today?" : "What does your " + esc(person().bank || "bank") + " app show right now?") + " Budgie starts again from this.</p>" +
        '<label class="f">' + (inv ? "Worth" : "Balance") + '<input type="text" inputmode="decimal" id="potBal" placeholder="' + esc(now !== undefined && !(S.prefs.hide && !S.ui.reveal) ? B.money(now) : "£") + '"></label>' +
        (dated ? '<label class="f">On<input type="date" id="potDate" value="' + todayIso() + '" max="' + todayIso() + '"></label>' + (a.kind === "lisa" ? '<p class="tiny muted" style="margin:6px 0 0">You can add past values too (say, the last day of each month) to fill in the chart.</p>' : "") : "") +
        '<button type="button" class="btn wide" style="margin-top:12px" data-a="potsave">Save</button>');
    },
    potsave: function () { var a = +String(($("#potBal") || {}).value || "").replace(/[£,\s]/g, ""); if (isNaN(a) || ($("#potBal") || {}).value === "") return; var vd = (($("#potDate") || {}).value || todayIso()); put("valuations", {id: newId("val"), account: S.ui.potCheck, date: vd > todayIso() ? todayIso() : vd, amount: B.round(a)}, true); markChecked(S.ui.potCheck); closeSheet(); toast("Thanks. Budgie has caught up."); render(); },
    chk: function (v) {
      var c = checkList().filter(function (x) { return x.id === v; })[0]; if (!c) return;
      if (c.action === "edit") { var k = c.value.split(":"); openEditor(k[0], k[1]); }
      else if (c.action === "potcheck") ACT.potcheck(c.value);
      else if (c.action === "lisapaid") ACT.lisapaid(c.value);
      else if (c.action === "go") go(c.value);
    },
    chkok: function (v) { setting("check:" + v, "done"); if (sheetOpen() && checkList().length) checksSheet(); else closeSheet(); toast("Thanks"); render(); },
    lisapaid: function (v) {
      S.ui.lisaAcc = v; var cur = getSetting("lisa.paidBefore." + v, "");
      openSheet('<h2>Paid in since 6 April</h2><p class="muted">Your LISA app shows how much has gone in this tax year (yours and anyone else\'s). Budgie adds what comes next, so it can warn you before you go over £4,000.</p><label class="f">Paid in before ' + esc(B.nice(B.startOf(db(), me()))) + '<input type="text" inputmode="decimal" id="lisaPaid" value="' + esc(cur) + '" placeholder="£"></label><button type="button" class="btn wide" style="margin-top:12px" data-a="lisapaidsave">Save</button>');
    },
    lisapaidsave: function () { var raw = ($("#lisaPaid") || {}).value || "", a = +String(raw).replace(/[£,\s]/g, ""); if (raw === "" || isNaN(a)) return; setting("lisa.paidBefore." + S.ui.lisaAcc, B.round(a)); markChecked("lisapaid-" + S.ui.lisaAcc); closeSheet(); toast("Saved"); render(); },
    edit: function (v) { var k = v.split(":"); openEditor(k[0], k[1]); }, "new": function (v) { openEditor(v, null); },
    editsave: function () { saveEditor(); },
    amtwhen: function (v) { if (S.ui.amtFinish) S.ui.amtFinish(v === "today"); },
    editstop: function () {
      var stored = (tables()[EDIT.table] || []).filter(function (x) { return x.id === EDIT.id; })[0] || EDIT.orig, end = todayIso();
      // a budget belongs to a whole pay period (its pay was sorted on payday), so it stops once this one ends
      var bud = EDIT.table === "budgets"; if (bud) end = B.addDays(B.periodAt(db(), me(), end).next, -1);
      put(EDIT.table, Object.assign({}, stored, {end: end}), true); toast(bud ? "Stops at your next payday" : "Stopped from today"); leave();
    },
    editdelete: function () { openSheet('<h2>Delete this?</h2><p class="muted">It will stop counting everywhere, including past months. To keep the past, use "' + (EDIT.table === "budgets" ? "Stop at next payday" : "Stop from today") + '" instead.</p><button type="button" class="btn danger wide" data-a="editdelete2">Delete</button><button type="button" class="btn ghost wide" style="margin-top:10px" data-a="sheetclose">Keep it</button>'); },
    editdelete2: function () { del(EDIT.table, EDIT.id, true); toast("Deleted"); leave(); },
    addmode: function (v) { S.ui.add.mode = v; render(); window.scrollTo(0, 0); },
    addbud: function (v) { var a = S.ui.add; if (a.budget !== v) { a.budget = v; a.touched = {}; } closeSheet(); render(); },
    addmorebud: function () {
      var a = S.ui.add, buds = addBudgets(a.date || todayIso());
      openSheet('<h2>What was it for?</h2><div class="budgrid" style="margin-top:12px">' + buds.map(function (b) { return '<button type="button" class="budtile" data-a="addbud" data-v="' + esc(b.id) + '" aria-pressed="' + (a.budget === b.id) + '">' + icon(budIcon(b.name), 22) + budLabel(b) + "</button>"; }).join("") + "</div>");
    },
    addfrom: function () {
      var a = S.ui.add, d = db(), accs = B.accountsOf(d, me()).filter(function (x) { return /main|pot|saving|credit/.test(x.kind || "pot"); });
      openSheet("<h2>Paid from</h2><div class=\"list\" style=\"margin-top:6px\">" + accs.map(function (x) { return '<button type="button" class="li" data-a="addfrom2" data-v="' + esc(x.id) + '"><span class="grow"><span class="what">' + esc(x.name) + "</span>" + (x.purpose ? '<span class="why">' + esc(x.purpose) + "</span>" : "") + "</span>" + (a.account === x.id ? '<span class="good" style="font-weight:700">✓</span>' : "") + "</button>"; }).join("") + "</div>");
    },
    addfrom2: function (v) { S.ui.add.account = v; S.ui.add.touched = Object.assign(S.ui.add.touched || {}, {account: true}); closeSheet(); render(); },
    adddatepick: function () {
      var t = todayIso(), cur = S.ui.add.date || t;
      openSheet('<h2>When was it?</h2><div class="chips fit" style="margin-top:10px"><button type="button" class="chip" data-a="adddate2" data-v="' + t + '" aria-pressed="' + (cur === t) + '">Today</button><button type="button" class="chip" data-a="adddate2" data-v="' + B.addDays(t, -1) + '" aria-pressed="' + (cur === B.addDays(t, -1)) + '">Yesterday</button></div><label class="f">Another day<input type="date" id="addDateIn" value="' + esc(cur) + '" max="' + t + '"></label><button type="button" class="btn wide" style="margin-top:12px" data-a="adddate2">Done</button>');
    },
    adddate2: function (v) { var x = v || (($("#addDateIn") || {}).value) || todayIso(); S.ui.add.date = x > todayIso() ? todayIso() : x; closeSheet(); render(); },
    addsplit2: function () {
      var a = S.ui.add, d = db(), splits = d.splits.filter(function (s) { return !/=/.test(String(s.shares || "")) && s.id !== "half"; });
      a.touched = Object.assign(a.touched || {}, {split: true});
      if (!splits.length || a.split) { a.split = !a.split; a.splitId = a.splitId || "half"; render(); return; }
      openSheet("<h2>Split with " + esc(shortName(person(partner()).name) || "your partner") + '</h2><div class="list" style="margin-top:6px">' + [{id: "half", name: "Half each"}].concat(splits).map(function (s) { return '<button type="button" class="li" data-a="addsplit3" data-v="' + esc(s.id) + '"><span class="grow"><span class="what">' + esc(s.name) + "</span>" + (s.shares ? '<span class="why">' + esc(describeShares(s.shares)) + "</span>" : "") + "</span></button>"; }).join("") + "</div>");
    },
    addsplit3: function (v) { S.ui.add.split = true; S.ui.add.splitId = v; closeSheet(); render(); },
    addnotepick: function () { openSheet('<h2>Add a note</h2><label class="f">Note<input type="text" id="addNoteIn" value="' + esc(S.ui.add.note || "") + '" placeholder="For example: Tesco big shop" maxlength="80"></label><button type="button" class="btn wide" style="margin-top:12px" data-a="addnote2">Done</button>'); },
    addnote2: function () { S.ui.add.note = (($("#addNoteIn") || {}).value || "").trim(); closeSheet(); render(); },
    addpick: function (v) { var k = v.split(":"); S.ui.add[k[0]] = k[1]; render(); },
    addallbills: function () { S.ui.add.allBills = true; render(); },
    addsave: function () {
      var el = $("#addAmt"); if (el) S.ui.keys = el.value;
      var a = S.ui.add, amt = B.round(+String(S.ui.keys || "").replace(/[£,\s]/g, "")); if (!(amt > 0)) { toast("Type the amount first"); if (el) el.focus(); return; }
      if (amt > 100000) { toast("That looks too big. Check the amount"); return; }
      var date = a.date || todayIso();
      if (a.mode === "bill") {
        var b = db().byId[a.bill]; if (!b) { toast("Choose which bill it was"); return; }
        // the one it was ("When was it?"): the latest on or before that day, or failing that the next one due
        var near = B.occurrences(db(), b, B.addDays(date, -25), B.addDays(date, 26)), was = near.filter(function (o) { return o.date <= date; });
        var occ = was.length ? was[was.length - 1] : near[0];
        if (!occ) { toast("That bill isn't due near that date"); return; }
        var orig = occ.key.split(/[@+]/)[1];
        put("exceptions", {id: "x-" + b.id + "-" + orig + "-amount", item: b.id, date: orig, action: "amount", amount: amt});
        toast(b.name + " on " + B.nice(occ.date) + " saved as " + M(amt) + (b.split ? " and re-split" : ""));
      } else {
        var row = put("transactions", {id: newId("t"), date: date, person: me(), amount: amt, budget: a.budget, account: a.account || B.mainOf(db(), me()), split: a.split ? (a.splitId || "half") : "", note: a.note || "", source: "app"}, true);
        toast("Logged " + M(amt), {t: "transactions", ids: [row.id]});
      }
      S.ui.keys = ""; S.ui.add = {mode: a.mode === "bill" ? "spend" : a.mode}; if (document.activeElement) document.activeElement.blur(); go("today");
    },
    undo: function () {
      var u = S.ui.undo; if (!u) return;
      u.ids.forEach(function (id) {
        if (u.restore) { var r = (tables()[u.t] || []).filter(function (x) { return x.id === id; })[0]; if (r) put(u.t, Object.assign({}, r, {deleted: false}), true); }
        else del(u.t, id, true);
      });
      $("#toast").innerHTML = ""; S.ui.undo = null; render();
    },
    syncnow: function () { if (sheetOpen()) closeSheet(); sync(false); }, syncfull: function () { sync(true); },
    unlock: function () { unlock(); },
    applink: function (v) { bankCall("app.link", {app: v}).then(function (j) { S.ui.appLink = {app: v, link: j.link}; S.appsState = Object.assign(S.appsState || {}, (function () { var o = {}; o[v] = true; return o; })()); render(); }, function (e) { toast(e.message); }); },
    applinkcopy: function () { var v = ($("#appLinkOut") || {}).value || ""; try { navigator.clipboard.writeText(v).then(function () { toast("Copied. Paste it into the other app."); }); } catch (e) { toast("Press and hold the link to copy it"); } },
    appunlink: function (v) { bankCall("app.unlink", {app: v}).then(function () { if (S.appsState) S.appsState[v] = false; S.ui.appLink = null; toast("Unlinked"); render(); }, function (e) { toast(e.message); }); },
    bankre: function () { S.bank = null; render(); },
    bankcopy: function () { try { navigator.clipboard.writeText((S.cfg || {}).u || ""); toast("Copied"); } catch (e) { toast("Couldn't copy. Press and hold to copy it."); } },
    bankmonzo: function () {
      var id = String(($("#mzId") || {}).value || "").trim(), sec = String(($("#mzSecret") || {}).value || "").trim();
      if (!id || !sec) { toast("Paste the Client ID and the Client secret first"); return; }
      var w = window.open("about:blank", "_blank"); // opened straight from the tap so the phone doesn't block it
      try { if (w) w.opener = null; } catch (e) {}   // the sign-in pages can't reach back into Budgie
      ($("#mzSecret") || {}).value = "";   // the secret doesn't stay on the screen, whatever Monzo says
      bankCall("bank.monzo.setClient", {clientId: id, clientSecret: sec}).then(function () { return bankCall("bank.monzo.authUrl"); }).then(function (j) {
        if (w) w.location = j.url; else location.href = j.url;
        S.bank = null; toast("Approve Budgie in the Monzo app, then come back here");
      }, function (e) { if (w) w.close(); toast(e.message); });
    },
    bankmonzo2: function () { var w = window.open("about:blank", "_blank"); try { if (w) w.opener = null; } catch (e) {} bankCall("bank.monzo.authUrl").then(function (j) { if (w) w.location = j.url; else location.href = j.url; S.bank = null; }, function (e) { if (w) w.close(); toast(e.message); }); },
    bankstarling: function () {
      var t = String(($("#stTok") || {}).value || "").trim(); if (!t) { toast("Paste your token first"); return; }
      toast("Checking the token…"); ($("#stTok") || {}).value = "";   // the token doesn't stay on the screen, whatever Starling says
      bankCall("bank.starling.setToken", {token: t}).then(function () { toast("Connected to Starling"); return bankRefresh(); }).then(function () { sync(false); }, function (e) { toast(e.message); });
    },
    bankguess: function () {
      var g = S.ui.bankGuess || {}, ids = Object.keys(g); if (!ids.length) return;
      toast("Saving…");
      ids.reduce(function (pr, id) { return pr.then(function () { return bankCall("bank.map", {extId: id, account: g[id]}); }); }, Promise.resolve()).then(function () { toast("Saved"); return bankRefresh(); }, function (e) { toast(e.message); });
    },
    banksync: function () { toast("Checking…"); bankCall("bank.syncNow").then(function (j) { toast(j.added || j.updated ? (j.added || 0) + " new, " + (j.updated || 0) + " updated" : "Nothing new"); sync(false); return bankRefresh(); }, function (e) { toast(e.message); }); },
    bankoff: function () { openSheet("<h2>Disconnect " + esc(bankName()) + '?</h2><p class="muted">Budgie stops reading your bank and forgets its key. Payments it already brought in stay.' + (bankName() === "Starling" ? " Also delete the token on developer.starlingbank.com, so it can't be used again." : "") + "</p>" + '<button type="button" class="btn danger wide" data-a="bankoff2">Disconnect</button><button type="button" class="btn ghost wide" style="margin-top:10px" data-a="sheetclose">Keep it</button>'); },
    bankoff2: function () { closeSheet(); bankCall("bank.disconnect").then(function () { toast("Disconnected"); return bankRefresh(); }, function (e) { toast(e.message); }); },
    revbud: function (v) { var k = v.split("|"); reviewSave(k[0], {budget: k[1]}, false); closeSheet(); render(); },
    revmore: function (v) { var x = (tables().transactions || []).filter(function (r) { return r.id === v; })[0] || {}; openSheet('<h2>What was it for?</h2><div class="budgrid" style="margin-top:12px">' + spendBudgets().map(function (b) { return '<button type="button" class="budtile" data-a="revbud" data-v="' + esc(v) + "|" + esc(b.id) + '" aria-pressed="' + (x.budget === b.id) + '">' + icon(budIcon(b.name), 22) + budLabel(b) + "</button>"; }).join("") + "</div>"); },
    revsplit: function (v) { var x = (tables().transactions || []).filter(function (r) { return r.id === v; })[0]; if (!x) return; S.ui.revSplit = S.ui.revSplit || {}; S.ui.revSplit[v] = revSplit(x) ? "" : (splitHint(x) || "half"); render(); },
    revok: function (v) { var x = (tables().transactions || []).filter(function (r) { return r.id === v; })[0]; if (!x) return; reviewSave(v, {review: false, split: revSplit(x)}, true); toast("Got it"); render(); },
    revall: function () { var n = 0; reviewRows().forEach(function (x) { if (x.budget) { reviewSave(x.id, {review: false, split: revSplit(x)}, true); n++; } }); toast(n + " done"); render(); },
    emailsave: function () {
      var to = String(($("#emailTo") || {}).value || "").trim(), on = !!($('[data-c="emailon"]') || {}).checked;
      if (on && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) { toast("That email address doesn't look right"); return; }
      setting("email.to", to); setting("email.sunday", on); toast(on ? "Done. Your first one comes on Sunday." : "Saved. No Sunday email."); leave();
    },
    reload: function () { var done = function () { location.reload(); }; try { navigator.serviceWorker.getRegistration().then(function (r) { return r && r.update(); }).then(done, done); } catch (e) { done(); } },
    disconnect: function () {
      var n = S.data.queue.length + (S.data.carry ? S.data.carry.queue.length : 0);
      openSheet('<h2>Disconnect this phone?</h2>' + (n ? '<p class="bad" style="font-weight:600">' + n + " change" + (n === 1 ? " hasn't" : "s haven't") + " reached your Google Sheet yet. Disconnecting now would lose " + (n === 1 ? "it" : "them") + '.</p><button type="button" class="btn wide" data-a="syncnow">Sync now</button>' : '<p class="muted">Your data stays safe in the Google Sheet. You\'ll need your connect link to come back.</p>') +
        '<button type="button" class="btn danger wide" style="margin-top:10px" data-a="disconnect2">' + (n ? "Disconnect anyway" : "Disconnect") + "</button>");
    },
    disconnect2: function () { S.cfg = null; LS.set("budgie.cfg", null); S.data = {tables: {}, since: 0, me: "", summary: null, queue: []}; store.set("data", S.data); dirty(); go("today"); },
    tmode: function (v) { S.prefs.mode = v; S.prefs.special = ""; themeSaved(); }, tcolour: function (v) { S.prefs.colour = v; S.prefs.special = ""; themeSaved(); },
    tspecial: function (v) { S.prefs.special = v; themeSaved(); }, tsize: function (v) { S.prefs.size = v; themeSaved(); },
    hprice: function (v) { S.ui.house.price = +v; render(); }, hdep: function (v) { S.ui.house.dep = +v; render(); },
    impsave: function () {
      var im = S.ui.imp, n = 0; im.rows.forEach(function (r) { if (!r.on) return; put("transactions", {id: newId("t"), date: r.date, person: me(), amount: r.amount, budget: r.budget, account: im.account, note: r.name, source: "import"}, true); n++; });
      S.ui.imp = null; toast("Added " + n + " payment" + (n === 1 ? "" : "s")); go("today");
    }
  };
  // a payday move belongs to its payday, but one ticked after a balance you checked of either account since then is
  // dated today: on payday it would count as already in that balance, when it's only just been moved
  function payTickDate(key, from, to) {
    var now = todayIso(), dd = B.moveDate ? B.moveDate(key, now) : now;
    return dd < now && db().valuations.some(function (x) { return (x.account === from || x.account === to) && x.date > dd && x.date <= now; }) ? now : dd;
  }
  function themeSaved() { S.prefs._local = true; savePrefs(); applyTheme(); if (!demoOn() && me()) { setting("theme.mode", S.prefs.mode); setting("theme.colour", S.prefs.colour); setting("theme.special", S.prefs.special); } render(); }
  function tickItem(it) {
    if (!it) return;
    var now = todayIso(), ids = [];
    if (it.type === "move") it.keys.forEach(function (k) { ids.push(put("moves", {id: newId("mv"), date: now, person: me(), from: it.from, to: it.to, amount: k.amount, key: k.key}, true).id); });
    else if (it.type === "loan") ids.push(put("settlements", {id: newId("set"), date: now, from: it.borrower, to: it.lender, amount: it.amount, loan: it.loan, key: it.key}, true).id);
    else if (it.type === "settle") ids.push(put("settlements", {id: newId("set"), date: now, from: it.from, to: it.to, amount: it.amount, key: it.key, note: "Settled up"}, true).id);
    else if (it.type === "warn") ids.push(put("moves", {id: newId("mv"), date: now, person: me(), amount: 0, key: it.key, note: "dismissed"}, true).id);
    toast("Done", {t: it.type === "loan" || it.type === "settle" ? "settlements" : "moves", ids: ids});
    render();
  }

  document.addEventListener("click", function (e) {
    var el = e.target.closest("[data-a]"); if (!el) return;
    var fn = ACT[el.dataset.a]; if (!fn) return;
    if (el.tagName === "A") e.preventDefault();
    fn(el.dataset.v, el, e);
  });
  document.addEventListener("change", function (e) {
    var el = e.target, c = el.dataset && el.dataset.c;
    // the editor's fields (data-f): picking a day yourself, and the questions that follow "How often"
    if (!c && el.dataset && el.dataset.f) {
      if (el.dataset.f === "on") S.ui.onTouched = true;
      // a new bill's day follows its start date until you pick a day yourself
      if (el.dataset.f === "start" && !EDIT.id && !S.ui.onTouched && B.isIso(el.value)) { var onEl = $("#main").querySelector('[data-f="on"]'); if (onEl) onEl.value = String(+el.value.slice(8, 10)); }
      if (el.dataset.f === "how" || (el.dataset.f === "direction" && EDIT.table === "loans")) render();   // render reads the form first, so nothing typed is lost
      return;
    }
    if (!c) return;
    var v = el.dataset.v;
    if (c === "tick") { tickItem(last.todo[+v]); return; }
    if (c === "paytick") { var k = v.split("|"); if (el.checked) put("moves", {id: newId("mv"), date: payTickDate(k[0], k[1], k[2]), person: me(), from: k[1], to: k[2], amount: +k[3], key: k[0]}); else { (db().moves || []).filter(function (m) { return m.key === k[0] && m.person === me(); }).forEach(function (m) { del("moves", m.id); }); } return; }
    if (c === "toggle") {
      if (v === "easy") { S.prefs.easy = el.checked; savePrefs(); if (!demoOn() && me()) setting("easy", el.checked); applyTheme(); render(); }
      if (v === "hide") { S.prefs.hide = el.checked; S.ui.reveal = false; savePrefs(); render(); }
      if (v === "lock") { if (el.checked) lockEnable().then(function () { render(); }); else lockDisable().then(function () { render(); }); }
      if (v === "demo") { setDemo(el.checked); go("today"); }
      return;
    }
    if (c === "share") { setting("share." + v, el.checked); render(); return; }
    if (c === "bankmap") { var val = el.value; bankCall("bank.map", {extId: v, account: val}).then(function () { toast("Saved"); return bankRefresh(); }, function (e) { toast(e.message); }); return; }
    if (c === "emailon") return;
    if (c === "addsplit") { S.ui.add.split = el.checked; render(); return; }
    if (c === "adddate") { S.ui.add.date = el.value; render(); return; }
    if (c === "addnote") { S.ui.add.note = el.value; return; }
    if (c === "addamt") { S.ui.keys = el.value; return; }
    if (c === "hrate") { S.ui.house.rate = +el.value || 4.5; render(); return; }
    if (c === "hterm") { S.ui.house.term = +el.value || 30; render(); return; }
    if (c === "csvacc") { S.ui.imp = Object.assign(S.ui.imp || {}, {account: el.value}); return; }
    if (c === "csvfile") {
      var f = el.files && el.files[0]; if (!f) return;
      f.text().then(function (txt) { try { S.ui.imp = readStatement(txt, ($('[data-c="csvacc"]') || {}).value || B.mainOf(db(), me())); } catch (err) { toast(err.message); } render(); });
      return;
    }
    if (c === "impon") { S.ui.imp.rows[+v].on = el.checked; return; }
    if (c === "impbud") { S.ui.imp.rows[+v].budget = el.value; return; }
  });
  // the "how often" control re-draws the form so the right questions show
  document.addEventListener("input", function (e) {
    var c = e.target.dataset && e.target.dataset.c;
    if (c === "addnote") S.ui.add.note = e.target.value;
    if (c === "addamt") { var v = e.target.value.replace(/[^\d.]/g, "").replace(/(\..*)\./g, "$1").replace(/^(\d*\.\d{0,2}).*$/, "$1").slice(0, 9); if (v !== e.target.value) e.target.value = v; S.ui.keys = v; }
  });
  // Done on the number keyboard just puts it away, so you can pick what it was for
  document.addEventListener("keydown", function (e) { if (e.key === "Enter" && e.target && e.target.id === "addAmt") { e.preventDefault(); e.target.blur(); } });

  // swipe a Coming up row to reveal its buttons
  var sw = null;
  document.addEventListener("touchstart", function (e) { var f = e.target.closest(".swipe .face"); if (!f || !f.parentNode.querySelector(".acts")) return; sw = {f: f, x: e.touches[0].clientX, y: e.touches[0].clientY, dx: 0, open: f.style.transform && f.style.transform !== "translateX(0px)"}; }, {passive: true});
  document.addEventListener("touchmove", function (e) { if (!sw) return; var dx = e.touches[0].clientX - sw.x, dy = e.touches[0].clientY - sw.y; if (Math.abs(dy) > Math.abs(dx) && !sw.moved) { sw = null; return; } sw.moved = true; sw.f.parentNode.classList.add("open"); sw.dx = Math.max(-168, Math.min(0, dx + (sw.open ? -168 : 0))); sw.f.style.transition = "none"; sw.f.style.transform = "translateX(" + sw.dx + "px)"; }, {passive: true});
  document.addEventListener("touchend", function () { if (!sw) return; var f = sw.f; f.style.transition = ""; var openIt = sw.moved ? sw.dx < -60 : false; f.style.transform = "translateX(" + (openIt ? -168 : 0) + "px)"; if (!openIt) { var row = f.parentNode; setTimeout(function () { if (row && !/-168/.test(f.style.transform)) row.classList.remove("open"); }, 200); } if (sw.moved) { f.dataset.swiped = "1"; setTimeout(function () { delete f.dataset.swiped; }, 350); } sw = null; });
  document.addEventListener("click", function (e) { var f = e.target.closest(".swipe .face"); if (f && f.dataset.swiped) { e.stopImmediatePropagation(); e.preventDefault(); } }, true);

  // ---------- fingerprint lock ----------
  // Budgie asks the phone to check your fingerprint (or face, or screen-lock PIN) before it shows anything.
  // It uses the phone's built-in passkey check; nothing about your fingerprint ever leaves the phone.
  // When Budgie goes into the background the screen is covered straight away (so it doesn't show in the
  // app switcher), and coming back after more than a minute asks again.
  var LOCK = {cred: LS.get("budgie.lock", null), locked: false, hiddenAt: 0, busy: false, GRACE: 60000};
  // on whenever it's been set up, Show and tell included: otherwise turning Show and tell off would get round it
  var lockOn = function () { return !!(LOCK.cred && LOCK.cred.id); };
  var rnd = function (n) { var a = new Uint8Array(n); crypto.getRandomValues(a); return a; };
  var b64u = function (buf) { var s2 = "", a = new Uint8Array(buf); for (var i = 0; i < a.length; i++) s2 += String.fromCharCode(a[i]); return btoa(s2).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); };
  var unb64u = function (s2) { s2 = s2.replace(/-/g, "+").replace(/_/g, "/"); var bin = atob(s2 + "===".slice((s2.length + 3) % 4)), a = new Uint8Array(bin.length); for (var i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i); return a; };
  async function lockSupported() { try { return !!(window.PublicKeyCredential && await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable()); } catch (e) { return false; } }
  async function lockEnable() {
    if (!(await lockSupported())) { toast("This phone can't check a fingerprint for Budgie. Make sure it has a fingerprint or screen lock set up."); return false; }
    try {
      var cred = await navigator.credentials.create({publicKey: {challenge: rnd(32), rp: {name: "Budgie", id: location.hostname}, user: {id: rnd(16), name: (person().name || "Budgie") + " on this phone", displayName: person().name || "Budgie"},
        pubKeyCredParams: [{type: "public-key", alg: -7}, {type: "public-key", alg: -257}], authenticatorSelection: {authenticatorAttachment: "platform", userVerification: "required", residentKey: "discouraged"}, timeout: 60000, attestation: "none"}});
      if (!cred) return false;
      LOCK.cred = {id: b64u(cred.rawId), at: Date.now()}; LS.set("budgie.lock", LOCK.cred); toast("Fingerprint lock is on"); return true;
    } catch (e) { toast(e && e.name === "NotAllowedError" ? "Fingerprint lock wasn't turned on" : "Couldn't set up the fingerprint lock: " + (e && e.message || e)); return false; }
  }
  // turning the lock off needs your fingerprint too
  async function lockDisable() {
    if (!(await lockCheck())) { toast("Fingerprint lock is still on"); return false; }
    LOCK.cred = null; LS.set("budgie.lock", null); LOCK.locked = false; showLock(false); toast("Fingerprint lock is off"); return true;
  }
  function showLock(on, waiting) {
    var el = $("#lock");
    ["#app", "#nav", "#sheets", "#toast"].forEach(function (q) { var x = $(q); if (!x) return; x.inert = !!on; if (on) x.setAttribute("aria-hidden", "true"); else x.removeAttribute("aria-hidden"); });
    if (!on) { if (el) el.remove(); return; }
    if (!el) { el = document.createElement("div"); el.id = "lock"; el.setAttribute("role", "dialog"); el.setAttribute("aria-label", "Budgie is locked"); document.body.appendChild(el); }
    el.innerHTML = '<div class="in"><img src="icon-192.png" alt="" width="72" height="72" style="border-radius:18px"><h1>Budgie is locked</h1>' + (waiting ? "" : '<button type="button" class="btn wide" data-a="unlock">Unlock with your fingerprint</button><p class="small" style="opacity:.8;margin-top:10px">Or your face or screen lock, whichever your phone uses.</p>') + "</div>";
  }
  // ask the phone to check it's you; true only if it says it did (flag 0x04 in its answer)
  async function lockCheck() {
    if (!lockOn()) return true;
    try {
      var a = await navigator.credentials.get({publicKey: {challenge: rnd(32), rpId: location.hostname, allowCredentials: [{type: "public-key", id: unb64u(LOCK.cred.id), transports: ["internal"]}], userVerification: "required", timeout: 60000}});
      var flags = a && a.response && a.response.authenticatorData ? new Uint8Array(a.response.authenticatorData)[32] : 0;
      return !!(a && (flags & 0x04));
    } catch (e) { if (e && e.name === "InvalidStateError") toast("This phone no longer knows Budgie's lock. Check your phone's passkeys."); return false; }
  }
  async function unlock() {
    if (LOCK.busy || !lockOn()) return;
    LOCK.busy = true;
    try { if (await lockCheck()) { LOCK.locked = false; showLock(false); render(); } else showLock(true); }
    finally { LOCK.busy = false; }
  }
  // once a peek ends, amounts still showing where the screen isn't drawn again (an open sheet, a toast, a form being
  // filled in) are covered too; what's typed into a box is left as it is
  function coverMoney() {
    ["#main", "#sheets", "#toast"].forEach(function (q) {
      var root = $(q); if (!root) return;
      var w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT), n;
      while ((n = w.nextNode())) { var v = MT(n.nodeValue); if (v !== n.nodeValue) n.nodeValue = v; }
      root.querySelectorAll("[aria-label],[title]").forEach(function (el) { ["aria-label", "title"].forEach(function (a) { var x = el.getAttribute(a); if (x !== null && MT(x) !== x) el.setAttribute(a, MT(x)); }); });
    });
  }
  function lockNow() { if (!lockOn()) return; LOCK.locked = true; showLock(true); }
  document.addEventListener("visibilitychange", function () {
    // a peek at the amounts (the eye) lasts until Budgie goes into the background, so coming back shows £•••• again
    if (document.visibilityState === "hidden" && S.ui.reveal) { S.ui.reveal = false; render(true); coverMoney(); }
    if (!lockOn()) return;
    if (document.visibilityState === "hidden") { LOCK.hiddenAt = Date.now(); if (!LOCK.locked) showLock(true, true); }
    else if (LOCK.locked || Date.now() - LOCK.hiddenAt > LOCK.GRACE) { LOCK.locked = true; render(); showLock(true); unlock(); }
    else showLock(false);
  });

  // ---------- start ----------
  function setDemo(on) {
    S.prefs.demo = on; S.prefs.easy = null; savePrefs();
    if (on) S.demo = {tables: window.BudgieDemo.make(todayIso()), me: "alex"};
    dirty(); applyTheme();
  }
  function connectFrom(text) {
    // a link Budgie won't use: say why (as a note too if this phone is already connected), and keep things as they were
    var refuse = function (msg) { S.lastError = msg; try { history.replaceState(null, "", location.pathname); } catch (e) {} render(); if (S.cfg) toast(msg); return false; };
    var m = String(text || "").match(/#connect=([A-Za-z0-9_\-=]+)/); if (!m) return refuse("That doesn't look like a connect link");
    var j;
    try { var b64 = m[1].replace(/-/g, "+").replace(/_/g, "/"); j = JSON.parse(decodeURIComponent(escape(atob(b64 + "===".slice((b64.length + 3) % 4))))); if (!j.u || !j.k) throw 0; }
    catch (e) { return refuse("That connect link didn't work. Copy it again from your sheet."); }
    // only ever talk to a Google Apps Script web app (or this computer while testing)
    var host = "", proto = ""; try { var U = new URL(j.u); host = U.hostname; proto = U.protocol; } catch (e) {}
    var local = /^(localhost|127\.0\.0\.1)$/.test(host) && /^(localhost|127\.0\.0\.1)$/.test(location.hostname);   // only while testing on a computer
    if (!(/^(script\.google\.com|script\.googleusercontent\.com)$/.test(host) && proto === "https:") && !local) return refuse("That connect link doesn't point at a Google Sheet, so Budgie won't use it.");
    if (!/^[0-9a-f]{64}$/.test(String(j.k))) return refuse("That link is for another app, not for Budgie itself.");
    var same = S.cfg && S.cfg.u === j.u && S.cfg.k === j.k;
    // a link to a different Google Sheet than the one this phone uses could be someone else's: ask first
    if (S.cfg && S.cfg.u !== j.u && !S.ui.connectOk) {
      S.ui.pendingLink = text;
      try { history.replaceState(null, "", location.pathname); } catch (e) {}
      render();
      openSheet('<h2>Switch to a different sheet?</h2><p class="muted">This link points to a different Google Sheet from the one Budgie uses on this phone. Only switch if you set up a new sheet yourself. A link from anyone else could send your details to them.</p>' + (S.data.queue.length ? '<p class="bad small" style="font-weight:600">' + S.data.queue.length + " change" + (S.data.queue.length === 1 ? " hasn't" : "s haven't") + " reached your sheet yet and would be lost.</p>" : "") + '<button type="button" class="btn ghost wide" data-a="sheetclose">Keep my sheet</button><button type="button" class="btn danger wide" style="margin-top:10px" data-a="connectswitch">Switch anyway</button>');
      return true;
    }
    S.ui.connectOk = false;
    // a new link for the same sheet (a new key, say): anything still waiting goes up once the sheet says it's the same person
    var waiting = S.data.queue.concat(S.data.carry && S.data.carry.queue || []), carry = !same && S.cfg && S.cfg.u === j.u && waiting.length && (S.data.me || (S.data.carry || {}).me) ? {me: S.data.me || S.data.carry.me, name: S.data.me ? person().name : S.data.carry.name, queue: waiting} : null;
    S.cfg = {u: j.u, k: j.k}; LS.set("budgie.cfg", S.cfg);
    // opening the same link again keeps anything still waiting to sync
    if (!same) { S.data = {tables: {}, since: 0, me: "", summary: null, queue: []}; if (carry) S.data.carry = carry; store.set("data", S.data); }
    dirty(); S.lastError = "";
    if (demoOn()) setDemo(false);
    try { history.replaceState(null, "", location.pathname); } catch (e) {}
    $("#main").innerHTML = '<p class="empty">Connecting to your sheet…</p>';
    sync(true).then(function () { if (S.data.me) toast("Connected. Hi " + person().name + "!" + (S.ui.carryNote ? " " + S.ui.carryNote : "")); S.ui.carryNote = ""; go("today"); });
    return true;
  }
  // ---------- Budgie's new home ----------
  // Budgie used to live at alertrobot.github.io/budgie, next to Peckish and Caledonite. It now has a web address of
  // its own, so nothing else can read its data. Opening the old address offers to carry this phone across: it sends
  // anything waiting, opens the new address with this phone's connect link, then wipes Budgie's copy at the old one.
  var HOME = "https://budgie-money.github.io/";
  var isOldHome = function () { return /^alertrobot\.github\.io$/i.test(location.hostname); };
  function movedScreen() {
    $("#top").innerHTML = '<div class="t"><div class="sub">Budgie</div><h1>Budgie has moved</h1></div>'; $("#nav").innerHTML = "";
    $("#main").innerHTML = card('<h2 style="font-size:20px">A new home, just for Budgie</h2><p class="muted">Budgie now lives at <b>budgie-money.github.io</b>, on its own, so no other app can read your money. Your data is safe in your Google Sheet; this just moves this phone across.</p>' +
      (S.cfg ? '<button type="button" class="btn wide" data-a="moveme">Move this phone across</button><p class="tiny muted" style="margin:8px 0 0">Anything waiting to sync goes first. Then Budgie opens at its new address, signed in, and clears its old copy here. Afterwards, add the new Budgie to your home screen and remove the old one' + (lockOn() ? ", and turn the fingerprint lock back on in Settings" : "") + ".</p>" : '<a class="btn wide" style="display:flex;align-items:center;justify-content:center;text-decoration:none" href="' + HOME + '">Open the new Budgie</a>'));
  }
  async function moveMe() {
    if (lockOn() && !(await lockCheck())) { toast("Budgie needs to check it's you first"); return; }
    toast("Sending anything waiting…");
    S.prefs.demo = false;   // (Show and tell left on here would stop anything being sent; it isn't saved, as this copy is wiped)
    for (var i = 0; i < 5 && S.data.queue.length; i++) { await sync(false); if (S.data.queue.length) await new Promise(function (r) { setTimeout(r, 1500); }); }
    // (what the sheet said, when it answered: a link whose key has been changed can't move across, whatever the signal)
    if (S.data.queue.length) { toast(S.lastError && !/^Offline/.test(S.lastError) ? S.lastError : "Couldn't reach your sheet yet. Try again when you have signal."); return; }
    var link = HOME + "#connect=" + btoa(unescape(encodeURIComponent(JSON.stringify({u: S.cfg.u, k: S.cfg.k})))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    // wipe the old copy so nothing at this address can read it. From here nothing is saved at this address again, and
    // a sync still on its way (one fetching everything again after a refused change, say) is dropped when it answers
    wiped = true; clearTimeout(syncTimer); S.cfg = null;
    try { Object.keys(localStorage).forEach(function (k) { if (/^budgie\./.test(k)) localStorage.removeItem(k); }); } catch (e) {}
    try { if (store.db) store.db.close(); indexedDB.deleteDatabase("budgie"); } catch (e) {}
    try { (await caches.keys()).forEach(function (k) { if (/^budgie-/.test(k)) caches.delete(k); }); } catch (e) {}
    try { (await navigator.serviceWorker.getRegistrations()).forEach(function (r) { if (/\/budgie\//.test(r.scope)) r.unregister(); }); } catch (e) {}
    location.replace(link);
  }

  async function start() {
    if (isOldHome()) {
      // only open the old copy if there's a phone to move, so a visit after moving leaves nothing behind
      if (S.cfg) { await store.open(); var old = await store.get("data"); if (old && old.tables) S.data = Object.assign(S.data, old); }
      document.addEventListener("click", function (e) { var el = e.target.closest('[data-a="moveme"]'); if (el) moveMe(); }); movedScreen(); return;
    }
    await store.open();
    var saved = await store.get("data"); if (saved && saved.tables) S.data = Object.assign(S.data, saved);
    if (S.prefs.demo) setDemo(true);
    if (lockOn()) { lockNow(); unlock(); }
    setInterval(function () { if (document.visibilityState === "visible") sync(false); }, 60000);
    document.addEventListener("visibilitychange", function () { if (document.visibilityState === "visible") { sync(false); render(true); } });
    window.addEventListener("online", function () { sync(false); });
    if (window.matchMedia) matchMedia("(prefers-color-scheme: dark)").addEventListener("change", applyTheme);
    if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(function () {});
    try { history.replaceState({b: 0}, ""); } catch (e) {}
    if (location.hash.indexOf("#connect=") >= 0 && connectFrom(location.hash)) return;
    // long-press the app icon: Log a payment, Payday, Today
    var jump = (location.search.match(/[?&]go=([a-z]+)/) || [])[1];
    if (jump) { try { history.replaceState({b: 0}, "", location.pathname); } catch (e) {} }
    render();
    if (jump && me() && (jump === "add" || jump === "payday" || TABS.indexOf(jump) >= 0) && jump !== "today") go(jump);
    sync(false);
  }
  window.BudgieApp = {S: S, db: db, render: render, go: go, sync: sync, setDemo: setDemo};
  start();
})();
