/* =========================================================
   SEER Sales v3 — entry point.
   Shows the sign-in screen until a staff member signs in, then the
   app shell. This app is for buying only. All events are delegated (data-action / data-bind),
   and each screen only opens for roles allowed to use it.
   ========================================================= */

import "./style.css";
import type { ViewId } from "./types";
import { isLanguage, setLanguage, t } from "./i18n";
import { canView, currentUser, loadFromBackend, onSyncError, savePrefs, signIn, signOut, state } from "./store";
import { isLive, sessionUser, signIn as apiSignIn, signOut as apiSignOut } from "./api";
import { $ } from "./ui/dom";
import { wireApp, type ActionMap } from "./ui/app";
import { VIEW_IDS, renderNav, renderShell, renderSignIn } from "./ui/shell";
import { clearToast, runUndo, toast } from "./ui/toast";
import { renderDashboard } from "./views/dashboard";
import { mountPurchases, onPurchaseInput, purchaseActions, renderPurchases, submitPurchase } from "./views/purchases";
import { mountWaste, onWasteInput, renderWaste, submitWaste, wasteActions } from "./views/waste";
import { expenseActions, onExpenseInput, renderExpenses, submitExpense } from "./views/expenses";
import { auditActions, renderAudit } from "./views/audit";

const VIEWS: Record<ViewId, { title: string; render: () => string; mount?: () => void }> = {
  dashboard: { title: "Dashboard", render: renderDashboard },
  purchases: { title: "Purchases", render: renderPurchases, mount: mountPurchases },
  waste: { title: "Waste", render: renderWaste, mount: mountWaste },
  expenses: { title: "Other expenses", render: renderExpenses },
  audit: { title: "Audit trail", render: renderAudit },
};

/* ---------- live mode (backend) ---------- */

const live = { message: "", busy: false, username: "" };

function liveMessage(err: unknown): string {
  const m = err instanceof Error ? err.message : String(err);
  if (m === "wrong") return t("Wrong username or password.");
  if (m === "no-access") return t("This account can't open the purchasing app.");
  if (m.includes("Failed to fetch") || m.includes("NetworkError") || m.includes("Load failed")) return t("Cannot reach the server. It may be waking up — try again in a minute.");
  return m;
}

/** Load the backend's records for the signed-in account, then show the app. */
async function startLive(): Promise<void> {
  live.busy = true; render();
  try {
    await loadFromBackend();
    live.message = "";
    const h = location.hash.slice(1) as ViewId;
    state.view = VIEW_IDS.includes(h) ? h : "dashboard";
  } catch (err) {
    live.message = liveMessage(err);
    if (sessionUser()) await apiSignOut();
  }
  live.busy = false;
  rebuild();
}

onSyncError((message) => {
  toast(t("Not saved: {reason}", { reason: message }));
  render();
});

/* ---------- rendering ---------- */

function render(focusSelector?: string): void {
  if (!currentUser()) {
    const app = $("#app");
    if (app) {
      app.classList.add("signed-out");
      app.innerHTML = isLive ? renderSignIn(live) : renderSignIn();
    }
    document.title = "SEER · Sales";
    $<HTMLElement>(focusSelector ?? (isLive ? (live.message ? "#livePass" : "#liveUser") : state.signInFor ? "#pin" : ".staff-btn"))?.focus();
    return;
  }
  $("#app")?.classList.remove("signed-out");
  if (!$("#view")) renderShell();
  if (!canView(state.view)) state.view = "dashboard";
  const view = $("#view");
  if (!view) return;
  const def = VIEWS[state.view];
  view.innerHTML = def.render();
  def.mount?.();
  renderNav();
  document.title = `${t(def.title)} · SEER Sales`;
  if (focusSelector) $<HTMLElement>(focusSelector)?.focus();
}

function navigate(view: ViewId, focusSelector?: string): void {
  const changed = state.view !== view;
  state.view = view;
  state.errors = {};
  if (location.hash.slice(1) !== view) history.replaceState(null, "", `#${view}`);
  render(focusSelector);
  if (changed && !focusSelector) window.scrollTo({ top: 0 });
}

wireApp(render, navigate);

/** Language or user changed: rebuild the whole frame. */
function rebuild(focusSelector?: string): void {
  const app = $("#app");
  if (app) app.innerHTML = "";
  render(focusSelector);
}

