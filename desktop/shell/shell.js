/* SEER shell: one sign-in, a menu grouped by kind of work, and the Operations page.
   Plain script (no build step). Inside the Windows app `window.seerDesktop` is the bridge to the
   program; in a browser (tests) the same page reads ./config.json instead. */
(() => {
  "use strict";
  const root = document.getElementById("seer-shell");
  const bridge = window.seerDesktop || null;

  /* ---------- words ---------- */
  const TEXT = {
    "Sign in": ["ግባ", "Seeni"], "One sign-in for every part of SEER you are allowed to use.": ["ለተፈቀደልዎ የSEER ክፍሎች ሁሉ አንድ መግቢያ።", "Kutaalee SEER siif hayyamaman hundaaf seensa tokko."],
    "Username": ["የተጠቃሚ ስም", "Maqaa fayyadamaa"], "Password": ["የይለፍ ቃል", "Jecha icciitii"], "Signing in…": ["በመግባት ላይ…", "Seenaa jira…"],
    "Wrong username or password.": ["የተሳሳተ የተጠቃሚ ስም ወይም የይለፍ ቃል።", "Maqaan fayyadamaa ykn jechi icciitii dogoggora."],
    "Starting the server. This can take up to a minute.": ["ሰርቨሩ እየተነሳ ነው። እስከ አንድ ደቂቃ ሊወስድ ይችላል።", "Sarvariin ka'aa jira. Hanga daqiiqaa tokko fudhachuu danda'a."],
    "Cannot reach the server. Check the internet connection and try again.": ["ሰርቨሩን ማግኘት አልተቻለም። የኢንተርኔት ግንኙነቱን ይፈትሹና እንደገና ይሞክሩ።", "Sarvarii qaqqabuun hin danda'amne. Walqunnamtii interneetii ilaalii irra deebi'ii yaali."],
    "Operations": ["ክንውኖች", "Hojiiwwan"], "Service": ["አገልግሎት", "Tajaajila"], "Stock": ["ክምችት", "Kuusaa"], "Money & people": ["ገንዘብ እና ሰራተኞች", "Maallaqa fi hojjettoota"], "Control": ["ቁጥጥር", "To'annoo"],
    "Cashier": ["ገንዘብ ተቀባይ", "Kaffaltii fudhataa"], "Waiter": ["አስተናጋጅ", "Keessummeessaa"], "Kitchen screen": ["የወጥ ቤት ማያ", "Iskiriinii kushinaa"],
    "Purchases": ["ግዢዎች", "Bittaa"], "Stock & approvals": ["ክምችት እና ማጽደቆች", "Kuusaa fi mirkaneessa"], "Finance": ["ፋይናንስ", "Faayinaansii"], "HR & payroll": ["የሰው ኃይል እና ደመወዝ", "Humna namaa fi mindaa"],
    "Owner reports": ["የባለቤት ሪፖርቶች", "Gabaasa abbaa qabeenyaa"], "Admin": ["አስተዳዳሪ", "Bulchiinsa"],
    "Sign out": ["ውጣ", "Ba'i"], "Light or dark": ["ብሩህ ወይም ጨለማ", "Ifaa ykn dukkana"], "Language": ["ቋንቋ", "Afaan"],
    "Today at {branch}": ["ዛሬ በ{branch}", "Har'a {branch}tti"], "Updated {time}": ["የዘመነው {time}", "Kan haaromfame {time}"], "Refresh": ["አድስ", "Haaromsi"],
    "Sales today": ["የዛሬ ሽያጭ", "Gurgurtaa har'aa"], "Cash": ["ጥሬ ገንዘብ", "Callaa"], "Telebirr": ["ቴሌብር", "Telebirr"], "CBE Birr": ["ሲቢኢ ብር", "CBE Birr"],
    "Costs today": ["የዛሬ ወጪዎች", "Baasii har'aa"], "Purchases approved": ["የጸደቁ ግዢዎች", "Bittaa mirkanaa'e"], "Waste": ["ብክነት", "Qisaasama"], "Expenses": ["ወጪዎች", "Baasii"],
    "This month": ["በዚህ ወር", "Ji'a kana"], "Revenue": ["ገቢ", "Galii"], "Orders": ["ትዕዛዞች", "Ajajoota"], "all branches": ["ሁሉም ቅርንጫፎች", "damee hunda"],
    "Tables": ["ጠረጴዛዎች", "Minjaalota"], "open of {n}": ["ክፍት ከ{n}", "banaa {n} keessaa"], "Food ready": ["ምግብ ዝግጁ", "Nyaanni qophaa'eera"], "Asked for the bill": ["ሂሳብ የጠየቁ", "Herrega gaafatan"], "In kitchen": ["በወጥ ቤት", "Kushinaa keessa"],
    "Kitchen": ["ወጥ ቤት", "Kushinaa"], "tickets cooking": ["በመብሰል ላይ ያሉ ቲኬቶች", "tikeetota bilchaachaa jiran"], "Pending": ["በመጠባበቅ ላይ", "Eegaa jira"], "Preparing": ["በዝግጅት ላይ", "Qophaa'aa jira"], "Ready": ["ዝግጁ", "Qophaa'e"],
    "Longest wait {n} min": ["ረጅሙ መጠበቅ {n} ደቂቃ", "Eegumsa dheeraa daqiiqaa {n}"], "Longest wait {n} h": ["ረጅሙ መጠበቅ {n} ሰዓት", "Eegumsa dheeraa sa'aatii {n}"],
    "Morning": ["ጠዋት", "Ganama"], "Evening": ["ምሽት", "Galgala"], "Night": ["ሌሊት", "Halkan"], "Afternoon": ["ከሰዓት", "Waaree booda"],
    "Waiting for approval": ["ማጽደቅ የሚጠብቁ", "Mirkaneessa eeggatan"], "Waste reports": ["የብክነት ሪፖርቶች", "Gabaasa qisaasamaa"], "Stock requests": ["የክምችት ጥያቄዎች", "Gaaffii kuusaa"],
    "Nothing is waiting.": ["የሚጠብቅ ነገር የለም።", "Wanti eeggatu hin jiru."],
    "Low stock": ["ዝቅተኛ ክምችት", "Kuusaa gadi aanaa"], "reorder at {n}": ["በ{n} እንደገና ይዘዙ", "{n} irratti irra deebi'ii ajaji"], "and {n} more": ["እና {n} ተጨማሪ", "fi {n} dabalataa"], "Stock is above the reorder level.": ["ክምችቱ ከዳግም ማዘዣ ደረጃ በላይ ነው።", "Kuusaan sadarkaa ajaja irra deebii ol jira."],
    "On shift": ["በፈረቃ ላይ", "Dabaree irra"], "Nobody is clocked in.": ["ማንም አልገባም።", "Namni seene hin jiru."],
    "Open": ["ክፈት", "Bani"], "Some figures could not be loaded: {what}": ["አንዳንድ አሃዞች ሊጫኑ አልቻሉም፦ {what}", "Lakkoofsi tokko tokko fe'amuu hin dandeenye: {what}"],
    "Owner": ["ባለቤት", "Abbaa Qabeenyaa"], "System Admin": ["የሲስተም አስተዳዳሪ", "Bulchaa Sirnaa"], "Branch manager": ["የቅርንጫፍ ሥራ አስኪያጅ", "Hogganaa Damee"], "Accountant": ["የሂሳብ ባለሙያ", "Herrega-qabaa"],
    "HR officer": ["የሰው ኃይል ባለሙያ", "Ogeessa Humna Namaa"], "Inventory clerk": ["የክምችት ሰራተኛ", "Hojjetaa Kuusaa"], "Kitchen staff": ["የወጥ ቤት ሰራተኛ", "Hojjetaa Kushinaa"],
    "This account has no part of SEER to open here.": ["ይህ መለያ እዚህ የሚከፍተው የSEER ክፍል የለውም።", "Herregni kun kutaa SEER asitti banu hin qabu."],
  };
  const LANGS = [["en", "EN"], ["am", "አማ"], ["om", "OM"]];
  const store = { get: (k) => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* private mode */ } } };
  let lang = ["am", "om"].includes(store.get("seer.shell.lang")) ? store.get("seer.shell.lang") : "en";
  let theme = store.get("seer.shell.theme") === "light" ? "light" : "dark";
  const t = (key, vars) => {
    let s = lang === "en" ? key : (TEXT[key] || [])[lang === "am" ? 0 : 1] || key;
    for (const k in vars || {}) s = s.split(`{${k}}`).join(String(vars[k]));
    return s;
  };
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const money = (n) => `ETB ${Math.round(Number(n) || 0).toLocaleString("en-US")}`;

  /* ---------- what each role may open ---------- */
  const APPS = {
    cashier: { label: "Cashier", section: "Service", icon: "M4 6h16v9H4zM8 19h8M12 15v4M7.5 10.5h3" },
    waiter: { label: "Waiter", section: "Service", icon: "M3 8h18M5 8v11M19 8v11M3 8l2-3h14l2 3" },
    kds: { label: "Kitchen screen", section: "Service", icon: "M4 5h16v11H4zM9 20h6M12 16v4" },
    sales: { label: "Purchases", section: "Stock", icon: "M5 8h14l-1 12H6zM9 8V6a3 3 0 0 1 6 0v2" },
    manager: { label: "Stock & approvals", section: "Stock", icon: "M4 7l8-4 8 4-8 4zM4 7v10l8 4 8-4V7M12 11v10" },
    finance: { label: "Finance", section: "Money & people", icon: "M4 19V5M4 19h16M8 16v-5M12 16V8M16 16v-3" },
    hr: { label: "HR & payroll", section: "Money & people", icon: "M9.5 10a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7M3 20a6.5 6.5 0 0 1 13 0M17 11a3 3 0 1 0 0-6M21 20a5 5 0 0 0-4-4.9" },
    owner: { label: "Owner reports", section: "Control", icon: "M6 3h9l4 4v14H6zM14 3v5h5M9 13h6M9 17h6" },
    admin: { label: "Admin", section: "Control", icon: "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6M19 12a7 7 0 0 0-.1-1.3l2-1.5-2-3.4-2.3.9a7 7 0 0 0-2.3-1.3L14 3h-4l-.3 2.4a7 7 0 0 0-2.3 1.3l-2.3-.9-2 3.4 2 1.5a7 7 0 0 0 0 2.6l-2 1.5 2 3.4 2.3-.9a7 7 0 0 0 2.3 1.3L10 21h4l.3-2.4a7 7 0 0 0 2.3-1.3l2.3.9 2-3.4-2-1.5c.1-.4.1-.9.1-1.3z" },
  };
  const SECTIONS = ["Service", "Stock", "Money & people", "Control"];
  const ROLE_APPS = {
    OWNER: ["cashier", "waiter", "kds", "sales", "manager", "finance", "hr", "owner", "admin"],
    ADMIN: ["cashier", "waiter", "kds", "sales", "manager", "finance", "hr", "admin"],
    BRANCH_MANAGER: ["cashier", "waiter", "kds", "sales", "manager", "hr"],
    SALES_STAFF: ["cashier"], WAITER: ["waiter"], KITCHEN_STAFF: ["kds"], INVENTORY_CLERK: ["sales"], ACCOUNTANT: ["finance"], HR_OFFICER: ["hr"],
  };
  const OPS_ROLES = ["OWNER", "ADMIN", "BRANCH_MANAGER"];
  const ROLE_NAME = { OWNER: "Owner", ADMIN: "System Admin", BRANCH_MANAGER: "Branch manager", SALES_STAFF: "Cashier", WAITER: "Waiter", KITCHEN_STAFF: "Kitchen staff", INVENTORY_CLERK: "Inventory clerk", ACCOUNTANT: "Accountant", HR_OFFICER: "HR officer" };
  const icon = (d) => `<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${d}"/></svg>`;
  const I = { ops: "M4 4h7v7H4zM13 4h7v4h-7zM13 10h7v10h-7zM4 13h7v7H4z", out: "M10 4H5v16h5M15 8l4 4-4 4M19 12H9", theme: "M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5z", refresh: "M20 11a8 8 0 1 0-2.3 5.7M20 5v6h-6", arrow: "M5 12h14M13 6l6 6-6 6" };

  /* ---------- state ---------- */
  let cfg = { apiUrl: "", ports: {} };
  let user = null, token = "", secret = null;      // secret = { username, password }, memory only (to renew the session)
  let view = "ops";
  const opened = new Set();
  let ops = { at: 0, data: {}, failed: [] }, names = {}, timer = 0, busy = false, signMsg = "";

  /* ---------- server ---------- */
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  async function login(username, password, onWaiting) {
    const began = Date.now();
    for (;;) {
      let res = null;
      try { res = await fetch(`${cfg.apiUrl}/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username, password }) }); } catch { /* asleep or offline */ }
      if (res && res.ok) return res.json();
      if (res && ![502, 503, 504].includes(res.status)) throw new Error(res.status === 401 ? "wrong" : `Server error (${res.status})`);
      if (Date.now() - began > 90000) throw new Error("offline");
      onWaiting && onWaiting();
      await sleep(3000);
    }
  }
  async function api(path, again = true) {
    const res = await fetch(cfg.apiUrl + path, { headers: { Authorization: `Bearer ${token}`, "X-Branch-Id": user.branchId || "" } });
    if (res.status === 401 && again && secret) { token = (await login(secret.username, secret.password)).accessToken; return api(path, false); }
    if (!res.ok) throw new Error(String(res.status));
    return res.json();
  }

  /* ---------- sign-in ---------- */
  function renderSignIn(typed = "") {
    document.documentElement.lang = lang; document.documentElement.dataset.theme = theme;
    root.innerHTML = `
      <main class="signin"><form class="signin-card" id="signin" novalidate>
        <div class="brand"><img class="logo-dark" src="./logo-dark.png" alt=""><img class="logo-light" src="./logo-light.png" alt=""><strong>SEER</strong></div>
        <h1>${esc(t("Sign in"))}</h1>
        <p>${esc(t("One sign-in for every part of SEER you are allowed to use."))}</p>
        <label class="field"><span>${esc(t("Username"))}</span><input id="suUser" autocomplete="username" autocapitalize="none" spellcheck="false" value="${esc(typed)}"></label>
        <label class="field"><span>${esc(t("Password"))}</span><input id="suPass" type="password" autocomplete="current-password"></label>
        <p class="err" role="alert">${esc(signMsg)}</p>
        <button class="btn primary" type="submit" ${busy ? "disabled" : ""}>${esc(busy ? t("Signing in…") : t("Sign in"))}</button>
        ${langSeg()}
      </form></main>`;
    const u = document.getElementById("suUser"); if (u && !typed) u.focus();
  }
  const langSeg = () => `<div class="seg" role="group" aria-label="${esc(t("Language"))}">${LANGS.map(([c, l]) => `<button type="button" data-lang="${c}" aria-pressed="${lang === c}">${l}</button>`).join("")}</div>`;

  async function submitSignIn() {
    const username = document.getElementById("suUser").value.trim(), password = document.getElementById("suPass").value;
    if (!username || !password || busy) return;
    busy = true; signMsg = ""; renderSignIn(username);
    try {
      const out = await login(username, password, () => { const e = root.querySelector(".err"); if (e) e.textContent = t("Starting the server. This can take up to a minute."); });
      user = out.user; token = out.accessToken; secret = { username, password };
      if (bridge) await bridge.setCredentials(user.id, username, password);
      const mine = ROLE_APPS[user.role] || [];
      view = OPS_ROLES.includes(user.role) ? "ops" : mine[0] || "none";
      busy = false; renderFrame(); if (view === "ops") void loadOps();
    } catch (err) {
      busy = false;
      signMsg = err.message === "wrong" ? t("Wrong username or password.") : err.message === "offline" ? t("Cannot reach the server. Check the internet connection and try again.") : err.message;
      renderSignIn(username);
    }
  }

  async function signOut() {
    clearInterval(timer); timer = 0;
    if (bridge) await bridge.signOut();
    user = null; token = ""; secret = null; opened.clear(); ops = { at: 0, data: {}, failed: [] }; signMsg = "";
    renderSignIn();
  }

  /* ---------- frame ---------- */
  function badges() {
    const d = ops.data, out = {};
    if (d.overview) out.manager = d.overview.queue.reduce((s, q) => s + Number(q.n), 0);
    if (d.kds) out.kds = d.kds.tickets.filter((x) => x.status !== "READY").length;
    if (d.floor) out.waiter = d.floor.tables.filter((x) => x.status === "READY" || x.status === "BILL").length;
    return out;
  }
  function railHtml() {
    const mine = ROLE_APPS[user.role] || [], b = badges();
    const nav = (id, label, d) => `<button class="nav" data-view="${id}" ${view === id ? 'aria-current="page"' : ""} title="${esc(t(label))}">${icon(d)}<span>${esc(t(label))}</span>${b[id] ? `<b class="dot">${b[id]}</b>` : ""}</button>`;
    return `
      <div class="brand"><img class="logo-dark" src="./logo-dark.png" alt=""><img class="logo-light" src="./logo-light.png" alt=""><strong>SEER</strong></div>
      ${OPS_ROLES.includes(user.role) ? nav("ops", "Operations", I.ops) : ""}
      ${SECTIONS.map((s) => { const list = mine.filter((a) => APPS[a].section === s); return list.length ? `<h3>${esc(t(s))}</h3>${list.map((a) => nav(a, APPS[a].label, APPS[a].icon)).join("")}` : ""; }).join("")}
      <div class="rail-foot">
        <div class="me"><span class="avatar">${esc(user.initials || (user.name || "?").slice(0, 2).toUpperCase())}</span><span><strong>${esc(user.name)}</strong><small>${esc(t(ROLE_NAME[user.role] || user.role))}</small></span></div>
        <div class="row">${langSeg()}<button class="icon-btn" data-act="theme" aria-label="${esc(t("Light or dark"))}" title="${esc(t("Light or dark"))}">${icon(I.theme)}</button></div>
        <button class="nav" data-act="signout">${icon(I.out)}<span>${esc(t("Sign out"))}</span></button>
      </div>`;
  }
  function renderFrame() {
    document.documentElement.lang = lang; document.documentElement.dataset.theme = theme;
    if (!root.querySelector(".frame")) root.innerHTML = `<div class="frame"><nav class="rail" aria-label="SEER"></nav><div class="stage"><section class="ops" id="ops" hidden></section></div></div>`;
    root.querySelector(".rail").innerHTML = railHtml();
    const stage = root.querySelector(".stage");
    if (APPS[view] && !opened.has(view)) {            // an app is loaded the first time it is opened, then kept running
      const f = document.createElement("iframe");
      f.dataset.app = view; f.title = APPS[view].label; f.src = `http://localhost:${cfg.ports[view]}/`;
      stage.append(f); opened.add(view);
    }
    for (const el of stage.children) el.hidden = el.id === "ops" ? view !== "ops" : el.dataset.app !== view;
    if (view === "ops") renderOps();
    if (view === "none") { const o = document.getElementById("ops"); o.hidden = false; o.innerHTML = `<p class="none">${esc(t("This account has no part of SEER to open here."))}</p>`; }
    if (!timer && OPS_ROLES.includes(user.role)) timer = setInterval(() => { void loadOps(); }, 30000);
  }

  /* ---------- Operations ---------- */
  async function loadOps() {
    if (!user || !OPS_ROLES.includes(user.role)) return;
    const jobs = { overview: "/manager/overview?period=today", floor: "/floor", kds: "/kds/tickets" };
    if (user.role === "OWNER" && Date.now() - (ops.ownerAt || 0) > 5 * 60000) jobs.owner = "/owner/bootstrap";
    const failed = [], data = { ...ops.data };
    await Promise.all(Object.entries(jobs).map(async ([k, p]) => { try { data[k] = await api(p); if (k === "owner") ops.ownerAt = Date.now(); } catch { failed.push(k); } }));
    if (!names[lang]) { try { names[lang] = await api(`/ref/i18n/${lang}`); } catch { names[lang] = null; } }
    if (!user) return;                                 // signed out while loading
    ops = { ...ops, at: Date.now(), data, failed };
    root.querySelector(".rail").innerHTML = railHtml();
    if (view === "ops") renderOps();
  }

  function tile(title, target, body, cls = "") {
    const can = target && (ROLE_APPS[user.role] || []).includes(target);
    return `<article class="tile ${cls}"><div class="tile-head"><h2>${esc(t(title))}</h2>${can ? `<button class="link" data-view="${target}">${esc(t("Open"))} ${icon(I.arrow)}</button>` : ""}</div>${body}</article>`;
  }
  const shiftName = (code) => { const s = String(code || "").toLowerCase().replace(/_/g, " "); return s ? t(s.charAt(0).toUpperCase() + s.slice(1)) : ""; };
  const kv = (pairs) => `<div class="kv">${pairs.map(([k, v, c]) => `<div><div class="k">${esc(t(k))}</div><div class="v ${c || ""}">${esc(v)}</div></div>`).join("")}</div>`;

  function renderOps() {
    const el = document.getElementById("ops"); if (!el) return;
    const d = ops.data, o = d.overview, tiles = [];
    const branch = d.floor && d.floor.branch ? d.floor.branch.name : "";
    if (o) {
      tiles.push(tile("Sales today", "cashier", `<div class="fig">${money(o.payments.total)}</div>${kv([["Cash", money(o.payments.cash)], ["Telebirr", money(o.payments.telebirr)], ["CBE Birr", money(o.payments.cbeBirr)]])}`, "half"));
      tiles.push(tile("Costs today", "sales", `<div class="fig">${money(Number(o.cogs) + Number(o.waste) + Number(o.expenses))}</div>${kv([["Purchases approved", money(o.cogs)], ["Waste", money(o.waste)], ["Expenses", money(o.expenses)]])}`, "half"));
    }
    if (d.owner && d.owner.monthToDate) {
      const m = d.owner.monthToDate;
      tiles.push(tile("This month", "owner", `<div class="fig">${money(m.revenue)}<small>${esc(t("Revenue"))} · ${esc(t("all branches"))}</small></div>${kv([["Expenses", money(m.expenses)], ["Orders", Number(m.orders).toLocaleString("en-US")], ["Sales today", money(m.today)]])}`, "wide"));
    }
    if (d.floor) {
      const tb = d.floor.tables, open = tb.filter((x) => x.status !== "FREE"), n = (s) => tb.filter((x) => x.status === s).length;
      tiles.push(tile("Tables", "waiter", `<div class="fig">${open.length}<small>${esc(t("open of {n}", { n: tb.length }))}</small></div>${kv([["Food ready", n("READY"), n("READY") ? "good" : ""], ["Asked for the bill", n("BILL"), n("BILL") ? "warn" : ""], ["In kitchen", n("IN_KITCHEN")]])}`));
    }
    if (d.kds) {
      const tk = d.kds.tickets, n = (s) => tk.filter((x) => x.status === s).length, cooking = tk.filter((x) => x.status !== "READY");
      const longest = cooking.reduce((m, x) => Math.max(m, Number(x.elapsedMinutes) || 0), 0);
      tiles.push(tile("Kitchen", "kds", `<div class="fig">${cooking.length}<small>${esc(t("tickets cooking"))}</small></div>${kv([["Pending", n("PENDING")], ["Preparing", n("PREPARING")], ["Ready", n("READY"), n("READY") ? "good" : ""]])}${cooking.length ? `<p class="sub">${esc(longest >= 120 ? t("Longest wait {n} h", { n: Math.round(longest / 60) }) : t("Longest wait {n} min", { n: longest }))}</p>` : ""}`, d.owner ? "half" : ""));
    }
    if (o) {
      const Q = { purchase: "Purchases", expense: "Expenses", waste_report: "Waste reports", dispatch_request: "Stock requests" };
      const total = o.queue.reduce((s, q) => s + Number(q.n), 0);
      tiles.push(tile("Waiting for approval", "manager", total ? `<div class="fig">${total}</div><ul class="rows">${o.queue.map((q) => `<li><span>${esc(t(Q[q.entity_type] || q.entity_type))}</span><span class="n">${q.n}</span></li>`).join("")}</ul>` : `<p class="none">${esc(t("Nothing is waiting."))}</p>`, d.owner ? "half" : ""));
      const nm = names[lang] || {}, low = o.lowStock;
      tiles.push(tile("Low stock", "manager", low.length ? `<div class="fig">${low.length}</div><ul class="rows">${low.slice(0, 6).map((x) => `<li><span>${esc(nm[x.name_key] || x.item_id)} <small>${esc(t("reorder at {n}", { n: Number(x.reorder_point) }))}</small></span><span class="n ${Number(x.on_hand) <= 0 ? "bad" : "warn"}">${Number(x.on_hand)} ${esc(x.unit_code)}</span></li>`).join("")}</ul>${low.length > 6 ? `<p class="sub">${esc(t("and {n} more", { n: low.length - 6 }))}</p>` : ""}` : `<p class="none">${esc(t("Stock is above the reorder level."))}</p>`, "half"));
      tiles.push(tile("On shift", "hr", o.onShift.length ? `<div class="fig">${o.onShift.length}</div><ul class="rows">${o.onShift.slice(0, 8).map((x) => `<li><span>${esc(x.full_name)}</span><small>${esc(shiftName(x.shift_code))}</small></li>`).join("")}</ul>` : `<p class="none">${esc(t("Nobody is clocked in."))}</p>`, "half"));
    }
    const when = ops.at ? new Date(ops.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "";
    el.innerHTML = `
      <header class="ops-head"><div><h1>${esc(t("Operations"))}</h1><p>${esc(branch ? t("Today at {branch}", { branch }) : "")}${when ? ` · ${esc(t("Updated {time}", { time: when }))}` : ""}</p></div>
        <button class="btn" data-act="refresh">${icon(I.refresh)} ${esc(t("Refresh"))}</button></header>
      ${ops.failed.length && ops.at ? `<p class="note" role="status">${esc(t("Some figures could not be loaded: {what}", { what: ops.failed.join(", ") }))}</p>` : ""}
      <div class="ops-grid">${tiles.join("") || `<p class="none">…</p>`}</div>`;
  }

  /* ---------- events ---------- */
  root.addEventListener("submit", (e) => { if (e.target.id === "signin") { e.preventDefault(); void submitSignIn(); } });
  root.addEventListener("click", (e) => {
    const el = e.target.closest("[data-lang], [data-view], [data-act]"); if (!el) return;
    if (el.dataset.lang) {
      lang = el.dataset.lang; store.set("seer.shell.lang", lang);
      if (user) { renderFrame(); if (!names[lang]) void loadOps(); } else renderSignIn((document.getElementById("suUser") || {}).value || "");
    } else if (el.dataset.view) { view = el.dataset.view; renderFrame(); if (view === "ops") void loadOps(); }
    else if (el.dataset.act === "theme") { theme = theme === "dark" ? "light" : "dark"; store.set("seer.shell.theme", theme); renderFrame(); }
    else if (el.dataset.act === "refresh") void loadOps();
    else if (el.dataset.act === "signout") void signOut();
  });

  /* ---------- start ---------- */
  (async () => {
    try { cfg = bridge ? await bridge.config() : await fetch("./config.json").then((r) => r.json()); } catch { /* keep defaults */ }
    cfg.apiUrl = String(cfg.apiUrl || "").replace(/\/$/, "");
    renderSignIn();
  })();
})();
