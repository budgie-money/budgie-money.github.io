/* Budgie engine: works everything out from the rules in the Budgie data sheet.
   The same file runs in the phone app and in Apps Script, so they always agree.
   Dates are "YYYY-MM-DD" strings. Money is pounds (numbers). No side effects. */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.Budgie = factory();
})(this, function () {
  "use strict";
  var VERSION = "1.4.17";

  // ---------- dates ----------
  function D(s) { var p = String(s).split("-"); return new Date(Date.UTC(+p[0], +p[1] - 1, +p[2])); }
  function S(d) { return d.getUTCFullYear() + "-" + pad(d.getUTCMonth() + 1) + "-" + pad(d.getUTCDate()); }
  function pad(n) { return (n < 10 ? "0" : "") + n; }
  function isIso(s) { return /^\d{4}-\d{2}-\d{2}$/.test(String(s || "")); }
  function addDays(s, n) { var d = D(s); d.setUTCDate(d.getUTCDate() + n); return S(d); }
  function ymd(y, m, d) { return S(new Date(Date.UTC(y, m, d))); }       // m is 0-based and may overflow
  function daysIn(y, m) { return new Date(Date.UTC(y, m + 1, 0)).getUTCDate(); }
  function dow(s) { return D(s).getUTCDay(); }                              // 0 Sunday
  function diff(a, b) { return Math.round((D(b) - D(a)) / 86400000); }      // b - a in days
  function minS(a, b) { return a < b ? a : b; }
  function maxS(a, b) { return a > b ? a : b; }
  var MON = {jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11};
  var WD = {sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6};
  function parseDate(x) {
    if (x === null || x === undefined || x === "") return "";
    if (x instanceof Date) return S(new Date(Date.UTC(x.getFullYear(), x.getMonth(), x.getDate())));
    var s = String(x).trim();
    // a day that isn't in its month (31/02/2027, or 2027-02-30 typed into the sheet) isn't a date
    var ok = function (y, mo, d) { return mo >= 0 && mo < 12 && d >= 1 && d <= daysIn(y, mo) ? ymd(y, mo, d) : ""; };
    if (isIso(s)) return ok(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10));
    var m = s.match(/^(\d{1,2})[\/.](\d{1,2})[\/.](\d{4})$/); if (m) return ok(+m[3], +m[2] - 1, +m[1]);
    m = s.match(/^(?:[a-z]+,?\s+)?(\d{1,2})(?:st|nd|rd|th)?\s+([a-z]{3})[a-z]*\.?\s+(\d{4})$/i); if (m && MON[m[2].toLowerCase()] !== undefined) return ok(+m[3], MON[m[2].toLowerCase()], +m[1]);
    return "";
  }

  // ---------- UK (England and Wales) bank holidays ----------
  var bhCache = {};
  function easter(y) {
    var a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25),
      g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4,
      l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451), mo = Math.floor((h + l - 7 * m + 114) / 31), da = ((h + l - 7 * m + 114) % 31) + 1;
    return ymd(y, mo - 1, da);
  }
  function nthWeekday(y, m, wd, n) { // n = 1..5, or -1 for last
    if (n > 0) { var first = ymd(y, m, 1), off = (wd - dow(first) + 7) % 7; var d = 1 + off + (n - 1) * 7; return d <= daysIn(y, m) ? ymd(y, m, d) : ""; }
    var last = ymd(y, m, daysIn(y, m)); return addDays(last, -((dow(last) - wd + 7) % 7));
  }
  function bankHolidays(y) {
    if (bhCache[y]) return bhCache[y];
    var set = {}, add = function (s) { set[s] = true; };
    var ny = ymd(y, 0, 1); add(dow(ny) === 6 ? addDays(ny, 2) : dow(ny) === 0 ? addDays(ny, 1) : ny);
    var e = easter(y); add(addDays(e, -2)); add(addDays(e, 1));
    add(nthWeekday(y, 4, 1, 1)); add(nthWeekday(y, 4, 1, -1)); add(nthWeekday(y, 7, 1, -1));
    var xm = ymd(y, 11, 25), bx = ymd(y, 11, 26), wx = dow(xm);
    if (wx === 6) { add(ymd(y, 11, 27)); add(ymd(y, 11, 28)); }
    else if (wx === 0) { add(bx); add(ymd(y, 11, 27)); }
    else if (wx === 5) { add(xm); add(ymd(y, 11, 28)); }
    else { add(xm); add(bx); }
    bhCache[y] = set; return set;
  }
  function isWorkingDay(s) { var w = dow(s); return w !== 0 && w !== 6 && !bankHolidays(+s.slice(0, 4))[s]; }
  function shiftDay(s, how) {
    how = String(how || "").toLowerCase();
    if (!how || isWorkingDay(s)) return s;
    var step = /prev|before|earlier/.test(how) ? -1 : /next|after|later/.test(how) ? 1 : 0;
    if (!step) return s;
    var d = s; while (!isWorkingDay(d)) d = addDays(d, step); return d;
  }

  // ---------- schedules ----------
  // "15", "last", "last working day", "last friday", "1st monday", "first working day"
  function dayInMonth(y, m, on, fallbackDay) {
    var t = String(on === undefined || on === null || on === "" ? fallbackDay : on).toLowerCase().trim();
    var n = parseInt(t, 10), dim = daysIn(y, m);
    if (/^\d+(st|nd|rd|th)?$/.test(t)) return ymd(y, m, Math.min(n, dim));
    if (t === "last" || t === "last day") return ymd(y, m, dim);
    if (/last working/.test(t)) { var d = ymd(y, m, dim); while (!isWorkingDay(d)) d = addDays(d, -1); return d; }
    if (/first working/.test(t)) { var f = ymd(y, m, 1); while (!isWorkingDay(f)) f = addDays(f, 1); return f; }
    var mm = t.match(/^(last|first|1st|second|2nd|third|3rd|fourth|4th)\s+([a-z]{3})/);
    if (mm && WD[mm[2]] !== undefined) {
      var k = {last: -1, first: 1, "1st": 1, second: 2, "2nd": 2, third: 3, "3rd": 3, fourth: 4, "4th": 4}[mm[1]];
      return nthWeekday(y, m, WD[mm[2]], k);
    }
    return ymd(y, m, Math.min(isNaN(n) ? 1 : n, dim));
  }
  // raw dates an item is scheduled on, in [from, to)
  function scheduleDates(it, from, to) {
    var out = [], unit = String(it.unit || "month").toLowerCase(), every = Math.max(1, +it.every || 1);
    var start = it.start || from, end = it.end || "";
    var stop = end ? minS(addDays(end, 1), to) : to;
    var push = function (d) { if (d && d >= from && d < stop && d >= start && out.indexOf(d) < 0) out.push(d); };
    if (unit === "once") push(start);
    else if (unit === "dates") String(it.dates || "").split(/[,;\n]+/).map(parseDate).filter(Boolean).forEach(push);
    else if (unit === "day" || unit === "days") { var k0 = Math.max(0, Math.floor(diff(start, from) / every)); for (var d = addDays(start, k0 * every); d < stop; d = addDays(d, every)) push(d); }
    else if (unit === "week" || unit === "weeks") {
      var step = 7 * every, k = Math.max(0, Math.floor(diff(start, from) / step));
      for (var w = addDays(start, k * step); w < stop; w = addDays(w, step)) push(w);
    } else if (unit === "year" || unit === "years") {
      var sy = +start.slice(0, 4), smo = +start.slice(5, 7) - 1;
      for (var y = Math.max(sy, +from.slice(0, 4) - 1); y <= +to.slice(0, 4); y++) if ((y - sy) % every === 0) push(dayInMonth(y, smo, it.on, +start.slice(8, 10)));
    } else { // month
      var y0 = +start.slice(0, 4), m0 = +start.slice(5, 7) - 1, fy = +from.slice(0, 4), fm = +from.slice(5, 7) - 1;
      var idx = Math.max(0, (fy - y0) * 12 + (fm - m0) - 1), limit = (+to.slice(0, 4) - y0) * 12 + (+to.slice(5, 7) - 1 - m0) + 1;
      idx = idx - (idx % every);
      for (; idx <= limit; idx += every) { var yy = y0 + Math.floor((m0 + idx) / 12), mo = (m0 + idx) % 12; push(dayInMonth(yy, mo, it.on, +start.slice(8, 10))); }
    }
    // two dates that shift onto the same working day are still two payments
    return out.sort().map(function (d) { return shiftDay(d, it.shift); }).sort();
  }
  // the amount an item has on a date, using dated changes from the amounts table
  function amountAt(db, it, date) {
    var best = null;
    (db.byItem.amounts[it.id] || []).forEach(function (a) { if (a.start && a.start <= date && (!best || a.start >= best.start)) best = a; });
    return best ? best.amount : (+it.amount || 0);
  }
  // occurrences with exceptions applied: [{key, item, orig, date, amount, changed}]
  function occurrences(db, it, from, to) { return it.id ? memo(db, "occ|" + it.id + "|" + from + "|" + to, function () { return occ0(db, it, from, to); }) : occ0(db, it, from, to); }
  function occ0(db, it, from, to) {
    var raw = scheduleDates(it, addDays(from, -45), addDays(to, 45)), ex = db.byItem.exceptions[it.id] || [], out = [], seen = {};
    raw.forEach(function (orig) {
      var n = seen[orig] = (seen[orig] || 0) + 1;
      var o = {key: it.id + "@" + orig + (n > 1 ? "#" + n : ""), item: it, orig: orig, date: orig, amount: amountAt(db, it, orig), changed: false, skipped: false};
      ex.forEach(function (x) {
        if (x.date !== orig) return;
        var a = String(x.action || "").toLowerCase();
        if (a === "skip") o.skipped = true;
        if (a === "move" && x.newDate) { o.date = x.newDate; o.changed = true; }
        if ((a === "amount" || a === "actual") && x.amount !== "" && x.amount !== null && !isNaN(+x.amount)) { o.amount = +x.amount; o.changed = true; o.actual = true; }
      });
      if (!o.skipped && o.date >= from && o.date < to) out.push(o);
    });
    // extra one-off occurrences added as exceptions ("add")
    ex.forEach(function (x) { if (String(x.action).toLowerCase() === "add" && x.newDate >= from && x.newDate < to) out.push({key: it.id + "+" + x.newDate, item: it, orig: x.newDate, date: x.newDate, amount: x.amount !== "" ? +x.amount : amountAt(db, it, x.newDate), changed: true}); });
    return out.sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : 0; });
  }

  // results are cached per loaded data set (the data never changes after load)
  // a value asked for while it's still being worked out (the first tracked month looking back) gets the fallback
  var BUSY = {};
  // a map keyed by ids or names with no built-in keys, so an account or payment called "constructor" or "valueOf"
  // (typed into the sheet) is only ever itself
  function dict() { return Object.create(null); }
  function memo(db, key, fn, fallback) {
    var c = db._c; if (!c) return fn();
    if (Object.prototype.hasOwnProperty.call(c, key)) return c[key] === BUSY ? (typeof fallback === "function" ? fallback() : fallback) : c[key];
    c[key] = BUSY; try { c[key] = fn(); } catch (e) { delete c[key]; throw e; } return c[key];
  }

  // ---------- loading ----------
  var NUM = ["amount", "every", "order", "target", "repay", "newAmount", "extra", "price", "limit", "cost"];
  var DATE = ["start", "end", "date", "newDate", "due", "repayFrom"];
  var BOOL = ["deleted", "isPay", "fallback", "carry", "variable", "bought"];
  function toBool(v) { return v === true || /^(true|yes|y|1)$/i.test(String(v || "").trim()); }
  function clean(row) {
    var r = {};
    Object.keys(row).forEach(function (k) {
      var v = row[k];
      if (NUM.indexOf(k) >= 0) r[k] = v === "" || v === null || v === undefined ? "" : (typeof v === "number" ? v : +String(v).replace(/[£,\s]/g, "") || 0);
      else if (DATE.indexOf(k) >= 0) r[k] = parseDate(v);
      else if (BOOL.indexOf(k) >= 0) r[k] = toBool(v);
      else r[k] = v === null || v === undefined ? "" : (typeof v === "string" ? v.trim() : v);
    });
    return r;
  }
  var TABLES = ["people", "accounts", "income", "bills", "budgets", "splits", "transfers", "transactions", "moves", "settlements", "loans", "goals", "valuations", "amounts", "exceptions", "settings", "gifts", "prices", "meta"];
  // today (optional): money already in pots only counts for periods that have started
  function load(tables, today) {
    // (lookups by id have no built-in keys, so an id like "constructor" or "__proto__" is only ever that row)
    var db = {byItem: {amounts: Object.create(null), exceptions: Object.create(null)}, byId: Object.create(null), _c: {}, today: today || ""};
    TABLES.forEach(function (t) { db[t] = (tables[t] || []).map(clean).filter(function (r) { return !r.deleted && (t === "meta" || t === "settings" || r.id); }); });
    db.amounts.forEach(function (a) { (db.byItem.amounts[a.item] = db.byItem.amounts[a.item] || []).push(a); });
    db.exceptions.forEach(function (x) { (db.byItem.exceptions[x.item] = db.byItem.exceptions[x.item] || []).push(x); });
    db.accounts.sort(function (a, b) { return (+a.order || 99) - (+b.order || 99); });
    ["accounts", "income", "bills", "budgets", "splits", "transfers", "loans", "goals", "people"].forEach(function (t) { db[t].forEach(function (r) { db.byId[r.id] = r; }); });
    // (no built-in keys either: a setting typed in for a person or key called "__proto__" or "constructor" is just a setting)
    db.set = Object.create(null);
    db.settings.forEach(function (s) { var p = s.person || "all"; (db.set[p] = db.set[p] || Object.create(null))[s.key] = s.value; });
    // a payday move ticked twice (in the app and by the bank feed) counts once: the latest one
    var payTick = {};
    db.moves.forEach(function (m) { if (!/^pay:/.test(m.key || "")) return; var k = m.person + "|" + m.key, c = payTick[k]; if (!c || (+m.updated || 0) >= (+c.updated || 0)) payTick[k] = m; });
    db.moves.forEach(function (m) { if (/^pay:/.test(m.key || "") && payTick[m.person + "|" + m.key] !== m) m.dup = true; });
    db.moveKeys = dict(); db.moveKeysBy = dict(); db.moveTicks = dict();
    db.moves.forEach(function (m) { if (m.key && !m.dup) { db.moveKeys[m.key] = (db.moveKeys[m.key] || 0) + (+m.amount || 0) + 1e-9; var pk = m.person + "|" + m.key; db.moveKeysBy[pk] = (db.moveKeysBy[pk] || 0) + (+m.amount || 0) + 1e-9; (db.moveTicks[pk] = db.moveTicks[pk] || []).push(m); } });
    // a LISA payment copied from the provider's statement that is the same money as a move ticked in Budgie
    // (same account and amount, within 5 days) only counts once
    db.moves.forEach(function (m) {
      if (!/^lisa:in/.test(m.key || "") || !m.to) return;
      m.dup = db.moves.some(function (o) { return o !== m && !o.dup && !/^lisa:/.test(o.key || "") && o.to === m.to && Math.abs((+o.amount || 0) - (+m.amount || 0)) < 0.005 && Math.abs(diff(o.date, m.date)) <= 5; });
    });
    db.settleKeys = dict();
    db.settlements.forEach(function (s) { if (s.key) db.settleKeys[s.key] = true; });
    // yearly costs: a bill that comes round every 3 months or more has money set aside for it each pay period,
    // unless setAside is turned off ("FALSE"); left blank, it follows the schedule
    db.bills.forEach(function (b) { b.setAside = b.setAside === undefined || b.setAside === null || b.setAside === "" ? longRepeat(b) : toBool(b.setAside); });
    return db;
  }
  // a schedule that repeats every 3 months (12 weeks) or more
  function longRepeat(it) {
    var u = String(it.unit || "month").toLowerCase(), e = Math.max(1, +it.every || 1);
    if (u === "year" || u === "years") return true;
    if (u === "month" || u === "months" || u === "") return e >= 3;
    if (u === "week" || u === "weeks") return e >= 12;
    if (u === "day" || u === "days") return e >= 84;
    if (u === "dates") {
      var ds = uniqSorted(String(it.dates || "").split(/[,;\n]+/).map(parseDate).filter(Boolean));
      if (ds.length < 2) return false;
      for (var i = 1; i < ds.length; i++) if (diff(ds[i - 1], ds[i]) < 84) return false;
      return true;
    }
    return false;   // once
  }
  var NO_SETTINGS = Object.freeze(Object.create(null));
  function setting(db, person, key, dflt) { var v = (db.set[person] || NO_SETTINGS)[key]; if (v === undefined || v === "") v = (db.set.all || NO_SETTINGS)[key]; return v === undefined || v === "" ? dflt : v; }
  function person(db, id) { return db.byId[id] || {id: id, name: id}; }
  function partnerOf(db, p) { var me = person(db, p); if (me.partner) return me.partner; var o = db.people.filter(function (x) { return x.id !== p; })[0]; return o ? o.id : ""; }
  function accountsOf(db, p) { return db.accounts.filter(function (a) { return a.owner === p; }); }
  function mainOf(db, p) { var a = accountsOf(db, p); return (a.filter(function (x) { return x.kind === "main"; })[0] || a[0] || {id: p + "-main"}).id; }
  function fallbackOf(db, p) { var a = accountsOf(db, p).filter(function (x) { return x.fallback; })[0]; return a ? a.id : ""; }
  function accName(db, id) { var a = db.byId[id]; return a ? a.name : (id || ""); }
  function startOf(db, p) { return setting(db, p, "start", "2026-10-26"); }
  // what one person has ticked off under a key (a move is always its own person's, so the other one's moves never
  // tick off something of yours, whatever key they carry)
  function ticked(db, p, key) { return db.moveKeysBy[p + "|" + key] || 0; }
  // the same, counting only moves dated before a day (the ones a balance at the end of the day before includes)
  function tickedBefore(db, p, key, date) { var t = 0; (db.moveTicks[p + "|" + key] || []).forEach(function (m) { if (m.date < date) t += (+m.amount || 0) + 1e-9; }); return t; }
  // the day a ticked move should be dated: payday moves belong to their payday, everything else to the day you tick it.
  // A payday move ticked once a new tax year has begun (March's LISA money moved on 7 April) is dated the day it moved,
  // as the bank feed dates it, so it counts towards the tax year it really went in
  function moveDate(key, today) { var m = String(key || "").match(/^pay:(\d{4}-\d{2}-\d{2}):/); return m && m[1] <= today && taxYearStart(m[1]) === taxYearStart(today) ? m[1] : today; }
  // to the penny, halves away from zero, without the float slips (1.005 is £1.01, and -0.005 is -£0.01)
  var round = function (n) { n = +n || 0; var a = Math.round(Math.abs(n) * 100 + 1e-7) / 100; return n < 0 && a ? -a : a; };

  // ---------- splits ----------
  // "ethan:2, sophie:1" (parts) or "sophie=400" (fixed amount; anyone else shares the rest)
  function shareOf(db, splitId, who, amount, payer) {
    if (!splitId) return who === payer ? amount : 0;
    var sp = db.byId[splitId], txt = sp ? sp.shares : (splitId === "half" ? "" : splitId);
    var people = db.people.map(function (x) { return x.id; });
    if (!txt || /^half$/i.test(txt)) return people.indexOf(who) >= 0 ? amount / Math.max(1, people.length) : 0;
    var fixed = dict(), parts = dict(), rest = amount;
    String(txt).split(/[,;]+/).forEach(function (bit) {
      var m = bit.trim().match(/^([a-z0-9_-]+)\s*([:=])\s*([\d.]+)$/i); if (!m) return;
      if (m[2] === "=") { fixed[m[1].toLowerCase()] = +m[3]; } else parts[m[1].toLowerCase()] = +m[3];
    });
    Object.keys(fixed).forEach(function (k) { fixed[k] = Math.min(fixed[k], Math.max(0, rest)); rest -= fixed[k]; });
    if (fixed[who] !== undefined) return fixed[who];
    var others = people.filter(function (x) { return fixed[x] === undefined; }), tot = 0;
    others.forEach(function (x) { tot += parts[x] !== undefined ? parts[x] : (Object.keys(parts).length ? 0 : 1); });
    var mine = parts[who] !== undefined ? parts[who] : (Object.keys(parts).length ? 0 : 1);
    return tot ? rest * mine / tot : 0;
  }

  // ---------- pay periods ----------
  function payDates(db, p, from, to) {
    var out = [];
    db.income.filter(function (i) { return i.person === p && i.isPay; }).forEach(function (i) { occurrences(db, i, from, to).forEach(function (o) { out.push(o.date); }); });
    return uniqSorted(out);
  }
  function uniqSorted(a) { var s = a.slice().sort(), out = []; for (var i = 0; i < s.length; i++) if (!i || s[i] !== s[i - 1]) out.push(s[i]); return out; }
  var MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  function periodName(start, next) { var mid = addDays(start, Math.min(14, Math.floor(diff(start, next) / 2))); return MONTHS[+mid.slice(5, 7) - 1] + " " + mid.slice(0, 4); }
  // pay periods covering [from, to): [{start, next, name, pay}]
  function periods(db, p, from, to) { return memo(db, "per|" + p + "|" + from + "|" + to, function () { return per0(db, p, from, to); }); }
  function per0(db, p, from, to) {
    var st = startOf(db, p), pays = payDates(db, p, addDays(from, -70), addDays(to, 70)), out = [];
    // no pay at all (yet): monthly periods on the day tracking started
    var bounds = pays;
    if (!bounds.length && !db.income.some(function (i) { return i.person === p && i.isPay; })) {
      bounds = []; var sd = +st.slice(8, 10), y1 = +from.slice(0, 4), m1 = +from.slice(5, 7) - 3, n = (+to.slice(0, 4) - y1) * 12 + (+to.slice(5, 7) - 1) - m1 + 3;
      for (var k = 0; k <= n; k++) { var dd = dayInMonth(y1 + Math.floor((m1 + k) / 12), ((m1 + k) % 12 + 12) % 12, sd); if (bounds.indexOf(dd) < 0) bounds.push(dd); }
      bounds.sort();
    }
    var before = bounds.filter(function (d) { return d <= from; }), first = before.length ? before[before.length - 1] : "";
    var list = (first ? [first] : []).concat(bounds.filter(function (d) { return d > from; }));
    if (!first) {
      if (st <= from) list.unshift(st);
      else {
        // before tracking starts: a period that ends where tracking starts, so it never overlaps the first tracked one
        if (!list.length || st < list[0]) list.unshift(st);
        list.unshift(ymd(+from.slice(0, 4), +from.slice(5, 7) - 1, 1));
      }
    }
    list = uniqSorted(list);
    // the opening part-period: tracking started inside it, or on its first day when that isn't a payday
    var isPay = {}; pays.forEach(function (d) { isPay[d] = true; });
    var isOpening = function (s, nx) { return (s < st && st < nx) || (s === st && !isPay[st]); };
    for (var i = 0; i < list.length - 1; i++) { if (list[i] >= to) break; if (list[i + 1] <= from) continue; out.push({start: list[i], next: list[i + 1], name: periodName(list[i], list[i + 1]), pay: !!isPay[list[i]], opening: isOpening(list[i], list[i + 1])}); }
    if (!out.length) { var n = list[list.length - 1] || from; out.push({start: n, next: addDays(n, 30), name: periodName(n, addDays(n, 30)), pay: pays.indexOf(n) >= 0}); }
    return out;
  }
  // every tracked pay period that starts before a date, from one list worked out once
  function trackedList(db, p) { var st = startOf(db, p); return memo(db, "tper|" + p, function () { return periods(db, p, st, addDays(maxS(db.today || st, st), 1100)); }); }
  function trackedBefore(db, p, date) {
    var st = startOf(db, p);
    var all = trackedList(db, p);
    var last = all[all.length - 1];
    var list = last && date <= last.next ? all : periods(db, p, st, date);
    return list.filter(function (pk) { return pk.start < date && pk.next > st; });
  }
  function periodAt(db, p, date) { var ps = periods(db, p, date, addDays(date, 1)); return ps[ps.length - 1]; }
  function prevPeriod(db, p, per) { return periodAt(db, p, addDays(per.start, -1)); }
  function nextPeriod(db, p, per) { return periodAt(db, p, per.next); }

  // ---------- spending ----------
  // a budget's start, end and dated amounts are matched against the middle of the pay period, so a period that
  // begins a few days early (pay moved for a weekend or Christmas) still gets the right budgets
  function midOf(per) { return addDays(per.start, Math.floor(Math.max(0, diff(per.start, per.next)) / 2)); }
  function activeIn(b, per) { var mid = midOf(per); return (!b.start || b.start <= mid) && (!b.end || b.end >= mid); }
  function budgetsOf(db, p, per) {
    return db.budgets.filter(function (b) { return b.person === p && activeIn(b, per); });
  }
  function sameBudget(db, b, txn) {
    if (txn.budget === b.id) return true;
    var tb = db.byId[txn.budget];
    return !!tb && tb.person !== b.person && String(tb.name).toLowerCase() === String(b.name).toLowerCase();
  }
  // my share of a logged payment, to the penny as between() settles it: the share of the one who didn't pay is
  // rounded, and the one who paid has the rest (so the two shares add up to what was paid, and to what's settled)
  function myShare(db, p, txn) {
    var amt = +txn.amount || 0;
    if (!txn.split) return txn.person === p ? amt : 0;
    if (txn.person !== p) return round(shareOf(db, txn.split, p, amt, txn.person));
    var rest = amt; db.people.forEach(function (x) { if (x.id !== p) rest -= round(shareOf(db, txn.split, x.id, amt, p)); });
    return rest;
  }
  // running totals per budget, so adding up a month is two lookups however many years of payments there are
  function spendIndex(db, p, b) {
    return memo(db, "si|" + p + "|" + b.id, function () {
      var list = db.transactions.filter(function (x) { return sameBudget(db, b, x); }).map(function (x) { return [x.date, myShare(db, p, x)]; }).filter(function (x) { return x[1]; }).sort(function (a, c) { return a[0] < c[0] ? -1 : a[0] > c[0] ? 1 : 0; });
      var dates = [], cum = [0]; list.forEach(function (x, i) { dates.push(x[0]); cum.push(cum[i] + x[1]); });
      return {dates: dates, cum: cum};
    });
  }
  function lowerBound(a, v) { var lo = 0, hi = a.length; while (lo < hi) { var m = (lo + hi) >> 1; if (a[m] < v) lo = m + 1; else hi = m; } return lo; }
  function spentOn(db, p, b, from, to) { var ix = spendIndex(db, p, b); return round(ix.cum[lowerBound(ix.dates, to)] - ix.cum[lowerBound(ix.dates, from)]); }
  // budget amount for a period, prorated for the first period after tracking starts
  function budgetAmount(db, b, per) {
    // the first part-period can start from what's really in the pots: settings "opening.<budget id>"
    if (per.opening) { var o = setting(db, b.person, "opening." + b.id, ""); if (o !== "" && !isNaN(+o)) return round(+o); }
    var a = amountAt(db, b, midOf(per)), st = startOf(db, b.person);
    // the first part-period, when tracking starts: only the days that are left (a short stub counts against a typical month)
    if (per.start <= st && st < per.next) a = a * diff(st, per.next) / Math.max(28, diff(per.start, per.next));
    return round(a);
  }
  var SPEND = {daily: 1, weekly: 1, oneoff: 1, remainder: 1};
  function savingKind(db, acc) { return /saving|isa|lisa|pension/.test((db.byId[acc] || {}).kind || ""); }
  function isSpend(db, b) { var m = b.mode || "daily"; return !!SPEND[m] && !(m === "remainder" && savingKind(db, b.account)); }
  // carry-over and overspend per budget, walking periods from tracking start
  function budgetState(db, p, per) { return memo(db, "bs|" + p + "|" + per.start, function () { return bs0(db, p, per); }, {}); }
  // one pay period at a time, building on the one before
  function bs0(db, p, per) {
    var st = startOf(db, p), res = dict();
    if (per.next <= st) return res;
    var pv = per.start > st ? prevPeriod(db, p, per) : null, prev = pv && pv.start < per.start ? budgetState(db, p, pv) : dict();
    var plan = planFor(db, p, per);
    budgetsOf(db, p, per).forEach(function (b) {
      if (!isSpend(db, b)) return;
      var amt = b.mode === "remainder" ? plan.remainder : budgetAmount(db, b, per);
      // only budgets marked carry keep what's unspent (up to one month's worth); "whatever is left" never piles up
      var carries = b.carry === true && b.mode !== "oneoff" && b.mode !== "remainder";
      var carryIn = carries ? ((prev[b.id] || {}).carryOut || 0) : 0;
      var spent = spentOn(db, p, b, maxS(per.start, st), per.next);
      var avail = amt + carryIn, over = Math.max(0, spent - avail);
      // what's unspent carries on (up to one month's worth) only for budgets marked carry
      var carryOut = carries ? Math.min(Math.max(0, avail - spent), Math.max(amt, budgetAmount(db, b, {start: per.next, next: addDays(per.next, 30)}))) : 0;
      res[b.id] = {budget: b, period: per, amount: amt, carryIn: round(carryIn), spent: spent, avail: round(avail), left: round(avail - spent), over: round(over), carryOut: round(carryOut), current: true};
    });
    return res;
  }
  // what was in each account at the start of the day tracking started (a balance checked that day, less what
  // happened that day, so payday on the first day isn't counted twice)
  function startBalances(db, p) {
    return memo(db, "sb|" + p, function () {
      var st = startOf(db, p), res = Object.assign(dict(), balances(db, st));
      flows(db, addDays(st, -1), st).forEach(function (f) { if (res[f.account] !== undefined) res[f.account] = round(res[f.account] - f.amount); });
      return res;
    });
  }

  // ---------- yearly costs (sinking funds) ----------
  // a pot (not the fallback one) or the main account can hold money set aside for a bill
  function holdsSetAside(db, p, acc) { var a = db.byId[acc]; return acc === mainOf(db, p) || (!!a && a.owner === p && a.kind === "pot" && !a.fallback); }
  function setAsideBills(db, p) { return memo(db, "sab|" + p, function () { return db.bills.filter(function (b) { return b.person === p && b.setAside && holdsSetAside(db, p, b.account || mainOf(db, p)); }); }); }
  // the first occurrence of a bill on or after a date (from one list worked out once per bill)
  function nextOcc(db, b, from) {
    var st = startOf(db, b.person), horizon = addDays(maxS(db.today || st, st), 2200);
    var list = from > addDays(horizon, -1500) ? occurrences(db, b, from, addDays(from, 1500)) : memo(db, "bocc|" + b.id, function () { return occurrences(db, b, addDays(st, -1), horizon); });
    for (var i = lowerBound(list.map(function (o) { return o.date; }), from); i < list.length; i++) if (list[i].amount > 0) return list[i];
    return null;
  }
  // how many pay periods from this one up to and including the one a date falls in
  function periodsUntil(db, p, per, date) {
    var all = trackedList(db, p), last = all[all.length - 1];
    if (!last || date >= last.next) return periods(db, p, per.start, addDays(date, 1)).length;
    var starts = memo(db, "tpst|" + p, function () { return all.map(function (pk) { return pk.start; }); });
    return Math.max(1, lowerBound(starts, addDays(date, 1)) - lowerBound(starts, per.start));
  }

  // ---------- the plan for one pay period ----------
  // lines: {kind: in|bill|spend|save|topup|remainder, name, amount, account, date, id}
  // a yearly cost adds {kind: "save", setAside: true, bill, name: "Set aside for …", amount, account, due} each pay
  // period until it's due, and {kind: "in", setAside: true, bill, name: "Saved up for …"} when it lands
  function planFor(db, p, per, noTopup) { return memo(db, "plan|" + p + "|" + per.start + "|" + per.next + "|" + (noTopup ? 1 : 0), function () { return plan0(db, p, per, noTopup); }, function () { return planFor(db, p, per, true); }); }
  function plan0(db, p, per, noTopup) {
    var lines = [], partner = partnerOf(db, p), main = mainOf(db, p), st = startOf(db, p), from = per.start, to = per.next;
    var live = function (d) { return d >= st; };
    db.income.filter(function (i) { return i.person === p; }).forEach(function (i) {
      occurrences(db, i, from, to).forEach(function (o) {
        if (!live(o.date)) return;
        lines.push({kind: "in", name: i.name, amount: o.amount, account: i.account || main, date: o.date, id: i.id, occ: o.key, isPay: i.isPay, actual: !!o.actual});
        // money paid straight into a savings account (say, family topping up a LISA) is saved, not spendable
        if (i.account && i.account !== main && savingKind(db, i.account)) lines.push({kind: "save", name: i.name, amount: o.amount, account: i.account, date: o.date, id: i.id, direct: true});
      });
    });
    db.transfers.forEach(function (t) {
      occurrences(db, t, from, to).forEach(function (o) {
        if (!live(o.date)) return;
        if (t.to === p) lines.push({kind: "in", name: person(db, t.from).name + ": " + (t.name || t.purpose || "transfer"), amount: o.amount, account: t.toAccount || main, date: o.date, id: t.id, occ: o.key});
        if (t.from === p) lines.push({kind: "bill", name: (t.name || t.purpose || "Transfer") + " (to " + person(db, t.to).name + ")", amount: o.amount, account: t.fromAccount || main, date: o.date, id: t.id, occ: o.key, transfer: true});
      });
    });
    db.bills.filter(function (b) { return b.person === p; }).forEach(function (b) { occurrences(db, b, from, to).forEach(function (o) { if (live(o.date)) lines.push({kind: "bill", name: b.name, amount: o.amount, account: b.account || main, date: o.date, id: b.id, occ: o.key, category: b.category, split: b.split}); }); });
    db.loans.forEach(function (l) {
      loanDue(db, l, from, to).forEach(function (r) {
        if (!live(r.date)) return;
        if (l.borrower === p) lines.push({kind: "bill", name: "Pay " + person(db, l.lender).name + " back: " + l.name, amount: r.amount, account: main, date: r.date, id: l.id, loan: true});
        // a repayment lands in the lender's main account, as the payment logged for it does (whichever account the loan
        // was paid from), so payday still moves what the other pots need
        if (l.lender === p) lines.push({kind: "in", name: person(db, l.borrower).name + " pays back: " + l.name, amount: r.amount, account: main, date: r.date, id: l.id, loan: true});
      });
    });
    if (per.opening) {
      var ob = startBalances(db, p), opening = 0;
      accountsOf(db, p).forEach(function (a) { if (a.kind === "main" || (a.kind === "pot" && !a.fallback)) opening += ob[a.id] || 0; });
      if (opening) lines.push({kind: "in", name: "In your account and " + (person(db, p).potWord || "pot") + "s when you started", amount: round(opening), account: main, date: st, id: "opening"});
    }
    var bud = budgetsOf(db, p, per), remainder = null;
    bud.forEach(function (b) {
      if (b.mode === "remainder") { remainder = b; return; }
      if (per.opening && b.mode === "saving") return;   // the opening part-period runs on the balances you started with
      var amt = budgetAmount(db, b, per); if (!amt) return;
      lines.push({kind: b.mode === "saving" ? "save" : "spend", name: b.name, amount: amt, account: b.account || main, id: b.id, mode: b.mode || "daily"});
    });
    if (!noTopup) {
      // puts back what the fallback pot really paid out last period: covers for going over, and a ticked payday cover
      var fb = fallbackOf(db, p), pvT = fb ? prevPeriod(db, p, per) : null, top = 0;
      if (pvT && pvT.start < from && pvT.next > st) {
        reimbursements(db, p, pvT, addDays(pvT.next, -1)).forEach(function (g) { if (g.kind === "over" && g.from === fb) top += g.amount; });
        // (by person: you can both be paid on the same day, and the key doesn't say whose pay it was)
        if (pvT.pay && !pvT.opening) top += db.moveKeysBy[p + "|pay:" + pvT.start + ":cover"] || 0;
        // and what it really put into a pot that would have run short before a payment (a ticked move to fill it), or
        // back into a pot for your partner's share of something it paid, until you settled up
        db.moves.forEach(function (m) { if (!m.dup && m.person === p && m.from === fb && /^(fill|lent):/.test(m.key || "") && m.date >= pvT.start && m.date < pvT.next) top += +m.amount || 0; });
        // and what last payday's move into it came up short of (or over), once it was ticked: spending from before then
        // logged after it was moved (its cover is asked for, but that payday's top-up was already done), say
        var tk = pvT.pay && !pvT.opening ? db.moveKeysBy[p + "|pay:" + pvT.start + ":" + fb] || 0 : 0;
        if (tk > 0.004) { var mfb = payday(db, p, pvT).moves.filter(function (m) { return m.to === fb; })[0]; top += (mfb ? mfb.amount : 0) - tk; }
      }
      top = round(top);
      if (top > 0.004) lines.push({kind: "topup", name: "Top up " + accName(db, fb), amount: top, account: fb, id: "topup"});
    }
    // money already sitting in a pot when the period starts (bills came in cheaper, a pot topped up early) counts
    // towards that pot's needs; a pot that ended short gets caught up; what's left in the main account carries
    // into the new month. Worked out once the period has started, and estimated for the next payday.
    var pv0 = db.today && from > addDays(db.today, 1) ? prevPeriod(db, p, per) : null, upcoming = !!(pv0 && pv0.start <= db.today);
    // money saved into a pot for something later (a sinking fund) is kept for that pot's bills, carried from period to period
    var pvR = per.opening ? null : prevPeriod(db, p, per), prevPl = pvR && pvR.start < from && pvR.next > st ? planFor(db, p, pvR) : null;
    // saIn: what's been set aside so far for each yearly cost (by bill), kept apart from the saving-budget reserve
    var resIn = prevPl ? (prevPl.reserveOut || dict()) : dict(), saIn = prevPl ? (prevPl.setAside || dict()) : dict(), reserveOut = dict(), setOut = dict(), saShort = dict();
    var potOk = function (id) { var a = db.byId[id]; return a && a.owner === p && a.kind === "pot" && !a.fallback; };
    Object.keys(resIn).forEach(function (id) { reserveOut[id] = resIn[id]; });
    var est = !per.opening && from >= st && (!db.today || from <= addDays(db.today, 1) || upcoming), bal = dict(), keepOf = function () { return 0; }, keepBud = keepOf, owe = 0;
    if (est) {
      var first = from === st, dayBefore = addDays(from, -1), pv = prevPeriod(db, p, per), bst = !first && pv && pv.start < from ? budgetState(db, p, pv) : dict();
      bal = Object.assign(dict(), first ? startBalances(db, p) : balances(db, dayBefore));
      // what each budget keeps in its pot: what carries over, and before payday whatever is still left to spend
      // (including "whatever is left" budgets, which can still be spent until payday)
      keepOf = function (accId) { var k = 0; Object.keys(bst).forEach(function (id) { var s = bst[id]; if ((s.budget.account || main) !== accId || s.budget.mode === "saving") return; k += upcoming ? Math.max(s.carryOut || 0, (s.avail || 0) - (s.spent || 0), 0) : (s.carryOut || 0); }); return k; };
      // what you owe your partner when the period starts stays in the main account (where settling up happens), rather
      // than counting as left over: so settling up after payday doesn't take it from this month's budgets
      owe = partnerOf(db, p) && !first ? Math.max(0, -owedAt(db, p, dayBefore)) : 0; keepBud = keepOf;
      keepOf = function (accId) { return keepBud(accId) + (accId === main ? owe : 0); };
      // moves still on the To do count as done, so a forgotten tick doesn't ask for the money twice;
      // but a balance checked on or after the move already includes it, so that side is left alone
      var vd = dict(); db.valuations.forEach(function (v) { if (v.date <= dayBefore && v.date > (vd[v.account] || "")) vd[v.account] = v.date; });
      var pendMove = function (from2, to2, amt, when) {
        if (bal[from2] !== undefined && !(vd[from2] >= when)) bal[from2] = round(bal[from2] - amt);
        if (bal[to2] !== undefined && !(vd[to2] >= when)) bal[to2] = round(bal[to2] + amt);
      };
      // (a move ticked from payday on, say last month's on payday morning, isn't in the balance the day before, so it
      // still counts as one to do: ticking it doesn't change this month's plan)
      if (!first) trackedBefore(db, p, from).forEach(function (pk) {
        if (pk.start >= from || pk.next <= st) return;
        if (pk.pay && !pk.opening) {
          var pdk = payday(db, p, pk);
          pdk.moves.forEach(function (m) { if (!tickedBefore(db, p, "pay:" + pk.start + ":" + m.to, from)) pendMove(m.from, m.to, m.amount, pk.start); });
          pdk.later.forEach(function (m) { var left = round(m.amount - tickedBefore(db, p, m.key, from)); if (left > 0.004) pendMove(m.from, m.to, left, m.date); });
        }
        reimbursements(db, p, pk, minS(dayBefore, addDays(pk.next, -1))).forEach(function (g) { var left = round(g.amount - tickedBefore(db, p, g.key, from)); if (left > 0.004) pendMove(g.from, g.to, left, g.date || pk.start); });
      });
    }
    // yearly costs (sinking funds). Each pay period puts by (next amount - set aside so far) / pay periods left until
    // it's due (this one included). In the period it lands, what was set aside pays it ("Saved up for …") and only
    // the rest comes from this pay, so the instalments add up to the bill once. Then the cycle starts again.
    // The money set aside is carried in plan.setAside (by bill), like the saving-budget reserve (fix #13), but kept
    // apart: it only ever pays its own bill. A pot can also have a saving budget of its own (say "Car fund"): both
    // are kept, and neither counts the other's money, so nothing is counted twice.
    var held = dict(), usedE = dict(), saDue = dict();
    if (!per.opening && from >= st) {
      var sab = setAsideBills(db, p), saReal = dict(), byAcc = dict();
      sab.forEach(function (b) { var acc = b.account || main; (byAcc[acc] = byAcc[acc] || []).push(b); });
      // once the period has started (or is next), only what's really in the pot counts as set aside
      Object.keys(byAcc).forEach(function (acc) {
        var tot = 0; byAcc[acc].forEach(function (b) { tot += saIn[b.id] || 0; });
        var f = est && tot > 0.004 ? Math.min(1, Math.max(0, round((bal[acc] || 0) - keepOf(acc))) / tot) : 1;
        byAcc[acc].forEach(function (b) { var v = round((saIn[b.id] || 0) * f); saReal[b.id] = v; if (v < (saIn[b.id] || 0) - 0.004) saShort[b.id] = round(saIn[b.id] - v); });
      });
      sab.forEach(function (b) {
        var acc = b.account || main, have = saReal[b.id] || 0, due = 0;
        lines.forEach(function (l) { if (l.kind === "bill" && l.id === b.id && !l.transfer && !l.loan && !l.catchup) due += l.amount; });
        if (due > 0.004) {
          var use = round(Math.min(have, due)); saDue[acc] = round((saDue[acc] || 0) + due);
          if (use > 0.004) lines.push({kind: "in", setAside: true, bill: b.id, name: "Saved up for " + b.name, amount: use, account: acc, id: "setaside:" + b.id, estimate: est && upcoming});
          usedE[acc] = round((usedE[acc] || 0) + use); held[acc] = round((held[acc] || 0) + use);
          return;   // anything over is released next period
        }
        held[acc] = round((held[acc] || 0) + have);
        var o = nextOcc(db, b, to); if (!o) return;
        var amt = round(Math.max(0, o.amount - have) / periodsUntil(db, p, per, o.date));
        if (amt > 0.004) lines.push({kind: "save", setAside: true, bill: b.id, name: "Set aside for " + b.name, amount: amt, account: acc, id: "setaside:" + b.id, due: o.date});
        setOut[b.id] = round(have + amt);
      });
    }
    if (est) {
      accountsOf(db, p).forEach(function (a) {
        if (a.kind !== "pot" || a.fallback) return;
        var needs = 0, billNeeds = 0; lines.forEach(function (l) { if (l.kind !== "in" && l.account === a.id) { needs += l.amount; if (l.kind === "bill") billNeeds += l.amount; } });
        // money set aside for yearly costs is spoken for: it has paid its own bill above, and is kept for the rest.
        // The rest of a yearly cost (its last instalment) isn't paid from a saving budget's reserve either.
        needs -= usedE[a.id] || 0; billNeeds -= saDue[a.id] || 0;
        var spare = round((bal[a.id] || 0) - keepOf(a.id) - (held[a.id] || 0)), R = round(Math.min(resIn[a.id] || 0, Math.max(0, spare))), free = round(spare - R);
        // spare money counts towards anything the pot needs; the saved-up money only towards its bills
        var useFree = free > 0.004 ? Math.min(free, needs) : 0, billsLeft = Math.max(0, billNeeds - Math.max(0, useFree - (needs - billNeeds))), useR = Math.min(R, billsLeft);
        reserveOut[a.id] = round(R - useR);
        var got = round(useFree + useR);
        if (got > 0.004) lines.push({kind: "in", name: "Already in " + a.name, amount: got, account: a.id, id: "already", already: true, estimate: upcoming});
        else if (spare < -0.004) lines.push({kind: "bill", name: "Catch up " + a.name, amount: round(-spare), account: a.id, id: "catchup", catchup: true, estimate: upcoming});
      });
      if (bal[main] !== undefined) {
        var left0 = round(bal[main] - keepOf(main) - (held[main] || 0));
        if (left0 > 0.004) lines.push({kind: "in", name: "Left in " + accName(db, main) + " from last month", amount: left0, account: main, id: "leftover", leftover: true, estimate: upcoming});
        else if (left0 < -0.004) lines.push({kind: "bill", name: "Catch up " + accName(db, main), amount: round(-left0), account: main, id: "catchup", catchup: true, estimate: upcoming});
      }
    }
    lines.forEach(function (l) { if (l.kind === "save" && !l.setAside && potOk(l.account)) reserveOut[l.account] = round((reserveOut[l.account] || 0) + l.amount); });
    Object.keys(reserveOut).forEach(function (id) { if (!potOk(id) || !(reserveOut[id] > 0.004)) delete reserveOut[id]; });
    Object.keys(setOut).forEach(function (id) { if (!(setOut[id] > 0.004)) delete setOut[id]; });
    var tin = 0, tout = 0;
    lines.forEach(function (l) { if (l.kind === "in") tin += l.amount; else tout += l.amount; });
    var left = round(tin - tout);
    if (per.opening && remainder && savingKind(db, remainder.account)) left = 0;
    // keptMain: what's already in the main account for its budgets when the period starts (what they carry over), on top
    // of what this pay gives them
    var res = {period: per, lines: lines, totalIn: round(tin), totalOut: round(tout), remainder: Math.max(0, round(left)), shortfall: left < 0 ? round(-left) : 0, remainderBudget: remainder, opening: !!per.opening, reserveOut: reserveOut, setAside: setOut, setAsideShort: saShort, keptMain: est && bal[main] !== undefined ? round(Math.max(0, keepBud(main))) : 0, owe: round(owe || 0)};
    if (remainder) lines.push({kind: remainder.account && (db.byId[remainder.account] || {}).kind !== "main" && /saving|isa|lisa|pension/.test((db.byId[remainder.account] || {}).kind) ? "save" : "spend", name: remainder.name, amount: res.remainder, account: remainder.account || main, id: remainder.id, mode: "remainder", remainder: true});
    var sum = function (k) { var t = 0; lines.forEach(function (l) { if (l.kind === k) t += l.amount; }); return round(t); };
    res.totals = {in: sum("in"), bills: sum("bill"), spend: sum("spend"), save: round(sum("save") + sum("topup"))};
    return res;
  }

  // ---------- loans ----------
  function loanPaid(db, l, upTo) {
    var t = 0; db.settlements.forEach(function (s) { if (s.loan === l.id && (!upTo || s.date <= upTo)) t += +s.amount || 0; }); return round(t);
  }
  // planned repayments: repay amount on repayDay each month from repayFrom until cleared; settled ones marked.
  // A payment ticked for one repayment (its key names the loan and that date) pays that one; anything else (paid
  // early in one go, or more than that repayment) pays the earliest still owed. So ticking this month's while last
  // month's is still owed leaves last month's in To do (it's never hidden by this month's key).
  function loanPlan(db, l) {
    var out = [], left = +l.amount || 0, paid = loanPaid(db, l), rp = +l.repay || 0;
    if (!rp || !l.repayFrom) return out;
    var dates = scheduleDates({unit: "month", on: l.repayDay || +l.repayFrom.slice(8, 10), start: l.repayFrom}, l.repayFrom, addDays(l.repayFrom, 3660));
    var own = Object.create(null);
    db.settlements.forEach(function (s) { if (s.loan === l.id && s.key && +s.amount > 0) own[s.key] = (own[s.key] || 0) + (+s.amount); });
    for (var i = 0; i < dates.length && left > 0.004; i++) {
      var a = Math.min(rp, left), key = "loan:" + l.id + ":" + dates[i], mine = Math.min(a, own[key] || 0); left -= a;
      if (mine) own[key] -= mine;
      out.push({date: dates[i], amount: round(a), covered: mine, key: key});
    }
    var credit = paid; out.forEach(function (r) { credit -= r.covered; });
    out.forEach(function (r) {
      var more = Math.min(r.amount - r.covered, Math.max(0, credit)); credit -= more;
      var covered = r.covered + more; delete r.covered;
      r.paid = covered >= r.amount - 0.004; r.left = round(r.amount - covered);
    });
    return out;
  }

  // the repayments due in [from, to) that still need paying when that time starts: what was paid back before then
  // (on time, or early in one go) counts against the earliest repayments first, so money paid back early isn't
  // planned to come out (or come in) again
  function loanDue(db, l, from, to) {
    var credit = loanPaid(db, l, addDays(from, -1)), out = [];
    loanPlan(db, l).forEach(function (r) {
      var c = Math.min(r.amount, Math.max(0, credit)), a = round(r.amount - c); credit -= c;
      if (r.date >= from && r.date < to && a > 0.004) out.push({date: r.date, amount: a, key: r.key});
    });
    return out;
  }

  // ---------- money flows and balances ----------
  // every flow in or out of an account in (after, upTo]: {date, account, amount (+ in / - out), what}
  function flows(db, after, upTo) { return memo(db, "fl|" + after + "|" + upTo, function () { return fl0(db, after, upTo); }); }
  function fl0(db, after, upTo) {
    // upd: when a logged row was saved, so a balance checked earlier the same day doesn't swallow it
    // bank: it came from the bank feed (a balance the bank feed checked that day already has it in)
    var out = [], push = function (date, acc, amt, what, src, upd, bank) { if (acc && date > after && date <= upTo && amt) out.push({date: date, account: acc, amount: round(amt), what: what, src: src, upd: +upd || 0, bank: !!bank}); };
    var from = addDays(after, 1), to = addDays(upTo, 1);
    db.income.forEach(function (i) { occurrences(db, i, from, to).forEach(function (o) { if (o.date >= startOf(db, i.person)) push(o.date, i.account || mainOf(db, i.person), o.amount, i.name, o.key); }); });
    db.bills.forEach(function (b) { occurrences(db, b, from, to).forEach(function (o) { if (o.date >= startOf(db, b.person)) push(o.date, b.account || mainOf(db, b.person), -o.amount, b.name, o.key); }); });
    db.transfers.forEach(function (t) { occurrences(db, t, from, to).forEach(function (o) { if (o.date >= startOf(db, t.from)) { push(o.date, t.fromAccount || mainOf(db, t.from), -o.amount, t.name, o.key); push(o.date, t.toAccount || mainOf(db, t.to), o.amount, t.name, o.key); } }); });
    db.transactions.forEach(function (x) { push(x.date, x.account || mainOf(db, x.person), -(+x.amount || 0), x.note || x.budget, x.id, x.updated, !!x.bankId || /^bk-/.test(String(x.id))); });
    db.moves.forEach(function (m) { if (m.dup) return; var bk = /^bk-/.test(String(m.id)); if (m.from) push(m.date, m.from, -(+m.amount || 0), "move", m.id, m.updated, bk); if (m.to) push(m.date, m.to, +m.amount || 0, "move", m.id, m.updated, bk); });
    db.settlements.forEach(function (s) { push(s.date, s.fromAccount || mainOf(db, s.from), -(+s.amount || 0), s.note || "payment", s.id, s.updated); push(s.date, s.toAccount || mainOf(db, s.to), +s.amount || 0, s.note || "payment", s.id, s.updated); });
    db.loans.forEach(function (l) { if (l.account) push(l.date, l.account, -(+l.amount || 0), l.name, l.id); });
    return out;
  }
  // tracked balance of every account on a date: last checked balance plus everything since
  // every movement of money from the earliest tracking start to a few years ahead, sorted once
  function allFlows(db) {
    return memo(db, "allfl", function () {
      var earliest = "9999";
      db.accounts.forEach(function (a) { var st = startOf(db, a.owner); if (st < earliest) earliest = st; });
      db.valuations.forEach(function (v) { if (v.date < earliest) earliest = v.date; });
      var horizon = addDays(db.today || maxS(earliest, "2026-01-01"), 1100);
      db.transactions.forEach(function (x) { if (x.date > horizon) horizon = x.date; });
      var list = flows(db, addDays(earliest, -1), horizon).slice().sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : 0; });
      return {from: earliest, to: horizon, list: list, dates: list.map(function (f) { return f.date; })};
    });
  }
  // tracked balance of every account at the end of a date: last checked balance plus everything since
  // (flows on a valuation's own date are already in it)
  function balances(db, date) { return memo(db, "bal|" + date, function () { return bal0(db, date); }); }
  function bal0(db, date) {
    var res = dict(), base = dict(), vdate = dict(), vupd = dict();
    db.accounts.forEach(function (a) { res[a.id] = 0; base[a.id] = addDays(startOf(db, a.owner), -1); });
    db.valuations.forEach(function (v) {
      if (v.date > date || res[v.account] === undefined) return;
      var vd = vdate[v.account] || "";
      if (v.date > vd || (v.date === vd && (+v.updated || 0) >= (vupd[v.account] || 0))) { vdate[v.account] = v.date; vupd[v.account] = +v.updated || 0; res[v.account] = +v.amount || 0; base[v.account] = v.date; }
    });
    var af = allFlows(db), list = af.list;
    if (date > af.to) list = flows(db, addDays(af.from, -1), date);
    var end = date > af.to ? list.length : lowerBound(af.dates, addDays(date, 1));
    // flows on a check's own date are already in it, unless they were logged after the check. A payment or move from the
    // bank feed on that day is in it however late its row came or was changed: the balance came from the bank (from the
    // feed, or read off the bank's app and typed in), and the bank had it. (A first import brings in the days before
    // you started, after the balances you started with were typed in.)
    var counts = function (f) { var b = base[f.account]; return f.date > b || (f.date === b && !f.bank && f.upd && vupd[f.account] && f.upd > vupd[f.account]); };
    for (var i = 0; i < end; i++) { var f = list[i]; if (res[f.account] !== undefined && f.date <= date && counts(f)) res[f.account] = round(res[f.account] + f.amount); }
    return res;
  }

  // moves needed because something was paid from the wrong place, or went over budget, in one pay period
  // (amounts before anything already ticked off)
  function reimbursements(db, p, pk, today) {
    return memo(db, "rb|" + p + "|" + pk.start + "|" + today, function () {
      var main = mainOf(db, p), fb = fallbackOf(db, p), st = startOf(db, p), out = [];
      budgetsOf(db, p, pk).forEach(function (b) {
        if (!isSpend(db, b)) return;
        var home = b.account || main, amt = b.mode === "remainder" ? planFor(db, p, pk).remainder : budgetAmount(db, b, pk);
        var mineB = memo(db, "txb|" + b.id, function () { return db.transactions.filter(function (x) { return x.budget === b.id; }).sort(function (a, c) { return a.date < c.date ? -1 : a.date > c.date ? 1 : 0; }); });
        var from0 = maxS(pk.start, st), inPeriod = function (x) { return x.date >= from0 && x.date < pk.next && x.date <= today; };
        var lo = lowerBound(mineB.map(function (x) { return x.date; }), from0);
        var list = []; for (var i = lo; i < mineB.length && mineB[i].date < pk.next && mineB[i].date <= today; i++) if (mineB[i].person === p) list.push(mineB[i]);
        // my share of a split payment my partner made (under their budget of the same name, as it counts towards mine)
        // is money I pay them back from my main account when we settle up, so it's paid from there
        var theirs = memo(db, "txq|" + p + "|" + b.id, function () { return db.transactions.filter(function (x) { return x.person !== p && x.split && sameBudget(db, b, x); }); }).filter(function (x) { return inPeriod(x) && Math.abs(myShare(db, p, x)) > 0.004; });
        if (!list.length && !theirs.length) return;
        var all = list.concat(theirs).sort(function (a, c) { return a.date < c.date ? -1 : a.date > c.date ? 1 : 0; });
        var payerOf = function (x) { return x.person === p ? x.account || main : main; };
        var own = function (x) { return payerOf(x) === home; }, left = amt + ((budgetState(db, p, pk)[b.id] || {}).carryIn || 0);
        all.filter(own).forEach(function (x) { left -= myShare(db, p, x); });
        // one combined move per pot and reason, so ten small shops make one To do item
        var lastDate = all[all.length - 1].date;
        var agg = dict(), bump = function (key, from, to, a, kind, date, who) { if (!(a > 0.004)) return; var g = agg[key] = agg[key] || {key: key, from: from, to: to, amount: 0, kind: kind, name: b.name.toLowerCase(), date: ""}; g.amount += a; if (date > g.date) g.date = date; if (who && who.theirs) g.theirs = true; if (who && who.mine) g.mine = true; };
        // payments and refunds through each other account, netted (only my share: the other share comes back from my partner)
        var byPayer = dict(), payerDate = dict(), payers = [], via = dict();
        all.filter(function (x) { return !own(x); }).forEach(function (x) {
          var payer = payerOf(x); if (byPayer[payer] === undefined) { byPayer[payer] = 0; payers.push(payer); }
          byPayer[payer] += myShare(db, p, x); if (!payerDate[payer] || x.date > payerDate[payer]) payerDate[payer] = x.date;
          var v = via[payer] = via[payer] || {}; if (x.person !== p) v.theirs = true; else v.mine = true;
        });
        // my partner's share of a split payment I made from a pot (or anywhere but my main account) comes back into my main
        // account when we settle up, so it goes back to where it came from
        var lent = dict(), lentDate = dict(), lentTo = [];
        list.forEach(function (x) {
          var acc = x.account || main; if (!x.split || acc === main) return;
          var s = round((+x.amount || 0) - myShare(db, p, x)); if (!s) return;
          if (lent[acc] === undefined) { lent[acc] = 0; lentTo.push(acc); }
          lent[acc] += s; if (!lentDate[acc] || x.date > lentDate[acc]) lentDate[acc] = x.date;
        });
        // a refund that landed somewhere else goes back to the budget's pot
        payers.forEach(function (payer) { var a = round(byPayer[payer]); if (a < -0.004) { bump("refund:" + b.id + ":" + pk.start + ":" + payer, payer, home, -a, "refund", payerDate[payer]); left += -a; } });
        if (left < 0 && home === main && fb) bump("cover:" + b.id + ":" + pk.start + ":" + main, fb, main, -left, "over", lastDate);
        left = Math.max(0, left);
        var giveMain = 0;
        payers.forEach(function (payer) {
          var a = round(byPayer[payer]); if (!(a > 0.004)) return;
          var give = Math.min(a, left); left -= give;
          if (payer === main && home !== main) giveMain = give;
          else bump("back:" + b.id + ":" + pk.start + ":" + payer, home, payer, give, "back", payerDate[payer], via[payer]);
          if (fb && payer !== fb) bump("cover:" + b.id + ":" + pk.start + ":" + payer, fb, payer, a - give, "over", payerDate[payer]);
        });
        // what goes between the budget's pot and the main account both ways (my share of what my partner paid, and their
        // share of what the pot paid) is one move: the difference, after what's been ticked off either way
        var backKey = "back:" + b.id + ":" + pk.start + ":" + main, lentKey = "lent:" + b.id + ":" + pk.start + ":" + home;
        if (home !== main && (giveMain > 0.004 || lent[home])) {
          var tb = ticked(db, p, backKey), tl = ticked(db, p, lentKey), net = round((giveMain - tb) - ((lent[home] || 0) - tl));
          var md = maxS(payerDate[main] || "", lentDate[home] || "");
          if (tb > 0.004 || net > 0.004) bump(backKey, home, main, round(tb + Math.max(0, net)), "back", md, via[main]);
          if (tl > 0.004 || net < -0.004) bump(lentKey, main, home, round(tl + Math.max(0, -net)), "lent", md);
        }
        lentTo.forEach(function (acc) { if (acc !== home) bump("lent:" + b.id + ":" + pk.start + ":" + acc, main, acc, lent[acc], "lent", lentDate[acc]); });
        Object.keys(agg).forEach(function (k) { agg[k].amount = round(agg[k].amount); out.push(agg[k]); });
      });
      return out;
    });
  }

  // ---------- To do ----------
  // returns pending moves and reminders for a person today
  function todo(db, p, today) {
    var per = periodAt(db, p, today), main = mainOf(db, p), fb = fallbackOf(db, p), st = startOf(db, p);
    var bal = balances(db, today), items = [], pend = dict();
    var avail = function (a) { return round((bal[a] || 0) + (pend[a] || 0)); };
    var plan = function (key, from, to, amount, what, why, extra) {
      amount = round(amount); if (!(amount > 0.004) || from === to) return;
      if (extra && extra.partial) { amount = round(amount - ticked(db, p, key)); if (!(amount > 0.004)) return; what = "Move " + money(amount) + " from " + accName(db, from) + " to " + accName(db, to); }
      // (a move to fill a pot is only asked for while the pot is still short, with what it's ticked already counted, so
      // one that's been ticked doesn't hide a shortfall that's grown since)
      else if (!(extra && extra.fill) && ticked(db, p, key)) return;
      // keys: what ticking it saves (a move added after the grouping below, like one to fill a pot, is ticked by its own key)
      var it = {key: key, type: "move", from: from, to: to, fromName: accName(db, from), toName: accName(db, to), amount: amount, what: what, why: why, short: false, keys: [{key: key, amount: amount}]};
      for (var k in extra) it[k] = extra[k];
      if (avail(from) < amount - 0.004) it.short = round(amount - Math.max(0, avail(from)));
      pend[from] = (pend[from] || 0) - amount; pend[to] = (pend[to] || 0) + amount;
      items.push(it);
    };
    // 1. payday: sort the pay into pots (current period, from payday for 7 days)
    if (per.pay && !per.opening) {
      var pdNow = payday(db, p, per);
      pdNow.moves.forEach(function (m) { plan("pay:" + per.start + ":" + m.to, m.from, m.to, m.amount, "Payday: move " + money(m.amount) + " to " + accName(db, m.to), m.why, {payday: true}); });
      // the payday screen's cover, from the pot that covers going over, counts as on its way while that screen still has
      // moves to tick; once they're all done (it can come later, when a bill's real amount is logged), To do asks for it
      var pc = pdNow.cover;
      if (pc && !ticked(db, p, pc.key)) {
        if (pdNow.moves.some(function (m) { return !ticked(db, p, "pay:" + per.start + ":" + m.to); })) { pend[pc.from] = (pend[pc.from] || 0) - pc.amount; pend[pc.to] = (pend[pc.to] || 0) + pc.amount; }
        else plan(pc.key, pc.from, pc.to, pc.amount, "Move " + money(pc.amount) + " from " + accName(db, pc.from) + " to " + accName(db, pc.to), pc.why + ". Your next pay tops it back up.", {});
      }
    }
    // 1b. money that came in after payday: its part of what's left goes on once it's in (a loan repayment once it's paid)
    periods(db, p, st, addDays(today, 1)).forEach(function (pk) {
      if (!pk.pay || pk.opening) return;
      payday(db, p, pk).later.forEach(function (m) {
        if (m.date > today || !m.loans.every(function (x) { var l = db.byId[x.id]; return !!l && loanPlan(db, l).some(function (r) { return r.date === x.date && r.paid; }); })) return;
        plan(m.key, m.from, m.to, m.amount, "", m.names.join(" and ") + (m.date > pk.start ? " came in after payday" : " came in") + ", so its part of what's left goes to " + accName(db, m.to) + " now.", {partial: true, later: true});
      });
    });
    // 2. paid from the wrong place, or over budget (all periods since tracking started)
    var qName = person(db, partnerOf(db, p)).name || "your partner";
    var backWhy = function (names, to, theirs, mine) { return theirs ? "Your share of " + names + " " + qName + " paid for is settled up from " + to + (mine ? ", and you paid for some from there too." : ".") : "You paid for " + names + " from " + to + "."; };
    // (when the main account can't spare it, the fallback pot puts the share back until you settle up)
    var lentWhy = function (names, to, from) { return qName + "'s share of " + names + " you paid from " + to + " comes back into " + accName(db, main) + " when you settle up." + (from === accName(db, fb) && from !== accName(db, main) ? " Until then it comes from " + from + ", and your next pay tops the " + from + " back up." : ""); };
    // what the budgets kept in the main account still have to spend before payday isn't spare, and nor is what its
    // bills and payments take out before then
    var stNow = budgetState(db, p, per), mainKeep = 0, flowsAhead = flows(db, today, addDays(per.next, -1)), mainOut = 0;
    Object.keys(stNow).forEach(function (id) { var s = stNow[id]; if ((s.budget.account || main) === main) mainKeep += Math.max(0, s.left || 0); });
    flowsAhead.forEach(function (f) { if (f.account === main) mainOut += f.amount; });
    mainKeep = round(mainKeep); mainOut = round(Math.max(0, -mainOut));
    periods(db, p, st, addDays(today, 1)).forEach(function (pk) {
      reimbursements(db, p, pk, today).forEach(function (g) {
        if (g.kind === "back") plan(g.key, g.from, g.to, g.amount, "", backWhy(g.name, accName(db, g.to), g.theirs, g.mine), {partial: true, names: [g.name], theirs: !!g.theirs, mine: !!g.mine});
        else if (g.kind === "lent") {
          // your partner's share of what a pot paid goes back into the pot from the main account, as long as the main account
          // can spare it (beyond what its own budgets and bills still need); else from the fallback pot, if it has it
          var lentLeft = round(g.amount - ticked(db, p, g.key)), src = g.from;
          if (g.from === main && fb && fb !== g.to && lentLeft > 0.004 && avail(main) - mainKeep - mainOut - lentLeft < -0.004 && avail(fb) - lentLeft >= -0.004) src = fb;
          plan(g.key, src, g.to, g.amount, "", lentWhy(g.name, accName(db, g.to), accName(db, src)), {partial: true, lent: true, names: [g.name]});
        }
        else if (g.kind === "refund") plan(g.key, g.from, g.to, g.amount, "", "A " + g.name + " refund came into " + accName(db, g.from) + ".", {partial: true, refund: true, names: [g.name]});
        else plan(g.key, g.from, g.to, g.amount, "", "You went over your " + g.name + " budget" + (g.to === main ? "" : " paying from " + accName(db, g.to)) + ". Your next pay tops the " + accName(db, g.from) + " back up.", {partial: true, over: true, names: [g.name]});
      });
    });
    // the same move from older months or other budgets becomes one item (ticking it saves each part)
    var grouped = [], at = dict(), joinNames = function (a) { a = a.filter(function (x, i) { return a.indexOf(x) === i; }); return a.length < 2 ? a.join("") : a.slice(0, -1).join(", ") + " and " + a[a.length - 1]; };
    items.forEach(function (it) {
      it.keys = [{key: it.key, amount: it.amount}];
      if (it.type !== "move" || it.payday || !it.names) { grouped.push(it); return; }
      var g = it.from + ">" + it.to + (it.over ? "!" : it.refund ? "r" : it.lent ? "s" : "");
      if (at[g] === undefined) { at[g] = grouped.length; grouped.push(it); return; }
      var x = grouped[at[g]]; x.amount = round(x.amount + it.amount); x.keys.push({key: it.key, amount: it.amount}); x.names = x.names.concat(it.names);
      x.theirs = x.theirs || it.theirs; x.mine = x.mine || it.mine;
      x.short = it.short || x.short; x.what = "Move " + money(x.amount) + " from " + x.fromName + " to " + x.toName;
      x.why = x.over ? "You went over your " + joinNames(x.names) + " budget" + (x.names.length > 1 ? "s" : "") + (x.to === main ? "" : " paying from " + x.toName) + ". Your next pay tops the " + x.fromName + " back up."
        : x.refund ? "Refunds for " + joinNames(x.names) + " came into " + x.fromName + "."
        : x.lent ? lentWhy(joinNames(x.names), x.toName, x.fromName)
        : backWhy(joinNames(x.names), x.toName, x.theirs, x.mine);
    });
    items = grouped;
    // 3. a pot that will run short before payday
    var run = dict(); Object.keys(bal).forEach(function (a) { run[a] = avail(a); });
    // (on the same day, money going out is counted before money coming in: which the bank takes first isn't known)
    var warned = dict(), ahead = flowsAhead.slice().sort(function (a, c) { return a.date < c.date ? -1 : a.date > c.date ? 1 : a.amount - c.amount; });
    ahead.forEach(function (f, i) {
      if (run[f.account] === undefined || (db.byId[f.account] || {}).owner !== p) return;
      run[f.account] = round(run[f.account] + f.amount);
      if (run[f.account] < -0.004 && f.account !== main && !warned[f.account]) {
        warned[f.account] = true;
        // enough for the lowest it goes before payday (more payments after this one), so it's one move, not one a payment
        var low = run[f.account], r = low, lowF = f;
        for (var j = i + 1; j < ahead.length; j++) if (ahead[j].account === f.account) { r = round(r + ahead[j].amount); if (r < low - 0.004) { low = r; lowF = ahead[j]; } }
        // the main account if it will have the money by then without touching what its budgets have left, else the
        // fallback pot, else what the main account can spare and the rest from the fallback pot, else all the fallback pot
        // has and the rest from the main account anyway (a bill matters more); only shown once the money is actually there.
        // (when nowhere has enough for the lowest it goes, then enough for this payment)
        var need, parts, has = function (a, keep) { return (run[a] || 0) - keep - need >= -0.004 && avail(a) - keep - need >= -0.004; };
        var pick = function () {
          if (has(main, mainKeep)) return [[main, need]];
          if (fb && fb !== f.account && (run[fb] || 0) - need >= -0.004) return [[fb, need]];
          var sp = round(Math.max(0, Math.min(run[main] || 0, avail(main)) - mainKeep)), fh = fb && fb !== f.account ? Math.max(0, Math.min(run[fb] || 0, avail(fb))) : 0;
          if (sp > 0.004 && sp + fh - need >= -0.004) return [[main, sp], [fb, round(need - sp)]];
          // (and last, all the fallback pot has with the rest from the main account, or the main account on its own)
          var mh = Math.max(0, Math.min(run[main] || 0, avail(main)));
          if (fh > 0.004 && mh + fh - need >= -0.004) return [[main, round(need - fh)], [fb, round(fh)]];
          return (run[main] || 0) - need >= -0.004 ? [[main, need]] : null;
        };
        need = round(-low); parts = pick();
        if (!parts && low < run[f.account] - 0.004) { need = round(-run[f.account]); parts = pick(); lowF = f; }
        var forWhat = f.what + " on " + nice(f.date) + (lowF !== f ? " and " + lowF.what + " on " + nice(lowF.date) + " need it." : " needs it.");
        if (parts && parts.every(function (x) { return avail(x[0]) - x[1] >= -0.004; })) {
          parts.forEach(function (x, k) {
            var src = x[0], amt = x[1];
            plan("fill:" + f.account + ":" + f.date + (k ? ":" + src : ""), src, f.account, amt, "Move " + money(amt) + " from " + accName(db, src) + " to " + accName(db, f.account), forWhat + (src === fb ? " Your next pay tops the " + accName(db, fb) + " back up." : parts.length > 1 ? " The rest comes from " + accName(db, fb) + "." : ""), {fill: true});
            run[src] = round(run[src] - amt); run[f.account] = round(run[f.account] + amt);
          });
        } else if (!parts) {
          // "Got it" saves a move with this key: the warning stays away (a new date or pot makes a new one)
          if (!ticked(db, p, "short:" + f.account + ":" + f.date)) items.push({key: "short:" + f.account + ":" + f.date, type: "warn", amount: need, what: accName(db, f.account) + " will be " + money(need) + " short", why: f.what + " on " + nice(f.date) + ", and there isn't enough spare money to cover it yet."});
          run[f.account] = 0;
        }
      }
    });
    // 3b. the main account itself going under before payday (your partner's share of something you paid until you settle
    // up, a bill from it that came in higher): only the fallback pot can cover that, and the next pay tops it back up
    if (fb && bal[main] !== undefined) {
      // (with what you're due to pay your partner back before payday, which you pay from it)
      var outM = ahead.filter(function (f) { return f.account === main; }).map(function (f) { return {date: f.date, amount: f.amount}; });
      db.loans.forEach(function (l) { if (l.borrower === p) loanPlan(db, l).forEach(function (r) { if (!r.paid && r.date < per.next) outM.push({date: maxS(r.date, today), amount: -r.left}); }); });
      outM.sort(function (a, c) { return a.date < c.date ? -1 : a.date > c.date ? 1 : 0; });
      var lowM = avail(main), lowD = today, runM = lowM;
      outM.forEach(function (f) { runM = round(runM + f.amount); if (runM < lowM - 0.004) { lowM = runM; lowD = f.date; } });
      if (lowM < -0.004) {
        var needM = round(-lowM), canM = round(Math.min(needM, Math.max(0, avail(fb)))), whenM = lowD === today ? " is " + money(needM) + " under" : " would be " + money(needM) + " under on " + nice(lowD);
        if (canM > 0.004) plan("fill:" + main + ":" + lowD, fb, main, canM, "Move " + money(canM) + " from " + accName(db, fb) + " to " + accName(db, main), accName(db, main) + whenM + ". Your next pay tops the " + accName(db, fb) + " back up.", {fill: true});
        else if (!ticked(db, p, "short:" + main + ":" + lowD)) items.push({key: "short:" + main + ":" + lowD, type: "warn", amount: needM, what: accName(db, main) + whenM, why: "There isn't enough in your " + accName(db, fb) + " to cover it yet."});
      }
    }
    // 4. loan repayments due
    db.loans.forEach(function (l) {
      if (l.lender !== p && l.borrower !== p) return;
      loanPlan(db, l).forEach(function (r) {
        // (one partly paid under its own key, as when the monthly amount went up after it was ticked, still asks for the rest)
        if (r.paid || r.date > today) return;
        // (only what's still to pay of it, when part of it has been paid already)
        items.push({key: r.key, type: "loan", loan: l.id, amount: r.left, date: r.date, lender: l.lender, borrower: l.borrower,
          what: l.borrower === p ? "Pay " + person(db, l.lender).name + " " + money(r.left) : person(db, l.borrower).name + " pays you " + money(r.left),
          why: l.name + (r.date < today ? " (was due " + nice(r.date) + ")" : " · due today")});
      });
    });
    // 5. split payments between you two
    var bt = between(db, p, today);
    if (bt.owedToMe > 0.004) items.push({key: "split:" + today, type: "settle", amount: bt.owedToMe, what: person(db, bt.partner).name + " owes you " + money(bt.owedToMe), why: "For shared bills and split payments. Tick when it arrives.", from: bt.partner, to: p});
    if (bt.iOwe > 0.004) items.push({key: "split:" + today, type: "settle", amount: bt.iOwe, what: "Pay " + person(db, bt.partner).name + " " + money(bt.iOwe), why: "For shared bills and split payments.", from: p, to: bt.partner, info: true});
    return items;
  }

  // ---------- payday sort ----------
  function payday(db, p, per) { return memo(db, "pd|" + p + "|" + per.start + "|" + per.next, function () { return pd0(db, p, per); }); }
  function pd0(db, p, per) {
    var pl = planFor(db, p, per), main = mainOf(db, p), need = dict(), why = dict();
    var payAcc = (pl.lines.filter(function (l) { return l.isPay; })[0] || {}).account || main;
    pl.lines.forEach(function (l) {
      if (l.kind === "in") { if (l.account !== payAcc && !l.isPay) { need[l.account] = (need[l.account] || 0) - l.amount; } return; }
      if (l.catchup) (why[l.account] = why[l.account] || []).push("catching up " + money(l.amount));
      if (l.account === payAcc) return;
      need[l.account] = (need[l.account] || 0) + l.amount;
      if (!l.catchup) (why[l.account] = why[l.account] || []).push(l.name);
    });
    var already = pl.lines.filter(function (l) { return l.already; }).map(function (l) { return {account: l.account, name: accName(db, l.account), amount: l.amount}; });
    var moves = [];
    accountsOf(db, p).concat(db.accounts.filter(function (a) { return a.owner !== p; })).forEach(function (a) {
      var n = round(need[a.id] || 0); if (n > 0.004) moves.push({from: payAcc, to: a.id, amount: n, why: (why[a.id] || []).join(", ")});
    });
    var pay = pl.lines.filter(function (l) { return l.isPay; })[0] || null;
    // money that only comes into the pay's account later in the period (a loan repayment on the 28th, a second income)
    // isn't there on payday: the part of what's left for the remainder (a Cash ISA, say) that it pays for is moved once
    // it's in (later: a To do move then), rather than on payday, leaving the account overdrawn until it comes
    // (a repayment due on payday itself isn't there yet either when payday's moves are made: it's only in once it's paid)
    var late = 0, lateDate = "", lateNames = [], lateLoans = [];
    // (named as you'd say it: "Sophie's Sofa repayment", "Sophie's Rent share", "Side income")
    var lateName = function (l) { var it = db.byId[l.id] || {}; return l.loan ? person(db, it.borrower).name + "'s " + it.name + " repayment" : db.transfers.indexOf(it) >= 0 ? person(db, it.from).name + "'s " + (it.name || it.purpose || "payment") : l.name; };
    pl.lines.forEach(function (l) { if (l.kind === "in" && l.account === payAcc && l.date && (l.date > per.start || (l.loan && l.date >= per.start))) { late += l.amount; if (l.date > lateDate) lateDate = l.date; var nm = lateName(l); if (lateNames.indexOf(nm) < 0) lateNames.push(nm); if (l.loan) lateLoans.push({id: l.id, date: l.date}); } });
    var remAcc = pl.remainderBudget ? pl.remainderBudget.account || main : "", remMove = remAcc && remAcc !== payAcc ? moves.filter(function (m) { return m.to === remAcc; })[0] : null, later = [];
    if (remMove && late > 0.004) {
      var cut = round(Math.min(remMove.amount, late)); remMove.amount = round(remMove.amount - cut); if (!(remMove.amount > 0.004)) moves.splice(moves.indexOf(remMove), 1);
      later.push({from: payAcc, to: remAcc, amount: cut, date: lateDate, key: "late:" + per.start + ":" + remAcc, names: lateNames, loans: lateLoans});
    }
    var landed = 0; pl.lines.forEach(function (l) { if (l.kind === "in" && l.account === payAcc) landed += l.amount; });
    var keeps = round(landed - moves.concat(later).reduce(function (t, m) { return t + m.amount; }, 0)), cover = null, uncovered = 0;
    // the pay doesn't stretch to everything: the pot that covers going over fills the whole gap (so the main
    // account still has its own budgets), as far as the money in it goes; the next pay tops it back up
    var fb = fallbackOf(db, p), gap0 = round(Math.max(pl.shortfall || 0, -keeps, 0)), gap = gap0, soon = 0;
    // money still to come that's more than what was held back for it: until it's in, the account has that much less, so
    // the pot that covers going over also covers what the account needs before then (its bills until then, catching it
    // up, and its budgets' share of the days until then), so it never goes under; the money that comes in is left over for next payday
    var wait = round(late - later.reduce(function (t, m) { return t + m.amount; }, 0));
    if (wait > 0.004) {
      var frac = Math.min(1, diff(per.start, lateDate) / Math.max(1, diff(per.start, per.next))), kept = payAcc === main ? pl.keptMain || 0 : 0, before = kept * frac;
      pl.lines.forEach(function (l) { if (l.account !== payAcc || l.kind === "in") return; if (l.kind === "spend") before += l.amount * frac; else if (l.kind === "bill" && (!l.date || l.date < lateDate)) before += l.amount; });
      soon = round(Math.max(0, before - (keeps + gap0 - wait + kept)));
      gap = round(gap0 + soon);
    }
    if (gap > 0.004) {
      var st = startOf(db, p), fbBal = 0;
      if (fb) { fbBal = (per.start === st ? startBalances(db, p) : balances(db, addDays(per.start, -1)))[fb] || 0; fbBal = round(Math.max(0, fbBal + (need[fb] > 0 ? need[fb] : 0))); }
      var amt = round(Math.min(gap, fbBal));
      if (amt > 0.004) { cover = {from: fb, to: payAcc, amount: amt, why: "This pay doesn't stretch to everything, so " + accName(db, fb) + " covers the gap", cover: true, key: "pay:" + per.start + ":cover"}; keeps = round(keeps + amt); }
      uncovered = round(gap - amt);
    }
    var estimate = pl.lines.some(function (l) { return l.estimate; });
    // soon: how much of the gap is only until that money comes in (soonFor: what it is, and when it's due)
    return {period: per, pay: pay, payAccount: payAcc, moves: moves, later: later, cover: cover, uncovered: uncovered, already: already, plan: pl, keeps: keeps, estimate: estimate, soon: soon, soonFor: soon > 0.004 ? {names: lateNames, date: lateDate} : null};
  }

  // ---------- between partners ----------
  // shared bills and the regular transfers that pay for them are settled by completed calendar month,
  // so a rent share sent on the 13th for rent on the 15th never shows as owed; split payments count straight away
  function between(db, p, today) {
    var q = partnerOf(db, p), owed = 0; // + means q owes p
    var st = maxS(startOf(db, p), startOf(db, q)), monthStart = today.slice(0, 8) + "01", month = {bills: 0, myShare: 0, theirShare: 0, paidIn: 0, paidOut: 0};
    // what each payment or bill owes is to the penny (half of £20.15 is the £10.08 that's settled), so settling up
    // leaves nothing over to drift into the next amount owed
    db.transactions.forEach(function (x) {
      if (!x.split || x.date > today || x.date < st) return;
      if (x.person === p) owed += round(shareOf(db, x.split, q, +x.amount, x.person));
      if (x.person === q) owed -= round(shareOf(db, x.split, p, +x.amount, x.person));
    });
    db.bills.forEach(function (b) {
      if (!b.split || (b.person !== p && b.person !== q)) return;
      occurrences(db, b, st, addDays(today, 1)).forEach(function (o) {
        var theirs = round(shareOf(db, b.split, b.person === p ? q : p, o.amount, b.person)), sign = b.person === p ? 1 : -1;
        if (o.date < monthStart) owed += sign * theirs;
        else { month.bills += o.amount; if (b.person === p) month.theirShare += theirs; else month.myShare += theirs; }
      });
    });
    db.transfers.forEach(function (t) {
      occurrences(db, t, st, addDays(today, 1)).forEach(function (o) {
        var sign = t.from === q && t.to === p ? -1 : t.from === p && t.to === q ? 1 : 0; if (!sign) return;
        if (o.date < monthStart) owed += sign * o.amount;
        else if (sign < 0) month.paidIn += o.amount; else month.paidOut += o.amount;
      });
    });
    db.settlements.forEach(function (s) {
      if (s.loan || s.date > today || s.date < st) return;
      if (s.from === q && s.to === p) owed -= +s.amount;
      if (s.from === p && s.to === q) owed += +s.amount;
    });
    // half a penny or less either way is all square (every share above is to the penny now, so this only matters for
    // an amount typed into the sheet with fractions of a penny)
    owed = Math.abs(owed) < 0.005 + 1e-7 ? 0 : round(owed);
    Object.keys(month).forEach(function (k) { month[k] = round(month[k]); });
    return {partner: q, owedToMe: owed > 0 ? owed : 0, iOwe: owed < 0 ? -owed : 0, net: owed, month: month};
  }

  // what between() says is owed (+ your partner owes you) at the end of a day, from running totals worked out once, so
  // asking for it on every payday back to the start costs nothing: split payments and settling up count from their day,
  // shared bills and regular payments between you once their calendar month is over
  function owedIndex(db, p) {
    return memo(db, "owix|" + p, function () {
      var q = partnerOf(db, p), st = maxS(startOf(db, p), startOf(db, q)), hz = addDays(maxS(db.today || st, st), 400), now = [], month = [];
      db.transactions.forEach(function (x) { if (!x.split || x.date < st) return; if (x.person === p) now.push([x.date, round(shareOf(db, x.split, q, +x.amount, x.person))]); if (x.person === q) now.push([x.date, -round(shareOf(db, x.split, p, +x.amount, x.person))]); });
      db.settlements.forEach(function (s) { if (s.loan || s.date < st) return; if (s.from === q && s.to === p) now.push([s.date, -(+s.amount)]); if (s.from === p && s.to === q) now.push([s.date, +s.amount]); });
      db.bills.forEach(function (b) { if (!b.split || (b.person !== p && b.person !== q)) return; occurrences(db, b, st, hz).forEach(function (o) { month.push([o.date, (b.person === p ? 1 : -1) * round(shareOf(db, b.split, b.person === p ? q : p, o.amount, b.person))]); }); });
      db.transfers.forEach(function (t) { var sign = t.from === q && t.to === p ? -1 : t.from === p && t.to === q ? 1 : 0; if (sign) occurrences(db, t, st, hz).forEach(function (o) { month.push([o.date, sign * o.amount]); }); });
      var pack = function (list) { list.sort(function (a, c) { return a[0] < c[0] ? -1 : a[0] > c[0] ? 1 : 0; }); var dates = [], cum = [0]; list.forEach(function (x, i) { dates.push(x[0]); cum.push(cum[i] + x[1]); }); return {dates: dates, cum: cum}; };
      return {hz: hz, now: pack(now), month: pack(month)};
    });
  }
  function owedAt(db, p, date) {
    var ix = owedIndex(db, p); if (date >= ix.hz) return between(db, p, date).net;
    var o = ix.now.cum[lowerBound(ix.now.dates, addDays(date, 1))] + ix.month.cum[lowerBound(ix.month.dates, date.slice(0, 8) + "01")];
    return Math.abs(o) < 0.005 + 1e-7 ? 0 : round(o);
  }

  // ---------- today ----------
  function today(db, p, date) {
    var per = periodAt(db, p, date), daysLeft = Math.max(1, diff(date, per.next)), plan = planFor(db, p, per);
    var stt = budgetState(db, p, per), bal = balances(db, date), tiles = [], safe = 0, status = "On track", overs = [];
    var from0 = maxS(per.start, startOf(db, p)), dayNo = diff(from0, date) + 1, days = Math.max(1, diff(from0, per.next));
    budgetsOf(db, p, per).forEach(function (b) {
      var s = stt[b.id]; if (!s || !s.current) return;
      var mode = b.mode || "daily", tile = {id: b.id, name: b.name, mode: mode, amount: s.avail, spent: s.spent, left: s.left, over: s.over, pct: s.avail > 0 ? Math.min(100, Math.round(s.spent / s.avail * 100)) : (s.spent > 0 ? 100 : 0)};
      if (mode === "daily" || mode === "remainder") {
        var paceAmt = s.avail * dayNo / days; tile.day = round(Math.max(0, s.left) / daysLeft); tile.pace = round(paceAmt - s.spent); safe += tile.day;
      } else if (mode === "weekly") {
        var week = s.avail * 7 / days, weeksIn = Math.ceil(dayNo / 7), allowed = Math.min(s.avail, week * weeksIn);
        tile.week = round(week); tile.weekLeft = round(Math.max(0, allowed - s.spent)); tile.pace = round(allowed - s.spent);
        var dLeftWeek = 7 - ((dayNo - 1) % 7); tile.day = round(Math.min(tile.weekLeft / dLeftWeek, Math.max(0, s.left) / daysLeft * 7 / dLeftWeek)); safe += round(Math.max(0, s.left) / daysLeft);
      } else { tile.day = null; tile.pace = round(s.left); }
      tile.paceMark = Math.round(Math.min(1, dayNo / days) * 100);
      if (tile.pace < -0.5 && mode !== "oneoff") status = "A bit ahead";
      if (s.left < -0.004) overs.push({id: b.id, name: b.name, over: round(-s.left)});
      tiles.push(tile);
    });
    // a budget gone over that's been covered (the move from the pot that covers going over is ticked) isn't a worry:
    // it's said as that, and each one says what covered it
    if (overs.length) {
      var rbs = reimbursements(db, p, per, date);
      overs.forEach(function (o) {
        var gs = rbs.filter(function (g) { return g.kind === "over" && g.key.indexOf("cover:" + o.id + ":") === 0; });
        o.covered = gs.length > 0 && gs.every(function (g) { return ticked(db, p, g.key) >= g.amount - 0.004; });
        if (gs.length) o.from = accName(db, gs[0].from);
      });
      status = overs.every(function (o) { return o.covered; }) ? "Over, but covered" : "Over budget";
    }
    var cash = 0, main = mainOf(db, p);
    // cap by money actually there (spending accounts minus what's still due before payday)
    var spendAccs = dict(); tiles.forEach(function (t) { var b = db.byId[t.id]; if (t.day !== null) spendAccs[b.account || main] = true; });
    var committed = 0; flows(db, date, addDays(per.next, -1)).forEach(function (f) { if (spendAccs[f.account]) committed += f.amount; });
    Object.keys(spendAccs).forEach(function (a) { cash += bal[a] || 0; });
    // money set aside for a yearly cost that isn't due before payday isn't spare
    Object.keys(plan.setAside || {}).forEach(function (id) { var b = db.byId[id], acc = b ? b.account || main : ""; if (spendAccs[acc]) committed -= Math.min(plan.setAside[id], Math.max(0, bal[acc] || 0)); });
    var cashFree = round(Math.max(0, cash + committed));
    var cap = round(cashFree / daysLeft);
    if (safe > cap) { safe = cap; status = cashFree <= 0 ? "No spare cash" : status; }
    var nxt = payDates(db, p, addDays(date, 1), addDays(date, 70))[0] || per.next, nplan = planFor(db, p, periodAt(db, p, nxt));
    // what's spare in the main account now (beyond what its budgets and bills still need) goes where whatever's left
    // goes on payday: said when that's somewhere else, a Cash ISA say
    var lo = nplan.lines.filter(function (l) { return l.leftover; })[0], rl = nplan.lines.filter(function (l) { return l.remainder; })[0], spare = null;
    if (lo && rl && rl.account !== main && rl.amount > 0.004) spare = {amount: round(Math.min(lo.amount, rl.amount)), to: rl.account, toName: accName(db, rl.account), date: nxt};
    return {date: date, period: per, plan: plan, daysLeft: daysLeft, safe: round(safe), status: status, overs: overs, tiles: tiles, cashFree: cashFree, nextPay: nxt,
      nextPayAmount: (nplan.lines.filter(function (l) { return l.isPay; })[0] || {}).amount || 0, spare: spare,
      todo: todo(db, p, date), coming: coming(db, p, date, 14)};
  }
  function coming(db, p, date, days) {
    var to = addDays(date, days + 1), out = [], from = addDays(date, 1);
    var add = function (o, kind, name, amount, account, sign) { out.push({date: o.date, key: o.key, item: o.item.id, table: kind, name: name, amount: round(amount), sign: sign, account: accName(db, account), changed: o.changed}); };
    db.bills.forEach(function (b) { if (b.person === p) occurrences(db, b, from, to).forEach(function (o) { add(o, "bills", b.name, o.amount, b.account, -1); }); });
    db.income.forEach(function (i) { if (i.person === p) occurrences(db, i, from, to).forEach(function (o) { add(o, "income", i.isPay ? "Payday" : i.name, o.amount, i.account, 1); }); });
    db.transfers.forEach(function (t) {
      if (t.from === p || t.to === p) occurrences(db, t, from, to).forEach(function (o) { add(o, "transfers", t.from === p ? (t.name || "Transfer") + " to " + person(db, t.to).name : person(db, t.from).name + ": " + (t.name || "transfer"), o.amount, t.from === p ? t.fromAccount : t.toAccount, t.from === p ? -1 : 1); });
    });
    db.loans.forEach(function (l) { loanPlan(db, l).forEach(function (r) { if (r.paid || r.date < from || r.date >= to) return; if (l.borrower === p) out.push({date: r.date, key: r.key, item: l.id, table: "loans", name: "Pay " + person(db, l.lender).name + " back", amount: r.left, sign: -1, account: accName(db, mainOf(db, p))}); if (l.lender === p) out.push({date: r.date, key: r.key, item: l.id, table: "loans", name: person(db, l.borrower).name + " pays you back", amount: r.left, sign: 1, account: accName(db, mainOf(db, p))}); }); });
    return out.sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : 0; });
  }
  // everything due on each day of a month, for the calendar
  function calendar(db, p, year, month) {
    var from = ymd(year, month, 1), to = ymd(year, month + 1, 1), days = {};
    // (coming() looks from the day after the one it's given, up to and including the number of days after it, so the
    // last day of the month is in too)
    var all = coming(db, p, addDays(from, -1), diff(from, to));
    all.forEach(function (c) { (days[c.date] = days[c.date] || []).push(c); });
    return days;
  }

  // ---------- pots view ----------
  function pots(db, p, date) {
    var bal = balances(db, date), items = todo(db, p, date), pend = dict();
    items.forEach(function (t) { if (t.type === "move") { pend[t.from] = (pend[t.from] || 0) - t.amount; pend[t.to] = (pend[t.to] || 0) + t.amount; } });
    return accountsOf(db, p).filter(function (a) { return /main|pot|saving/.test(a.kind || "pot"); }).map(function (a) {
      return {id: a.id, name: a.name, kind: a.kind, purpose: a.purpose, now: round(bal[a.id] || 0), should: round((bal[a.id] || 0) + (pend[a.id] || 0)), pending: round(pend[a.id] || 0), fallback: !!a.fallback};
    });
  }

  // ---------- months and the year ----------
  function monthView(db, p, per) {
    var pl = planFor(db, p, per), st = budgetState(db, p, per);
    var spentFor = function (l) { var s = st[l.id]; return s && s.period.start === per.start ? s : null; };
    return {period: per, plan: pl, lines: pl.lines.map(function (l) { var s = (l.kind === "spend") ? spentFor(l) : null; return Object.assign({}, l, s ? {spent: s.spent, avail: s.avail, left: s.left} : {}); })};
  }
  function year(db, p, date) {
    var cur = periodAt(db, p, date), list = [], per = cur;
    for (var i = 0; i < 6; i++) { var pv = prevPeriod(db, p, per); if (!pv || pv.start >= per.start || pv.next <= startOf(db, p)) break; per = pv; }
    for (var k = 0; k < 12; k++) {
      var pl = planFor(db, p, per), st = budgetState(db, p, per), spent = 0;
      Object.keys(st).forEach(function (id) { if (st[id].period.start === per.start) spent += st[id].spent; });
      list.push({period: per, in: pl.totals.in, bills: pl.totals.bills, spendPlan: pl.totals.spend, spent: round(spent), save: pl.totals.save, past: per.next <= date, current: per.start === cur.start});
      per = nextPeriod(db, p, per);
    }
    return list;
  }

  // ---------- goals, LISA, net worth ----------
  function accountValue(db, accId, date) { return round(balances(db, date)[accId] || 0); }
  function goals(db, p, date) {
    var bal = balances(db, date);
    return db.goals.filter(function (g) { return String(g.owners || p).split(/[,\s]+/).indexOf(p) >= 0; }).map(function (g) {
      var saved = +g.extra || 0, parts = [];
      String(g.accounts || "").split(/[,\s]+/).filter(Boolean).forEach(function (a) { var v = round(bal[a] || 0); saved += v; parts.push({account: a, name: accName(db, a), owner: (db.byId[a] || {}).owner, amount: v}); });
      var target = +g.target || 0;
      return {id: g.id, name: g.name, kind: g.kind, target: target, saved: round(saved), pct: target ? Math.min(100, Math.round(saved / target * 100)) : 0, due: g.due || "", parts: parts, notes: g.notes};
    });
  }
  function taxYearStart(date) { var y = +date.slice(0, 4); var s = ymd(y, 3, 6); return date >= s ? s : ymd(y - 1, 3, 6); }
  function lisa(db, accId, date) {
    var tys = taxYearStart(date), paid = 0, all = 0;
    // history copied from the provider's statement lives in moves with keys lisa:in / lisa:bonus / lisa:fee
    var bonusIds = dict(), feeIds = dict(), bonusIn = 0, fees = 0;
    db.moves.forEach(function (m) {
      if (/^lisa:bonus/.test(m.key || "") && m.to === accId) { bonusIds[m.id] = 1; if (m.date >= tys && m.date <= date) bonusIn += +m.amount || 0; }
      if (/^lisa:fee/.test(m.key || "") && m.from === accId) { feeIds[m.id] = 1; if (m.date >= tys && m.date <= date) fees += +m.amount || 0; }
    });
    var months = {}, mk = function (d) { return d.slice(0, 7); }, from12 = ymd(+date.slice(0, 4), +date.slice(5, 7) - 12, 1);
    var acc = db.byId[accId], ownerStart = acc ? startOf(db, acc.owner) : "", inBeforeStart = 0;
    flows(db, "2000-01-01", date).forEach(function (f) {
      if (f.account !== accId || !f.src || /^val/.test(f.src)) return;
      if (f.date >= from12) { var b = months[mk(f.date)] = months[mk(f.date)] || {paid: 0, bonus: 0, fees: 0}; if (bonusIds[f.src]) b.bonus += f.amount; else if (feeIds[f.src] || f.amount < 0) b.fees += -f.amount; else b.paid += f.amount; }
      if (f.amount > 0 && !bonusIds[f.src]) { if (f.date >= tys) { paid += f.amount; if (f.date < ownerStart) inBeforeStart += f.amount; } all += f.amount; }
    });
    var monthList = [];
    for (var mi = 11; mi >= 0; mi--) { var key = ymd(+date.slice(0, 4), +date.slice(5, 7) - 1 - mi, 1).slice(0, 7), bk = months[key] || {paid: 0, bonus: 0, fees: 0}; monthList.push({month: key, paid: round(bk.paid), bonus: round(bk.bonus), fees: round(bk.fees)}); }
    paid = round(Math.min(paid, 1e9));
    var bal = accountValue(db, accId, date), bonus = round(Math.min(1000, paid * 0.25));
    var series = [], first = "9999";
    db.valuations.forEach(function (v) { if (v.account === accId && v.date < first) first = v.date; });
    if (first === "9999" && acc) first = startOf(db, acc.owner);
    for (var i = 23; i >= 0; i--) { var d = ymd(+date.slice(0, 4), +date.slice(5, 7) - 1 - i, 1); if (i === 0) d = date; if (d >= first) series.push({date: d, amount: accountValue(db, accId, d)}); }
    // paid in before Budgie started tracking (from the person's Moneybox app), so the £4,000 limit is right;
    // statement rows copied in for the same months are the same money, so only the rest counts
    var before = acc ? +setting(db, acc.owner, "lisa.paidBefore." + accId, 0) || 0 : 0;
    if (before && tys <= ownerStart) paid = round(paid + Math.max(0, before - inBeforeStart));
    bonus = round(Math.min(1000, paid * 0.25));
    // what's still planned to go in before the tax year ends: savings on each payday (including this period's,
    // until its move is ticked) and money paid straight in
    var tyEnd = addDays(ymd(+tys.slice(0, 4) + 1, 3, 6), -1), planned = 0, owner = acc ? acc.owner : "";
    if (owner) {
      var cur = periodAt(db, owner, date);
      payDates(db, owner, maxS(cur.start, tys), addDays(tyEnd, 1)).forEach(function (d) {
        if (d <= date && ticked(db, owner, "pay:" + d + ":" + accId)) return;
        var pk = periodAt(db, owner, d); if (pk.start !== d || pk.opening) return;
        db.budgets.forEach(function (b) { if (b.person === owner && b.mode === "saving" && b.account === accId && activeIn(b, pk)) planned += budgetAmount(db, b, pk); });
      });
      db.income.forEach(function (i) { if (i.account === accId) occurrences(db, i, addDays(date, 1), addDays(tyEnd, 1)).forEach(function (o) { planned += o.amount; }); });
    }
    var onCourse = round(paid + planned), exp = expectedBonus(db, accId, date, before, ownerStart), expTot = 0;
    exp.forEach(function (x) { expTot += x.amount; });
    return {account: accId, name: accName(db, accId), balance: bal, paidThisYear: paid, paidBefore: before, allowanceLeft: round(Math.max(0, 4000 - paid)), bonusThisYear: bonus, taxYearStart: tys, taxYearEnd: tyEnd,
      planned: round(planned), onCourse: onCourse, overBy: round(Math.max(0, onCourse - 4000)), series: series,
      bonusReceived: round(bonusIn), feesThisYear: round(fees), months: monthList, checks: db.valuations.filter(function (v) { return v.account === accId; }).length,
      expectedBonus: exp, expectedBonusTotal: round(expTot)};
  }
  // the government bonus still to come: 25% of each payment in that hasn't had its bonus yet, by the month it was
  // paid in: [{amount, due, for: "YYYY-MM"}]. Not part of the balance until it lands.
  // Payments in: statement rows (lisa:in, not the ones that are the same money as a ticked move), payday ticks
  // (pay:<date>:<acc>) and bank feed rows (bank:…) into the LISA. Bonuses: lisa:bonus moves.
  // Moneybox claims the bonus monthly and it lands 4 to 6 weeks after the payment, so due = payment + 6 weeks.
  // Matching: bonuses are taken in date order, and each one settles the oldest payments still waiting that were made
  // before it landed (a bonus is never for money paid later). So one bonus can settle two payments (167 on 30 Jul for
  // 11 May and 9 Jul), and later ones go to the next in line (83.50 on 3 Sep for 7 Aug, 1 Oct for 9 Sep, 26 Oct for
  // 30 Sep). Whatever a bonus has left over is for money paid in before the history Budgie has, and is dropped.
  // Payments over the £4,000 a tax year get no bonus.
  function expectedBonus(db, accId, date, before, ownerStart) {
    var pays = [], bons = [];
    db.moves.forEach(function (m) {
      var k = String(m.key || ""), a = +m.amount || 0;
      if (m.to !== accId || !(a > 0) || m.date > date) return;
      if (/^lisa:bonus/.test(k)) bons.push({date: m.date, amount: a});
      else if (!m.dup && (/^lisa:in/.test(k) || /^pay:\d{4}-\d{2}-\d{2}:/.test(k) || /^bank:/.test(k))) pays.push({date: m.date, amount: a});
    });
    // money paid straight in on a schedule (family topping it up) earns the bonus too, as the balance counts it
    db.income.forEach(function (i) {
      if (i.account !== accId) return;
      occurrences(db, i, startOf(db, i.person), addDays(date, 1)).forEach(function (o) { if (o.amount > 0) pays.push({date: o.date, amount: o.amount}); });
    });
    var byDate = function (x, y) { return x.date < y.date ? -1 : x.date > y.date ? 1 : 0; };
    pays.sort(byDate); bons.sort(byDate);
    // what's been paid in each tax year so far (money paid before Budgie's history counts towards the £4,000)
    var cum = {}, early = 0, sty = ownerStart ? taxYearStart(ownerStart) : "";
    pays.forEach(function (x) { if (sty && x.date >= sty && x.date < ownerStart) early += x.amount; });
    if (sty && before) cum[sty] = Math.max(0, before - early);
    pays.forEach(function (x) { var ty = taxYearStart(x.date), c = cum[ty] || 0; x.want = 0.25 * Math.min(x.amount, Math.max(0, 4000 - c)); cum[ty] = c + x.amount; });
    var i0 = 0;
    bons.forEach(function (bn) {
      var credit = bn.amount;
      for (var i = i0; i < pays.length && credit > 0.004 && pays[i].date < bn.date; i++) {
        var take = Math.min(credit, pays[i].want); pays[i].want -= take; credit -= take;
      }
      while (i0 < pays.length && pays[i0].want <= 0.004) i0++;
    });
    var months = {}, out = [];
    pays.forEach(function (x) {
      if (!(x.want > 0.004)) return;
      var k = x.date.slice(0, 7), m = months[k];
      if (!m) { m = months[k] = {amount: 0, due: "", "for": k}; out.push(m); }
      m.amount += x.want; m.due = maxS(m.due, addDays(x.date, 42));
    });
    out.forEach(function (m) { m.amount = round(m.amount); });
    return out;
  }

  // ---------- yearly costs, for the Bills screen ----------
  // [{id, name, amount, next, monthly, saved, account, accountName, periods, onTrack}], soonest first
  // next/amount: the next time it's due on or after date. monthly: what this pay period sets aside for it (when it's
  // due this pay period: the part this pay covers, after what was saved). saved: what's put by for it now (once this
  // period's set-aside is in). periods: pay periods left until it's due, this one included. onTrack: the pot really
  // holds what was set aside, and this pay stretches to it.
  function yearly(db, p, date) {
    var per = periodAt(db, p, date), pl = planFor(db, p, per), pd = payday(db, p, per), main = mainOf(db, p);
    return setAsideBills(db, p).map(function (b) {
      var o = nextOcc(db, b, date), acc = b.account || main, line = null, used = null;
      pl.lines.forEach(function (l) { if (l.setAside && l.bill === b.id) { if (l.kind === "save") line = l; else used = l; } });
      var dueNow = !!o && o.date < per.next, saved = dueNow ? (used ? used.amount : 0) : (pl.setAside[b.id] || 0);
      var monthly = dueNow ? Math.max(0, o.amount - saved) : (line ? line.amount : 0);
      return {id: b.id, name: b.name, amount: o ? o.amount : amountAt(db, b, date), next: o ? o.date : "", monthly: round(monthly), saved: round(saved), account: acc, accountName: accName(db, acc),
        periods: o ? Math.max(1, periodsUntil(db, p, per, o.date) - (per.opening && o.date >= per.next ? 1 : 0)) : 0, onTrack: !(pl.setAsideShort[b.id] > 0.004) && !(pd.uncovered > 0.004)};
    }).sort(function (a, b) { return (a.next || "9999") < (b.next || "9999") ? -1 : (a.next || "9999") > (b.next || "9999") ? 1 : 0; });
  }

  // ---------- the tax year round-up ----------
  // yearReview(db, p, "YYYY-04-06"): the tax year so far (to the day the data was loaded for), or the whole of it.
  // {from, to, until, in, bills, billsBy: [{id, name, amount, count}], saved, savedPct, spent: [{budget, name, amount}],
  //  lisa: {paidIn, bonus, fees, value, expectedBonus}, goals: [{id, name, start, end, target}],
  //  biggestMonth: {month: "YYYY-MM", name, amount} or null, noSpendDays}
  // in and bills are what the plan counts: pay and other income, your partner's transfers and loan repayments to you;
  // bills, transfers to your partner and loan repayments you make. saved is what went into savings, ISAs and the LISA
  // (planned savings, what's left, top-ups and money paid straight in), less what came back out of them.
  // spent is your share of logged payments by budget. Only days from when tracking started count.
  function yearReview(db, p, tys) {
    var from = taxYearStart(parseDate(tys) || db.today || startOf(db, p)), to = addDays(ymd(+from.slice(0, 4) + 1, 3, 6), -1), st = startOf(db, p);
    var until = db.today && db.today < to ? db.today : to, lo = maxS(from, st), end = addDays(until, 1), live = lo <= until;
    var main = mainOf(db, p), tin = 0, tbill = 0, billsBy = dict(), billList = [];
    var addBill = function (id, name, amt) { var x = billsBy[id]; if (!x) { x = billsBy[id] = {id: id, name: name, amount: 0, count: 0}; billList.push(x); } x.amount += amt; x.count++; tbill += amt; };
    if (live) {
      db.income.forEach(function (i) { if (i.person === p) occurrences(db, i, lo, end).forEach(function (o) { tin += o.amount; }); });
      db.transfers.forEach(function (t) {
        if (t.to !== p && t.from !== p) return;
        occurrences(db, t, maxS(lo, startOf(db, t.from)), end).forEach(function (o) { if (t.to === p) tin += o.amount; else addBill(t.id, (t.name || t.purpose || "Transfer") + " (to " + person(db, t.to).name + ")", o.amount); });
      });
      db.bills.forEach(function (b) { if (b.person === p) occurrences(db, b, lo, end).forEach(function (o) { addBill(b.id, b.name, o.amount); }); });
      db.loans.forEach(function (l) {
        if (l.lender !== p && l.borrower !== p) return;
        loanDue(db, l, lo, end).forEach(function (r) { if (l.lender === p) tin += r.amount; else addBill(l.id, "Pay " + person(db, l.lender).name + " back: " + l.name, r.amount); });
      });
    }
    // saved: from each pay period that started in the year, less money taken back out of savings
    var saved = 0, mineSaving = function (acc) { var a = db.byId[acc]; return !!a && a.owner === p && savingKind(db, acc); };
    if (live) {
      trackedBefore(db, p, end).forEach(function (pk) {
        if (pk.start < lo) return;
        planFor(db, p, pk).lines.forEach(function (l) { if ((l.kind === "save" || l.kind === "topup") && !l.setAside && mineSaving(l.account)) saved += l.amount; });
      });
      db.moves.forEach(function (m) { if (!m.dup && m.date >= lo && m.date <= until && !/^lisa:/.test(m.key || "") && mineSaving(m.from) && !mineSaving(m.to)) saved -= +m.amount || 0; });
      db.transactions.forEach(function (x) { if (x.date >= lo && x.date <= until && mineSaving(x.account)) saved -= +x.amount || 0; });
    }
    // spending by budget and by calendar month, and the days you spent nothing
    var spentBy = dict(), spentList = [], months = {}, spendDay = {}, byName = dict();
    db.budgets.forEach(function (b) { if (b.person === p) byName[String(b.name).toLowerCase()] = b; });
    if (live) db.transactions.forEach(function (x) {
      if (x.date < lo || x.date > until) return;
      if (x.person === p && +x.amount > 0) spendDay[x.date] = true;
      var sh = myShare(db, p, x); if (!sh) return;
      var b = db.byId[x.budget], mine = b && b.person === p ? b : (b && byName[String(b.name).toLowerCase()]) || null, k = mine ? mine.id : b ? b.id : "";
      var g = spentBy[k]; if (!g) { g = spentBy[k] = {budget: k, name: mine ? mine.name : b ? b.name : "Other", amount: 0}; spentList.push(g); }
      g.amount += sh; months[x.date.slice(0, 7)] = (months[x.date.slice(0, 7)] || 0) + sh;
    });
    spentList.forEach(function (g) { g.amount = round(g.amount); });
    spentList = spentList.filter(function (g) { return Math.abs(g.amount) > 0.004; }).sort(function (a, b) { return b.amount - a.amount; });
    var big = null; Object.keys(months).sort().forEach(function (k) { if (!big || months[k] > big.amount + 0.004) big = {month: k, name: MONTHS[+k.slice(5, 7) - 1] + " " + k.slice(0, 4), amount: months[k]}; });
    if (big) big.amount = round(big.amount);
    var noSpend = 0; if (live) for (var d = lo; d <= until; d = addDays(d, 1)) if (!spendDay[d]) noSpend++;
    // the LISA over the year (added up if there's more than one)
    var L = {paidIn: 0, bonus: 0, fees: 0, value: 0, expectedBonus: 0};
    accountsOf(db, p).forEach(function (a) {
      if (a.kind !== "lisa") return;
      var x = lisa(db, a.id, until); L.paidIn += x.paidThisYear; L.bonus += x.bonusReceived; L.fees += x.feesThisYear; L.value += x.balance; L.expectedBonus += x.expectedBonusTotal;
    });
    Object.keys(L).forEach(function (k) { L[k] = round(L[k]); });
    // goals at the start: the day before the tax year, or, when tracking started during it, the balances you started with
    var gStart = lo > st ? addDays(lo, -1) : lo, g0 = dict(); goals(db, p, gStart).forEach(function (g) { g0[g.id] = g.saved; });
    billList.forEach(function (x) { x.amount = round(x.amount); });
    saved = round(saved); tin = round(tin);
    return {from: from, to: to, until: until, "in": tin, bills: round(tbill), billsBy: billList.sort(function (a, b) { return b.amount - a.amount; }),
      saved: saved, savedPct: tin > 0 ? Math.round(saved / tin * 100) : 0, spent: spentList, lisa: L,
      goals: goals(db, p, live ? until : gStart).map(function (g) { return {id: g.id, name: g.name, start: round(g0[g.id] || 0), end: g.saved, target: g.target}; }),
      biggestMonth: big, noSpendDays: noSpend};
  }

  // ---------- things to check ----------
  // settings rows "check:<id>" hold {t: what to check, a: action, v: what it opens}; "done" once confirmed
  // date (optional, default the day the data was loaded for): adds a monthly reminder to check each Lifetime ISA
  // that hasn't had its value checked in the last 30 days. It isn't stored: a new valuation clears it, and
  // "It's right" (settings check:<id> = done) hides it for that month only, as the id carries the month.
  function checks(db, p, date) {
    var s = db.set[p] || NO_SETTINGS, out = [];
    Object.keys(s).forEach(function (k) {
      if (!/^check:/.test(k) || !s[k] || /^done$/i.test(String(s[k]))) return;
      var c; try { c = JSON.parse(s[k]); } catch (e) { c = {t: String(s[k])}; }
      out.push({id: k.slice(6), key: k, text: c.t || "", action: c.a || "", value: c.v || "", order: +c.o || 50});
    });
    date = date || db.today;
    if (isIso(date)) accountsOf(db, p).forEach(function (a) {
      if (a.kind !== "lisa") return;
      var id = "lisa-month-" + date.slice(0, 7) + "-" + a.id, since = addDays(date, -30);
      if (s["check:" + id] !== undefined && s["check:" + id] !== "") return;   // dismissed (or stored) for this month
      if (db.valuations.some(function (v) { return v.account === a.id && v.date >= since && v.date <= date; })) return;
      out.push({id: id, key: "check:" + id, text: "Check your Lifetime ISA in Moneybox and update its value", action: "potcheck", value: a.id, order: 40});
    });
    return out.sort(function (a, b) { return a.order - b.order; });
  }
  function netWorth(db, p, date) {
    var bal = balances(db, date), own = 0, owe = 0, rows = [];
    accountsOf(db, p).forEach(function (a) { var v = round(bal[a.id] || 0); if (a.kind === "credit") { owe += -v; rows.push({name: a.name, amount: v, owe: true}); } else { own += v; rows.push({name: a.name, amount: v}); } });
    db.loans.forEach(function (l) {
      var left = round((+l.amount || 0) - loanPaid(db, l, date)); if (left <= 0) return;
      if (l.lender === p) { own += left; rows.push({name: person(db, l.borrower).name + " owes you: " + l.name, amount: left}); }
      if (l.borrower === p) { owe += left; rows.push({name: "You owe " + person(db, l.lender).name + ": " + l.name, amount: -left, owe: true}); }
    });
    return {own: round(own), owe: round(owe), total: round(own - owe), rows: rows};
  }
  function loans(db, p, date) {
    return db.loans.filter(function (l) { return l.lender === p || l.borrower === p; }).map(function (l) {
      var paid = loanPaid(db, l, date), left = round((+l.amount || 0) - paid);
      return {id: l.id, name: l.name, lender: l.lender, borrower: l.borrower, amount: +l.amount || 0, notes: String(l.notes || ""), paid: paid, left: left, pct: l.amount ? Math.round(paid / l.amount * 100) : 0, plan: loanPlan(db, l).filter(function (r) { return !r.paid; }).map(function (r) { return Object.assign({}, r, {amount: r.left}); })};
    });
  }

  // ---------- partner summary (what the other person sees) ----------
  function summary(db, p, date) {
    var t = today(db, p, date), share = function (k, d) { var v = setting(db, p, "share." + k, d); return v === true || /^(true|yes|on|1)$/i.test(String(v)); };
    var out = {person: p, name: person(db, p).name, nextPay: t.nextPay, period: t.period};
    // "on track" or "over budget" says how the money's going, so it's only there when some of it is shared
    if (share("totals", true) || share("cats", true)) out.status = t.status;
    if (share("totals", true)) { out.safe = t.safe; out.saved = t.plan.totals.save; }
    if (share("cats", true)) out.tiles = t.tiles.map(function (x) { return {name: x.name, spent: x.spent, amount: x.amount, pct: x.pct, paceMark: x.paceMark, mode: x.mode}; });
    // only how far each goal has got: not the balance of each account in it, or its notes
    if (share("goals", true)) out.goals = goals(db, p, date).filter(function (g) { return String((db.byId[g.id] || {}).owners || "").split(/[,\s]+/).length < 2; })
      .map(function (g) { return {id: g.id, name: g.name, kind: g.kind, target: g.target, saved: g.saved, pct: g.pct, due: g.due}; });
    return out;
  }

  // ---------- helpers for display ----------
  // rounded as everything else is (so half of £20.15 shows as the £10.08 that's owed, not £10.07)
  function money(n) { var r = round(n), s = Math.abs(r).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ","); return (r < 0 ? "-£" : "£") + s; }
  var DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  function nice(s) { if (!isIso(s)) return ""; return DAYS[dow(s)] + " " + (+s.slice(8, 10)) + " " + MONTHS[+s.slice(5, 7) - 1]; }
  function describe(it) {
    var u = String(it.unit || "month").toLowerCase(), e = +it.every || 1, on = String(it.on || (it.start ? +it.start.slice(8, 10) : "")).toLowerCase();
    var ord = function (n) { n = +n; return n + (n % 10 === 1 && n !== 11 ? "st" : n % 10 === 2 && n !== 12 ? "nd" : n % 10 === 3 && n !== 13 ? "rd" : "th"); };
    var onTxt = /^\d+$/.test(on) ? "on the " + ord(on) : on ? "on the " + on : "";
    if (u === "once") return "Once, " + nice(it.start);
    if (u === "dates") return "On set dates";
    if (u === "week" || u === "weeks") return e === 1 ? "Every week" : "Every " + e + " weeks";
    if (u === "year" || u === "years") return "Every year, " + (it.start ? (+it.start.slice(8, 10)) + " " + MONTHS[+it.start.slice(5, 7) - 1] : "");
    return (e === 1 ? "Every month " : e === 3 ? "Every 3 months " : "Every " + e + " months ") + onTxt;
  }

  return {
    VERSION: VERSION, TABLES: TABLES,
    load: load, occurrences: occurrences, scheduleDates: scheduleDates, isWorkingDay: isWorkingDay, bankHolidays: bankHolidays,
    periods: periods, periodAt: periodAt, prevPeriod: prevPeriod, nextPeriod: nextPeriod, planFor: planFor, payday: payday,
    budgetState: budgetState, balances: balances, flows: flows, todo: todo, between: between, today: today, coming: coming,
    calendar: calendar, pots: pots, monthView: monthView, year: year, goals: goals, lisa: lisa, checks: checks, netWorth: netWorth, loans: loans,
    yearly: yearly, yearReview: yearReview, taxYearStart: taxYearStart,
    summary: summary, shareOf: shareOf, myShare: myShare, owedAt: owedAt, amountAt: amountAt, setting: setting, partnerOf: partnerOf, mainOf: mainOf, fallbackOf: fallbackOf,
    accountsOf: accountsOf, accName: accName, ticked: ticked, person: person, startOf: startOf, moveDate: moveDate, budgetsOf: budgetsOf, budgetsIn: budgetsOf, reimbursements: reimbursements, startBalances: startBalances,
    money: money, nice: nice, describe: describe, addDays: addDays, diff: diff, parseDate: parseDate, isIso: isIso, round: round
  };
});
