/* What each screen looks like. Pure functions of the store: state in, HTML out. */

import { isConfigured, sessionUser } from "./api";
import { LANGS, money, nm, since, t } from "./i18n";
import { canEdit, draftTotal, draftsOf, isOpen, item, me, order, orders, sending, state, tableOf } from "./store";
import type { Draft, FloorTable, LineState, Order, OrderLine, PayMethod, TableStatus } from "./types";

export const esc = (s: string): string => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string);

const P = {
  back: "M15 5l-7 7 7 7", more: "M5 12h.01M12 12h.01M19 12h.01", people: "M16 19v-1a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v1M9.5 10a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7M21 19v-1a4 4 0 0 0-3-3.9M15.5 3.2a3.5 3.5 0 0 1 0 6.6",
  clock: "M12 7v5l3 2M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18", search: "M21 21l-4.3-4.3M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14", close: "M6 6l12 12M18 6L6 18",
  send: "M4 12l16-8-6 16-3-7-7-1z", pause: "M9 5v14M15 5v14", bell: "M6 16V11a6 6 0 1 1 12 0v5l2 2H4l2-2zM10 21h4", check: "M5 12.5l4.5 4.5L19 7.5",
  receipt: "M6 3h12v18l-3-2-3 2-3-2-3 2V3zM9 8h6M9 12h6", swap: "M7 7h13l-3-3M17 17H4l3 3", flame: "M12 3c1 4 5 5 5 10a5 5 0 0 1-10 0c0-2 1-3 2-4 0 2 1 3 2 3 0-3-1-5 1-9z",
  plus: "M12 5v14M5 12h14", minus: "M5 12h14", note: "M5 4h14v12l-4 4H5V4zM9 9h6M9 13h4", wifi: "M3 9a14 14 0 0 1 18 0M6.5 12.5a9 9 0 0 1 11 0M10 16a4 4 0 0 1 4 0M12 19.5h.01",
  table: "M3 8h18M5 8v11M19 8v11M3 8l2-3h14l2 3", out: "M10 4H5v16h5M15 8l4 4-4 4M19 12H9", trash: "M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13",
};
export const icon = (n: keyof typeof P, cls = ""): string =>
  `<svg class="ic ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${P[n]}"/></svg>`;

const STATUS: Record<TableStatus | "PAID" | "VOIDED", { label: string; cls: string }> = {
  FREE: { label: "Free", cls: "free" }, SEATED: { label: "Seated", cls: "seated" }, IN_KITCHEN: { label: "In kitchen", cls: "kitchen" },
  READY: { label: "Food ready", cls: "ready" }, SERVED: { label: "Served", cls: "served" }, BILL: { label: "Ready for bill", cls: "bill" },
  PAID: { label: "Paid", cls: "free" }, VOIDED: { label: "Closed", cls: "free" },
};
const pill = (s: keyof typeof STATUS): string => `<span class="pill st-${STATUS[s].cls}">${esc(t(STATUS[s].label))}</span>`;
const clock = (): string => new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
const initials = (name: string): string => name.split(/\s+/).map((w) => w[0] ?? "").join("").slice(0, 2).toUpperCase();

/* ---------- sign-in ---------- */

export const signInUi = { mode: "pin" as "pin" | "password", message: "", busy: false, first: "", };

export function renderSignIn(): string {
  const pin = signInUi.mode === "pin";
  return `
  <main class="signin">
    <form class="signin-card" id="signIn" novalidate>
      <div class="brand"><span class="mark">E</span><span><strong>Eirsha</strong><small>${t("Waiter")}</small></span></div>
      <h1>${t("Sign in")}</h1>
      <label class="field"><span>${t(pin ? "Staff code" : "Username")}</span>
        <input id="siFirst" value="${esc(signInUi.first)}" autocomplete="username" autocapitalize="${pin ? "characters" : "none"}" spellcheck="false" ${pin ? 'placeholder="W-101"' : ""}></label>
      <label class="field"><span>${t(pin ? "PIN" : "Password")}</span>
        <input id="siSecret" type="password" ${pin ? 'inputmode="numeric" pattern="[0-9]*" maxlength="6" autocomplete="one-time-code"' : 'autocomplete="current-password"'}></label>
      <p class="err" role="alert">${esc(signInUi.message)}</p>
      <button class="btn primary big" type="submit" ${signInUi.busy ? "disabled" : ""}>${signInUi.busy ? t("Signing in…") : t("Sign in")}</button>
      <button class="link" type="button" data-act="signin-mode">${t(pin ? "Use username and password" : "Use staff code and PIN")}</button>
      ${pin ? `<p class="hint">${t("Your staff code is on your badge. Ask your manager for a PIN.")}</p>` : ""}
      <div class="seg" role="group" aria-label="${t("Language")}">${LANGS.map((l) => `<button type="button" data-act="lang" data-id="${l.code}" aria-pressed="${state.lang === l.code}">${l.label}</button>`).join("")}</div>
    </form>
  </main>`;
}

