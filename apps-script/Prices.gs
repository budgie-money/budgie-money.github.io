/* Budgie: fund prices for the LISA tracker.
   Once a day this reads the latest price of each fund from Fidelity's public factsheet pages and keeps it in the
   "prices" tab, so the app can show what the LISA is worth between balance checks. The first run also adds a few
   estimated prices from each fund's 1, 3, 6 and 12 month performance, so the chart has a past to draw.
   Prices are in pence, as Fidelity shows them; the app only uses how they change.
   Set up once: run installPriceTrigger. Check it works: run testPrices (it changes nothing). */

var PRICE_FUNDS = [
  {fund: "GB00BJS8SJ34", name: "Global shares (Fidelity Index World P Acc)", url: "https://www.fidelity.co.uk/factsheet-data/factsheet/GB00BJS8SJ34-fidelity-index-world-fund-p-acc"},
  {fund: "GB00B58YKH53", name: "Overseas corporate bonds ESG (iShares ESG Screened Overseas Corporate Bond Index D Acc)", url: "https://www.fidelity.co.uk/factsheet-data/factsheet/GB00B58YKH53-ishares-esg-scr-ov-co-bd-idx-uk-d-acc"},
  {fund: "GB00B5BFJG71", name: "Global property ESG (iShares Environment & Low Carbon Tilt Real Estate Index D Acc)", url: "https://www.fidelity.co.uk/factsheet-data/factsheet/GB00B5BFJG71-ishare-env--lw-crbn-tlt-rl-est-in-d-acc"}
];
var PRICE_HEAD_ = ["id", "fund", "date", "price", "source", "deleted", "updated", "by"];
var MONTHS_ = {jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12};

