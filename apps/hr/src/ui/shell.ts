/* App frame: compact header (branch picker, "Logged in as" badge with
   user switch, language, theme), sidebar on desktop, bottom tabs on phones. */

import type { ViewId } from "../types";
import { LANGUAGES, getLanguage, t, tk } from "../i18n";
import { BRANCHES } from "../catalog";
import { attendanceOn, db, HR_USERS, state, user } from "../store";
import { today } from "../format";
import { $, esc, icon, type IconName } from "./dom";
import { avatar, roleName } from "./shared";

export const NAV: readonly { id: ViewId; label: string; short: string; icon: IconName }[] = [
  { id: "today", label: "Today", short: "Today", icon: "overview" },
  { id: "staff", label: "Staff directory", short: "Staff", icon: "users" },
  { id: "schedule", label: "Shift planner", short: "Planner", icon: "calendar" },
  { id: "attendance", label: "Attendance", short: "Clock", icon: "clock" },
  { id: "payroll", label: "Payroll", short: "Payroll", icon: "wallet" },
  { id: "performance", label: "Performance & incidents", short: "Logs", icon: "star" },
];
export const VIEW_IDS: readonly ViewId[] = NAV.map((n) => n.id);

export function renderShell(): void {
  const app = $("#app");
  if (!app) return;
  app.innerHTML = `
    <aside class="sidebar" aria-label="${t("Main navigation")}">
      <div class="brand"><span class="brand-mark" aria-hidden="true">BA</span><span><strong>Bistro Addis</strong><small>${t("HR & Staff")}</small></span></div>
      <nav id="sideNav" aria-label="${t("Sections")}"></nav>
    </aside>
    <div class="main">
      <header class="topbar" id="topbar"></header>
      <main class="view" id="view" tabindex="-1"></main>
    </div>
    <nav class="bottom-nav" id="bottomNav" aria-label="${t("Sections")}"></nav>
    <div id="modalRoot"></div>`;
  renderTopbar();
  renderNav();
}

export function renderTopbar(): void {
  const bar = $("#topbar");
  if (!bar) return;
  const u = user();
  const others = HR_USERS.filter((id) => id !== u.id).map((id) => db.employees.find((e) => e.id === id)).filter(Boolean);
  bar.innerHTML = `
    <span class="top-brand" aria-hidden="true"><span class="brand-mark">BA</span></span>
    <div class="user-wrap">
      <button type="button" class="user-badge" data-action="user-menu" aria-expanded="${state.userMenu}" aria-controls="userMenu">
        ${avatar(u.id)}
        <span class="who"><small>${t("Logged in as:")}</small><strong>${esc(u.fullName)} <span class="role-paren">(${esc(roleName(u.role))})</span></strong></span>
        <span class="staff-id">${esc(u.id)}</span>
      </button>
      <div class="user-menu" id="userMenu" ${state.userMenu ? "" : "hidden"}>
        <p class="meta">${t("Switch user")}</p>
        ${others.map((s) => s ? `<button type="button" data-action="switch-user" data-value="${s.id}">${avatar(s.id, "xs")}${esc(s.fullName)} <small>(${esc(roleName(s.role))})</small></button>` : "").join("")}
      </div>
    </div>
    <label class="branch-pick"><span class="sr">${t("Branch")}</span>${icon("store")}
      <select id="branchSel" data-bind="shell.branch">${BRANCHES.map((b) => `<option value="${b.id}" ${b.id === state.branch ? "selected" : ""}>${esc(tk(b.nameKey))}</option>`).join("")}</select></label>
    <div class="top-actions">
      <div class="seg lang" role="group" aria-label="${t("Language")}">
        ${LANGUAGES.map((l) => `<button type="button" data-action="lang" data-value="${l.code}" lang="${l.code}" title="${l.name}" aria-pressed="${getLanguage() === l.code}">${l.short}</button>`).join("")}
      </div>
      <button type="button" class="btn icon-btn" id="themeBtn" data-action="theme"
        aria-label="${state.theme === "dark" ? t("Switch to light mode") : t("Switch to dark mode")}">${icon(state.theme === "dark" ? "sun" : "moon")}</button>
    </div>`;
}

export function renderNav(): void {
  const side = $("#sideNav");
  const bottom = $("#bottomNav");
  const onShift = attendanceOn(today()).filter((a) => a.status === "CLOCKED_IN").length;
  const counts: Partial<Record<ViewId, number>> = { attendance: onShift };
  const link = (n: (typeof NAV)[number], cls: string, short: boolean): string => {
    const c = counts[n.id];
    return `<a href="#${n.id}" class="${cls}" ${state.view === n.id ? 'aria-current="page"' : ""}>${icon(n.icon)}<span>${t(short ? n.short : n.label)}</span>${
      c ? `<span class="count neutral" aria-label="${t("{n} on shift now", { n: c })}">${c}</span>` : ""}</a>`;
  };
  if (side) side.innerHTML = NAV.map((n) => link(n, "nav-link", false)).join("");
  if (bottom) {
    bottom.style.setProperty("--tabs", String(NAV.length));
    bottom.innerHTML = NAV.map((n) => link(n, "", true)).join("");
  }
}