/* ---------- floor ---------- */

function conn(): string {
  if (state.pending) return `<span class="conn wait">${icon("wifi")} ${t("{n} waiting to send", { n: state.pending })}</span>`;
  if (state.offline) return `<span class="conn off">${icon("wifi")} ${t("Offline")}</span>`;
  return `<span class="conn ${state.live ? "live" : ""}" title="${state.live ? "live" : "polling"}"><i></i></span>`;
}

function card(tb: FloorTable, now: number): string {
  const o = tb.order, m = me();
  const mine = !!o && o.waiterId === m?.id;
  if (!o) return `
    <article class="tcard st-free"><button class="tmain" data-act="table" data-id="${tb.id}">
      <span class="tname">${esc(tb.name)}</span>${pill("FREE")}
      <span class="tmeta">${icon("people")} ${t("{n} seats", { n: tb.seats })}</span>
    </button></article>`;
  const extra = tb.status === "READY" && o.ready ? `<span class="tflag">${icon("bell")} ${t("{n} ready", { n: o.ready })}</span>`
    : o.held ? `<span class="tflag quiet">${icon("pause")} ${t("{n} held", { n: o.held })}</span>` : "";
  return `
    <article class="tcard st-${STATUS[tb.status].cls} ${mine ? "mine" : ""}">
      <button class="tmain" data-act="table" data-id="${tb.id}">
        <span class="tname">${esc(tb.name)}</span>${pill(tb.status)}
        <span class="tmeta">${icon("people")} ${o.guests} <span class="dot">·</span> ${icon("clock")} ${since(o.openedAt, now)}</span>
        <span class="ttotal">${money(o.due < o.total ? o.due : o.total)}${o.due < o.total ? ` <small>${t("Due").toLowerCase()}</small>` : ""}</span>
        <span class="twho ${mine ? "me" : ""}">${mine ? t("Me") : esc(o.waiterName ?? "—")}</span>
        ${extra}
      </button>
      ${mine || m?.canManage ? `<button class="tmore" data-act="table-menu" data-id="${tb.id}" aria-label="${t("More")} ${esc(tb.name)}">${icon("more")}</button>` : ""}
    </article>`;
}

