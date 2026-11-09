/* =========================================================
   Finance & Accounting — entry point.
   Renders the shell and the current view. Events are delegated:
   data-action for clicks, data-bind="scope.key" for inputs.
   ========================================================= */

import "./style.css";
import type { ViewId } from "./types";
import { isLanguage, setLanguage, t } from "./i18n";
import { USERS } from "./catalog";
import { savePrefs, state, user } from "./store";
import { $ } from "./ui/dom";
import { wireApp, type ActionMap } from "./ui/app";
import { VIEW_IDS, renderNav, renderShell, renderTopbar } from "./ui/shell";
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

function render(focusSelector?: string): void {
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
  submitModal((e.target as HTMLFormElement).id);
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
  if (VIEW_IDS.includes(v) && v !== state.view) { if (state.modal) closeModal(); navigate(v); }
});

/* ---------- boot ---------- */

setLanguage(state.lang);
applyTheme();
const start = location.hash.slice(1) as ViewId;
state.view = VIEW_IDS.includes(start) ? start : "pnl";
render();
