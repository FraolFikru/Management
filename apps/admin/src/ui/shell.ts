/* App frame: compact header ("Logged in as" badge with user switch,
   global branch switch, language, theme), sidebar on desktop, bottom
   tabs on phones. */

import type { ViewId } from "../types";
import { isLive } from "../api";
import { LANGUAGES, getLanguage, t, tk } from "../i18n";
import { db, isAdmin, state, user } from "../store";
import { HELP_ICON } from "../support";
import { $, esc, icon, type IconName } from "./dom";
import { avatar } from "./shared";

export const NAV: readonly { id: ViewId; label: string; short: string; icon: IconName }[] = [
  { id: "store", label: "Store & tax", short: "Store", icon: "store" },
  { id: "branches", label: "Branches & prices", short: "Branches", icon: "globe" },
  { id: "access", label: "Users & roles", short: "Users", icon: "shield" },
  { id: "receipt", label: "Receipt & printer", short: "Receipt", icon: "receipt" },
  { id: "audit", label: "Activity & backup", short: "Activity", icon: "list" },
];
export const VIEW_IDS: readonly ViewId[] = [...NAV.map((n) => n.id), "help"];

export function renderShell(): void {
  const app = $("#app");
  if (!app) return;
  app.innerHTML = `
    <aside class="sidebar" aria-label="${t("Main navigation")}">
      <div class="brand"><img class="brand-logo" src="/logo-light.png" alt="SEER"><img class="brand-logo dark-only" src="/logo-dark.png" alt="SEER"><span><strong>SEER</strong><small>${t("System admin")}</small></span></div>
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
  bar.innerHTML = `
    <span class="top-brand" aria-hidden="true"><img class="brand-logo-sm" src="/logo-light.png" alt=""><img class="brand-logo-sm dark-only" src="/logo-dark.png" alt=""></span>
    <div class="user-wrap">
      <button type="button" class="user-badge" data-action="user-menu" aria-expanded="${state.userMenu}" aria-controls="userMenu">
        ${avatar(u.id)}
        <span class="who"><small>${t("Logged in as:")}</small><strong>${esc(u.fullName)} <span class="role-paren">(${esc(tk(`role.${u.role}`))})</span></strong></span>
        <span class="staff-id">${esc(u.id)}</span>
      </button>
      <div class="user-menu" id="userMenu" ${state.userMenu ? "" : "hidden"}>
        ${isLive ? `<button type="button" data-action="sign-out">${icon("lock")} ${t("Sign out")}</button>` : `
        <p class="meta">${t("Switch user")}</p>
        ${db.users.filter((x) => x.id !== u.id && x.isActive && (x.role === "ADMIN" || x.role === "BRANCH_MANAGER")).map((x) =>
          `<button type="button" data-action="switch-user" data-value="${x.id}">${avatar(x.id, "xs")}${esc(x.fullName)} <small>(${esc(tk(`role.${x.role}`))})</small></button>`).join("")}`}
      </div>
    </div>
    ${isAdmin() ? `<label class="scope-pick"><span class="sr">${t("Branch view")}</span>${icon("store")}
      <select class="input slim" id="scopeSel" data-bind="shell.scope">
        <option value="ALL" ${state.scope === "ALL" ? "selected" : ""}>${t("All branches")}</option>
        ${db.branches.map((b) => `<option value="${b.id}" ${state.scope === b.id ? "selected" : ""}>${esc(b.name)}${b.isActive ? "" : ` (${t("closed")})`}</option>`).join("")}
      </select></label>` : `<span class="branch-tag">${icon("store")} ${esc(db.branches.find((b) => b.id === u.assignedBranchId)?.name ?? "")}</span>`}
    <div class="top-actions">
      <a href="#help" class="sh-help-btn" aria-label="${t("Help & support")}" title="${t("Help & support")}">${HELP_ICON}</a>
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
  const inactive = db.users.filter((u) => !u.isActive).length;
  const counts: Partial<Record<ViewId, [number, string]>> = { access: [inactive, t("{n} inactive accounts", { n: inactive })] };
  const link = (n: (typeof NAV)[number], cls: string, short: boolean): string => {
    const c = counts[n.id];
    return `<a href="#${n.id}" class="${cls}" ${state.view === n.id ? 'aria-current="page"' : ""}>${icon(n.icon)}<span>${t(short ? n.short : n.label)}</span>${
      c && c[0] ? `<span class="count muted-count" aria-label="${esc(c[1])}">${c[0]}</span>` : ""}</a>`;
  };
  if (side) side.innerHTML = NAV.map((n) => link(n, "nav-link", false)).join("") + `<p class="nav-heading sh-nav-heading">${t("Support")}</p><a href="#help" class="nav-link" ${state.view === "help" ? 'aria-current="page"' : ""}>${HELP_ICON}<span>${t("Help & support")}</span></a>`;
  if (bottom) { bottom.style.setProperty("--tabs", String(NAV.length)); bottom.innerHTML = NAV.map((n) => link(n, "", true)).join(""); }
}
