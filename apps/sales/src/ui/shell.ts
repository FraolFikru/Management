/* App frame: compact top bar with the signed-in staff badge, language
   and theme switches; sidebar (desktop) and bottom tabs (phones).
   Navigation only lists the screens the current role may open. */

import type { ViewId } from "../types";
import { LANGUAGES, getLanguage, t } from "../i18n";
import { STAFF } from "../catalog";
import { canView, canApproveWaste, currentUser, db, state } from "../store";
import { $, esc, icon, type IconName } from "./dom";
import { roleName } from "./shared";

export const NAV: readonly { id: ViewId; label: string; icon: IconName }[] = [
  { id: "dashboard", label: "Dashboard", icon: "overview" },
  { id: "purchases", label: "Purchases", icon: "box" },
  { id: "waste", label: "Waste", icon: "trash" },
  { id: "expenses", label: "Other expenses", icon: "coin" },
  { id: "audit", label: "Audit trail", icon: "clipboard" },
];

export const VIEW_IDS: readonly ViewId[] = NAV.map((n) => n.id);

export function renderShell(): void {
  const app = $("#app");
  if (!app) return;
  const u = currentUser();
  app.innerHTML = `
    <aside class="sidebar" aria-label="${t("Main navigation")}">
      <div class="brand"><span class="brand-mark" aria-hidden="true">BA</span><span><strong>Bistro Addis</strong><small>${t("Purchasing & inventory")}</small></span></div>
      <nav id="sideNav" aria-label="${t("Sections")}"></nav>
    </aside>
    <div class="main">
      <header class="topbar">
        <span class="top-brand" aria-hidden="true"><span class="brand-mark">BA</span></span>
        ${u ? `<button type="button" class="user-badge" data-action="switch-user" aria-label="${t("Logged in as {name}, {role}. Switch user", { name: u.name, role: roleName(u.role) })}">
          <span class="avatar" aria-hidden="true">${u.initials}</span>
          <span class="who"><small>${t("Logged in as")}</small><strong>${esc(u.name)}</strong></span>
          <span class="role-tag role-${u.role.toLowerCase()}">${esc(roleName(u.role))}</span>
        </button>` : ""}
        <div class="top-actions">
          <div class="seg lang" role="group" aria-label="${t("Language")}">
            ${LANGUAGES.map((l) => `<button type="button" data-action="lang" data-value="${l.code}" lang="${l.code}" title="${l.name}" aria-pressed="${getLanguage() === l.code}">${l.short}</button>`).join("")}
          </div>
          <button type="button" class="btn icon-btn" id="themeBtn" data-action="theme"
            aria-label="${state.theme === "dark" ? t("Switch to light mode") : t("Switch to dark mode")}">${icon(state.theme === "dark" ? "sun" : "moon")}</button>
          ${u ? `<button type="button" class="btn icon-btn" data-action="sign-out" aria-label="${t("Sign out")}" title="${t("Sign out")}">${icon("logout")}</button>` : ""}
        </div>
      </header>
      <main class="view" id="view" tabindex="-1"></main>
    </div>
    <nav class="bottom-nav" id="bottomNav" aria-label="${t("Sections")}"></nav>
    <div id="modalRoot"></div>`;
  renderNav();
}

export function renderNav(): void {
  const u = currentUser();
  const side = $("#sideNav");
  const bottom = $("#bottomNav");
  if (!u) {
    if (side) side.innerHTML = "";
    if (bottom) bottom.innerHTML = "";
    return;
  }
  const pending = canApproveWaste() ? db.waste.filter((w) => w.approval === "PENDING").length : 0;
  const items = NAV.filter((n) => canView(n.id, u.role));
  const link = (n: (typeof NAV)[number], cls: string): string =>
    `<a href="#${n.id}" class="${cls}" ${state.view === n.id ? 'aria-current="page"' : ""}>${icon(n.icon)}<span>${t(n.label)}</span>${
      n.id === "waste" && pending ? `<span class="count" aria-label="${t("{n} awaiting approval", { n: pending })}">${pending}</span>` : ""}</a>`;
  if (side) side.innerHTML = items.map((n) => link(n, "nav-link")).join("");
  if (bottom) {
    bottom.style.setProperty("--tabs", String(items.length));
    bottom.innerHTML = items.map((n) => link(n, "")).join("");
  }
}

/* ---------- sign-in / switch user ---------- */

export function renderSignIn(): string {
  const chosen = STAFF.find((s) => s.userId === state.signInFor);
  return `
    <div class="signin">
      <div class="signin-card card">
        <div class="brand"><span class="brand-mark" aria-hidden="true">BA</span><span><strong>Bistro Addis</strong><small>${t("Purchasing & inventory")}</small></span></div>
        <h1>${chosen ? t("Enter PIN for {name}", { name: chosen.name }) : t("Who is working?")}</h1>
        <p class="meta">${t("Every purchase, expense and waste report is stamped with the person signed in.")}</p>
        ${chosen ? `
          <form id="pinForm" class="form" novalidate>
            <div class="field"><label for="pin">${t("4-digit PIN")}</label>
              <input id="pin" class="input pin" type="password" inputmode="numeric" autocomplete="off" maxlength="4" pattern="[0-9]*" aria-describedby="err-pin">
              <p class="err" id="err-pin"></p></div>
            <div class="form-actions">
              <button type="button" class="btn" data-action="signin-back">${t("Back")}</button>
              <button type="submit" class="btn primary">${icon("lock")} ${t("Sign in")}</button>
            </div>
            <p class="hint">${t("Demo PIN: {pin}", { pin: chosen.pin })}</p>
          </form>` : `
          <ul class="staff-list">${STAFF.map((s) => `
            <li><button type="button" class="staff-btn" data-action="signin-pick" data-value="${s.userId}">
              <span class="avatar" aria-hidden="true">${s.initials}</span>
              <span class="who"><strong>${esc(s.name)}</strong><small>${esc(roleName(s.role))}</small></span>
              ${icon("arrow")}
            </button></li>`).join("")}</ul>`}
        <div class="seg lang small" role="group" aria-label="${t("Language")}">
          ${LANGUAGES.map((l) => `<button type="button" data-action="lang" data-value="${l.code}" lang="${l.code}" aria-pressed="${getLanguage() === l.code}">${l.name}</button>`).join("")}
        </div>
      </div>
    </div>`;
}
