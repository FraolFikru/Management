/* =========================================================
   Finance & Accounting — entry point.
   Renders the shell and the current view. Events are delegated:
   data-action for clicks, data-bind="scope.key" for inputs.
   ========================================================= */

import "./style.css";
import type { ViewId } from "./types";
import { isLanguage, setLanguage, t } from "./i18n";
import { USERS } from "./catalog";
import { loadFromBackend, onSyncError, savePrefs, signOut, signedIn, state, user } from "./store";
import { isLive, sessionUser, signIn as apiSignIn, signOut as apiSignOut } from "./api";
import { $ } from "./ui/dom";
import { wireApp, type ActionMap } from "./ui/app";
import { VIEW_IDS, renderNav, renderShell, renderSignIn, renderTopbar } from "./ui/shell";
import { clearToast, runUndo, toast } from "./ui/toast";
import { pnlActions, renderPnl } from "./views/pnl";
import { onApInput, payablesActions, renderPayables } from "./views/payables";
import { renderTax, taxActions } from "./views/tax";
import { cashActions, renderCash } from "./views/cash";
import { closeModal, modalActions, modalKeydown, onModalInput, renderModal, submitModal } from "./views/modals";

const VIEWS: Record<ViewId, { title: string; render: () => string }> = {
  pnl: { title: "Profit & loss", render: renderPnl },
  payables: { title: "Accounts payable", render: renderPayables },
  tax: { title: "Tax & VAT", render: renderTax },
  cash: { title: "Cash & reconciliation", render: renderCash },
};

/* ---------- live mode (backend) ---------- */

const liveUi = { message: "", busy: false, username: "" };

function liveMessage(err: unknown): string {
  const m = err instanceof Error ? err.message : String(err);
  if (m === "wrong") return t("Wrong username or password.");
  if (m === "no-access") return t("This account can't open the finance app.");
  if (m.includes("Failed to fetch") || m.includes("NetworkError") || m.includes("Load failed")) return t("Cannot reach the server. It may be waking up — try again in a minute.");
  return m;
}

/** Load the books for the signed-in account, then show the app. */
async function startLive(): Promise<void> {
  liveUi.busy = true; render();
  try {
    await loadFromBackend();
    liveUi.message = "";
  } catch (err) {
    liveUi.message = liveMessage(err);
    if (sessionUser()) await apiSignOut();
  }
  liveUi.busy = false;
  rebuild();
}

onSyncError((message) => {
  toast(t("Not saved: {reason}", { reason: message }));
  render();
});

function render(focusSelector?: string): void {
  if (!signedIn()) {
    const app = $("#app");
    if (app) {
      app.classList.add("signed-out");
      app.innerHTML = renderSignIn(liveUi.message, liveUi.busy, liveUi.username);
    }
    document.title = "Bistro Addis Finance";
    $<HTMLElement>(focusSelector ?? (liveUi.message ? "#livePass" : "#liveUser"))?.focus();
    return;
  }
  $("#app")?.classList.remove("signed-out");
  if (!$("#view")) renderShell();
  const view = $("#view");
  if (!view) return;
  view.innerHTML = VIEWS[state.view].render();
  renderNav();
  document.title = `${t(VIEWS[state.view].title)} · Bistro Addis Finance`;
  if (focusSelector) $<HTMLElement>(focusSelector)?.focus();
}

function navigate(view: ViewId, focusSelector?: string): void {
  const changed = state.view !== view;
  state.view = view;
  state.errors = {};
  if (location.hash.slice(1) !== view) history.replaceState(null, "", `#${view}`);
  render(focusSelector);
  if (changed && !focusSelector) { window.scrollTo({ top: 0 }); $<HTMLElement>("#view h1")?.focus({ preventScroll: true }); }
}

wireApp(render, navigate);

function rebuild(focusSelector?: string): void {
  const app = $("#app");
  if (app) app.innerHTML = "";
  render(focusSelector);
  if (state.modal) renderModal();
}

const applyTheme = (): void => { document.documentElement.dataset.theme = state.theme; };

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
    renderTopbar();
    $<HTMLElement>("#themeBtn")?.focus();
  },
  "user-menu": () => {
    state.userMenu = !state.userMenu;
    renderTopbar();
    $<HTMLElement>(state.userMenu ? '[data-action="switch-user"]' : '[data-action="user-menu"]')?.focus();
  },
  "switch-user": (el) => {
    const id = el.dataset.value ?? "";
    if (!USERS.some((u) => u.id === id)) return;
    state.userId = id;
    state.userMenu = false;
    savePrefs();
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
};

const ACTIONS: ActionMap = { ...shellActions, ...pnlActions, ...payablesActions, ...taxActions, ...cashActions, ...modalActions };

/* ---------- events ---------- */

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
    if (liveUi.busy) return;
    const u = $<HTMLInputElement>("#liveUser")?.value ?? "";
    const p = $<HTMLInputElement>("#livePass")?.value ?? "";
    liveUi.username = u;
    if (!u.trim() || !p) { liveUi.message = t("Enter your username and password."); render(); return; }
    liveUi.busy = true; liveUi.message = ""; render();
    apiSignIn(u, p).then(startLive, (err) => { liveUi.busy = false; liveUi.message = liveMessage(err); render(); });
    return;
  }
  submitModal(id);
});

function routeInput(el: HTMLInputElement): void {
  const bind = el.dataset.bind;
  if (!bind) return;
  const [scope, ...rest] = bind.split(".");
  const key = rest.join(".");
  if (scope === "ap") onApInput(key, el.value);
  else if (scope === "pay" || scope === "bill" || scope === "recon" || scope === "file") onModalInput(scope, key, el);
}

document.addEventListener("input", (e) => {
  const el = e.target as HTMLInputElement;
  if (el.tagName === "SELECT" || el.type === "checkbox" || el.type === "date") return;
  routeInput(el);
});
document.addEventListener("change", (e) => {
  const el = e.target as HTMLInputElement;
  if (el.tagName === "SELECT" || el.type === "checkbox" || el.type === "date") routeInput(el);
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
applyTheme();
const start = location.hash.slice(1) as ViewId;
state.view = VIEW_IDS.includes(start) ? start : "pnl";
if (isLive && sessionUser()) void startLive();
else render();
