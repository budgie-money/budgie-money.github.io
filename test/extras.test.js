// Run with: node test/extras.test.js
// The Sunday email, the weekly backup and the tax-year round-up (apps-script/Extras.gs), on the fake Apps Script.
const makeEnv = require("./fake-gas.js"), fixture = require("./fixture.js");
const vm = require("vm"), fs = require("fs"), path = require("path");
let fails = 0, passes = 0;
const ok = (name, cond, extra) => { cond ? passes++ : fails++; if (!cond) console.log("FAIL", name, extra !== undefined ? JSON.stringify(extra).slice(0, 600) : ""); };
const SHOW = process.argv.includes("--show");

// ---------- fakes for the services Extras.gs adds: MailApp, DriveApp, trigger times ----------
function fakeDrive(env) {
  let n = 0; const folders = {}, files = {}, copies = [], made = {};
  const File = (name, mime, created, parent) => {
    const f = {id: "f" + (++n), name, mime, created: created || new Date(), trashed: false, parent};
    f.api = {getId: () => f.id, getName: () => f.name, getMimeType: () => f.mime, getDateCreated: () => f.created, setTrashed: (v) => { f.trashed = !!v; return f.api; },
      makeCopy: (nm, folder) => { copies.push(nm); const c = File(nm, f.mime, new Date(), folder._id); return c.api; }, moveTo: (folder) => { f.parent = folder._id; return f.api; }};
    files[f.id] = f; return f;
  };
  const Folder = (id, share) => {
    folders[id] = {id}; share = share || {};
    const user = (e) => ({getEmail: () => e});
    return {_id: id, getName: () => "Budgie backups", getOwner: () => user(share.owner || "owner@example.com"), getSharingAccess: () => share.access || "PRIVATE",
      getEditors: () => (share.editors || []).map(user), getViewers: () => (share.viewers || []).map(user), getFiles: () => { const list = Object.values(files).filter(f => f.parent === id && !f.trashed); let i = 0; return {hasNext: () => i < list.length, next: () => list[i++].api}; }};
  };
  const sheetFile = File("Budgie data", "application/vnd.google-apps.spreadsheet", new Date(2026, 9, 1), "root");
  env.ss.getId = () => sheetFile.id;
  const api = {
    getFolderById: (id) => { if (!folders[id]) throw new Error("No item with the given ID could be found, or you do not have permission to access it."); return folders[id].api; },
    getFileById: (id) => { if (!files[id]) throw new Error("No file " + id); return files[id].api; }
  };
  // SpreadsheetApp.create: a new, empty spreadsheet in My Drive (no script, no properties)
  const create = (nm) => {
    const file = File(nm, "application/vnd.google-apps.spreadsheet", new Date(), "root"), tabs = [];
    const Tab = (name) => { const t = {name, cells: []}; t.api = {getName: () => t.name, setName: (x) => { t.name = x; return t.api; },
      getRange: (r, c, nr, nc) => ({setValues: (v) => { v.forEach((row, i) => { t.cells[r - 1 + i] = row.slice(); }); }})}; return t; };
    tabs.push(Tab("Sheet1"));
    const ss = {getId: () => file.id, getSheets: () => tabs.map(t => t.api), insertSheet: (name, i) => { if (tabs.some(t => t.name === name)) throw new Error("A sheet with the name \"" + name + "\" already exists."); const t = Tab(name); tabs.splice(i, 0, t); return t.api; },
      deleteSheet: (api) => { const i = tabs.findIndex(t => t.api === api); tabs.splice(i, 1); }};
    made[file.id] = tabs; return ss;
  };
  return {api, files, copies, made, create, addFolder: (id, share) => { const f = Folder(id, share); folders[id].api = f; return f; }, File};
}
function setupEnv(mut) {
  const env = makeEnv(), c = env.ctx;
  c.setup(); const fx = fixture(); if (mut) mut(fx);
  Object.keys(fx).forEach(t => { const sh = env.sheets[t]; if (!sh) return; const head = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0]; fx[t].forEach(r => sh.appendRow(head.map(h => r[h] === undefined ? "" : r[h]))); });
  c.CACHE_ = {}; c.setup();
  env.mail = []; c.MailApp = {sendEmail: (o) => { env.mail.push(o); }};
  env.drive = fakeDrive(env); c.DriveApp = env.drive.api; c.DriveApp.Access = {PRIVATE: "PRIVATE", ANYONE_WITH_LINK: "ANYONE_WITH_LINK"}; c.SpreadsheetApp.create = env.drive.create;
  // triggers that remember how they were set up
  c.ScriptApp.WeekDay = {SUNDAY: "SUNDAY", MONDAY: "MONDAY"};
  c.ScriptApp.newTrigger = (fn) => { const calls = []; const b = new Proxy({}, {get: (t, k) => k === "create" ? () => { const tr = {getHandlerFunction: () => fn, calls}; env.triggers.push(tr); return tr; } : (...a) => { calls.push(k + "(" + a.join(",") + ")"); return b; }}); return b; };
  vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "apps-script/Extras.gs"), "utf8"), c, {filename: "Extras.gs"});
  return {env, c};
}
const optIn = (fx, p, to, on = "true") => fx.settings.push({id: p + ":email.sunday", person: p, key: "email.sunday", value: on}, {id: p + ":email.to", person: p, key: "email.to", value: to});
// a week of payments: Ethan's own, Sophie's private one, and a shop she split with him
const household = (fx) => {
  fx.budgets.push({id: "s-hobby", person: "sophie", name: "Hobbies", amount: 40, mode: "oneoff", account: "s-main"});
  fx.transactions.push(
    {id: "e1", date: "2026-10-28", person: "ethan", amount: 42.1, budget: "e-food-b", account: "e-food", note: "Tesco"},
    {id: "e2", date: "2026-10-31", person: "ethan", amount: 12.5, budget: "e-fun", account: "e-main", note: "Cinema"},
    {id: "e3", date: "2026-10-30", person: "ethan", amount: 30, budget: "e-fuel", account: "e-car"},
    {id: "s-secret", date: "2026-10-30", person: "sophie", amount: 55.55, budget: "s-hobby", account: "s-main", note: "Hidden present"},
    {id: "s-split", date: "2026-10-31", person: "sophie", amount: 60, budget: "s-food", account: "s-main", split: "half", note: "Big shop"});
  fx.valuations.push({id: "v-lisa2", account: "e-lisa", date: "2026-11-05", amount: 10300});   // his LISA checked again, next week
  optIn(fx, "ethan", "ethan@example.com"); optIn(fx, "sophie", "sophie@example.com");
};
const SUNDAY = "2026-11-01";
const all = (m) => m.htmlBody + "\n" + m.body + "\n" + m.subject;