export function renderFloor(): string {
  const u = sessionUser(), f = state.floor, m = me();
  const head = `
    <header class="top">
      <button class="who" data-act="profile" aria-label="${esc(u?.name ?? "")}">
        <span class="avatar">${esc(u?.initials || initials(u?.name ?? "?"))}</span>
        <span class="who-text"><strong>${esc(u?.name ?? "")}</strong><small>${esc(f?.branch.name ?? "")} · ${clock()}</small></span>
      </button>
      ${conn()}
    </header>`;
  if (state.floorError === "no-access") return `${head}<main class="empty"><h2>${t("This account can't take tables.")}</h2><button class="btn" data-act="sign-out">${t("Sign out")}</button></main>`;
  if (!f) return `${head}<main class="empty">${state.offline || state.floorError
    ? `<h2>${t("Cannot reach the server. It may be waking up — try again in a minute.")}</h2><button class="btn primary" data-act="reload">${t("Try again")}</button>`
    : `<div class="spinner"></div><p>${t("Loading the floor…")}</p>`}</main>`;
  const all = f.tables;
  const counts = {
    mine: all.filter((x) => x.order?.waiterId === m?.id).length, all: all.length,
    free: all.filter((x) => x.status === "FREE").length, bill: all.filter((x) => x.status === "BILL").length,
  };
  const q = state.search.trim().toLowerCase();
  // start of a shift: "My tables" is empty, so offer the free ones straight away
  const starting = !q && state.filter === "mine" && counts.mine === 0 && counts.free > 0;
  const shown = starting ? all.filter((x) => x.status === "FREE") : all.filter((x) => {
    if (q) return x.name.toLowerCase().includes(q) || (x.order?.orderNumber ?? "").includes(q);
    return state.filter === "all" || (state.filter === "mine" && x.order?.waiterId === m?.id) || (state.filter === "free" && x.status === "FREE") || (state.filter === "bill" && x.status === "BILL");
  });
  const chips = (["mine", "all", "free", "bill"] as const).map((k) => `
    <button class="chip ${k === "bill" && counts.bill ? "alert" : ""}" data-act="filter" data-id="${k}" aria-pressed="${state.filter === k && !q}">
      ${t({ mine: "My tables", all: "All", free: "Free", bill: "Bill" }[k])} <b>${counts[k]}</b></button>`).join("");
  const now = Date.now();
  let body: string;
  if (!all.length) {
    body = `<div class="empty"><span class="big-ic">${icon("table")}</span><h2>${t("No tables here yet")}</h2>
      ${m?.canSetup ? `<button class="btn primary" data-act="setup">${t("Set up tables")}</button>` : `<p>${t("Ask your manager to set up the tables for this branch.")}</p>`}</div>`;
  } else if (!shown.length) {
    body = `<div class="empty"><h2>${q ? t("Nothing matches") : t("No tables in this view.")}</h2>
      ${!q && state.filter === "mine" && counts.free ? `<button class="btn" data-act="filter" data-id="free">${t("Free")} · ${counts.free}</button>` : ""}</div>`;
  } else {
    body = `${starting ? `<p class="lead">${t("You have no tables yet. Tap a free one to open it.")}</p>` : ""}<div class="grid">${shown.map((x) => card(x, now)).join("")}</div>`;
  }
  return `${head}
    ${state.offline ? `<p class="banner">${t("Offline — showing the last known floor")}</p>` : ""}
    <div class="tools">
      <div class="chips" role="group">${chips}</div>
      <label class="search">${icon("search")}<input id="floorSearch" type="search" inputmode="search" placeholder="${t("Table or order number")}" value="${esc(state.search)}" autocomplete="off"></label>
    </div>
    <main class="floor" data-scroll="floor">${body}</main>`;
}

/* ---------- one table's check ---------- */

const modsText = (l: OrderLine): string => [...l.modifiers.map((x) => x.name).filter(Boolean), l.note].filter(Boolean).join(" · ");
function draftText(d: Draft): string {
  const mods = d.mods.map((id) => state.menu?.modifiers.find((x) => x.id === id)).filter(Boolean).map((x) => nm(x!.name));
  return [...mods, d.note].filter(Boolean).join(" · ");
}
const qty = (n: number): string => (Number.isInteger(n) ? String(n) : n.toFixed(1));

function lineRow(l: OrderLine, editable: boolean): string {
  const sub = l.state === "VOIDED" ? l.voidReason ?? "" : modsText(l);
  return `<li class="line ${l.state === "VOIDED" ? "void" : ""}">
    <span class="q">${qty(l.quantity)}×</span>
    <span class="ln"><strong>${esc(l.name)}</strong>${sub ? `<small>${esc(sub)}</small>` : ""}</span>
    <span class="lp">${money(l.total)}</span>
    ${editable && l.state !== "VOIDED" && l.state !== "SERVED" ? `<button class="icon-btn" data-act="line-remove" data-id="${l.id}" aria-label="${t("Remove")} ${esc(l.name)}">${icon(l.state === "HELD" ? "trash" : "close")}</button>` : `<span class="icon-gap"></span>`}
  </li>`;
}

function draftRow(d: Draft, busy = false): string {
  const it = item(d.itemId);
  const sub = draftText(d);
  return `<li class="line draft">
    ${busy ? `<span class="q">${d.qty}×</span>` : `<span class="step"><button data-act="draft-minus" data-id="${d.id}" aria-label="−">${icon("minus")}</button><b>${d.qty}</b><button data-act="draft-plus" data-id="${d.id}" aria-label="+">${icon("plus")}</button></span>`}
    <button class="ln ${busy ? "" : "tap"}" ${busy ? "disabled" : `data-act="draft-edit" data-id="${d.id}"`}><strong>${esc(it ? nm(it.name) : d.itemId)}</strong>
      <small>${esc([t("Course {n}", { n: d.course }), sub].filter(Boolean).join(" · "))}</small></button>
    <span class="lp">${money(draftTotal(d))}</span>
  </li>`;
}

