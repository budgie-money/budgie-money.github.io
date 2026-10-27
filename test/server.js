// Serves the app and a stand-in for the Apps Script web app, loaded with the test household.
const http = require("http"), fs = require("fs"), path = require("path");
const makeEnv = require("./fake-gas.js"), fixture = require(process.env.FIX || "./fixture.js");
const env = makeEnv(), c = env.ctx;
c.setup();
const fx = fixture();
Object.keys(fx).forEach(t => { const sh = env.sheets[t]; if (!sh) return; const head = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0]; fx[t].forEach(r => sh.appendRow(head.map(h => r[h] === undefined ? "" : r[h]))); });
c.CACHE_ = {}; c.setup();
const ROOT = path.join(__dirname, ".."), PORT = +process.env.PORT || 8790;
const link = who => "http://localhost:" + PORT + "/#connect=" + Buffer.from(JSON.stringify({u: "http://localhost:" + PORT + "/exec", k: env.props["KEY_" + who]})).toString("base64url");
fs.writeFileSync(path.join(__dirname, ".links.json"), JSON.stringify({ethan: link("ethan"), sophie: link("sophie")}));
const types = {".html": "text/html", ".js": "text/javascript", ".webmanifest": "application/manifest+json", ".png": "image/png", ".json": "application/json"};
http.createServer((req, res) => {
  if (req.url.startsWith("/exec")) { let b = ""; req.on("data", d => b += d); req.on("end", () => { c.CACHE_ = {}; let body = {}; try { body = JSON.parse(b || "{}"); } catch (e) {} const out = c.handle_(body); res.writeHead(200, {"Content-Type": "application/json", "Access-Control-Allow-Origin": "*"}); res.end(out.text); }); return; }
  // tests only: give a person a new Budgie key (or put back the one given), and answer with its connect link
  if (req.url.startsWith("/rekey")) { const q = new URLSearchParams(req.url.split("?")[1] || ""), who = q.get("who"); const old = env.props["KEY_" + who]; env.props["KEY_" + who] = q.get("k") || c.makeKey_(); c.keysChanged_(); res.end(JSON.stringify({link: link(who), old})); return; }
  if (req.url.startsWith("/dump")) { const t = decodeURIComponent(req.url.split("?")[1] || "transactions"); c.CACHE_ = {}; res.end(JSON.stringify(c.readTable_(t).rows)); return; }
  let p = req.url.split("?")[0].split("#")[0]; if (p === "/") p = "/index.html";
  const f = path.join(ROOT, p);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, {"Content-Type": types[path.extname(f)] || "application/octet-stream"}); fs.createReadStream(f).pipe(res);
}).listen(PORT, () => console.log("listening " + PORT));
