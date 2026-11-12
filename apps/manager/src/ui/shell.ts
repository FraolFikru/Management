/* App frame: compact top header (branch, "Logged in as: Name (Role)"
   badge with user switch, language and theme), sidebar on desktop,
   bottom tabs on phones. Badges show work waiting for the manager. */

import type { ViewId } from "../types";
import { LANGUAGES, getLanguage, t, tk } from "../i18n";
import { DASHBOARD_ROLES, STAFF } from "../catalog";
import { db, lowStock, pendingDispatches, state, user } from "../store";
import { HELP_ICON } from "../support";
import { $, esc, icon, type IconName } from "./dom";
import { isLive } from "../api";
import { roleName } from "./shared";

export const NAV: readonly { id: ViewId; label: string; short: string; icon: IconName }[] = [
  { id: "overview", label: "Overview", short: "Overview", icon: "overview" },
  { id: "sales", label: "Sales", short: "Sales", icon: "sale" },
  { id: "dispatch", label: "Dispatch", short: "Dispatch", icon: "truck" },
  { id: "cogs", label: "COGS purchases", short: "COGS", icon: "box" },
  { id: "waste", label: "Waste & shrinkage", short: "Waste", icon: "trash" },
  { id: "expenses", label: "Branch expenses", short: "Expenses", icon: "coin" },
  { id: "audit", label: "Audit trail", short: "Audit", icon: "clipboard" },
];

export const VIEW_IDS: readonly ViewId[] = [...NAV.map((n) => n.id), "help"];

/** Live mode: real account sign-in (username + password). */
export function renderSignIn(message: string, busy: boolean, username: string): string {
  return `
    <div class="signin">
      <div class="signin-card card">
        <div class="brand"><img class="brand-logo" src="/logo-light.png" alt="SEER"><img class="brand-logo dark-only" src="/logo-dark.png" alt="SEER"><span><strong>SEER</strong><small>${t("Branch manager")}</small></span></div>
        <h1>${t("Sign in")}</h1>
        <p class="meta">${t("Every approval, rejection and log is stamped with the person signed in.")}</p>
        <form id="liveSignIn" class="form" novalidate>
          <div class="field"><label for="liveUser">${t("Username")}</label>
            <input id="liveUser" class="input" autocomplete="username" autocapitalize="none" spellcheck="false" value="${esc(username)}"></div>
          <div class="field"><label for="livePass">${t("Password")}</label>
            <input id="livePass" class="input" type="password" autocomplete="current-password" aria-describedby="err-live"></div>
          <p class="err" id="err-live" role="alert">${esc(message)}</p>
          <div class="form-actions">
            <button type="submit" class="btn primary" ${busy ? "disabled" : ""}>${busy ? t("Signing in…") : t("Sign in")}</button>
          </div>
        </form>
        <div class="seg lang" role="group" aria-label="${t("Language")}">
          ${LANGUAGES.map((l) => `<button type="button" data-action="lang" data-value="${l.code}" lang="${l.code}" aria-pressed="${getLanguage() === l.code}">${l.name}</button>`).join("")}
        </div>
      </div>
    </div>`;
}

