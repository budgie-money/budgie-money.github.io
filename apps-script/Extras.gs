/* Budgie extras: the Sunday money email, a weekly backup of the sheet, and a round-up of each tax year.
   Sits beside Code.gs and Engine.gs (or after them in the one-file Budgie.gs) and uses their helpers.

   Switch it on (once): run installExtras and allow the two new permissions Google asks for
   (send email as you, and Google Drive for the backup). It never removes any other trigger.
     - sendSundayEmails  Sundays, 6 to 7pm      to everyone who turned on the Sunday email in the app
     - backupNow         Sundays, 3 to 4am      a copy of this sheet's tabs (values only) in the folder in Script
                                                Property BACKUP_FOLDER_ID
     - yearReviewCheck   every day, 9 to 10am   on or just after 6 April, sends last tax year's round-up once
   Try them first: previewSundayEmail("ethan"), previewYearReview("ethan") (both only write to the log), backupNow.

   Privacy: a backup is the whole sheet, so it is only made into a folder nobody else can open.
   Each email is worked out from exactly the rows that person's phone gets (sync_ with canSee_), so the
   partner's private payments, pay and budgets never reach it unless the partner shares them. Emails never hold
   keys, connect links or the web app address. */

var EXTRAS_APP_LINK = typeof APP_URL !== "undefined" && APP_URL ? APP_URL : "https://budgie-money.github.io/";
var EXTRAS_KEEP_BACKUPS = 8;
var EXTRAS_BACKUP_NAME = "Budgie data backup ";
var EXTRAS_REVIEW_DAYS = 30;   // how long after 6 April the round-up can still go out (if the trigger missed a day)
var EXTRAS_TRIGGERS_ = [
  {fn: "sendSundayEmails", what: "the Sunday money email, Sundays between 6 and 7pm", make: function (b) { return b.onWeekDay(ScriptApp.WeekDay.SUNDAY).atHour(18); }},
  {fn: "backupNow", what: "a backup of the sheet, Sundays between 3 and 4am", make: function (b) { return b.onWeekDay(ScriptApp.WeekDay.SUNDAY).atHour(3); }},
  {fn: "yearReviewCheck", what: "the tax-year round-up check, every day between 9 and 10am", make: function (b) { return b.everyDays(1).atHour(9); }}
];

// ---------- setup ----------
/** Run once: adds the three triggers if they aren't there yet. Other triggers are left alone. */
// Google lets you approve a script's permissions one by one, so Mail or Drive can be listed but never approved.
// This asks for them (the editor then shows Google's approval screen) before anything relies on them.
var EXTRAS_SCOPES_ = ["https://www.googleapis.com/auth/script.send_mail", "https://www.googleapis.com/auth/drive"];
function extrasScopesMissing_() {
  try {
    var info = ScriptApp.getAuthorizationInfo(ScriptApp.AuthMode.FULL, EXTRAS_SCOPES_);
    return info.getAuthorizationStatus() === ScriptApp.AuthorizationStatus.REQUIRED ? (info.getAuthorizedScopes ? EXTRAS_SCOPES_.filter(function (x) { return info.getAuthorizedScopes().indexOf(x) < 0; }) : EXTRAS_SCOPES_) : [];
  } catch (e) { return []; }
}
function installExtras() {
  if (extrasScopesMissing_().length && ScriptApp.requireScopes) {
    // stops here with Google's approval screen; tick every box, then run installExtras again
    ScriptApp.requireScopes(ScriptApp.AuthMode.FULL, EXTRAS_SCOPES_);
  }
  var missing = extrasScopesMissing_();
  if (missing.length) Logger.log("Not approved yet: " + missing.join(", ") + ". Run installExtras again and tick every box on Google's screen, or the email and backup can't run.");
  var have = {};
  ScriptApp.getProjectTriggers().forEach(function (t) { have[t.getHandlerFunction()] = true; });
  EXTRAS_TRIGGERS_.forEach(function (x) {
    if (have[x.fn]) { Logger.log("Already set: " + x.what + "."); return; }
    x.make(ScriptApp.newTrigger(x.fn).timeBased()).inTimezone(tz_()).create();
    Logger.log("Added: " + x.what + ".");
  });
  var on = exRecipients_().map(function (r) { return r.name; });
  Logger.log(on.length ? "Sunday email is on for: " + on.join(", ") + "." : "Nobody has the Sunday email on yet. Each of you can turn it on in the app.");
  if (!PropertiesService.getScriptProperties().getProperty("BACKUP_FOLDER_ID")) Logger.log("Backups: add Script Property BACKUP_FOLDER_ID (the folder's id from its Drive link) so the weekly backup has somewhere to go.");
}