// ================= 1. Sunday email =================
{
  const {env, c} = setupEnv(household);
  const sent = c.exSendSunday_(SUNDAY);
  ok("sent to both", JSON.stringify(sent) === JSON.stringify(["ethan", "sophie"]) && env.mail.length === 2, {sent, logs: env.logs});
  const e = env.mail.find(m => m.to === "ethan@example.com"), s = env.mail.find(m => m.to === "sophie@example.com");
  ok("each to their own address", e && s);
  if (SHOW && e) console.log("\n----- Ethan, Sunday -----\nSubject: " + e.subject + "\n" + e.body + "\n");
  if (SHOW && s) console.log("\n----- Sophie, Sunday -----\nSubject: " + s.subject + "\n" + s.body + "\n");
  // content, worked out by the same engine as his phone
  const B = require("../engine.js"), tables = {};
  Object.keys(c.SCHEMA).forEach(t => { c.CACHE_ = {}; });
  c.CACHE_ = {}; const view = c.exViewOf_("ethan", SUNDAY), t = B.today(view, "ethan", SUNDAY);
  ok("Ethan: greeting and subject", /^Hi Ethan,/.test(e.body) && e.subject === "Your week in money: " + B.money(t.safe) + " to spend today", e.subject);
  ok("Ethan: can spend today", e.htmlBody.includes("You can spend today") && e.htmlBody.includes(B.money(t.safe)) && e.body.includes("You can spend today: " + B.money(t.safe)));
  ok("Ethan: each budget, this week and left until payday", ["Food", "Fuel", "Fun"].every(n => e.body.includes("- " + n + ": ")) && e.body.includes("spent this week") && /left until payday|until payday on/.test(e.body), e.body);
  // his food: £42.10 of his own plus his £30 half of Sophie's split shop
  ok("Ethan: food this week counts his half of the split shop", e.body.includes("£72.10 spent this week"), e.body);
  ok("Ethan: fun this week", e.body.includes("£12.50 spent this week"));
  ok("Ethan: next 7 days", e.body.includes("COMING UP THIS WEEK") && e.body.includes("- Phone: £20.00 (Thu 5 Nov") && !e.body.includes("Household bills"), e.body);
  // counted as Today counts it: the payday moves are one thing to do
  const nTodo = t.todo.filter(x => !x.payday).length + (t.todo.some(x => x.payday) ? 1 : 0);
  ok("Ethan: to do count, as Today counts it", t.todo.some(x => x.payday) && t.todo.length > nTodo && e.body.includes(nTodo + " thing" + (nTodo === 1 ? " is" : "s are") + " waiting in To do"), {n: nTodo, body: e.body});
  ok("Ethan: LISA value", e.body.includes("LIFETIME ISA") && e.body.includes("Worth about: " + B.money(B.lisa(view, "e-lisa", SUNDAY).balance)), e.body);
  ok("Ethan: goals", e.body.includes("- House deposit: 17% (£10,000.00 of £60,000.00)"), e.body);
  ok("Ethan: a goal doesn't look new in the first week", !/up £10,000/.test(e.body));
  ok("Ethan: link to Budgie", e.htmlBody.includes('href="https://budgie-money.github.io/"') && e.body.includes("Open Budgie: https://budgie-money.github.io/"));
  ok("plain-text fallback and HTML both there", e.body.length > 200 && /^<!DOCTYPE html>/.test(e.htmlBody) && !/<[a-z]/i.test(e.body));
  ok("mobile-friendly, no images", e.htmlBody.includes('name="viewport"') && e.htmlBody.includes("max-width:560px") && !/<img|background-image|url\(/i.test(e.htmlBody));
  ok("British English, no jargon", !/\b(color|favorite|paycheck|checking account|transaction|ledger)\b/i.test(e.body), e.body);
  // privacy: nothing of Sophie's own
  const E = all(e);
  ok("PRIVACY: Sophie's private payment never in Ethan's email", !E.includes("55.55") && !/Hidden present/i.test(E) && !E.includes("Hobbies"), E.slice(0, 300));
  ok("PRIVACY: Sophie's pay, budgets and address not in Ethan's email", !E.includes("2,100") && !E.includes("sophie@example.com"));
  // Sophie's own email has her own things, and nothing private of Ethan's
  const S = all(s);
  ok("Sophie: her own budgets", /^Hi Sophie,/.test(s.body) && s.body.includes("- Hobbies: ") && s.body.includes("- Food: "), s.body);
  ok("Sophie: her private payment counts in her own email", s.body.includes("£55.55"), s.body);
  ok("Sophie: her half of the split shop", s.body.includes("£30.00 spent this week"));
  ok("Sophie: the shared house goal", s.body.includes("House deposit"));
  ok("PRIVACY: Ethan's private budgets and payments not in Sophie's email", !S.includes("Fuel") && !S.includes("42.10") && !S.includes("Cinema") && !S.includes("12.50") && !S.includes("Cash ISA") && !S.includes("ethan@example.com"), S.slice(0, 400));
  ok("Sophie: no LISA section without a LISA of her own", !s.body.includes("LIFETIME ISA") && !s.body.includes("Worth about"));
  // secrets
  ok("no keys, connect links or web app address", [E, S].every(x => !x.includes(env.props.KEY_ethan) && !x.includes(env.props.KEY_sophie) && !/connect=|script\.google\.com|\/exec\b|KEY_/.test(x)));
  // run again the same day: not sent twice
  const again = c.exSendSunday_(SUNDAY);
  ok("not sent twice on the same day", again.length === 0 && env.mail.length === 2);
  // next Sunday it goes again
  ok("next Sunday it goes again", c.exSendSunday_("2026-11-08").length === 2 && env.mail.length === 4);
  const e2 = env.mail.slice(2).find(m => m.to === "ethan@example.com");
  ok("next Sunday: the goal's move this week", e2 && e2.body.includes("- House deposit: 17% (£10,300.00 of £60,000.00 · up £300.00 this week)"), e2 && e2.body);
  if (SHOW && e2) fs.writeFileSync(path.join(process.env.OUT || "/tmp", "ethan-sunday.html"), e.htmlBody);
  // the preview logs it and sends nothing
  const before = env.mail.length, pv = c.previewSundayEmail("ethan", SUNDAY);
  ok("preview logs the HTML and doesn't send", env.mail.length === before && env.logs.some(l => /^<!DOCTYPE html>/.test(l)) && pv.html === e.htmlBody, env.logs.slice(-3).map(l => l.slice(0, 80)));
}
// sharing turned on: Ethan's email still only has his own budgets (and the summary of hers never arrives)
{
  const {env, c} = setupEnv(fx => { household(fx); fx.settings.push({id: "sophie:share.payments", person: "sophie", key: "share.payments", value: "true"}); });
  c.exSendSunday_(SUNDAY);
  const E = all(env.mail.find(m => m.to === "ethan@example.com"));
  ok("PRIVACY: with sharing on, still no Hobbies budget of hers in his", !E.includes("Hobbies") && !/Hidden present/i.test(E));
}
// opting in
{
  const {env, c} = setupEnv(fx => { household(fx); fx.settings.find(s => s.id === "sophie:email.sunday").value = "false"; });
  const sent = c.exSendSunday_(SUNDAY);
  ok("OPT-IN: Sophie turned it off, gets nothing", JSON.stringify(sent) === JSON.stringify(["ethan"]) && env.mail.every(m => m.to !== "sophie@example.com"), sent);
}
{
  const {env, c} = setupEnv(fx => { household(fx); fx.settings = fx.settings.filter(s => !/^email\./.test(s.key)); });
  const sent = c.exSendSunday_(SUNDAY);
  ok("OPT-IN: nobody opted in, nothing sent", sent.length === 0 && env.mail.length === 0 && env.logs.some(l => /Nobody has the Sunday email/.test(l)));
}
{
  const {env, c} = setupEnv(fx => {
    household(fx);
    fx.settings.find(s => s.id === "sophie:email.to").value = "";                              // on, but no address
    fx.settings.find(s => s.id === "ethan:email.sunday").deleted = true;                          // turned off by deleting the row
    fx.settings.push({person: "", key: "email.sunday", value: "true"}, {person: "", key: "email.to", value: "someone@example.com"});   // a row for everyone counts for nobody
  });
  const sent = c.exSendSunday_(SUNDAY);
  ok("OPT-IN: no address, a deleted row, or a row for everyone: nothing sent", sent.length === 0 && env.mail.length === 0, env.mail.map(m => m.to));
  ok("OPT-IN: a missing address is logged", env.logs.some(l => /Sophie .*address/.test(l)), env.logs);
}
// one person failing doesn't stop the other
{
  const {env, c} = setupEnv(household);
  let n = 0; c.MailApp.sendEmail = (o) => { if (n++ === 0) throw new Error("Service invoked too many times"); env.mail.push(o); };
  const sent = c.exSendSunday_(SUNDAY);
  ok("one failure doesn't stop the other", JSON.stringify(sent) === JSON.stringify(["sophie"]) && env.logs.some(l => /Couldn't send Ethan's/.test(l)) && !env.props.SUNDAY_SENT_ethan, sent);
}

// ================= 2. backup =================
{
  const {env, c} = setupEnv();
  ok("BACKUP: no folder set, logs and does nothing", c.backupNow() === null && env.logs.some(l => /BACKUP_FOLDER_ID/.test(l)) && Object.values(env.drive.files).length === 1);
  env.props.BACKUP_FOLDER_ID = "missing";
  ok("BACKUP: folder not reachable, logs and does nothing", c.backupNow() === null && env.logs.some(l => /can't open the backup folder/.test(l)) && Object.values(env.drive.files).length === 1);
  env.drive.addFolder("fold1"); env.props.BACKUP_FOLDER_ID = "fold1";
  const SHEET = "application/vnd.google-apps.spreadsheet";
  for (let i = 0; i < 10; i++) env.drive.File("Budgie data backup 2026-0" + (1 + Math.floor(i / 3)) + "-" + String(10 + i).padStart(2, "0"), SHEET, new Date(2026, Math.floor(i / 3), 10 + i), "fold1");
  const others = [env.drive.File("Holiday photos.jpg", "image/jpeg", new Date(2020, 0, 1), "fold1"), env.drive.File("Budgie data backup 2020-01-01", "application/vnd.google-apps.document", new Date(2020, 0, 1), "fold1"),
    env.drive.File("Budgie data backup notes", SHEET, new Date(2020, 0, 1), "fold1"), env.drive.File("Budgie data backup 2019-01-01", SHEET, new Date(2019, 0, 1), "elsewhere")];
  const name = c.backupNow();
  const today = c.exTodayIso_(), inFolder = Object.values(env.drive.files).filter(f => f.parent === "fold1");
  ok("BACKUP: named with today's date", name === "Budgie data backup " + today && inFolder.some(f => f.name === name && !f.trashed), name);
  const backups = inFolder.filter(f => /^Budgie data backup \d{4}-\d{2}-\d{2}$/.test(f.name) && f.mime === SHEET);
  const kept = backups.filter(f => !f.trashed).map(f => f.name).sort();
  ok("BACKUP: keeps the newest 8", kept.length === 8 && kept[kept.length - 1] === name && kept[0] === "Budgie data backup 2026-02-13", kept);
  ok("BACKUP: the 3 oldest went to the bin", backups.filter(f => f.trashed).map(f => f.name).sort().join() === "Budgie data backup 2026-01-10,Budgie data backup 2026-01-11,Budgie data backup 2026-01-12");
  ok("BACKUP: other files never touched", others.every(f => !f.trashed) && !Object.values(env.drive.files).find(f => f.name === "Budgie data").trashed);
  // weekly: run 8 more times, still 8
  for (let i = 0; i < 3; i++) c.backupNow();
  ok("BACKUP: not a copy of this file (which would carry the script and its keys)", env.drive.copies.length === 0);
  const bk = Object.values(env.drive.files).find(f => f.name === name && !f.trashed), tabs = env.drive.made[bk.id];
  ok("BACKUP: every tab, with its values", tabs && tabs.length === Object.keys(env.sheets).length && tabs.map(t => t.name).join() === Object.keys(env.sheets).join() && JSON.stringify(tabs.find(t => t.name === "people").cells[1]).includes("Ethan"), tabs && tabs.map(t => t.name));
  ok("BACKUP: no keys in it", !JSON.stringify(tabs.map(t => t.cells)).includes(env.props.KEY_ethan));
  ok("BACKUP: still 8 after more runs", Object.values(env.drive.files).filter(f => f.parent === "fold1" && /^Budgie data backup \d{4}/.test(f.name) && f.mime === SHEET && !f.trashed).length === 8);
}

// a backup is everything in the sheet, both of yours: never into a folder someone else can open
{
  const {env, c} = setupEnv(), made = () => Object.values(env.drive.files).filter(f => /^Budgie data backup/.test(f.name)).length;
  env.drive.addFolder("shared1", {editors: ["owner@example.com", "sophie@example.com"]}); env.props.BACKUP_FOLDER_ID = "shared1";
  ok("BACKUP: not into a folder shared with someone", c.backupNow() === null && made() === 0 && env.logs.some(l => /backup folder is shared \(sophie@example\.com\)/.test(l)), env.logs.slice(-1));
  env.drive.addFolder("link1", {access: "ANYONE_WITH_LINK"}); env.props.BACKUP_FOLDER_ID = "link1";
  ok("BACKUP: nor one anyone with the link can open", c.backupNow() === null && made() === 0 && env.logs.some(l => /anyone with the link/.test(l)));
  env.drive.addFolder("mine1", {editors: ["owner@example.com"]}); env.props.BACKUP_FOLDER_ID = "mine1";
  ok("BACKUP: a folder only you can open is fine", !!c.backupNow() && made() === 1);
  // the folder in your other Google account, shared only with the account the script runs as: still only you
  c.Session = {getEffectiveUser: () => ({getEmail: () => "owner@example.com"})};   // the script runs as owner@
  env.drive.addFolder("mine2", {owner: "main@example.com", editors: ["owner@example.com"]}); env.props.BACKUP_FOLDER_ID = "mine2";
  ok("BACKUP: your own two accounts don't count as shared", !!c.backupNow() && made() === 2, env.logs.slice(-1));
  env.drive.addFolder("mine3", {owner: "main@example.com", editors: ["owner@example.com", "sophie@example.com"]}); env.props.BACKUP_FOLDER_ID = "mine3";
  ok("BACKUP: but anyone else still does", c.backupNow() === null && made() === 2);
}

// ================= 3. tax-year round-up =================
// a year of money: payments each week from November to March, a private one of Sophie's every month
const yearHousehold = (fx) => {
  household(fx);
  for (let d = new Date(Date.UTC(2026, 10, 2)); d < Date.UTC(2027, 3, 6); d.setUTCDate(d.getUTCDate() + 7)) {
    const iso = d.toISOString().slice(0, 10);
    fx.transactions.push({id: "ef" + iso, date: iso, person: "ethan", amount: iso.slice(5, 7) === "12" ? 95 : 48, budget: "e-food-b", account: "e-food"},
      {id: "eu" + iso, date: iso, person: "ethan", amount: 20, budget: "e-fun", account: "e-main"});
    if (iso.slice(8) <= "07") fx.transactions.push({id: "sp" + iso, date: iso, person: "sophie", amount: 77.77, budget: "s-hobby", account: "s-main", note: "Hidden thing"});
  }
};
{
  const {env, c} = setupEnv(yearHousehold);
  ok("ROUND-UP: nothing before 6 April", c.exYearReviewCheck_("2027-04-05").length === 0 && c.exYearReviewCheck_("2026-11-01").length === 0 && env.mail.length === 0);
  const hadYR = c.Budgie.yearReview; delete c.Budgie.yearReview;   // the engine's own round-up may not be there yet
  const sent = c.exYearReviewCheck_("2027-04-06");
  ok("ROUND-UP: sent on 6 April to both", JSON.stringify(sent) === JSON.stringify(["ethan", "sophie"]) && env.mail.length === 2, {sent, logs: env.logs.slice(-4)});
  ok("ROUND-UP: the year is recorded", env.props.YEAR_REVIEW_ethan === "2026" && env.props.YEAR_REVIEW_sophie === "2026");
  ok("ROUND-UP: once a year", c.exYearReviewCheck_("2027-04-07").length === 0 && c.exYearReviewCheck_("2027-04-20").length === 0 && env.mail.length === 2);
  const e = env.mail.find(m => m.to === "ethan@example.com"), s = env.mail.find(m => m.to === "sophie@example.com");
  if (SHOW) console.log("\n----- Ethan, round-up -----\nSubject: " + e.subject + "\n" + e.body + "\n");
  if (SHOW) fs.writeFileSync(path.join(process.env.OUT || "/tmp", "ethan-year.html"), e.htmlBody);
  ok("ROUND-UP: title", e.subject === "Your 2026/27 in money" && e.htmlBody.includes("Your 2026/27 in money"), e.subject);
  ok("ROUND-UP: money in, saved and %", e.body.includes("Money in: £") && /You saved £[\d,.]+, \d+% of what came in/.test(e.body), e.body);
  ok("ROUND-UP: top budgets", e.body.includes("WHERE MOST OF IT WENT") && e.body.includes("- Food: £"), e.body);
  ok("ROUND-UP: LISA paid in plus bonus", e.body.includes("You paid in: £") && e.body.includes("Government bonus: £"));
  ok("ROUND-UP: goals moved (from the day Budgie started)", e.body.includes("- House deposit: up £300.00 (Now £10,300.00 of £60,000.00)"), e.body);
  ok("ROUND-UP: biggest month is December", /Biggest month: December 2026, £/.test(e.body), e.body);
  ok("ROUND-UP: no-spend days", /No-spend days: \d+/.test(e.body) && !/No-spend days: 0\b/.test(e.body));
  ok("ROUND-UP PRIVACY: Sophie's private spending not in Ethan's", !all(e).includes("Hobbies") && !all(e).includes("77.77") && !/Hidden/.test(all(e)));
  ok("ROUND-UP: Sophie's has her own", s.body.includes("Hobbies"), s.body);
  ok("ROUND-UP: next year it goes again", c.exYearReviewCheck_("2028-04-06").length === 2 && env.props.YEAR_REVIEW_ethan === "2027");
  // too late in the year: not sent (the trigger was missing for weeks)
  const late = setupEnv(yearHousehold);
  delete late.c.Budgie.yearReview;
  ok("ROUND-UP: not sent weeks later", late.c.exYearReviewCheck_("2027-06-01").length === 0);
  // a tax year that ended before Budgie started: nothing to say, nothing sent
  const early = setupEnv(yearHousehold); delete early.c.Budgie.yearReview;
  ok("ROUND-UP: nothing for a year before Budgie", early.c.exYearReviewCheck_("2026-04-06").length === 0 && early.env.mail.length === 0);
  // with the engine's yearReview, its numbers are used
  const withYR = setupEnv(yearHousehold);
  let asked = null;
  withYR.c.Budgie.yearReview = (db, p, tys) => { asked = [p, tys]; return {moneyIn: 12345.67, saved: 2345.67, savedPct: 19, topBudgets: [{name: "Food", spent: 1111.11}], lisa: {paidIn: 2664, bonus: 666}, goals: [{name: "House deposit", from: 10000, to: 13330}], biggestMonth: {month: "2026-12", spent: 800}, noSpendDays: 42}; };
  withYR.c.exYearReviewCheck_("2027-04-06");
  const y = withYR.env.mail.find(m => m.to === "ethan@example.com");
  ok("ROUND-UP: uses Budgie.yearReview when there", asked && asked[1] === "2026-04-06" && y.body.includes("Money in: £12,345.67") && y.body.includes("19% of what came in") && y.body.includes("You paid in: £2,664.00") && y.body.includes("Government bonus: £666.00") && y.body.includes("No-spend days: 42") && y.body.includes("up £3,330.00"), y && y.body);
  if (hadYR) c.Budgie.yearReview = hadYR;
  // with the real engine: refunds are netted off, and someone without a Lifetime ISA gets nothing about one
  const real = setupEnv(fx => { yearHousehold(fx); fx.transactions.push({id: "s-refund", date: "2026-11-20", person: "sophie", amount: -15, budget: "s-hobby", account: "s-main", note: "Refund"}); });
  real.c.exYearReviewCheck_("2027-04-06");
  const rs = real.env.mail.find(m => m.to === "sophie@example.com"), re = real.env.mail.find(m => m.to === "ethan@example.com");
  const hob = real.c.Budgie.yearReview(real.c.exViewOf_("sophie", "2027-04-06"), "sophie", "2026-04-06").spent.find(x => x.name === "Hobbies");
  const hobPaid = real.c.exViewOf_("sophie", "2027-04-06").transactions.filter(x => x.budget === "s-hobby" && x.amount > 0 && x.date < "2027-04-06").reduce((t, x) => t + x.amount, 0);
  ok("ROUND-UP: spending nets off refunds", hob && rs.body.includes("- Hobbies: " + real.c.Budgie.money(hob.amount)) && Math.abs(hob.amount - (hobPaid - 15)) < 0.01, {hob, hobPaid, body: rs.body});
  ok("ROUND-UP: no Lifetime ISA section without a Lifetime ISA", !/LIFETIME ISA|You paid in/.test(rs.body) && /LIFETIME ISA/.test(re.body), rs.body);
  ok("ROUND-UP: biggest month in full", /Biggest month: [A-Z][a-z]{3,} 20\d\d, £/.test(re.body), re.body);
  // not opted in: nothing
  const none = setupEnv(fx => { yearHousehold(fx); fx.settings.find(s => s.id === "sophie:email.sunday").value = "no"; });
  delete none.c.Budgie.yearReview;
  ok("ROUND-UP OPT-IN: only people who opted in", JSON.stringify(none.c.exYearReviewCheck_("2027-04-08")) === JSON.stringify(["ethan"]));
  // preview: last tax year if Budgie ran then, otherwise this year so far
  const pv = withYR.c.previewYearReview("ethan", "2026-12-20");
  ok("ROUND-UP: preview this year so far, nothing sent", pv.subject === "Your 2026/27 in money so far" && withYR.env.mail.length === 2 && withYR.env.logs.some(l => /^<!DOCTYPE html>/.test(l)), pv.subject);
}

// ================= 4. installExtras =================
{
  const {env, c} = setupEnv();
  env.triggers.push({getHandlerFunction: () => "updatePrices"}, {getHandlerFunction: () => "refreshBudgetTabs"}, {getHandlerFunction: () => "backupNow", calls: ["old"]});
  c.installExtras(); c.installExtras();
  const names = env.triggers.map(t => t.getHandlerFunction()).sort();
  ok("TRIGGERS: adds what's missing, once, keeps the rest", JSON.stringify(names) === JSON.stringify(["backupNow", "refreshBudgetTabs", "sendSundayEmails", "updatePrices", "yearReviewCheck"]), names);
  const calls = (fn) => (env.triggers.find(t => t.getHandlerFunction() === fn) || {}).calls || [];
  ok("TRIGGERS: Sunday email Sundays at 6pm", calls("sendSundayEmails").join(" ") === "timeBased() onWeekDay(SUNDAY) atHour(18) inTimezone(Europe/London)", calls("sendSundayEmails"));
  ok("TRIGGERS: round-up check daily", calls("yearReviewCheck").join(" ") === "timeBased() everyDays(1) atHour(9) inTimezone(Europe/London)", calls("yearReviewCheck"));
  ok("TRIGGERS: an existing backup trigger is left as it was", calls("backupNow")[0] === "old");
  const F = setupEnv(); F.c.installExtras();
  ok("TRIGGERS: backup Sundays at 3am", ((F.env.triggers.find(t => t.getHandlerFunction() === "backupNow") || {}).calls || []).join(" ") === "timeBased() onWeekDay(SUNDAY) atHour(3) inTimezone(Europe/London)");
  ok("TRIGGERS: says what's missing", F.env.logs.some(l => /BACKUP_FOLDER_ID/.test(l)) && F.env.logs.some(l => /Nobody has the Sunday email on/.test(l)));
}

// Extras.gs uses only MailApp (never GmailApp) and DriveApp, and defines nothing the other files define
{
  const src = fs.readFileSync(path.join(__dirname, "..", "apps-script/Extras.gs"), "utf8");
  ok("only MailApp, no GmailApp", !/GmailApp/.test(src) && /MailApp\.sendEmail/.test(src));
  const names = (f) => { const p = path.join(__dirname, "..", f); return fs.existsSync(p) ? (fs.readFileSync(p, "utf8").match(/^(?:function|var) [A-Za-z0-9_$]+/gm) || []).map(x => x.split(" ")[1]) : []; };
  const mine = names("apps-script/Extras.gs"), theirs = new Set([].concat(names("apps-script/Code.gs"), names("apps-script/Prices.gs"), names("apps-script/BankFeeds.gs")));
  const clash = mine.filter(n => theirs.has(n) || n === "Budgie");
  ok("no clashes with Code.gs, Prices.gs or BankFeeds.gs", !clash.length, clash);
  ok("no clash with installTriggers or installPriceTrigger", mine.indexOf("installTriggers") < 0 && mine.indexOf("installPriceTrigger") < 0);
}

// ================= review 2026-10-27b (1.4.8) =================
// P5: a settings row typed into the sheet for a "person" called __proto__ is nobody's: it can't turn the email on
// for someone else, or send their money to its address
{
  const {env, c} = setupEnv(fx => { optIn(fx, "ethan", "ethan@example.com"); fx.settings.push({person: "__proto__", key: "email.sunday", value: "true"}, {person: "__proto__", key: "email.to", value: "someone@example.com"}); });
  const sent = c.exSendSunday_(SUNDAY);
  ok("P5: only Ethan, who turned it on, gets an email", JSON.stringify(sent) === JSON.stringify(["ethan"]) && env.mail.every(m => m.to === "ethan@example.com"), {sent, to: env.mail.map(m => m.to)});
}

// ================= review 2026-10-27e (1.4.11) =================
// E1: the Sunday email counts a split payment as the app does: half of £20.15 paid by Ethan is his £10.07 (Sophie
// pays him back £10.08)
{
  const {env, c} = setupEnv(fx => { optIn(fx, "ethan", "ethan@example.com"); fx.transactions.push({id: "e-odd", date: "2026-10-31", person: "ethan", amount: 20.15, budget: "e-fun", account: "e-main", split: "half"}); });
  c.exSendSunday_(SUNDAY);
  const e = env.mail.find(m => m.to === "ethan@example.com");
  ok("E1: Ethan's fun this week is his £10.07 share", e && /- Fun: [^\n]*\(£10\.07 spent this week/.test(e.body), e && e.body);
}

// X1 (1.4.18): the round-up's own count of what was saved (used when the engine's isn't there) leaves out money put by
// for a yearly bill (Sophie's membership), as Budgie.yearReview and the Money tab do
{
  const {c} = setupEnv(yearHousehold), B = c.Budgie, db = c.exViewOf_("sophie", "2027-04-06");
  const base = c.exReviewBase_(db, "sophie", "2026-04-06", "2027-04-05");
  let setAside = 0, saving = 0;
  B.periods(db, "sophie", base.from, "2027-04-06").forEach(per => { if (per.start < base.from) return; B.planFor(db, "sophie", per).lines.forEach(l => { if (l.setAside && l.kind === "save") setAside += l.amount; if ((l.kind === "save" && !l.setAside) || l.kind === "topup") saving += l.amount; }); });
  ok("X1: Sophie put money by for her membership", setAside > 1, setAside);
  ok("X1: and it isn't counted as saved", Math.abs(base.saved - B.round(saving)) < 0.005, {saved: base.saved, saving, setAside});
  ok("X1: the same as the engine's round-up", Math.abs(base.saved - B.yearReview(db, "sophie", "2026-04-06").saved) < 0.005, {base: base.saved, yr: B.yearReview(db, "sophie", "2026-04-06").saved});
}

console.log(fails ? fails + " failed, " + passes + " passed" : "All " + passes + " passed");
process.exit(fails ? 1 : 0);
