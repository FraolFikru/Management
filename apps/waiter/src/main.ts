import "./style.css";
import * as api from "./api";
import { setLang, t } from "./i18n";
import * as S from "./store";
import { state } from "./store";
import { renderApp, signInUi } from "./ui";
import type { Lang, PayMethod } from "./types";

const app = document.querySelector<HTMLElement>("#app")!;
const $ = <T extends HTMLElement = HTMLInputElement>(sel: string): T | null => document.querySelector<T>(sel);

/* ---------- rendering (keeps scroll positions, focus and the caret) ---------- */

function render(): void {
  const scroll = new Map<string, number>();
  document.querySelectorAll<HTMLElement>("[data-scroll]").forEach((el) => scroll.set(el.dataset.scroll!, el.dataset.scroll === "cats" ? el.scrollLeft : el.scrollTop));
  const active = document.activeElement as HTMLInputElement | null;
  const focusId = active?.id, caret = active && "selectionStart" in active ? active.selectionStart : null;
  document.documentElement.dataset.theme = state.dark ? "dark" : "light";
  app.innerHTML = renderApp();
  document.querySelectorAll<HTMLElement>("[data-scroll]").forEach((el) => {
    const v = scroll.get(el.dataset.scroll!);
    if (v) { if (el.dataset.scroll === "cats") el.scrollLeft = v; else el.scrollTop = v; }
  });
  if (focusId) {
    const el = document.getElementById(focusId) as HTMLInputElement | null;
    if (el) { el.focus({ preventScroll: true }); if (caret !== null) { try { el.setSelectionRange(caret, caret); } catch { /* not a text field */ } } }
  }
}
S.onChange(render);
setLang(state.lang);

/* ---------- starting and stopping ---------- */

let stopLive: (() => void) | null = null;
let poll: number | undefined;

function start(): void {
  state.loading = true;
  void S.loadFloor();
  void S.loadMenu();
  void api.drain();
  void api.getBranches().then((b) => {
    state.branches = b;
    if (!api.sessionUser()?.branchId && b[0]) { api.setBranch(b[0].id); void S.loadFloor(); void S.loadMenu(); }
  }, () => {});
  stopLive?.();
  stopLive = api.connectLive(S.refreshSoon, (live) => { if (state.live !== live) { state.live = live; render(); } });
  window.clearInterval(poll);
  // a safety net under the live feed: quick when it is down, slow when it is up; also keeps the timers moving
  poll = window.setInterval(() => { if (document.visibilityState === "visible") { if (!state.live || Date.now() % 60000 < 15000) void S.loadFloor(); else render(); } }, 15000);
}

function stop(): void {
  stopLive?.(); stopLive = null;
  window.clearInterval(poll);
  state.floor = null; state.orderId = null; state.sheet = null; state.branches = [];
  api.cache.write("seer.waiter.floor", null);
}
api.onSessionLost(() => { stop(); render(); });
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible" && api.sessionUser()) { S.refreshSoon(); void api.drain(); } });

function signInMessage(err: unknown, pin: boolean): string {
  if (err instanceof api.Offline) return t("Cannot reach the server. It may be waking up — try again in a minute.");
  const m = err instanceof Error ? err.message : String(err);
  if (m === "wrong") return t(pin ? "Wrong staff code or PIN." : "Wrong username or password.");
  if (m === "locked") return t("Too many wrong PINs. Wait five minutes and try again.");
  return m;
}

document.addEventListener("submit", (e) => {
  e.preventDefault();
  if ((e.target as HTMLElement).id !== "signIn" || signInUi.busy) return;
  const first = $("#siFirst")?.value ?? "", secret = $("#siSecret")?.value ?? "";
  const pin = signInUi.mode === "pin";
  signInUi.first = first;
  if (!first.trim() || !secret) { signInUi.message = t(pin ? "Enter your staff code and PIN." : "Enter your username and password."); render(); return; }
  signInUi.busy = true; signInUi.message = ""; render();
  (pin ? api.signInPin(first, secret) : api.signInPassword(first, secret)).then(
    () => { signInUi.busy = false; signInUi.first = ""; start(); render(); },
    (err) => { signInUi.busy = false; signInUi.message = signInMessage(err, pin); render(); $("#siSecret")?.focus(); },
  );
});

