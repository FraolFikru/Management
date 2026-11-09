/* =========================================================
   Branch Manager Dashboard — entry point.
   Renders the shell and the current view; all events are delegated
   (data-action for clicks, data-bind="scope.key" for inputs).
   ========================================================= */

import "./style.css";
import type { ViewId } from "./types";
import { isLanguage, setLanguage, t } from "./i18n";
import { isPeriod } from "./catalog";
import { loadFromBackend, onSyncError, savePrefs, signOut, signedIn, state, switchUser, user } from "./store";
import { isLive, sessionUser, signIn as apiSignIn, signOut as apiSignOut } from "./api";
import { $ } from "./ui/dom";
import { wireApp, type ActionMap } from "./ui/app";
import { VIEW_IDS, renderNav, renderShell, renderSignIn, renderTopbar } from "./ui/shell";
import { clearToast, runUndo, toast } from "./ui/toast";
import { renderOverview } from "./views/overview";
import { onSalesSearch, renderSales, salesActions } from "./views/sales";
import { dispatchActions, renderDispatch } from "./views/dispatch";
import { cogsActions, renderCogs } from "./views/cogs";
import { renderWaste, wasteActions } from "./views/waste";
import { expenseActions, onExpenseInput, renderExpenses, submitExpense } from "./views/expenses";
import { auditActions, onAuditInput, renderAudit } from "./views/audit";
import { closeModal, modalActions, modalKeydown, onModalInput, renderModal, submitReason, submitWaste } from "./views/modals";

const VIEWS: Record<ViewId, { title: string; render: () => string }> = {
  overview: { title: "Overview", render: renderOverview },
  sales: { title: "Sales", render: renderSales },
  dispatch: { title: "Dispatch", render: renderDispatch },
  cogs: { title: "COGS purchases", render: renderCogs },
  waste: { title: "Waste & shrinkage", render: renderWaste },
  expenses: { title: "Branch expenses", render: renderExpenses },
  audit: { title: "Audit trail", render: renderAudit },
};

/* ---------- live mode (backend) ---------- */

const live = { message: "", busy: false, username: "" };

function liveMessage(err: unknown): string {
  const m = err instanceof Error ? err.message : String(err);
  if (m === "wrong") return t("Wrong username or password.");
  if (m === "no-access") return t("This account can't open the manager dashboard.");
  if (m.includes("Failed to fetch") || m.includes("NetworkError") || m.includes("Load failed")) return t("Cannot reach the server. It may be waking up — try again in a minute.");
  return m;
}