function group(title: string, cls: string, rows: string, action = ""): string {
  return rows ? `<section class="grp ${cls}"><h3><span>${title}</span>${action}</h3><ul>${rows}</ul></section>` : "";
}

function renderCheck(o: Order, editable: boolean): string {
  const dr = draftsOf(o.id), sn = sending[o.id] ?? [];
  const by = (s: LineState[]): OrderLine[] => o.lines.filter((l) => s.includes(l.state));
  const held = by(["HELD"]);
  const courses = [...new Set(held.map((l) => l.course))].sort();
  const heldAction = !editable || !held.length ? "" : courses.length > 1
    ? courses.map((c) => `<button class="btn small" data-act="fire" data-id="${c}">${icon("flame")} ${t("Send course {n}", { n: c })}</button>`).join("")
    : `<button class="btn small" data-act="fire" data-id="all">${icon("flame")} ${t("Send all held")}</button>`;
  const heldRows = courses.map((c) => (courses.length > 1 ? `<li class="sub">${t("Course {n}", { n: c })}</li>` : "") + held.filter((l) => l.course === c).map((l) => lineRow(l, editable)).join("")).join("");
  const ready = by(["READY"]);
  const body =
    group(t("New — not sent yet"), "g-new", dr.map((d) => draftRow(d)).join("")) +
    group(t("Sending…"), "g-sending", sn.map((d) => draftRow(d, true)).join("")) +
    group(t("Ready to serve"), "g-ready", ready.map((l) => lineRow(l, editable)).join(""),
      editable && ready.length ? `<button class="btn small good" data-act="served">${icon("check")} ${t("Mark served")}</button>` : "") +
    group(t("Held"), "g-held", heldRows, heldAction) +
    group(t("In kitchen"), "g-kitchen", by(["SENT", "PREPARING"]).map((l) => lineRow(l, editable)).join("")) +
    group(t("Served"), "g-served", by(["SERVED"]).map((l) => lineRow(l, editable)).join("")) +
    group(t("Voided"), "g-void", by(["VOIDED"]).map((l) => lineRow(l, false)).join(""));
  if (!body) return `<div class="empty"><span class="big-ic">${icon("receipt")}</span><h2>${t("Nothing on this check yet")}</h2><p>${t("Pick dishes from the menu.")}</p></div>`;
  const newTotal = dr.concat(sn).reduce((s, d) => s + draftTotal(d), 0);
  return `${o.note ? `<p class="note">${icon("note")} ${esc(o.note)}</p>` : ""}${body}
    <dl class="totals">
      <div class="grand"><dt>${t("Total")}</dt><dd>${money(o.total + newTotal)}</dd></div>
      <div><dt>${t("VAT included")}</dt><dd>${money(o.vat)}</dd></div>
      ${o.paid ? `<div><dt>${t("Paid so far")}</dt><dd>${money(o.paid)}</dd></div><div class="grand"><dt>${t("Due")}</dt><dd>${money(o.due)}</dd></div>` : ""}
    </dl>`;
}