// ---------- shared helpers ----------
function exTodayIso_() { return Utilities.formatDate(new Date(), tz_(), "yyyy-MM-dd"); }
function exOn_(v) { return v === true || /^(true|yes|on|1)$/i.test(String(v === undefined || v === null ? "" : v).trim()); }
function exEsc_(s) { return String(s === undefined || s === null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }
function exMoney_(n) { return Budgie.money(n); }
function exName_(s) { return String(s || "").replace(/ \(what's left\)/, ""); }
function exPlural_(n, one, many) { return n + " " + (n === 1 ? one : (many || one + "s")); }
var EX_MONTHS_ = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
function exMonthName_(ym) { return EX_MONTHS_[+ym.slice(5, 7) - 1] + " " + ym.slice(0, 4); }
function exYearShift_(iso, n) { return (+iso.slice(0, 4) + n) + iso.slice(4); }
function exTaxYearStart_(iso) { var s = iso.slice(0, 4) + "-04-06"; return iso >= s ? s : exYearShift_(s, -1); }
function exTaxYearLabel_(tys) { var y = +tys.slice(0, 4); return y + "/" + String(y + 1).slice(-2); }

// who gets the emails: settings rows email.sunday = true and email.to = an address, for a person in the people tab.
// Only each person's own rows count (never a row for everyone), so nobody's money goes to someone else's address.
function exRecipients_() {
  // (no built-in keys: a row typed in for a "person" called __proto__ is nobody's, and can't stand in for anyone's)
  var set = Object.create(null);
  readTable_("settings").rows.forEach(function (r) {
    if (exOn_(r.deleted) || !r.person || !/^email\./.test(String(r.key))) return;
    (set[r.person] = set[r.person] || Object.create(null))[String(r.key)] = r.value;
  });
  var out = [];
  readTable_("people").rows.forEach(function (p) {
    if (exOn_(p.deleted) || !p.id) return;
    var s = set[p.id] || Object.create(null), to = String(s["email.to"] || "").trim();
    if (!exOn_(s["email.sunday"])) return;
    if (!/^[^@\s,;<>]+@[^@\s,;<>]+\.[^@\s,;<>]+$/.test(to)) { Logger.log((p.name || p.id) + " turned the Sunday email on but the email address doesn't look right, so nothing was sent."); return; }
    out.push({id: p.id, name: p.name || p.id, to: to, colour: p.colour});
  });
  return out;
}

// what this person's phone would have: the same rows a full sync sends them, worked out by the engine
function exViewOf_(p, today, snap) {
  var res = sync_(p, "", true, snap || snapshot_());
  return Budgie.load(res.rows, today);
}
function exColour_(c, p) { return /^#[0-9a-f]{6}$/i.test(String(c || "")) ? c : (p === "sophie" ? "#2F7D6D" : "#2E5E8C"); }
function exPerson_(p) { var row = readTable_("people").rows.filter(function (x) { return x.id === p; })[0]; if (!row) throw new Error("No person called " + p + " in the people tab."); return {id: row.id, name: row.name || row.id, colour: row.colour}; }

// what one person spent on a budget between two dates (their share of split payments, and their partner's
// split payments under a budget of the same name, as the engine counts them)
function exSpent_(db, p, b, from, to) {
  var t = 0;
  db.transactions.forEach(function (x) {
    if (x.date < from || x.date > to) return;
    var tb = db.byId[x.budget], same = x.budget === b.id || (!!tb && tb.person !== b.person && String(tb.name).toLowerCase() === String(b.name).toLowerCase());
    if (same) t += Budgie.myShare(db, p, x);
  });
  return Budgie.round(t);
}

// ---------- email layout (one model, drawn as HTML and as plain text) ----------
// m: {subject, preheader, hello, intro, hero: {label, value, note}, sections: [{title, rows: [{label, sub, value, bad}], note}], why}
function exHtml_(m, colour) {
  var font = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
  var h = '<!DOCTYPE html><html lang="en-GB"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>' + exEsc_(m.subject) + "</title></head>" +
    '<body style="margin:0;padding:0;background:#F2F4F7;-webkit-text-size-adjust:100%">' +
    '<div style="display:none;max-height:0;overflow:hidden;opacity:0">' + exEsc_(m.preheader || "") + "</div>" +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#F2F4F7"><tr><td align="center" style="padding:16px 10px">' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;background:#FFFFFF;border-radius:16px;font-family:' + font + ';color:#1F2933">' +
    '<tr><td style="padding:22px 22px 6px"><div style="font-size:13px;font-weight:700;letter-spacing:.04em;color:' + colour + '">BUDGIE</div>' +
    '<div style="font-size:22px;font-weight:800;margin-top:6px">' + exEsc_(m.hello) + "</div>" +
    (m.intro ? '<div style="font-size:15px;color:#566273;margin-top:4px">' + exEsc_(m.intro) + "</div>" : "") + "</td></tr>";
  if (m.hero) h += '<tr><td style="padding:12px 22px"><div style="background:' + colour + ';color:#FFFFFF;border-radius:14px;padding:16px 18px">' +
    '<div style="font-size:14px;opacity:.9">' + exEsc_(m.hero.label) + '</div><div style="font-size:34px;font-weight:800;line-height:1.2;margin-top:2px">' + exEsc_(m.hero.value) + "</div>" +
    (m.hero.note ? '<div style="font-size:14px;opacity:.9;margin-top:4px">' + exEsc_(m.hero.note) + "</div>" : "") + "</div></td></tr>";
  m.sections.forEach(function (s) {
    h += '<tr><td style="padding:14px 22px 2px"><div style="font-size:17px;font-weight:800;margin-bottom:4px">' + exEsc_(s.title) + "</div>";
    if (s.rows && s.rows.length) {
      h += '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="font-size:15px">';
      s.rows.forEach(function (r) {
        h += '<tr><td style="padding:8px 0;border-top:1px solid #E6EAF0;vertical-align:top"><div style="font-weight:600">' + exEsc_(r.label) + "</div>" +
          (r.sub ? '<div style="font-size:13px;color:#566273;margin-top:2px">' + exEsc_(r.sub) + "</div>" : "") + "</td>" +
          '<td align="right" style="padding:8px 0 8px 12px;border-top:1px solid #E6EAF0;vertical-align:top;white-space:nowrap;font-weight:700;color:' + (r.bad ? "#B42318" : "#1F2933") + '">' + exEsc_(r.value || "") + "</td></tr>";
      });
      h += "</table>";
    }
    if (s.note) h += '<div style="font-size:14px;color:#566273;margin-top:4px">' + exEsc_(s.note) + "</div>";
    h += "</td></tr>";
  });
  h += '<tr><td style="padding:20px 22px 8px"><a href="' + exEsc_(EXTRAS_APP_LINK) + '" style="display:inline-block;background:' + colour + ';color:#FFFFFF;text-decoration:none;font-weight:700;font-size:16px;padding:12px 20px;border-radius:10px">Open Budgie</a></td></tr>' +
    '<tr><td style="padding:8px 22px 22px;font-size:12px;color:#7B8794">' + exEsc_(m.why) + "</td></tr>" +
    "</table></td></tr></table></body></html>";
  return h;
}
function exText_(m) {
  var out = [m.hello, m.intro || ""];
  if (m.hero) out.push("", m.hero.label + ": " + m.hero.value + (m.hero.note ? "\n" + m.hero.note : ""));
  m.sections.forEach(function (s) {
    out.push("", s.title.toUpperCase());
    (s.rows || []).forEach(function (r) { out.push("- " + r.label + (r.value ? ": " + r.value : "") + (r.sub ? " (" + r.sub + ")" : "")); });
    if (s.note) out.push(s.note);
  });
  out.push("", "Open Budgie: " + EXTRAS_APP_LINK, "", m.why);
  return out.join("\n");
}
function exSend_(r, m) {
  var colour = exColour_(r.colour, r.id);
  MailApp.sendEmail({to: r.to, subject: m.subject, htmlBody: exHtml_(m, colour), body: exText_(m), name: "Budgie"});
}

// ---------- 1. the Sunday money email ----------
function exSundayModel_(db, p, today) {
  var me = Budgie.person(db, p), t = Budgie.today(db, p, today), weekFrom = Budgie.addDays(today, -6), sections = [];
  var daysTo = Budgie.diff(today, t.nextPay);
  var payLine = daysTo <= 0 ? "Payday is today" : daysTo === 1 ? "Payday is tomorrow" : "Payday is in " + daysTo + " days, " + Budgie.nice(t.nextPay);
  if (t.nextPayAmount) payLine += " (" + exMoney_(t.nextPayAmount) + ")";
  // budgets: this week, and what's left until payday
  // (a "whatever is left" budget with nothing in it and nothing spent says nothing, so it's left out)
  var rows = t.tiles.filter(function (x) { return x.amount > 0.004 || x.spent > 0.004; }).map(function (x) {
    var b = db.byId[x.id] || {id: x.id, name: x.name, person: p}, week = exSpent_(db, p, b, weekFrom, today);
    var sub = (week > 0.004 ? exMoney_(week) + " spent this week" : "Nothing spent this week") + " · " + exMoney_(x.spent) + " of " + exMoney_(x.amount) + " since payday";
    return {label: exName_(x.name), sub: sub, value: x.left < -0.004 ? exMoney_(-x.left) + " over" : exMoney_(x.left) + " left", bad: x.left < -0.004};
  });
  sections.push({title: "Your budgets", rows: rows, note: rows.length ? "What's left is until payday on " + Budgie.nice(t.nextPay) + "." : "No budgets set up yet."});
  // the next 7 days
  var coming = Budgie.coming(db, p, today, 7);
  sections.push({title: "Coming up this week", rows: coming.map(function (c) { return {label: c.name, sub: Budgie.nice(c.date) + (c.account ? " · " + c.account : ""), value: (c.sign > 0 ? "+" : "") + exMoney_(c.amount)}; }),
    note: coming.length ? "" : "No bills or paydays in the next 7 days."});
  // to do, counted as Today counts it: the payday moves are one thing, and so are new bank payments to check
  var todo = t.todo || [], n = todo.filter(function (x) { return !x.payday; }).length + (todo.some(function (x) { return x.payday; }) ? 1 : 0) +
    (db.transactions.some(function (x) { return x.person === p && exOn_(x.review); }) ? 1 : 0);
  sections.push({title: "To do", rows: [], note: n ? exPlural_(n, "thing is", "things are") + " waiting in To do in Budgie." : "Nothing waiting in To do. All sorted."});
  // LISA
  db.accounts.filter(function (a) { return a.owner === p && /lisa/.test(String(a.kind)); }).forEach(function (a) {
    var L = Budgie.lisa(db, a.id, today), bonus = L.expectedBonusTotal !== undefined ? L.expectedBonusTotal : L.bonusThisYear;
    sections.push({title: a.name || "Lifetime ISA", rows: [
      {label: "Worth about", value: exMoney_(L.balance)},
      {label: "Paid in this tax year", sub: exMoney_(L.allowanceLeft) + " of your £4,000 allowance left", value: exMoney_(L.paidThisYear)},
      {label: L.expectedBonusTotal !== undefined ? "Government bonus to come" : "Government bonus on that", value: exMoney_(bonus)}
    ]});
  });
  // goals, and how far they moved this week
  // how far each goal moved since last Sunday (only once Budgie was running then, or it would all look new)
  var before = {}, weekAgo = Budgie.addDays(today, -7);
  if (weekAgo >= Budgie.startOf(db, p)) Budgie.goals(db, p, weekAgo).forEach(function (g) { before[g.id] = g.saved; });
  var goals = Budgie.goals(db, p, today);
  if (goals.length) sections.push({title: "Goals", rows: goals.map(function (g) {
    var moved = Budgie.round(g.saved - (before[g.id] !== undefined ? before[g.id] : g.saved));
    return {label: g.name, sub: exMoney_(g.saved) + " of " + exMoney_(g.target) + (moved > 0.5 ? " · up " + exMoney_(moved) + " this week" : moved < -0.5 ? " · down " + exMoney_(-moved) + " this week" : ""), value: g.pct + "%"};
  })});
  return {
    subject: "Your week in money: " + exMoney_(t.safe) + " to spend today",
    preheader: payLine + ". " + (n ? exPlural_(n, "thing") + " in To do." : "Nothing in To do."),
    hello: "Hi " + me.name + ",", intro: "Here's how your money's looking this " + Budgie.nice(today).replace(/^Sun /, "Sunday, ") + ".",
    hero: {label: "You can spend today", value: exMoney_(t.safe), note: t.status + " · " + payLine},
    sections: sections,
    why: "You get this every Sunday because you turned on the Sunday email in Budgie. You can turn it off there in Settings."
  };
}
// sends to everyone who has it on; returns who it went to. A person who already had today's isn't sent it again.
function exSendSunday_(today) {
  CACHE_ = {};
  var list = exRecipients_(), props = PropertiesService.getScriptProperties(), sent = [];
  if (!list.length) { Logger.log("Nobody has the Sunday email turned on, so nothing was sent."); return sent; }
  var snap = snapshot_();
  list.forEach(function (r) {
    if (props.getProperty("SUNDAY_SENT_" + r.id) === today) { Logger.log(r.name + " already had today's Sunday email."); return; }
    try {
      exSend_(r, exSundayModel_(exViewOf_(r.id, today, snap), r.id, today));
      props.setProperty("SUNDAY_SENT_" + r.id, today); sent.push(r.id);
      Logger.log("Sunday email sent to " + r.name + ".");
    } catch (e) { Logger.log("Couldn't send " + r.name + "'s Sunday email: " + (e && e.message || e)); }
  });
  return sent;
}
/** The Sunday money email. Runs on Sundays once installExtras has been run. */
function sendSundayEmails() { return exSendSunday_(exTodayIso_()); }
/** Writes the Sunday email for one person to the log, without sending it. Opt-in isn't needed. */
function previewSundayEmail(personId, date) {
  CACHE_ = {};
  var r = exPerson_(personId || "ethan"), today = date || exTodayIso_(), m = exSundayModel_(exViewOf_(r.id, today), r.id, today), html = exHtml_(m, exColour_(r.colour, r.id));
  Logger.log("Subject: " + m.subject); Logger.log(exText_(m)); Logger.log(html);
  return {subject: m.subject, html: html, text: exText_(m)};
}

// ---------- 2. weekly backup ----------
// who else can open a folder: "" if nobody, else a short description (anyone with the link, or their addresses)
// The folder's owner and the account this script runs as don't count: often they're the same person's two Google
// accounts (a folder in one, shared with the other so the backup can be written there).
function exSharedWith_(f) {
  var mine = {}, out = [];
  try { if (f.getOwner && f.getOwner()) mine[String(f.getOwner().getEmail() || "").toLowerCase()] = true; } catch (e) {}
  try { mine[String(Session.getEffectiveUser().getEmail() || "").toLowerCase()] = true; } catch (e) {}
  try { if (f.getSharingAccess && typeof DriveApp.Access !== "undefined" && f.getSharingAccess() !== DriveApp.Access.PRIVATE) out.push("anyone with the link"); } catch (e) {}
  ["getEditors", "getViewers"].forEach(function (m) {
    try { (f[m] ? f[m]() : []).forEach(function (u) { var e = String(u && u.getEmail ? u.getEmail() : u || "").toLowerCase(); if (e && !mine[e] && out.indexOf(e) < 0) out.push(e); }); } catch (e) {}
  });
  return out.join(", ");
}
/** Copies every tab's values into a new spreadsheet in the backup folder and keeps the newest 8 backups there.
    It's a new standalone spreadsheet, not a copy of this file, so the script and its properties (the keys) never go
    with it. Other files are never touched. */
function backupNow() {
  var id = PropertiesService.getScriptProperties().getProperty("BACKUP_FOLDER_ID"), folder;
  if (!id) { Logger.log("No backup made: add Script Property BACKUP_FOLDER_ID (Project Settings > Script Properties) with the backup folder's id."); return null; }
  try { folder = DriveApp.getFolderById(String(id).trim()); folder.getName(); }
  catch (e) { Logger.log("No backup made: can't open the backup folder " + id + ". Check it's shared with this account as an editor. (" + (e && e.message || e) + ")"); return null; }
  // a backup is the whole sheet, both of your money in full, so it only goes in a folder nobody else can open
  var shared = exSharedWith_(folder);
  if (shared) { Logger.log("No backup made: the backup folder is shared (" + shared + "). A backup holds everything in the sheet, both of yours, so use a folder only you can open (or stop sharing this one)."); return null; }
  var name = EXTRAS_BACKUP_NAME + exTodayIso_(), copy;
  try {
    var src = ss_(), dest = SpreadsheetApp.create(name), blank = dest.getSheets()[0];
    if (blank) blank.setName("_budgie_blank_" + Date.now());
    src.getSheets().forEach(function (sh, i) {
      var vals = sh.getDataRange().getValues(), to = dest.insertSheet(sh.getName(), i);
      // values only, and text that would read as a formula stays text
      if (vals.length && vals[0].length) to.getRange(1, 1, vals.length, vals[0].length).setValues(vals.map(function (r) { return r.map(function (v) { return typeof cell_ === "function" ? cell_(v) : v; }); }));
    });
    if (blank && dest.getSheets().length > 1) dest.deleteSheet(blank);
    copy = DriveApp.getFileById(dest.getId());
    copy.moveTo(folder);
  }
  catch (e) { Logger.log("No backup made: copying the sheet failed. (" + (e && e.message || e) + ")"); return null; }
  // only our own backups: a Google Sheet named "Budgie data backup YYYY-MM-DD", newest first
  var mine = [], it = folder.getFiles(), re = /^Budgie data backup \d{4}-\d{2}-\d{2}$/;
  while (it.hasNext()) {
    var f = it.next();
    if (!re.test(f.getName()) || f.getMimeType() !== "application/vnd.google-apps.spreadsheet") continue;
    mine.push({f: f, name: f.getName(), at: +f.getDateCreated() || 0, isNew: f.getId() === copy.getId()});
  }
  mine.sort(function (a, b) { return a.isNew !== b.isNew ? (a.isNew ? -1 : 1) : a.name !== b.name ? (a.name < b.name ? 1 : -1) : b.at - a.at; });
  var gone = 0;
  mine.slice(EXTRAS_KEEP_BACKUPS).forEach(function (x) { try { x.f.setTrashed(true); gone++; } catch (e) { Logger.log("Couldn't remove old backup " + x.name + ": " + (e && e.message || e)); } });
  Logger.log("Backup made: " + name + "." + (gone ? " Moved " + exPlural_(gone, "older backup") + " to the bin." : "") + " Keeping the newest " + EXTRAS_KEEP_BACKUPS + ".");
  return name;
}

// ---------- 3. tax-year round-up ----------
// pick the first field that's there, so this works with whatever names Budgie.yearReview uses
function exPick_(o, names) { if (!o || typeof o !== "object") return undefined; for (var i = 0; i < names.length; i++) if (o[names[i]] !== undefined && o[names[i]] !== null && o[names[i]] !== "") return o[names[i]]; return undefined; }
function exNum_(v) { if (v && typeof v === "object") v = exPick_(v, ["amount", "total", "value", "spent"]); return v === undefined || v === "" || isNaN(+v) ? undefined : +v; }

// worked out here from the engine; used for anything Budgie.yearReview doesn't give (or when it isn't there yet)
function exReviewBase_(db, p, tys, today) {
  var endEx = exYearShift_(tys, 1), end = Budgie.addDays(endEx, -1), from = tys > Budgie.startOf(db, p) ? tys : Budgie.startOf(db, p);
  var last = today && today <= end ? today : end, out = {from: from, to: last};
  var moneyIn = 0;
  db.income.forEach(function (i) { if (i.person === p) Budgie.occurrences(db, i, from, Budgie.addDays(last, 1)).forEach(function (o) { moneyIn += +o.amount || 0; }); });
  out.moneyIn = Budgie.round(moneyIn);
  var saved = 0;
  if (from <= last) Budgie.periods(db, p, from, Budgie.addDays(last, 1)).forEach(function (per) {
    if (per.start < from || per.start > last) return;
    Budgie.planFor(db, p, per).lines.forEach(function (l) { if (l.kind === "save") saved += +l.amount || 0; });
  });
  out.saved = Budgie.round(saved);
  // spending by budget, by month and by day (their share)
  var byBudget = {}, byMonth = {}, byDay = {};
  db.transactions.forEach(function (x) {
    if (x.date < from || x.date > last) return;
    var s = Budgie.myShare(db, p, x); if (!(s > 0.004)) return;
    var b = db.byId[x.budget], name = exName_(b && b.name ? b.name : "Other");
    byBudget[name] = (byBudget[name] || 0) + s; byMonth[x.date.slice(0, 7)] = (byMonth[x.date.slice(0, 7)] || 0) + s; byDay[x.date] = true;
  });
  out.topBudgets = Object.keys(byBudget).map(function (k) { return {name: k, spent: Budgie.round(byBudget[k])}; }).sort(function (a, b) { return b.spent - a.spent; }).slice(0, 3);
  var bm = Object.keys(byMonth).sort(function (a, b) { return byMonth[b] - byMonth[a]; })[0];
  out.biggestMonth = bm ? {month: bm, spent: Budgie.round(byMonth[bm])} : null;
  var days = from <= last ? Budgie.diff(from, last) + 1 : 0;
  out.noSpendDays = Math.max(0, days - Object.keys(byDay).length); out.days = days;
  out.lisa = db.accounts.filter(function (a) { return a.owner === p && /lisa/.test(String(a.kind)); }).map(function (a) {
    var L = Budgie.lisa(db, a.id, last); return {name: a.name, paid: L.paidThisYear, bonus: L.expectedBonusTotal !== undefined ? L.bonusThisYear + L.expectedBonusTotal : L.bonusThisYear};
  });
  // goals from the start of the year (or the day Budgie started, with that day's balances) to its end
  var start = {}; Budgie.goals(db, p, from > tys ? from : Budgie.addDays(tys, -1)).forEach(function (g) { start[g.id] = g.saved; });
  out.goals = Budgie.goals(db, p, last).map(function (g) { var s0 = start[g.id] !== undefined ? start[g.id] : 0; return {name: g.name, from: s0, to: g.saved, moved: Budgie.round(g.saved - s0), target: g.target, pct: g.pct}; });
  return out;
}
function exReviewData_(db, p, tys, today) {
  var base = exReviewBase_(db, p, tys, today), yr = null;
  if (typeof Budgie.yearReview === "function") { try { yr = Budgie.yearReview(db, p, tys); } catch (e) { Logger.log("Budgie.yearReview failed, using the basic round-up: " + (e && e.message || e)); } }
  if (!yr) return base;
  var r = {from: base.from, to: base.to, days: base.days};
  var v = exNum_(exPick_(yr, ["moneyIn", "in", "income", "totalIn"])); r.moneyIn = v !== undefined ? v : base.moneyIn;
  v = exNum_(exPick_(yr, ["saved", "save", "savings", "totalSaved"])); r.saved = v !== undefined ? v : base.saved;
  v = exNum_(exPick_(yr, ["savedPct", "savePct", "pctSaved", "savingRate", "saveRate", "savedPercent"])); if (v !== undefined) r.savedPct = v;
  // the engine's spending by budget ("spent") nets off refunds
  var tb = exPick_(yr, ["topBudgets", "top", "budgets", "categories", "spent"]);
  r.topBudgets = Array.isArray(tb) && tb.length ? tb.slice(0, 3).map(function (b) { return {name: exName_(exPick_(b, ["name", "budget", "label"]) || ""), spent: exNum_(exPick_(b, ["spent", "amount", "total"])) || 0}; }) : base.topBudgets;
  var bm = exPick_(yr, ["biggestMonth", "topMonth", "bigMonth"]);
  r.biggestMonth = bm && typeof bm === "object" ? {month: String(exPick_(bm, ["month", "key", "ym", "start"]) || ""), label: exPick_(bm, ["name", "label"]), spent: exNum_(exPick_(bm, ["spent", "amount", "total"])) || 0} : base.biggestMonth;
  var ns = exPick_(yr, ["noSpendDays", "noSpend", "zeroDays"]); r.noSpendDays = Array.isArray(ns) ? ns.length : exNum_(ns) !== undefined ? exNum_(ns) : base.noSpendDays;
  var ls = exPick_(yr, ["lisa"]);
  if (!base.lisa.length) r.lisa = [];   // no Lifetime ISA, nothing to say about one
  else if (ls && typeof ls === "object") { var arr = Array.isArray(ls) ? ls : [ls]; r.lisa = arr.map(function (x, i) { var bb = base.lisa[i] || {}; var paid = exNum_(exPick_(x, ["paidIn", "paid", "paidThisYear", "in"])), bonus = exNum_(exPick_(x, ["bonus", "expectedBonus", "bonusThisYear"])); return {name: exPick_(x, ["name"]) || bb.name || "Lifetime ISA", paid: paid !== undefined ? paid : bb.paid || 0, bonus: bonus !== undefined ? bonus : bb.bonus || 0}; }); }
  else r.lisa = base.lisa;
  var gs = exPick_(yr, ["goals", "goalsMoved"]);
  r.goals = Array.isArray(gs) ? gs.map(function (g) { var to = exNum_(exPick_(g, ["to", "end", "saved", "now"])), fr = exNum_(exPick_(g, ["from", "start", "before"])), mv = exNum_(exPick_(g, ["moved", "change", "delta", "added"])); if (mv === undefined && to !== undefined && fr !== undefined) mv = Budgie.round(to - fr); return {name: exPick_(g, ["name"]) || "", from: fr, to: to, moved: mv || 0, target: exNum_(exPick_(g, ["target"])), pct: exNum_(exPick_(g, ["pct"]))}; }) : base.goals;
  return r;
}
function exReviewModel_(db, p, tys, today, soFar) {
  var me = Budgie.person(db, p), d = exReviewData_(db, p, tys, today), label = exTaxYearLabel_(tys), sections = [];
  var pct = d.savedPct !== undefined ? Math.round(d.savedPct) : d.moneyIn > 0 ? Math.round(d.saved / d.moneyIn * 100) : 0;
  if (d.topBudgets.length) sections.push({title: "Where most of it went", rows: d.topBudgets.map(function (b) { return {label: b.name, value: exMoney_(b.spent)}; })});
  (d.lisa || []).forEach(function (l) { sections.push({title: l.name || "Lifetime ISA", rows: [{label: "You paid in", value: exMoney_(l.paid)}, {label: "Government bonus", value: exMoney_(l.bonus)}], note: l.paid > 0.004 ? "That's " + exMoney_(Budgie.round(l.paid + l.bonus)) + " towards your first home." : ""}); });
  if (d.goals.length) sections.push({title: "Goals", rows: d.goals.map(function (g) { return {label: g.name, sub: g.to !== undefined ? "Now " + exMoney_(g.to) + (g.target ? " of " + exMoney_(g.target) : "") : "", value: g.moved > 0.004 ? "up " + exMoney_(g.moved) : g.moved < -0.004 ? "down " + exMoney_(-g.moved) : "no change"}; })});
  var more = [];
  if (d.biggestMonth && d.biggestMonth.spent > 0) more.push({label: "Biggest month", sub: "Your busiest month for spending", value: (/^\d{4}-\d{2}/.test(d.biggestMonth.month) ? exMonthName_(d.biggestMonth.month) : d.biggestMonth.label || d.biggestMonth.month) + ", " + exMoney_(d.biggestMonth.spent)});
  more.push({label: "No-spend days", sub: "Days you didn't spend anything", value: String(d.noSpendDays)});
  sections.push({title: "And also", rows: more});
  var title = "Your " + label + " in money" + (soFar ? " so far" : "");
  return {
    subject: title, preheader: exMoney_(d.moneyIn) + " came in and you saved " + exMoney_(d.saved) + ".",
    hello: "Hi " + me.name + ",",
    intro: soFar ? "Here's your tax year so far, from " + Budgie.nice(d.from) + "." : "The tax year ended on 5 April. Here's how your " + label + " went" + (d.from > tys ? ", from when you started Budgie on " + Budgie.nice(d.from) : "") + ".",
    hero: {label: "Money in", value: exMoney_(d.moneyIn), note: "You saved " + exMoney_(d.saved) + (d.moneyIn > 0 ? ", " + pct + "% of what came in" : "")},
    sections: sections,
    why: "You get this once a year, and the Sunday email every week, because you turned on the Sunday email in Budgie. You can turn it off there in Settings."
  };
}
// on or just after 6 April: last tax year's round-up, once per person per tax year
function exYearReviewCheck_(today) {
  var tys = exTaxYearStart_(today), sent = [];
  if (Budgie.diff(tys, today) >= EXTRAS_REVIEW_DAYS) return sent;
  var done = exTaxYearStart_(Budgie.addDays(tys, -1)), year = done.slice(0, 4);
  CACHE_ = {};
  var list = exRecipients_(), props = PropertiesService.getScriptProperties(), snap = null;
  list.forEach(function (r) {
    var k = "YEAR_REVIEW_" + r.id; if (+(props.getProperty(k) || 0) >= +year) return;
    try {
      snap = snap || snapshot_();
      var db = exViewOf_(r.id, today, snap);
      // a tax year that ended before this person started using Budgie has nothing to show
      if (Budgie.startOf(db, r.id) >= tys) { props.setProperty(k, year); return; }
      exSend_(r, exReviewModel_(db, r.id, done, today, false));
      props.setProperty(k, year); sent.push(r.id);
      Logger.log(exTaxYearLabel_(done) + " round-up sent to " + r.name + ".");
    } catch (e) { Logger.log("Couldn't send " + r.name + "'s round-up: " + (e && e.message || e)); }
  });
  return sent;
}
/** Daily: sends the tax-year round-up on or just after 6 April (once per person per tax year). */
function yearReviewCheck() { return exYearReviewCheck_(exTodayIso_()); }
/** Writes the tax-year round-up for one person to the log, without sending it. It shows the last tax year,
    or this tax year so far if Budgie wasn't running last year. */
function previewYearReview(personId, date) {
  CACHE_ = {};
  var r = exPerson_(personId || "ethan"), today = date || exTodayIso_(), db = exViewOf_(r.id, today);
  var tys = exTaxYearStart_(Budgie.addDays(exTaxYearStart_(today), -1)), soFar = false;
  if (Budgie.startOf(db, r.id) >= exYearShift_(tys, 1)) { tys = exTaxYearStart_(today); soFar = true; }
  var m = exReviewModel_(db, r.id, tys, today, soFar), html = exHtml_(m, exColour_(r.colour, r.id));
  Logger.log("Subject: " + m.subject); Logger.log(exText_(m)); Logger.log(html);
  return {subject: m.subject, html: html, text: exText_(m)};
}