/** Load the branch's data for the signed-in manager, then show the dashboard. */
async function startLive(): Promise<void> {
  live.busy = true; render();
  try {
    await loadFromBackend();
    live.message = "";
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
  if (!signedIn()) {
    const app = $("#app");
    if (app) {
      app.classList.add("signed-out");
      app.innerHTML = renderSignIn(live.message, live.busy, live.username);
    }
    document.title = "Bistro Addis";
    $<HTMLElement>(focusSelector ?? (live.message ? "#livePass" : "#liveUser"))?.focus();
    return;
  }
  $("#app")?.classList.remove("signed-out");
  if (!$("#view")) renderShell();
  const view = $("#view");
  if (!view) return;
  const def = VIEWS[state.view];
  view.innerHTML = def.render();
  renderNav();
  document.title = `${t(def.title)} · Bistro Addis`;
  if (focusSelector) $<HTMLElement>(focusSelector)?.focus();
}

function navigate(view: ViewId, focusSelector?: string): void {
  const changed = state.view !== view;
  state.view = view;
  state.errors = {};
  if (location.hash.slice(1) !== view) history.replaceState(null, "", `#${view}`);
  render(focusSelector);
  if (changed && !focusSelector) {
    window.scrollTo({ top: 0 });
    $<HTMLElement>("#view h1")?.focus({ preventScroll: true });
  }
}

wireApp(render, navigate);

/** Language or user changed: rebuild the whole frame. */
function rebuild(focusSelector?: string): void {
  const app = $("#app");
  if (app) app.innerHTML = "";
  render(focusSelector);
  if (state.modal) renderModal();
}

const applyTheme = (): void => { document.documentElement.dataset.theme = state.theme; };

/* ---------- global actions ---------- */

const shellActions: ActionMap = {
  lang: (el) => {
    const v = el.dataset.value;
    if (!isLanguage(v) || v === state.lang) return;
    state.lang = v;
    setLanguage(v);
    document.documentElement.lang = v;
    savePrefs();
    rebuild(`[data-action="lang"][data-value="${v}"]`);
  },
  theme: () => {
    state.theme = state.theme === "dark" ? "light" : "dark";
    applyTheme();
    savePrefs();
    renderTopbar();
    $<HTMLElement>("#themeBtn")?.focus();
  },
  period: (el) => {
    const v = el.dataset.value ?? "";
    if (!isPeriod(v)) return;
    state.period = v;
    render(`[data-action="period"][data-value="${v}"]`);
  },
  shift: (el) => {
    const v = el.dataset.value;
    if (v !== "ALL" && v !== "MORNING" && v !== "EVENING") return;
    state.shift = v;
    render(`[data-action="shift"][data-value="${v}"]`);
  },
  "user-menu": () => {
    state.userMenu = !state.userMenu;
    renderTopbar();
    $<HTMLElement>(state.userMenu ? '[data-action="switch-user"]' : '[data-action="user-menu"]')?.focus();
  },
  "switch-user": (el) => {
    switchUser(el.dataset.value ?? "");
    state.userMenu = false;
    clearToast();
    rebuild('[data-action="user-menu"]');
    toast(t("Now logged in as {name}", { name: user().name }));
  },
  undo: () => runUndo(),
  "sign-out": () => {
    signOut();
    state.userMenu = false;
    state.modal = null;
    clearToast();
    rebuild();
  },
  "goto-low": () => {
    if (state.view !== "overview") navigate("overview");
    const w = $<HTMLElement>("#lowStock");
    w?.scrollIntoView({ behavior: "smooth", block: "start" });
    w?.querySelector<HTMLElement>("h2")?.setAttribute("tabindex", "-1");
    w?.querySelector<HTMLElement>("h2")?.focus({ preventScroll: true });
  },
};

const ACTIONS: ActionMap = { ...shellActions, ...salesActions, ...dispatchActions, ...cogsActions, ...wasteActions, ...expenseActions, ...auditActions, ...modalActions };

/* ---------- event delegation ---------- */

document.addEventListener("click", (e) => {
  const target = e.target as HTMLElement;
  if (state.userMenu && !target.closest(".user-wrap")) { state.userMenu = false; renderTopbar(); }
  const el = target.closest<HTMLElement>("[data-action]");
  if (!el) return;
  const fn = ACTIONS[el.dataset.action ?? ""];
  if (!fn) return;
  e.preventDefault();
  fn(el, e);
});

document.addEventListener("submit", (e) => {
  e.preventDefault();
  const id = (e.target as HTMLFormElement).id;
  if (id === "liveSignIn") {
    if (live.busy) return;
    const u = $<HTMLInputElement>("#liveUser")?.value ?? "";
    const p = $<HTMLInputElement>("#livePass")?.value ?? "";
    live.username = u;
    if (!u.trim() || !p) { live.message = t("Enter your username and password."); render(); return; }
    live.busy = true; live.message = ""; render();
    apiSignIn(u, p).then(startLive, (err) => { live.busy = false; live.message = liveMessage(err); render(); });
  }
  else if (id === "wasteForm") submitWaste();
  else if (id === "reasonForm") submitReason();
  else if (id === "expenseForm") submitExpense();
});

function routeInput(el: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement): void {
  const bind = el.dataset.bind;
  if (!bind) return;
  const [scope, key] = bind.split(".");
  if (scope === "sales") onSalesSearch(el.value);
  else if (scope === "expense") onExpenseInput(key, el.value);
  else if (scope === "audit") onAuditInput(key, el.value);
  else if (scope === "waste" || scope === "reason") onModalInput(scope, key, el.value);
}

document.addEventListener("input", (e) => {
  const el = e.target as HTMLInputElement;
  if (el.tagName !== "SELECT") routeInput(el);
});
document.addEventListener("change", (e) => {
  const el = e.target as HTMLSelectElement;
  if (el.tagName === "SELECT") routeInput(el);
});

document.addEventListener("keydown", (e) => {
  if (state.modal) { modalKeydown(e); return; }
  if (e.key === "Escape" && state.userMenu) { state.userMenu = false; renderTopbar(); $<HTMLElement>('[data-action="user-menu"]')?.focus(); }
});

window.addEventListener("hashchange", () => {
  const v = location.hash.slice(1) as ViewId;
  if (VIEW_IDS.includes(v) && v !== state.view && signedIn()) { if (state.modal) closeModal(); navigate(v); }
});

/* ---------- boot ---------- */

setLanguage(state.lang);
document.documentElement.lang = state.lang;
applyTheme();
const start = location.hash.slice(1) as ViewId;
state.view = VIEW_IDS.includes(start) ? start : "overview";
if (isLive && sessionUser()) void startLive();
else render();
