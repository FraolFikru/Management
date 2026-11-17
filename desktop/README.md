# SEER for Windows

One program with one sign-in for every SEER app. The menu groups the apps by kind of work
(Service, Stock, Money & people, Control) and shows only what the signed-in role may use.
Owners, admins and branch managers also get **Operations**: today's sales and costs, tables,
the kitchen queue, approvals waiting, low stock and who is on shift, on one page.

- `main.js` – the program: one window, and a small local server per app (the same builds as the web apps).
- `preload.js` – hands the shell's sign-in to each app's own sign-in screen, once.
- `shell/` – the menu, sign-in and Operations page (plain HTML, CSS and JS).

The installer is built by GitHub (`.github/workflows/windows-app.yml`) and published as the
**seer-windows** release. The username and password are kept in memory only while the program is open.
To run from source: build each app in `apps/*` into `desktop/web/<app>`, write `desktop/web/config.json`
(`{"apiUrl": "https://…"}`), then `npm install && npm start` in this folder.
