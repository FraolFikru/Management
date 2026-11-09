/* App frame: compact top header (branch, "Logged in as: Name (Role)"
   badge with user switch, language and theme), sidebar on desktop,
   bottom tabs on phones. Badges show work waiting for the manager. */

import type { ViewId } from "../types";
import { LANGUAGES, getLanguage, t, tk } from "../i18n";
import { DASHBOARD_ROLES, STAFF } from "../catalog";
import { db, lowStock, pendingDispatches, state, user } from "../store";
import { $, esc, icon, type IconName } from "./dom";
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

export const VIEW_IDS: readonly ViewId[] = NAV.map((n) => n.id);

export function renderShell(): void {
  const app = $("#app");
  if (!app) return;
  app.innerHTML = `
    <aside class="sidebar" aria-label="${t("Main navigation")}">
      <div class="brand"><span class="brand-mark" aria-hidden="true">BA</span><span><strong>Bistro Addis</strong><small>${esc(tk("branch.name"))}</small></span></div>
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
    <span class="top-brand" aria-hidden="true"><span class="brand-mark">BA</span></span>
    <div class="user-wrap">
      <button type="button" class="user-badge" data-action="user-menu" aria-expanded="${state.userMenu}" aria-controls="userMenu">
        <span class="avatar" aria-hidden="true">${u.initials}</span>
        <span class="who"><small>${t("Logged in as:")}</small><strong>${esc(u.name)} <span class="role-paren">(${esc(roleName(u.role))})</span></strong></span>
        <span class="staff-id">${esc(u.userId)}</span>
      </button>
      <div class="user-menu" id="userMenu" ${state.userMenu ? "" : "hidden"}>
        <p class="meta">${t("Switch user")}</p>
        ${others.map((s) => `<button type="button" data-action="switch-user" data-value="${s.userId}"><span class="avatar xs" aria-hidden="true">${s.initials}</span>${esc(s.name)} <small>(${esc(roleName(s.role))})</small></button>`).join("")}
      </div>
    </div>
    ${lowChip()}
    <div class="top-actions">
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
  };
  const link = (n: (typeof NAV)[number], cls: string, short: boolean): string => {
    const c = counts[n.id];
    return `<a href="#${n.id}" class="${cls}" ${state.view === n.id ? 'aria-current="page"' : ""}>${icon(n.icon)}<span>${t(short ? n.short : n.label)}</span>${
      c ? `<span class="count" aria-label="${t("{n} waiting", { n: c })}">${c}</span>` : ""}</a>`;
  };
  if (side) side.innerHTML = NAV.map((n) => link(n, "nav-link", false)).join("");
  if (bottom) {
    bottom.style.setProperty("--tabs", String(NAV.length));
    bottom.innerHTML = NAV.map((n) => link(n, "", true)).join("");
  }
}