function renderMenu(o: Order): string {
  const m = state.menu;
  if (!m) return `<div class="empty"><div class="spinner"></div><p>${t("Loading…")}</p></div>`;
  const q = state.menuSearch.trim().toLowerCase();
  const picked = new Map<string, number>();
  for (const d of draftsOf(o.id)) picked.set(d.itemId, (picked.get(d.itemId) ?? 0) + d.qty);
  const items = m.items.filter((i) => (q ? Object.values(i.name).some((n) => n.toLowerCase().includes(q)) : state.category === "ALL" || i.category === state.category) && (!state.fastingOnly || i.fasting));
  const cats = [{ code: "ALL", label: t("All") }, ...m.categories.map((c) => ({ code: c.code, label: nm(c.name) }))];
  return `
    <div class="menu-tools">
      <label class="search">${icon("search")}<input id="menuSearch" type="search" placeholder="${t("Search the menu")}" value="${esc(state.menuSearch)}" autocomplete="off"></label>
      <div class="chips scroll" data-scroll="cats">
        ${cats.map((c) => `<button class="chip" data-act="cat" data-id="${c.code}" aria-pressed="${state.category === c.code && !q}">${esc(c.label)}</button>`).join("")}
        <button class="chip leaf" data-act="fasting" aria-pressed="${state.fastingOnly}">${t("Fasting")}</button>
      </div>
      <div class="course"><span>${t("New items go to course")}</span>
        <div class="seg">${[1, 2, 3].map((c) => `<button data-act="course" data-id="${c}" aria-pressed="${state.course === c}" aria-label="${t("Course {n}", { n: c })}">${c}</button>`).join("")}</div></div>
    </div>
    <div class="items" data-scroll="items">
      ${items.length ? items.map((i) => {
        const n = picked.get(i.id) ?? 0;
        return `<button class="item ${n ? "on" : ""}" data-act="pick" data-id="${i.id}">
          <span class="iname">${esc(nm(i.name))}</span>
          <span class="iprice">${money(i.price)}${i.fasting ? ` <i class="leaf-dot" title="${t("Fasting")}"></i>` : ""}</span>
          ${n ? `<b class="badge">${n}</b>` : ""}</button>`;
      }).join("") : `<p class="none">${t("No dishes match.")}</p>`}
    </div>`;
}

export function renderOrder(): string {
  const o = order();
  if (!o) return `<header class="top"><button class="icon-btn" data-act="back" aria-label="${t("Back to tables")}">${icon("back")}</button></header><main class="empty"><div class="spinner"></div></main>`;
  const open = isOpen(o), editable = open && canEdit(o);
  const dr = draftsOf(o.id);
  const count = o.lines.filter((l) => l.state !== "VOIDED").length + dr.length + (sending[o.id]?.length ?? 0);
  const tab = editable ? state.tab : "check";
  const newTotal = dr.reduce((s, d) => s + draftTotal(d), 0), newCount = dr.reduce((s, d) => s + d.qty, 0);
  let bar = "";
  if (editable && dr.length) {
    bar = `<footer class="bar"><button class="bar-info" data-act="tab" data-id="check"><b>${t("{n} new", { n: newCount })}</b><span>${money(newTotal)}</span></button>
      <button class="btn" data-act="hold">${icon("pause")} ${t("Hold")}</button>
      <button class="btn primary grow" data-act="send">${icon("send")} ${t("Send")}</button></footer>`;
  } else if (open && tab === "check" && count) {
    const payBtn = `<button class="btn primary grow" data-act="pay">${icon("receipt")} ${t("Take payment")} · ${money(o.due)}</button>`;
    bar = o.billRequestedAt
      ? `<footer class="bar">${payBtn}</footer>`
      : editable ? `<footer class="bar"><button class="btn" data-act="pay">${icon("receipt")}</button><button class="btn primary grow" data-act="bill">${icon("bell")} ${t("Request bill")}</button></footer>`
      : me()?.canCash ? `<footer class="bar">${payBtn}</footer>` : "";
  }
  return `
    <header class="top order-top">
      <button class="icon-btn" data-act="back" aria-label="${t("Back to tables")}">${icon("back")}</button>
      <div class="otitle"><strong>${esc(o.tableName)}</strong>
        <small>${icon("people")} ${o.guests} <span class="dot">·</span> ${icon("clock")} ${since(o.openedAt)} <span class="dot">·</span> ${o.waiterId === me()?.id ? t("Me") : esc(o.waiterName ?? "")}</small></div>
      ${pill(o.status)}
      ${editable ? `<button class="icon-btn" data-act="order-menu" aria-label="${t("More")}">${icon("more")}</button>` : ""}
    </header>
    ${state.pending && state.offline ? `<p class="banner sync">${conn()}</p>` : ""}
    ${!open ? `<p class="banner">${t("This check is closed.")}</p>` : !editable ? `<p class="banner info">${t("This table belongs to {name}. You can look, but only they or a manager can change it.", { name: o.waiterName ?? "—" })}</p>` : ""}
    ${editable ? `<nav class="tabs"><button data-act="tab" data-id="menu" aria-pressed="${tab === "menu"}">${t("Menu")}</button>
      <button data-act="tab" data-id="check" aria-pressed="${tab === "check"}">${t("Check")}${count ? ` <b>${count}</b>` : ""}</button></nav>` : ""}
    <main class="order ${tab}" data-scroll="order-${tab}">${tab === "menu" ? renderMenu(o) : renderCheck(o, editable)}</main>
    ${bar}`;
}