export function renderShell(): void {
  const app = $("#app");
  if (!app) return;
  app.innerHTML = `
    <aside class="sidebar" aria-label="${t("Main navigation")}">
      <div class="brand"><img class="brand-logo" src="/logo-light.png" alt="SEER"><img class="brand-logo dark-only" src="/logo-dark.png" alt="SEER"><span><strong>SEER</strong><small>${esc(tk("branch.name"))}</small></span></div>
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

/** Refresh only the header chip (called on every render, so stock changes show at once). */
export function renderLowChip(): void {
  const bar = $("#topbar");
  if (!bar) return;
  const old = bar.querySelector(".low-chip");
  const html = lowChip();
  if (old) old.outerHTML = html;
  else if (html) bar.querySelector(".top-actions")?.insertAdjacentHTML("beforebegin", html);
}

export function renderTopbar(): void {
  const bar = $("#topbar");
  if (!bar) return;
  const u = user();
  const others = STAFF.filter((s) => DASHBOARD_ROLES.includes(s.role) && s.userId !== u.userId);
  bar.innerHTML = `
    <span class="top-brand" aria-hidden="true"><img class="brand-logo-sm" src="/logo-light.png" alt=""><img class="brand-logo-sm dark-only" src="/logo-dark.png" alt=""></span>
    <div class="user-wrap">
      <button type="button" class="user-badge" data-action="user-menu" aria-expanded="${state.userMenu}" aria-controls="userMenu">
        <span class="avatar" aria-hidden="true">${u.initials}</span>
        <span class="who"><small>${t("Logged in as:")}</small><strong>${esc(u.name)} <span class="role-paren">(${esc(roleName(u.role))})</span></strong></span>
        <span class="staff-id">${esc(u.userId)}</span>
      </button>
      <div class="user-menu" id="userMenu" ${state.userMenu ? "" : "hidden"}>
        ${isLive ? `<button type="button" data-action="sign-out">${icon("arrow")} ${t("Sign out")}</button>` : `<p class="meta">${t("Switch user")}</p>`}
        ${isLive ? "" : others.map((s) => `<button type="button" data-action="switch-user" data-value="${s.userId}"><span class="avatar xs" aria-hidden="true">${s.initials}</span>${esc(s.name)} <small>(${esc(roleName(s.role))})</small></button>`).join("")}
      </div>
    </div>
    ${lowChip()}
    <div class="top-actions">
      <a href="#help" class="sh-help-btn" aria-label="${t("Help & support")}" title="${t("Help & support")}">${HELP_ICON}</a>
      <div class="seg lang" role="group" aria-label="${t("Language")}">
        ${LANGUAGES.map((l) => `<button type="button" data-action="lang" data-value="${l.code}" lang="${l.code}" title="${l.name}" aria-pressed="${getLanguage() === l.code}">${l.short}</button>`).join("")}
      </div>
      <button type="button" class="btn icon-btn" id="themeBtn" data-action="theme"
        aria-label="${state.theme === "dark" ? t("Switch to light mode") : t("Switch to dark mode")}">${icon(state.theme === "dark" ? "sun" : "moon")}</button>
    </div>`;
}

/** Always-visible low-stock warning in the header (currentQuantity <= reorderPoint). */
function lowChip(): string {
  const n = lowStock().length;
  return n
    ? `<a class="low-chip" href="#overview" data-n="${n}" data-action="goto-low" title="${t("Low stock warning")}">${icon("alert")}<span>${t("{n} low stock", { n })}</span></a>`
    : "";
}

export function renderNav(): void {
  renderLowChip();
  const side = $("#sideNav");
  const bottom = $("#bottomNav");
  const counts: Partial<Record<ViewId, number>> = {
    dispatch: pendingDispatches().length,
    cogs: db.purchases.filter((p) => p.status === "PENDING").length,
    waste: db.waste.filter((w) => w.pending).length,
  };
  const link = (n: (typeof NAV)[number], cls: string, short: boolean): string => {
    const c = counts[n.id];
    return `<a href="#${n.id}" class="${cls}" ${state.view === n.id ? 'aria-current="page"' : ""}>${icon(n.icon)}<span>${t(short ? n.short : n.label)}</span>${
      c ? `<span class="count" aria-label="${t("{n} waiting", { n: c })}">${c}</span>` : ""}</a>`;
  };
  if (side) side.innerHTML = NAV.map((n) => link(n, "nav-link", false)).join("") + `<p class="nav-heading sh-nav-heading">${t("Support")}</p><a href="#help" class="nav-link" ${state.view === "help" ? 'aria-current="page"' : ""}>${HELP_ICON}<span>${t("Help & support")}</span></a>`;
  if (bottom) {
    bottom.style.setProperty("--tabs", String(NAV.length));
    bottom.innerHTML = NAV.map((n) => link(n, "", true)).join("");
  }
}
