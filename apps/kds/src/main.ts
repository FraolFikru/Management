/* =========================================================
   Kitchen Display System — entry point.
   Renders the board, wires taps to store actions, runs the
   once-a-second timer, and raises new-order alerts.
   ========================================================= */

import "./style.css";
import type { KDSOrderStatus, KitchenTicket, OrderTypeFilter, StationFilter } from "./types";
import { createFeed, liveConfigured } from "./feed";
import { currentUser, signInScreen } from "./auth";
import { isLanguage, t } from "./i18n";
import { clock } from "./format";
import { audioReady, chime, unlockAudio } from "./sound";
import {
  attachFeed, bump, column, itemsFor, onNewTickets, onSendFailure, recall, setLang, setSound, setStation,
  setStatus, setType, state, subscribe, tick, toggleItem, toggleTheme,
} from "./store";
import { board } from "./ui/board";
import { $ } from "./ui/dom";
import { timerView, waitingText } from "./ui/ticket";
import { toast } from "./ui/toast";

const app = document.getElementById("app") as HTMLElement;

/* ---------- render ---------- */

let frame = 0;
function render(): void {
  cancelAnimationFrame(frame);
  frame = requestAnimationFrame(() => {
    // keep each column's scroll position across re-renders
    const scroll = new Map<string, number>();
    app.querySelectorAll<HTMLElement>(".col").forEach((c) => scroll.set(c.className, c.querySelector(".col-body")?.scrollTop ?? 0));
    app.innerHTML = board();
    app.querySelectorAll<HTMLElement>(".col").forEach((c) => {
      const body = c.querySelector<HTMLElement>(".col-body");
      if (body) body.scrollTop = scroll.get(c.className) ?? 0;
    });
    lastUrgency = currentUrgencies();
    const pending = column("PENDING").length;
    document.title = `${pending ? `(${pending}) ` : ""}${t("Kitchen Display")}`;
  });
}
subscribe(render);

/* ---------- live timers (no full re-render every second) ---------- */

let lastUrgency = new Map<string, string>();
const currentUrgencies = (): Map<string, string> => {
  const m = new Map<string, string>();
  for (const tk of state.tickets.values()) m.set(tk.id, timerView(tk).urgency);
  return m;
};

function updateTimers(): void {
  const now = currentUrgencies();
  for (const [id, u] of now) if (lastUrgency.get(id) !== u) { render(); return; } // colour band changed
  app.querySelectorAll<HTMLElement>("[data-timer]").forEach((el) => {
    const tk = state.tickets.get(el.dataset.timer ?? "");
    if (!tk) return;
    const v = timerView(tk);
    const val = el.querySelector(".tval");
    if (val) val.textContent = v.text;
    el.setAttribute("aria-label", v.label);
  });
  app.querySelectorAll<HTMLElement>("[data-waiting]").forEach((el) => {
    const tk = state.tickets.get(el.dataset.waiting ?? "");
    if (tk) el.textContent = waitingText(tk);
  });
  const c = $("[data-clock]", app);
  if (c) c.textContent = clock(state.now);
}

window.setInterval(() => (tick() ? render() : updateTimers()), 1000);

/* ---------- new-order alerts ---------- */

onNewTickets((tickets: KitchenTicket[]) => {
  const mine = tickets.filter((tk) => itemsFor(tk).length > 0 && (state.type === "ALL" || tk.orderType === state.type));
  if (!mine.length) return;
  if (state.sound) chime();
  const first = mine[0] as KitchenTicket;
  const where = first.orderType === "DINE_IN" ? t("Table {n}", { n: first.tableNumber ?? "?" }) : t("Takeout");
  toast(mine.length === 1 ? `${t("New order {no}", { no: first.orderNumber })} · ${where}` : t("{n} new orders", { n: mine.length }), { kind: "new" });
  document.body.classList.remove("alerting");
  void document.body.offsetWidth; // restart the flash animation
  document.body.classList.add("alerting");
});

onSendFailure(() => toast(t("Could not save. The change was undone; please try again."), { kind: "bad", ms: 6000 }));

/* ---------- taps ---------- */

const STATUS_NAME: Record<KDSOrderStatus, string> = { PENDING: "Pending", PREPARING: "Preparing", READY: "Ready" };

async function changeStatus(id: string, to: KDSOrderStatus): Promise<void> {
  const tk = state.tickets.get(id);
  if (!tk) return;
  const from = tk.status;
  const no = tk.orderNumber;
  if (!(await setStatus(id, to))) return;
  const forward = (from === "PENDING" && to === "PREPARING") || (from === "PREPARING" && to === "READY");
  const msg = !forward
    ? t("{no} moved back to {status}", { no, status: t(STATUS_NAME[to]) })
    : to === "READY" ? t("{no} is ready for pickup", { no }) : t("{no} is being prepared", { no });
  toast(msg, { kind: "good", undo: () => void setStatus(id, from) });
}

app.addEventListener("click", (ev) => {
  const el = (ev.target as Element).closest<HTMLElement>("[data-action]");
  if (!el || (el as HTMLButtonElement).disabled) return;
  const v = el.dataset.value ?? "";
  switch (el.dataset.action) {
    case "item":
      void toggleItem(el.dataset.ticket ?? "", el.dataset.item ?? "");
      break;
    case "status":
      void changeStatus(el.dataset.id ?? "", el.dataset.status as KDSOrderStatus);
      break;
    case "bump": {
      const id = el.dataset.id ?? "";
      const no = state.tickets.get(id)?.orderNumber ?? "";
      void bump(id).then((ok) => ok && toast(t("{no} picked up", { no }), { kind: "good", undo: () => void recall(id) }));
      break;
    }
    case "recall":
      void recall().then((tk) => toast(tk ? t("{no} recalled", { no: tk.orderNumber }) : t("Nothing to recall")));
      break;
    case "station":
      setStation(v as StationFilter);
      break;
    case "type":
      setType(v as OrderTypeFilter);
      break;
    case "lang":
      if (isLanguage(v)) setLang(v);
      break;
    case "sound":
      setSound(!state.sound);
      if (state.sound) { unlockAudio(); chime(); }
      break;
    case "theme":
      toggleTheme();
      break;
    case "fullscreen":
      if (document.fullscreenElement) void document.exitFullscreen();
      else void document.documentElement.requestFullscreen?.().catch(() => undefined);
      break;
    case "unlock":
      unlockAudio();
      window.setTimeout(render, 50);
      break;
  }
});

// The first tap anywhere unlocks audio (browser rule).
document.addEventListener("pointerdown", () => {
  if (audioReady()) return;
  unlockAudio();
  window.setTimeout(render, 50);
}, { capture: true });

/* ---------- keep the screen awake while the board is open ---------- */

type WakeLockNav = Navigator & { wakeLock?: { request(type: "screen"): Promise<unknown> } };
async function keepAwake(): Promise<void> {
  try { await (navigator as WakeLockNav).wakeLock?.request("screen"); } catch { /* not supported or denied */ }
}
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") void keepAwake(); });
void keepAwake();

/* ---------- start ---------- */

render();
void (async () => {
  if (liveConfigured() && !currentUser()) await signInScreen();
  attachFeed(createFeed());
})();
