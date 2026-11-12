/* =========================================================
   System Admin & Configuration — entry point.
   Renders the shell and the current view. Events are delegated:
   data-action for clicks, data-bind="scope.key" for inputs.
   Only roles with "System admin" permission see the settings.
   ========================================================= */

import { renderHelp } from "./views/help";
import "./style.css";
import type { ViewId } from "./types";
import { isLanguage, setLanguage, t, tk } from "./i18n";
import { PERMISSIONS } from "./catalog";
import { db, isAdmin, loadFromBackend, onRemoteChange, onSyncError, permsOf, savePrefs, signIn, state, user } from "./store";
import { ApiError, isLive, sessionUser, signIn as apiSignIn, signOut } from "./api";
import { $, esc, icon } from "./ui/dom";
import { wireApp, type ActionMap } from "./ui/app";
import { VIEW_IDS, renderNav, renderShell, renderTopbar } from "./ui/shell";
import { clearToast, runUndo, toast } from "./ui/toast";
import { onProfileInput, renderStore, resetStoreDraft, storeActions } from "./views/store";
import { branchActions, renderBranches } from "./views/branches";
import { accessActions, renderAccess } from "./views/access";
import { onReceiptInput, receiptActions, renderReceipt, resetReceiptDraft } from "./views/receipt";
import { auditActions, onAuditInput, renderAudit } from "./views/audit";
import { closeModal, modalActions, modalKeydown, onModalInput, renderModal, submitModal } from "./views/modals";

const VIEWS: Record<ViewId, { title: string; render: () => string }> = {
  help: { title: "Help & support", render: renderHelp },
  store: { title: "Store & tax", render: renderStore },
  branches: { title: "Branches & prices", render: renderBranches },
  access: { title: "Users & roles", render: renderAccess },
  receipt: { title: "Receipt & printer", render: renderReceipt },
  audit: { title: "Activity & backup", render: renderAudit },
};

/** Shown to signed-in users whose role does not include System admin. */
function renderNoAccess(): string {
  const u = user();
  const p = permsOf(u.role);
  return `<section class="card no-access" aria-labelledby="naTitle">
    <span class="na-ic">${icon("lock")}</span>
    <h1 id="naTitle" tabindex="-1">${t("System admin is for Admins only")}</h1>
    <p>${t("{name} is signed in as {role}. Ask an Admin if you need a setting changed.", { name: esc(u.fullName), role: esc(tk(`role.${u.role}`)) })}</p>
    <h2 class="mini-head">${t("What your role can do")}</h2>
    <ul class="perm-list">${PERMISSIONS.map((x) => `<li class="${p[x.key] ? "yes" : "no"}">${icon(p[x.key] ? "check" : "x")} ${t(x.label)}</li>`).join("")}</ul>
  </section>`;
}

function render(focusSelector?: string): void {
  if (!$("#view")) renderShell();
  const view = $("#view");
  if (!view) return;
  view.innerHTML = isAdmin() || state.view === "help" ? VIEWS[state.view].render() : renderNoAccess();
  renderNav();
  document.title = `${t(VIEWS[state.view].title)} · SEER Admin`;
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
    if (!db.users.some((u) => u.id === id && u.isActive)) return;
    state.userId = id;
    state.userMenu = false;
    if (!isAdmin()) state.scope = "ALL";
    resetStoreDraft();
    resetReceiptDraft();
    savePrefs();
    clearToast();
    signIn();
    rebuild('[data-action="user-menu"]');
    toast(t("Now logged in as {name}", { name: user().fullName }));
  },
  undo: () => runUndo(),
  "sign-out": () => { void signOut().then(() => renderSignIn()); },
};

const ACTIONS: ActionMap = { ...shellActions, ...storeActions, ...branchActions, ...accessActions, ...receiptActions, ...auditActions, ...modalActions };

/* ---------- events ---------- */

document.addEventListener("click", (e) => {
  const target = e.target as HTMLElement;
  if (state.userMenu && !target.closest(".user-wrap")) { state.userMenu = false; renderTopbar(); }
  const el = target.closest<HTMLElement>("[data-action]");
  if (!el || (el as HTMLButtonElement).disabled) return;
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
  if (scope === "shell" && key === "scope") {
    if (el.value !== "ALL" && !db.branches.some((b) => b.id === el.value)) return;
    state.scope = el.value;
    render("#scopeSel");
  } else if (scope === "profile") onProfileInput(key, el.value);
  else if (scope === "receipt") onReceiptInput(key, el.value);
  else if (scope === "audit") onAuditInput(key, el.value);
  else if (scope === "branch" || scope === "user" || scope === "price" || scope === "bulk") onModalInput(scope, key, el);
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

/* ---------- sign-in (live mode) ---------- */

function renderSignIn(message = ""): void {
  const app = $("#app");
  if (!app) return;
  app.innerHTML = `<main class="signin-wrap"><form id="signinForm" class="card signin-card form" novalidate>
      <img class="brand-logo" src="/logo-light.png" alt="SEER"><img class="brand-logo dark-only" src="/logo-dark.png" alt="SEER">
      <h1>${t("Sign in to SEER Admin")}</h1>
      <div class="field"><label for="siUser">${t("Username")}</label><input id="siUser" class="input" name="username" autocomplete="username" autocapitalize="off" required></div>
      <div class="field"><label for="siPass">${t("Password")}</label><input id="siPass" class="input" name="password" type="password" autocomplete="current-password" required></div>
      ${message ? `<p class="signin-error" role="alert">${esc(message)}</p>` : ""}
      <button type="submit" class="btn primary">${t("Sign in")}</button>
    </form></main>`;
  $<HTMLInputElement>("#siUser")?.focus();
}

async function startLive(): Promise<void> {
  const app = $("#app");
  if (app) app.innerHTML = `<main class="signin-wrap"><p class="card signin-card">${t("Loading…")}</p></main>`;
  try {
    await loadFromBackend();
  } catch (err) {
    renderSignIn(err instanceof ApiError && err.status === 401 ? "" : err instanceof ApiError && err.status === 403
      ? t("This account can't open System admin.") : t("Cannot reach the server. It may be waking up — try again in a minute."));
    return;
  }
  if (app) app.innerHTML = "";
  render();
}

document.addEventListener("submit", (e) => {
  const form = e.target as HTMLFormElement;
  if (form.id !== "signinForm") return;
  e.preventDefault();
  e.stopImmediatePropagation();
  const data = new FormData(form);
  void apiSignIn(String(data.get("username")), String(data.get("password")))
    .then(() => startLive())
    .catch((err) => renderSignIn(err instanceof ApiError && err.status === 401
      ? t("Wrong username or password") : t("Cannot reach the server. It may be waking up — try again in a minute.")));
}, { capture: true });

onRemoteChange(() => { if (!state.modal) render(); });

onSyncError((message) => {
  render();
  toast(t("Not saved: {reason}", { reason: message }));
});

/* ---------- boot ---------- */

setLanguage(state.lang);
applyTheme();
signIn();
const start = location.hash.slice(1) as ViewId;
state.view = VIEW_IDS.includes(start) ? start : "store";
if (!isLive) render();
else if (sessionUser()) void startLive();
else renderSignIn();