/* ---------- sheets ---------- */

const sheet = (title: string, body: string, cls = ""): string => `
  <div class="backdrop" data-act="sheet-close"></div>
  <section class="sheet ${cls}" role="dialog" aria-modal="true" aria-label="${esc(title)}">
    <header><h2>${esc(title)}</h2><button class="icon-btn" data-act="sheet-close" aria-label="${t("Cancel")}">${icon("close")}</button></header>
    ${body}
  </section>`;

const VOID_REASONS = ["Guest changed their mind", "Entered by mistake", "Kitchen is out of it", "Took too long"];
const METHODS: { id: PayMethod; label: string }[] = [{ id: "TELEBIRR", label: "Telebirr" }, { id: "CBE_BIRR", label: "CBE Birr" }, { id: "CASH", label: "Cash" }];

export function renderSheet(): string {
  const s = state.sheet;
  if (!s) return "";
  const o = order();
  switch (s.kind) {
    case "guests": {
      const tb = tableOf(s.tableId);
      return sheet(s.orderId ? t("Change guests") : t("Open {table}", { table: tb?.name ?? "" }), `
        <p class="q-label">${t("How many guests?")}</p>
        <div class="num-grid">${[1, 2, 3, 4, 5, 6, 7, 8].map((n) => `<button class="num ${s.guests === n ? "on" : ""}" data-act="guests-set" data-id="${n}">${n}</button>`).join("")}</div>
        <div class="stepper-row"><span>${t("Guests")}</span><span class="step big"><button data-act="guests-step" data-id="-1" aria-label="−">${icon("minus")}</button><b>${s.guests}</b><button data-act="guests-step" data-id="1" aria-label="+">${icon("plus")}</button></span></div>
        <button class="btn primary big" data-act="guests-ok">${s.orderId ? t("Save") : t("Open table")}</button>`);
    }
    case "item": {
      const d = draftsOf(state.orderId).find((x) => x.id === s.draftId);
      const it = d && item(d.itemId);
      if (!d || !it) return "";
      const mods = (state.menu?.modifiers ?? []).filter((m) => !it.modifiers || it.modifiers.includes(m.id));
      return sheet(nm(it.name), `
        <div class="stepper-row"><span>${t("Quantity")}</span><span class="step big"><button data-act="draft-minus" data-id="${d.id}" aria-label="−">${icon("minus")}</button><b>${d.qty}</b><button data-act="draft-plus" data-id="${d.id}" aria-label="+">${icon("plus")}</button></span></div>
        <div class="seg wide">${[1, 2, 3].map((c) => `<button data-act="draft-course" data-id="${c}" aria-pressed="${d.course === c}">${t("Course {n}", { n: c })}</button>`).join("")}</div>
        ${mods.length ? `<p class="q-label">${t("Options")}</p><div class="chips wrap">${mods.map((m) => `<button class="chip" data-act="draft-mod" data-id="${m.id}" aria-pressed="${d.mods.includes(m.id)}">${esc(nm(m.name))}${m.priceDelta ? ` +${m.priceDelta}` : ""}</button>`).join("")}</div>` : ""}
        <label class="field"><span>${t("Note for the kitchen")}</span><input id="draftNote" value="${esc(d.note)}" placeholder="${t("e.g. no salt, well done")}" maxlength="120" autocomplete="off"></label>
        <div class="row"><button class="btn danger" data-act="draft-remove" data-id="${d.id}">${icon("trash")} ${t("Remove")}</button><button class="btn primary grow" data-act="draft-done">${t("Done")}</button></div>`);
    }
    case "send": {
      const cs = [...new Set(draftsOf(state.orderId).map((d) => d.course))].sort();
      return sheet(t("Send to kitchen"), `
        <button class="opt primary" data-act="send-all">${icon("send")} ${t("Send everything now")}</button>
        <button class="opt" data-act="send-first" data-id="${cs[0]}">${icon("flame")} ${t("Send course {n} now, hold the rest", { n: cs[0] })}</button>
        <button class="opt" data-act="hold">${icon("pause")} ${t("Hold everything")}</button>
        <p class="hint">${t("Held items stay on the check and go to the kitchen when you send them.")}</p>`);
    }
    case "void": {
      const l = o?.lines.find((x) => x.id === s.lineId);
      if (!l) return "";
      return sheet(t("Void {item}?", { item: l.name }), `
        <p class="hint">${t("The kitchen already has this item. Say why it is being voided — your manager sees this.")}</p>
        <div class="opts">${VOID_REASONS.map((r) => `<button class="opt ${s.reason === r ? "on" : ""}" data-act="void-reason" data-id="${esc(r)}">${t(r)}</button>`).join("")}</div>
        <label class="field"><span>${t("Other reason")}</span><input id="voidOther" value="${esc(s.other)}" maxlength="120" autocomplete="off"></label>
        <button class="btn danger big" data-act="void-ok">${t("Void item")}</button>`);
    }
    case "transfer": {
      const cur = orders_waiter(s.orderId);
      const list = (state.floor?.waiters ?? []).filter((w) => w.id !== cur);
      return sheet(t("Who takes this table?"), `<div class="opts">${list.map((w) => `<button class="opt" data-act="transfer-to" data-id="${w.id}"><span class="avatar sm">${esc(initials(w.name))}</span> ${esc(w.name)}${w.id === me()?.id ? ` (${t("Me")})` : ""}</button>`).join("")}</div>`);
    }
    case "move": {
      const free = (state.floor?.tables ?? []).filter((x) => x.status === "FREE");
      return sheet(t("Which table?"), free.length ? `<div class="num-grid">${free.map((x) => `<button class="num" data-act="move-to" data-id="${x.id}">${esc(x.name)}</button>`).join("")}</div>` : `<p class="hint">${t("No free tables.")}</p>`);
    }
    case "note":
      return sheet(t("Note for this table"), `
        <label class="field"><span class="sr">${t("Note for this table")}</span><input id="tableNote" value="${esc(o?.note ?? "")}" placeholder="${t("e.g. birthday, allergy, in a hurry")}" maxlength="200" autocomplete="off"></label>
        <button class="btn primary big" data-act="note-ok">${t("Save")}</button>`);
    case "pay": {
      const po = orders_get(s.orderId);
      if (!po) return "";
      const cash = !!me()?.canCash;
      return sheet(t("Payment for {table}", { table: po.tableName }), `
        <p class="due"><span>${t("Due")}</span><strong>${money(po.due)}</strong></p>
        <div class="seg wide">${METHODS.filter((m) => cash || m.id !== "CASH").map((m) => `<button data-act="pay-method" data-id="${m.id}" aria-pressed="${s.method === m.id}">${t(m.label)}</button>`).join("")}</div>
        <label class="field"><span>${t("Amount")}</span><input id="payAmount" inputmode="decimal" value="${esc(s.amount)}" autocomplete="off"></label>
        ${s.method !== "CASH" ? `<label class="field"><span>${t("Transaction ID")}</span><input id="payRef" value="${esc(s.reference)}" autocapitalize="characters" autocomplete="off" spellcheck="false"></label>` : ""}
        <p class="err" role="alert">${esc(s.error)}</p>
        <button class="btn primary big" data-act="pay-ok">${t("Confirm payment")}</button>
        ${cash ? "" : `<p class="hint">${t("Cash is paid at the cashier. Request the bill and the cashier takes it from there.")}</p>`}`);
    }
    case "table": {
      const tb = tableOf(s.tableId);
      if (!tb?.order) return "";
      return sheet(tb.name, `<div class="opts">
        ${tb.status !== "BILL" ? `<button class="opt" data-act="tm-bill" data-id="${tb.id}">${icon("bell")} ${t("Request bill")}</button>` : ""}
        <button class="opt" data-act="tm-transfer" data-id="${tb.id}">${icon("swap")} ${t("Transfer to another waiter")}</button>
        <button class="opt" data-act="tm-move" data-id="${tb.id}">${icon("table")} ${t("Move to another table")}</button></div>`);
    }
    case "orderMenu":
      return sheet(o?.tableName ?? "", `<div class="opts">
        ${o?.billRequestedAt ? `<button class="opt" data-act="bill-off">${icon("bell")} ${t("Not ready for bill")}</button>` : ""}
        <button class="opt" data-act="om-guests">${icon("people")} ${t("Change guests")}</button>
        <button class="opt" data-act="om-note">${icon("note")} ${t("Note for this table")}</button>
        <button class="opt" data-act="om-transfer">${icon("swap")} ${t("Transfer to another waiter")}</button>
        <button class="opt" data-act="om-move">${icon("table")} ${t("Move to another table")}</button>
        ${o && !o.lines.some((l) => l.state !== "VOIDED") && !o.paid ? `<button class="opt danger" data-act="om-close">${icon("close")} ${t("Close table (nothing ordered)")}</button>` : ""}</div>`);
    case "profile": {
      const u = sessionUser();
      return sheet(u?.name ?? "", `
        <div class="stepper-row"><span>${t("Language")}</span><div class="seg">${LANGS.map((l) => `<button data-act="lang" data-id="${l.code}" aria-pressed="${state.lang === l.code}">${l.label}</button>`).join("")}</div></div>
        <div class="stepper-row"><span>${t("Dark mode")}</span><button class="switch" data-act="dark" role="switch" aria-checked="${state.dark}"><i></i></button></div>
        ${state.branches.length > 1 ? `<label class="field"><span>${t("Branch")}</span><select id="branchSel">${state.branches.map((b) => `<option value="${b.id}" ${b.id === u?.branchId ? "selected" : ""}>${esc(b.name)}</option>`).join("")}</select></label>` : ""}
        <div class="opts">${me()?.canSetup ? `<button class="opt" data-act="setup">${icon("table")} ${t("Manage tables")}</button>` : ""}
        <button class="opt danger" data-act="sign-out">${icon("out")} ${t("Sign out")}</button></div>`);
    }
    case "setup": {
      const tables = state.floor?.tables ?? [];
      if (!tables.length) return sheet(t("Set up tables"), `
        <label class="field"><span>${t("How many tables does this branch have?")}</span><input id="setupCount" inputmode="numeric" value="${esc(s.count)}" autocomplete="off"></label>
        <p class="hint">${t("They are named T1, T2, … You can rename or remove them later.")}</p>
        <p class="err" role="alert">${esc(s.error)}</p>
        <button class="btn primary big" data-act="setup-create" ${s.busy ? "disabled" : ""}>${t("Create tables")}</button>`);
      return sheet(t("Manage tables"), `
        <ul class="tlist">${tables.map((x) => `<li><strong>${esc(x.name)}</strong><span>${pill(x.status)}</span>
          <button class="icon-btn" data-act="setup-rename" data-id="${x.id}" aria-label="${t("Rename")} ${esc(x.name)}">${icon("note")}</button>
          <button class="icon-btn" data-act="setup-remove" data-id="${x.id}" ${x.status === "FREE" ? "" : "disabled"} aria-label="${t("Remove table")} ${esc(x.name)}">${icon("trash")}</button></li>`).join("")}</ul>
        <div class="row"><label class="field grow"><span>${t("Add a table")}</span><input id="setupName" value="${esc(s.name)}" placeholder="${t("Table name")}" maxlength="20" autocomplete="off"></label>
          <button class="btn primary" data-act="setup-add" ${s.busy ? "disabled" : ""}>${t("Add")}</button></div>
        <p class="err" role="alert">${esc(s.error)}</p>`, "tall");
    }
  }
}

const orders_get = (id: string): Order | undefined => orders[id];
const orders_waiter = (id: string): string | null => orders[id]?.waiterId ?? state.floor?.tables.find((x) => x.order?.id === id)?.order?.waiterId ?? null;

export function renderApp(): string {
  if (!isConfigured) return `<main class="empty"><h2>${t("This app needs the backend address.")}</h2><p><code>VITE_API_URL</code></p></main>`;
  if (!sessionUser()) return renderSignIn();
  return `<div class="screen">${state.orderId ? renderOrder() : renderFloor()}</div>${renderSheet()}
    ${state.toast ? `<div class="toast ${state.toast.bad ? "bad" : ""}" role="status">${esc(state.toast.text)}</div>` : ""}`;
}