/* ---------- inputs ---------- */

document.addEventListener("input", (e) => {
  const el = e.target as HTMLInputElement;
  const s = state.sheet;
  if (el.id === "floorSearch") { state.search = el.value; render(); }
  else if (el.id === "menuSearch") { state.menuSearch = el.value; render(); }
  else if (el.id === "payAmount" && s?.kind === "pay") s.amount = el.value;
  else if (el.id === "payRef" && s?.kind === "pay") s.reference = el.value;
  else if (el.id === "voidOther" && s?.kind === "void") { s.other = el.value; if (el.value) s.reason = ""; }
  else if (el.id === "setupCount" && s?.kind === "setup") s.count = el.value;
  else if (el.id === "setupName" && s?.kind === "setup") s.name = el.value;
});

document.addEventListener("change", (e) => {
  const el = e.target as HTMLSelectElement;
  if (el.id === "branchSel") { api.setBranch(el.value); state.sheet = null; state.floor = null; state.loading = true; render(); start(); }
});

/** The kitchen note is typed in a sheet that re-renders on every tap: keep what was typed. */
function syncDraftNote(): void {
  const s = state.sheet, note = $("#draftNote");
  if (s?.kind === "item" && note) {
    const d = S.draftsOf(state.orderId).find((x) => x.id === s.draftId);
    if (d && d.note !== note.value.trim()) S.changeDraft(d.id, { note: note.value.trim() });
  }
}

/* ---------- taps ---------- */

