// A small stand-in for the Apps Script services Code.gs uses, so it can be tested locally.
const vm = require("vm"), fs = require("fs"), path = require("path");
function chain() { const o = new Proxy(function () {}, {get: (t, k) => k === "then" ? undefined : () => o, apply: () => o}); return o; }
function makeEnv() {
  const sheets = {}, props = {}, logs = [];
  function Sheet(name) {
    const s = {name, cells: [], protections: []};
    const range = (r, c, nr = 1, nc = 1) => {
      const g = {
        getValues: () => Array.from({length: nr}, (_, i) => Array.from({length: nc}, (_, j) => ((s.cells[r - 1 + i] || [])[c - 1 + j]) ?? "")),
        setValues: (v) => { v.forEach((row, i) => row.forEach((x, j) => { (s.cells[r - 1 + i] = s.cells[r - 1 + i] || [])[c - 1 + j] = parseIn(x); })); return g; },
        setValue: (x) => { (s.cells[r - 1] = s.cells[r - 1] || [])[c - 1] = parseIn(x); return g; },
        setFontWeight: () => g, setBackground: () => g, setNote: () => g, setFontSize: () => g, setNumberFormat: () => g, setFontColor: () => g,
        // like Sheets: every protect() adds another protected range to the sheet
        protect: () => { const pr = {desc: "", setDescription: (d) => { pr.desc = d; return pr; }, getDescription: () => pr.desc, setWarningOnly: () => pr, remove: () => { s.protections.splice(s.protections.indexOf(pr), 1); }}; s.protections.push(pr); return pr; }
      };
      return g;
    };
    const api = {
      getName: () => name, getRange: range,
      getDataRange: () => { const w = Math.max(1, ...s.cells.map(r => (r || []).length)); return range(1, 1, Math.max(1, s.cells.length), w); },
      getLastColumn: () => Math.max(0, ...s.cells.map(r => (r || []).length)), getLastRow: () => s.cells.length,
      appendRow: (row) => { s.cells.push(row.map(parseIn)); },
      getProtections: () => s.protections.slice(),
      setFrozenRows: () => {}, setFrozenColumns: () => {}, setColumnWidth: () => {}, clear: () => { s.cells = []; }, _s: s
    };
    return api;
  }
  // like typing into a cell: ISO date strings become dates
  // a leading apostrophe keeps text as text and isn't stored, like in Sheets
  function parseIn(x) { if (typeof x === "string" && x[0] === "'") return x.slice(1); if (typeof x === "string" && /^\d{4}-\d{2}-\d{2}$/.test(x)) { const [y, m, d] = x.split("-").map(Number); return new Date(y, m - 1, d); } return x; }
  const triggers = [], cache = {}, userProps = {};
  // Script Properties (everyone with edit access to the script can see them) and the owner's User Properties
  const propStore = (store) => ({getProperty: (k) => store[k] ?? null, setProperty: (k, v) => { store[k] = String(v); }, getProperties: () => ({...store}), deleteProperty: (k) => { delete store[k]; }});
  const newTrigger = (fn) => { const b = new Proxy({}, {get: (t, k) => k === "create" ? () => { const tr = {getHandlerFunction: () => fn}; triggers.push(tr); return tr; } : () => b}); return b; };
  const ss = {
    getSheetByName: (n) => sheets[n] || null, insertSheet: (n) => (sheets[n] = Sheet(n)), getSpreadsheetTimeZone: () => "Europe/London", getSheets: () => Object.values(sheets),
    getName: () => "Untitled spreadsheet", rename: () => {}, setSpreadsheetTimeZone: () => {}, deleteSheet: (s) => { delete sheets[s.getName()]; }
  };
  const ctx = {
    console, Date, JSON, Math, Object, Array, String, Number, RegExp, Error,
    SpreadsheetApp: {getActiveSpreadsheet: () => ss, openById: () => ss, flush: () => {}, ProtectionType: {RANGE: "RANGE", SHEET: "SHEET"}},
    PropertiesService: {getScriptProperties: () => propStore(props), getUserProperties: () => propStore(userProps)},
    LockService: {getScriptLock: () => ({waitLock: () => {}, releaseLock: () => {}})},
    ContentService: {createTextOutput: (t) => ({setMimeType: () => ({text: t, json: () => JSON.parse(t)})}), MimeType: {JSON: "json"}},
    Utilities: {
      formatDate: (d, tz, f) => f === "yyyy-MM-dd" ? d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0") : d.toISOString(),
      getUuid: () => require("crypto").randomUUID(), base64EncodeWebSafe: (s) => Buffer.from(s).toString("base64url"),
      DigestAlgorithm: {SHA_256: "sha256"}, computeDigest: (alg, s) => Array.from(require("crypto").createHash(alg).update(String(s)).digest()).map(b => b > 127 ? b - 256 : b), sleep: () => {}
    },
    Logger: {log: (x) => logs.push(String(x))},
    ScriptApp: {getService: () => ({getUrl: () => "https://script.google.com/macros/s/TEST/exec"}), getProjectTriggers: () => triggers.slice(), newTrigger: newTrigger, deleteTrigger: (t) => { const i = triggers.indexOf(t); if (i >= 0) triggers.splice(i, 1); }},
    CacheService: {getScriptCache: () => ({get: (k) => cache[k] ?? null, put: (k, v) => { cache[k] = v; }, remove: (k) => { delete cache[k]; }})}
  };
  vm.createContext(ctx);
  const dir = path.join(__dirname, "..");
  vm.runInContext(fs.readFileSync(path.join(dir, "engine.js"), "utf8"), ctx, {filename: "Engine.gs"});
  vm.runInContext(fs.readFileSync(path.join(dir, "apps-script/Code.gs"), "utf8"), ctx, {filename: "Code.gs"});
  const prices = path.join(dir, "apps-script/Prices.gs");
  if (fs.existsSync(prices)) vm.runInContext(fs.readFileSync(prices, "utf8"), ctx, {filename: "Prices.gs"});
  return {ctx, sheets, props, userProps, logs, ss, triggers, cache, Sheet};
}
module.exports = makeEnv;
