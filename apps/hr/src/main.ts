/* =========================================================
   HR & Staff Management — entry point.
   Renders the shell and the current view. Events are delegated:
   data-action for clicks, data-bind="scope.key" for inputs, plus
   drag-and-drop for the shift planner and a 30-second timer that
   updates live hours on the clock board.
   ========================================================= */

import { renderHelp } from "./views/help";
import "./style.css";
import type { ViewId } from "./types";
import { isLanguage, setLanguage, t } from "./i18n";
import { BRANCHES } from "./catalog";
import { today } from "./format";
import { HR_USERS, loadFromBackend, onSyncError, savePrefs, signOut, signedIn, state, user } from "./store";
import { isLive, sessionUser, signIn as apiSignIn, signOut as apiSignOut } from "./api";
import { $ } from "./ui/dom";
import { wireApp, type ActionMap } from "./ui/app";
import { VIEW_IDS, renderNav, renderShell, renderSignIn, renderTopbar } from "./ui/shell";
import { clearToast, runUndo, toast } from "./ui/toast";
import { renderToday } from "./views/today";
import { onStaffInput, renderStaff, staffActions } from "./views/staff";
import { closeCellMenu, isMenuOpen, onDragEnd, onDragOver, onDragStart, onDrop, renderSchedule, scheduleActions } from "./views/schedule";
import { attendanceActions, refreshLive, renderAttendance } from "./views/attendance";
import { payrollActions, renderPayroll } from "./views/payroll";
import { performanceActions, renderPerformance } from "./views/performance";
import { closeModal, modalActions, modalKeydown, onModalInput, renderModal, submitAbsent, submitEmployee, submitLog } from "./views/modals";

const VIEWS: Record<ViewId, { title: string; render: () => string }> = {
  help: { title: "Help & support", render: renderHelp },
  today: { title: "Today", render: renderToday },
  staff: { title: "Staff directory", render: renderStaff },
  schedule: { title: "Shift planner", render: renderSchedule },
  attendance: { title: "Attendance", render: renderAttendance },
  payroll: { title: "Payroll", render: renderPayroll },
  performance: { title: "Performance & incidents", render: renderPerformance },
};

/* ---------- live mode (backend) ---------- */

const liveUi = { message: "", busy: false, username: "" };

function liveMessage(err: unknown): string {
  const m = err instanceof Error ? err.message : String(err);
  if (m === "wrong") return t("Wrong username or password.");
  if (m === "no-access") return t("This account can't open the HR app.");
  if (m.includes("Failed to fetch") || m.includes("NetworkError") || m.includes("Load failed")) return t("Cannot reach the server. It may be waking up — try again in a minute.");
  return m;
}

/** Load the staff data for the signed-in account, then show the app. */
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
    document.title = "SEER · HR";
    $<HTMLElement>(focusSelector ?? (liveUi.message ? "#livePass" : "#liveUser"))?.focus();
    return;
  }
  $("#app")?.classList.remove("signed-out");
  if (!$("#view")) renderShell();
  const view = $("#view");
  if (!view) return;
  view.innerHTML = VIEWS[state.view].render();
  renderNav();
  document.title = `${t(VIEWS[state.view].title)} · SEER HR`;
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
    if (!HR_USERS.includes(id)) return;
    state.userId = id;
    state.userMenu = false;
    savePrefs();
    clearToast();
    rebuild('[data-action="user-menu"]');
    toast(t("Now logged in as {name}", { name: user().fullName }));
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

const ACTIONS: ActionMap = {
  ...shellActions, ...staffActions, ...scheduleActions, ...attendanceActions, ...payrollActions, ...performanceActions, ...modalActions,
};

/* ---------- events ---------- */

document.addEventListener("click", (e) => {
  const target = e.target as HTMLElement;
  if (state.userMenu && !target.closest(".user-wrap")) { state.userMenu = false; renderTopbar(); }
  const el = target.closest<HTMLElement>("[data-action]");
  if (isMenuOpen() && !target.closest(".cell-menu") && el?.dataset.action !== "cell-menu") closeCellMenu();
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
  }
  else if (id === "employeeForm") submitEmployee();
  else if (id === "logForm") submitLog();
  else if (id === "absentForm") submitAbsent();
});

function routeInput(el: HTMLInputElement): void {
  const bind = el.dataset.bind;
  if (!bind) return;
  const [scope, ...rest] = bind.split(".");
  const key = rest.join(".");
  if (scope === "shell" && key === "branch") {
    if (!BRANCHES.some((b) => b.id === el.value)) return;
    state.branch = el.value;
    state.logEmployee = "ALL";
    rebuild("#branchSel");
  } else if (scope === "staff") onStaffInput(key, el.value);
  else if (scope === "att" && key === "day") {
    if (el.value && el.value <= today()) { state.attDay = el.value; render("[data-bind='att.day']"); }
  } else if (scope === "emp" || scope === "log" || scope === "absent") onModalInput(scope, key, el.value);
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
  if (e.key === "Escape") {
    if (closeCellMenu()) return;
    if (state.userMenu) { state.userMenu = false; renderTopbar(); $<HTMLElement>('[data-action="user-menu"]')?.focus(); }
  }
});

document.addEventListener("dragstart", onDragStart);
document.addEventListener("dragover", onDragOver);
document.addEventListener("drop", onDrop);
document.addEventListener("dragend", onDragEnd);

window.addEventListener("hashchange", () => {
  const v = location.hash.slice(1) as ViewId;
  if (VIEW_IDS.includes(v) && v !== state.view && signedIn()) { if (state.modal) closeModal(); navigate(v); }
});

// live hours on the clock board
window.setInterval(() => { if (state.view === "today" || state.view === "attendance") refreshLive(); }, 30_000);

/* ---------- boot ---------- */

setLanguage(state.lang);
applyTheme();
const start = location.hash.slice(1) as ViewId;
state.view = VIEW_IDS.includes(start) ? start : "today";
if (isLive && sessionUser()) void startLive();
else render();