const acts: Record<string, (id: string) => void> = {
  "signin-mode": () => { signInUi.mode = signInUi.mode === "pin" ? "password" : "pin"; signInUi.message = ""; signInUi.first = ""; render(); $("#siFirst")?.focus(); },
  lang: (id) => { state.lang = id as Lang; setLang(state.lang); S.savePrefs(); render(); },
  dark: () => { state.dark = !state.dark; S.savePrefs(); render(); },
  profile: () => { state.sheet = { kind: "profile" }; render(); },
  "sign-out": () => { void api.signOut().then(() => { stop(); render(); }); },
  reload: () => { state.loading = true; state.floorError = ""; render(); void S.loadFloor(); },
  filter: (id) => { state.filter = id as S.Filter; state.search = ""; S.savePrefs(); render(); },
  "sheet-close": () => { syncDraftNote(); state.sheet = null; render(); },
  back: () => { state.orderId = null; state.sheet = null; render(); S.refreshSoon(); },

  // floor
  table: (id) => {
    const tb = S.tableOf(id);
    if (!tb) return;
    if (tb.order) S.showOrder(tb.order.id);
    else { state.sheet = { kind: "guests", tableId: id, guests: 2 }; render(); }
  },
  "table-menu": (id) => { state.sheet = { kind: "table", tableId: id }; render(); },
  "tm-bill": (id) => { const tb = S.tableOf(id); if (tb) S.requestBillFor(tb); },
  "tm-transfer": (id) => { const o = S.tableOf(id)?.order; if (o) { state.sheet = { kind: "transfer", orderId: o.id }; render(); } },
  "tm-move": (id) => { const o = S.tableOf(id)?.order; if (o) { state.sheet = { kind: "move", orderId: o.id }; render(); } },
  "guests-set": (id) => { if (state.sheet?.kind === "guests") { state.sheet.guests = Number(id); acts["guests-ok"](""); } },
  "guests-step": (id) => { if (state.sheet?.kind === "guests") { state.sheet.guests = Math.max(1, Math.min(60, state.sheet.guests + Number(id))); render(); } },
  "guests-ok": () => {
    const s = state.sheet;
    if (s?.kind !== "guests") return;
    const o = s.orderId ? S.orders[s.orderId] : null;
    if (o) S.updateCheck(o, { guests: s.guests });
    else S.openTable(s.tableId, s.guests);
  },

  // order: menu
  tab: (id) => { state.tab = id as "menu" | "check"; render(); },
  cat: (id) => { state.category = id; state.menuSearch = ""; render(); },
  fasting: () => { state.fastingOnly = !state.fastingOnly; render(); },
  course: (id) => { state.course = Number(id); render(); },
  pick: (id) => S.pick(id),
  "draft-plus": (id) => { syncDraftNote(); const d = S.draftsOf(state.orderId).find((x) => x.id === id); if (d) S.changeDraft(id, { qty: d.qty + 1 }); },
  "draft-minus": (id) => {
    syncDraftNote();
    const d = S.draftsOf(state.orderId).find((x) => x.id === id);
    if (!d) return;
    if (d.qty <= 1 && state.sheet?.kind === "item") state.sheet = null;
    S.changeDraft(id, { qty: d.qty - 1 });
  },
  "draft-edit": (id) => { state.sheet = { kind: "item", draftId: id }; render(); },
  "draft-course": (id) => { syncDraftNote(); if (state.sheet?.kind === "item") S.changeDraft(state.sheet.draftId, { course: Number(id) }); },
  "draft-mod": (id) => {
    syncDraftNote();
    const s = state.sheet;
    const d = s?.kind === "item" ? S.draftsOf(state.orderId).find((x) => x.id === s.draftId) : null;
    if (d) S.changeDraft(d.id, { mods: d.mods.includes(id) ? d.mods.filter((m) => m !== id) : [...d.mods, id] });
  },
  "draft-remove": (id) => { state.sheet = null; S.changeDraft(id, null); },
  "draft-done": () => { syncDraftNote(); state.sheet = null; render(); },
  send: () => {
    const courses = new Set(S.draftsOf(state.orderId).map((d) => d.course));
    if (courses.size > 1) { state.sheet = { kind: "send" }; render(); } else S.saveDrafts("ALL");
  },
  "send-all": () => S.saveDrafts("ALL"),
  "send-first": (id) => S.saveDrafts([Number(id)]),
  hold: () => S.saveDrafts("NONE"),

  // order: check
  fire: (id) => S.fireHeld(id === "all" ? null : Number(id)),
  served: () => S.markServed(),
  "line-remove": (id) => {
    const l = S.order()?.lines.find((x) => x.id === id);
    if (!l) return;
    if (l.state === "HELD") S.removeLine(id);
    else { state.sheet = { kind: "void", lineId: id, reason: "", other: "" }; render(); }
  },
  "void-reason": (id) => { if (state.sheet?.kind === "void") { state.sheet.reason = id; state.sheet.other = ""; render(); } },
  "void-ok": () => {
    const s = state.sheet;
    if (s?.kind !== "void") return;
    const reason = (s.other.trim() || s.reason).trim();
    if (!reason) { $("#voidOther")?.focus(); return; }
    S.removeLine(s.lineId, reason);
  },
  bill: () => S.requestBill(true),
  "bill-off": () => S.requestBill(false),
  pay: () => {
    const o = S.order();
    if (!o) return;
    if (S.draftsOf(o.id).length || o.lines.some((l) => l.state === "HELD")) { S.toast(t("Send or remove the new and held items first."), true); return; }
    state.sheet = { kind: "pay", orderId: o.id, method: "TELEBIRR", amount: String(o.due), reference: "", error: "" };
    render();
  },
  "pay-method": (id) => { if (state.sheet?.kind === "pay") { state.sheet.method = id as PayMethod; state.sheet.error = ""; render(); } },
  "pay-ok": () => {
    const s = state.sheet;
    const o = s?.kind === "pay" ? S.orders[s.orderId] : null;
    if (s?.kind !== "pay" || !o) return;
    const amount = Number(s.amount.replace(/,/g, ""));
    if (!(amount > 0) || amount > o.due + 0.004) { s.error = t("Enter an amount up to {due}.", { due: `ETB ${o.due.toLocaleString("en-US")}` }); render(); return; }
    if (s.method !== "CASH" && !s.reference.trim()) { s.error = t("Enter the transaction ID from the guest's phone."); render(); $("#payRef")?.focus(); return; }
    S.pay(o, s.method, amount, s.reference);
  },
  "order-menu": () => { state.sheet = { kind: "orderMenu" }; render(); },
  "om-guests": () => { const o = S.order(); if (o) { state.sheet = { kind: "guests", tableId: o.tableId, orderId: o.id, guests: o.guests || 2 }; render(); } },
  "om-note": () => { const o = S.order(); if (o) { state.sheet = { kind: "note", orderId: o.id }; render(); $("#tableNote")?.focus(); } },
  "om-transfer": () => { const o = S.order(); if (o) { state.sheet = { kind: "transfer", orderId: o.id }; render(); } },
  "om-move": () => { const o = S.order(); if (o) { state.sheet = { kind: "move", orderId: o.id }; render(); } },
  "om-close": () => { const o = S.order(); if (o) S.closeEmpty(o); },
  "note-ok": () => { const o = S.order(); if (o) S.updateCheck(o, { note: $("#tableNote")?.value ?? "" }); },
  "transfer-to": (id) => { if (state.sheet?.kind === "transfer") S.transfer(state.sheet.orderId, { waiterId: id }); },
  "move-to": (id) => { if (state.sheet?.kind === "move") S.transfer(state.sheet.orderId, { tableId: id }); },

  // tables setup (managers)
  setup: () => { state.sheet = { kind: "setup", count: "12", name: "", error: "", busy: false }; render(); },
  "setup-create": () => setup((s) => {
    const n = Number(s.count);
    if (!Number.isInteger(n) || n < 1 || n > 80) throw new Error("1–80");
    return S.addTables(Array.from({ length: n }, (_, i) => `T${i + 1}`));
  }),
  "setup-add": () => setup((s) => { if (!s.name.trim()) throw new Error(t("Table name")); const name = s.name; s.name = ""; return S.addTables([name]); }),
  "setup-rename": (id) => {
    const tb = S.tableOf(id);
    const name = tb ? window.prompt(t("Table name"), tb.name) : null;       // a rare, manager-only action: the system prompt is enough
    if (name && name.trim() && name.trim() !== tb!.name) setup(() => S.editTable(id, { name: name.trim() }));
  },
  "setup-remove": (id) => setup(() => S.editTable(id, { active: false })),
};

