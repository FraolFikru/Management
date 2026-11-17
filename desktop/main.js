/* SEER for Windows — the desktop program.

   It shows one window: the SEER shell (menu, sign-in, Operations). Each of the nine apps runs inside
   that window in its own frame. The apps are the same builds that go on the web; here they are served
   from this computer, each on its own local address, so nothing depends on the web hosting.

   Sign-in once: the shell hands the username and password to this process, which keeps them in memory
   only (never on disk) and gives them to each app's own sign-in screen when it appears. */

const { app, BrowserWindow, ipcMain, session, shell } = require("electron");
const http = require("http");
const fs = require("fs");
const path = require("path");

const APPS = ["shell", "owner", "admin", "manager", "sales", "finance", "hr", "cashier", "waiter", "kds"];
const BASE_PORT = 47610;                       // shell = 47610, owner = 47611, …
const portOf = (name) => BASE_PORT + APPS.indexOf(name);
const SMOKE = process.argv.includes("--smoke");

const WEB = app.isPackaged ? path.join(process.resourcesPath, "web") : path.join(__dirname, "web");
const rootOf = (name) => (name === "shell" ? path.join(__dirname, "shell") : path.join(WEB, name));

const MIME = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".json": "application/json", ".webmanifest": "application/manifest+json", ".png": "image/png", ".svg": "image/svg+xml",
  ".ico": "image/x-icon", ".woff2": "font/woff2", ".woff": "font/woff", ".jpg": "image/jpeg", ".webp": "image/webp", ".map": "application/json",
};

function config() {
  try { return JSON.parse(fs.readFileSync(path.join(WEB, "config.json"), "utf8")); } catch { return {}; }
}

function serve(name) {
  const root = rootOf(name);
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      let rel = decodeURIComponent((req.url || "/").split("?")[0]);
      if (rel === "/sw.js") { res.writeHead(404); res.end(); return; }          // no offline cache inside the desktop app
      if (name === "shell" && rel === "/config.json") { res.writeHead(200, { "Content-Type": MIME[".json"], "Cache-Control": "no-store" }); res.end(JSON.stringify(config())); return; }
      if (rel.endsWith("/")) rel += "index.html";
      let file = path.normalize(path.join(root, rel));
      if (!file.startsWith(root)) { res.writeHead(403); res.end(); return; }
      if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(root, "index.html");   // single-page apps
      fs.readFile(file, (err, data) => {
        if (err) { res.writeHead(404); res.end("Not found"); return; }
        const type = MIME[path.extname(file).toLowerCase()] || "application/octet-stream";
        res.writeHead(200, { "Content-Type": type, "Cache-Control": type.startsWith("text/html") ? "no-store" : "max-age=3600" });
        res.end(data);
      });
    });
    server.once("error", reject);
    server.listen(portOf(name), "127.0.0.1", () => resolve(server));
  });
}

/* ---- one sign-in for every app ---- */

let creds = null;                                   // { username, password } — memory only
const isShell = (frame) => !!frame && frame.url.startsWith(`http://localhost:${BASE_PORT}/`);
const isApp = (frame) => {
  if (!frame) return false;
  const m = /^http:\/\/localhost:(\d+)\//.exec(frame.url);
  return !!m && Number(m[1]) > BASE_PORT && Number(m[1]) < BASE_PORT + APPS.length;
};
const appOrigins = () => APPS.slice(1).map((a) => `http://localhost:${portOf(a)}`);
const lastUserFile = () => path.join(app.getPath("userData"), "last-user.json");

async function forgetApps() {
  for (const origin of appOrigins()) {
    await session.defaultSession.clearStorageData({ origin, storages: ["localstorage", "indexdb", "cachestorage", "serviceworkers", "cookies"] }).catch(() => undefined);
  }
}

ipcMain.handle("seer:config", () => ({ ...config(), ports: Object.fromEntries(APPS.map((a) => [a, portOf(a)])), version: app.getVersion() }));

ipcMain.handle("seer:set-creds", async (e, c) => {
  if (!isShell(e.senderFrame) || !c || typeof c.username !== "string" || typeof c.password !== "string") return false;
  // a different person than last time: the apps must not open with the previous person's session
  let last = "";
  try { last = JSON.parse(fs.readFileSync(lastUserFile(), "utf8")).id || ""; } catch { /* first run */ }
  if (last !== c.userId) await forgetApps();
  try { fs.writeFileSync(lastUserFile(), JSON.stringify({ id: c.userId || "" })); } catch { /* read-only profile */ }
  creds = { username: c.username, password: c.password };
  return true;
});

ipcMain.handle("seer:creds", (e) => (isApp(e.senderFrame) ? creds : null));

ipcMain.handle("seer:logout", async (e) => {
  if (!isShell(e.senderFrame)) return false;
  creds = null;
  await forgetApps();
  try { fs.unlinkSync(lastUserFile()); } catch { /* nothing to remove */ }
  return true;
});

/* ---- window ---- */

async function createWindow() {
  const win = new BrowserWindow({
    width: 1440, height: 900, minWidth: 1024, minHeight: 680, show: !SMOKE,
    backgroundColor: "#141415", autoHideMenuBar: true, title: "SEER",
    icon: path.join(__dirname, "build", "icon.png"),
    webPreferences: { preload: path.join(__dirname, "preload.js"), contextIsolation: true, nodeIntegration: false, nodeIntegrationInSubFrames: true, sandbox: false },
  });
  win.removeMenu();
  // links to other websites open in the normal browser, never inside the app
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:\/\//.test(url) && !url.startsWith("http://localhost:476")) void shell.openExternal(url); return { action: "deny" }; });
  await win.loadURL(`http://localhost:${BASE_PORT}/`);
  return win;
}

async function smoke(win) {
  const problems = [];
  for (const name of APPS) {
    const body = await fetch(`http://localhost:${portOf(name)}/`).then((r) => (r.ok ? r.text() : `HTTP ${r.status}`)).catch((err) => String(err));
    if (!/id="app"|id="seer-shell"/.test(body)) problems.push(`${name}: page did not load (${body.slice(0, 80)})`);
  }
  const hasSignIn = await win.webContents.executeJavaScript("new Promise(r => setTimeout(() => r(!!document.querySelector('#signin') && typeof window.seerDesktop === 'object'), 1500))");
  if (!hasSignIn) problems.push("shell: sign-in screen or desktop bridge missing");
  console.log(problems.length ? "SMOKE FAILED\n" + problems.join("\n") : `SMOKE OK: shell and ${APPS.length - 1} apps load`);
  app.exit(problems.length ? 1 : 0);
}

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on("second-instance", () => { const w = BrowserWindow.getAllWindows()[0]; if (w) { if (w.isMinimized()) w.restore(); w.focus(); } });
  app.whenReady().then(async () => {
    try { await Promise.all(APPS.map(serve)); }
    catch (err) { console.error("Could not start the local servers:", err); app.exit(1); return; }
    const win = await createWindow();
    if (SMOKE) await smoke(win);
  });
  app.on("window-all-closed", () => app.quit());
}