const applyTheme = (): void => { document.documentElement.dataset.theme = state.theme; };

/* ---------- global actions ---------- */

const shellActions: ActionMap = {
  lang: (el) => {
    const v = el.dataset.value;
    if (!isLanguage(v) || v === state.lang) return;
    state.lang = v;
    setLanguage(v);
    savePrefs();
    rebuild(`[data-action="lang"][data-value="${v}"]`);
  },
  theme: () => {
    state.theme = state.theme === "dark" ? "light" : "dark";
    applyTheme();
    savePrefs();
    rebuild("#themeBtn");
  },
  period: (el) => {
    const v = el.dataset.value;
    if (v !== "today" && v !== "7d" && v !== "30d") return;
    state.period = v;
    render(`[data-action="period"][data-value="${v}"]`);
  },
  "show-pending": () => { state.wasteFilter = "PENDING"; navigate("waste"); },
  "switch-user": () => { signOut(); state.signInFor = null; clearToast(); rebuild(); },
  "sign-out": () => { signOut(); state.signInFor = null; clearToast(); rebuild(); },
  "signin-pick": (el) => { state.signInFor = el.dataset.value ?? null; render("#pin"); },
  "signin-back": () => { state.signInFor = null; render(); },
  undo: () => runUndo(),
};

const ACTIONS: ActionMap = { ...shellActions, ...purchaseActions, ...wasteActions, ...expenseActions, ...auditActions };

/* ---------- event delegation ---------- */

document.addEventListener("click", (e) => {
  const el = (e.target as HTMLElement).closest<HTMLElement>("[data-action]");
  if (!el) return;
  const fn = ACTIONS[el.dataset.action ?? ""];
  if (!fn) return;
  if (el.tagName !== "A" || el.dataset.action) e.preventDefault();
  fn(el, e);
});

document.addEventListener("submit", (e) => {
  e.preventDefault();
  const id = (e.target as HTMLFormElement).id;
  if (id === "purchaseForm") submitPurchase();
  else if (id === "wasteForm") submitWaste();
  else if (id === "expenseForm") submitExpense();
  else if (id === "liveSignIn") {
    if (live.busy) return;
    const u = $<HTMLInputElement>("#liveUser")?.value ?? "";
    live.username = u;
    const p = $<HTMLInputElement>("#livePass")?.value ?? "";
    if (!u.trim() || !p) { live.message = t("Enter your username and password."); render(); return; }
    live.busy = true; live.message = ""; render();
    apiSignIn(u, p).then(startLive, (err) => { live.busy = false; live.message = liveMessage(err); render(); });
  }
  else if (id === "pinForm") {
    const pin = $<HTMLInputElement>("#pin")?.value ?? "";
    if (state.signInFor && signIn(state.signInFor, pin)) {
      state.signInFor = null;
      state.view = VIEW_IDS.includes(location.hash.slice(1) as ViewId) ? (location.hash.slice(1) as ViewId) : "dashboard";
      rebuild();
    } else {
      const err = $("#err-pin");
      if (err) err.textContent = t("That PIN is not correct. Try again.");
      const input = $<HTMLInputElement>("#pin");
      input?.setAttribute("aria-invalid", "true");
      if (input) { input.value = ""; input.focus(); }
    }
  }
});

function routeInput(el: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement): void {
  const bind = el.dataset.bind;
  if (!bind) return;
  const [scope, key] = bind.split(".");
  if (scope === "purchase") onPurchaseInput(key, el.value);
  else if (scope === "waste") onWasteInput(key, el.value);
  else if (scope === "expense") onExpenseInput(key, el.value);
}

document.addEventListener("input", (e) => {
  const el = e.target as HTMLInputElement;
  if (el.tagName === "SELECT") return;
  routeInput(el);
});

document.addEventListener("change", (e) => {
  const el = e.target as HTMLSelectElement;
  if (el.tagName === "SELECT") routeInput(el);
});

window.addEventListener("hashchange", () => {
  const v = location.hash.slice(1) as ViewId;
  if (VIEW_IDS.includes(v) && v !== state.view && currentUser()) navigate(v);
});

/* ---------- boot ---------- */

setLanguage(state.lang);
applyTheme();
const start = location.hash.slice(1) as ViewId;
state.view = VIEW_IDS.includes(start) ? start : "dashboard";
if (isLive && sessionUser()) void startLive();
else render();