function setup(fn: (s: Extract<S.Sheet, { kind: "setup" }>) => Promise<void>): void {
  const s = state.sheet;
  if (s?.kind !== "setup" || s.busy) return;
  s.busy = true; s.error = "";
  let job: Promise<void>;
  try { job = fn(s); } catch (err) { s.busy = false; s.error = err instanceof Error ? err.message : String(err); render(); return; }
  render();
  job.then(() => { s.busy = false; render(); }, (err: unknown) => {
    s.busy = false;
    s.error = err instanceof api.Offline ? t("Cannot reach the server. It may be waking up — try again in a minute.") : err instanceof Error ? err.message : String(err);
    render();
  });
}

document.addEventListener("click", (e) => {
  const el = (e.target as HTMLElement).closest<HTMLElement>("[data-act]");
  if (!el || (el as HTMLButtonElement).disabled) return;
  acts[el.dataset.act!]?.(el.dataset.id ?? "");
});

// long-press (or right-click) on a table = its menu
document.addEventListener("contextmenu", (e) => {
  const el = (e.target as HTMLElement).closest<HTMLElement>(".tcard");
  const more = el?.querySelector<HTMLElement>(".tmore");
  if (more) { e.preventDefault(); acts["table-menu"](more.dataset.id ?? ""); }
});
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && state.sheet) acts["sheet-close"](""); });

if (api.isConfigured && api.sessionUser()) start();
render();