function fetchText_(url) {
  var r = UrlFetchApp.fetch(url, {muteHttpExceptions: true, followRedirects: true, headers: {"User-Agent": "Mozilla/5.0 (compatible; Budgie personal budget sheet)"}});
  if (r.getResponseCode() >= 300) throw new Error("Fidelity said " + r.getResponseCode() + " for " + url);
  return r.getContentText();
}
function pageText_(html) {
  return String(html).replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;/g, " ").replace(/&amp;/g, "&").replace(/&#43;|&plus;/g, "+").replace(/&minus;|&#8722;|−/g, "-").replace(/\s+/g, " ");
}
function iso_(y, m, d) { return y + "-" + ("0" + m).slice(-2) + "-" + ("0" + d).slice(-2); }
// the price, its date and (on the performance page) the 1, 3, 6 and 12 month returns
function parseFactsheet_(html) {
  var t = pageText_(html), out = {};
  var dm = t.match(/Prices? (?:updated )?as at:?\s*(\d{1,2})(?:st|nd|rd|th)? ([A-Za-z]{3})[a-z]* (\d{4})/i);
  if (dm && MONTHS_[dm[2].toLowerCase()]) out.date = iso_(+dm[3], MONTHS_[dm[2].toLowerCase()], +dm[1]);
  var pm = t.match(/(?:Last buy\/sell price|Buy\/sell price|Sell price|Price)\s*:?\s*(?:GBX|GBP)?\s*£?([\d,]+\.\d+)\s*(p\b)?/i);
  if (pm) out.price = +pm[1].replace(/,/g, "") * (pm[2] ? 1 : 100);
  // a return is a decimal straight after its label ("6 Months -1.91"), which skips chart buttons like "1 Month 3 Months"
  var periods = [["1m", 1, /\b1 Months?\s*:?\s*([-+]?\d+\.\d+)\s*%?/i], ["3m", 3, /\b3 Months\s*:?\s*([-+]?\d+\.\d+)/i], ["6m", 6, /\b6 Months\s*:?\s*([-+]?\d+\.\d+)/i], ["1y", 12, /\b1 Years?\s*:?\s*([-+]?\d+\.\d+)/i]];
  out.returns = [];
  periods.forEach(function (p) { var m = t.match(p[2]); if (m) out.returns.push({key: p[0], months: p[1], pct: +m[1]}); });
  return out;
}
function monthsBefore_(isoDate, n) {
  var d = new Date(Date.UTC(+isoDate.slice(0, 4), +isoDate.slice(5, 7) - 1 - n, +isoDate.slice(8, 10)));
  return iso_(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
}
function readFund_(f) {
  var main = parseFactsheet_(fetchText_(f.url)), perf = {};
  try { perf = parseFactsheet_(fetchText_(f.url + "/performance")); } catch (e) { perf = {returns: []}; }
  var price = main.price || perf.price, date = main.date || perf.date;
  if (!(price > 0) || !date) throw new Error("Couldn't read a price for " + f.name);
  return {fund: f.fund, name: f.name, price: Math.round(price * 1000) / 1000, date: date, returns: perf.returns && perf.returns.length ? perf.returns : main.returns};
}

/** See what Budgie would save, without saving anything. */
function testPrices() {
  PRICE_FUNDS.forEach(function (f) {
    try { var r = readFund_(f); Logger.log(f.name + ": " + r.price + "p on " + r.date + " · returns " + r.returns.map(function (x) { return x.key + " " + x.pct + "%"; }).join(", ")); }
    catch (e) { Logger.log(f.name + ": " + e.message); }
  });
}

/** Fetch today's prices and keep them in the prices tab. Runs once a day once installPriceTrigger has been run. */
function updatePrices() {
  var got = [], problems = [];
  PRICE_FUNDS.forEach(function (f) { try { got.push(readFund_(f)); } catch (e) { problems.push(e.message); } });
  var lock = LockService.getScriptLock(); lock.waitLock(25000);
  try {
    var ss = ss_(), sh = ss.getSheetByName("prices");
    if (!sh) { sh = ss.insertSheet("prices"); sh.getRange(1, 1, 1, PRICE_HEAD_.length).setValues([PRICE_HEAD_]).setFontWeight("bold").setBackground("#E3ECF5"); sh.setFrozenRows(1); }
    CACHE_.prices = null;
    var tab = readTable_("prices"), head = tab.head.length ? tab.head : PRICE_HEAD_, now = Date.now(), byId = {}, written = 0;
    tab.rows.forEach(function (r) { byId[r.id] = r; });
    var near = function (fund, date, days) { return tab.rows.some(function (r) { return r.fund === fund && !r.deleted && Math.abs((Date.parse(String(r.date).slice(0, 10)) - Date.parse(date)) / 864e5) <= days; }); };
    var write = function (row) {
      row.updated = now; row.by = "budgie"; row.deleted = false;
      var line = head.map(function (h) { return row[h] === undefined ? "" : row[h]; }), ex = byId[row.id];
      if (ex) sh.getRange(ex._row, 1, 1, line.length).setValues([line]); else { sh.appendRow(line); tab.rows.push(row); byId[row.id] = row; }
      written++;
    };
    got.forEach(function (g) {
      write({id: g.fund + ":" + g.date, fund: g.fund, date: g.date, price: g.price, source: "fidelity"});
      // estimated past prices from the fund's performance, only where there's nothing real nearby
      g.returns.forEach(function (r) {
        var d = monthsBefore_(g.date, r.months); if (near(g.fund, d, 10)) return;
        write({id: g.fund + ":" + d, fund: g.fund, date: d, price: Math.round(g.price / (1 + r.pct / 100) * 1000) / 1000, source: "est-" + r.key});
      });
    });
    SpreadsheetApp.flush(); CACHE_.prices = null;
    Logger.log("Saved " + written + " prices." + (problems.length ? " Problems: " + problems.join("; ") : ""));
  } finally { lock.releaseLock(); }
  if (problems.length && !got.length) throw new Error(problems.join("; "));
}

/** Run once: fetches prices now, then every morning. */
function installPriceTrigger() {
  var has = ScriptApp.getProjectTriggers().some(function (t) { return t.getHandlerFunction() === "updatePrices"; });
  if (!has) ScriptApp.newTrigger("updatePrices").timeBased().everyDays(1).atHour(7).create();
  updatePrices();
}
