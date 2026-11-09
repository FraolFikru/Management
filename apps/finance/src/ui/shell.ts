/* App frame: compact header ("Logged in as" badge with user switch,
   language, theme), sidebar on desktop, bottom tabs on phones.
   Badges show bills overdue and days waiting to be reconciled. */

import type { ViewId } from "../types";
import { LANGUAGES, getLanguage, t, tk } from "../i18n";
import { USERS } from "../catalog";
import { billStatus, db, filing, live, state, user } from "../store";
import { isLive } from "../api";
import { addDays, today } from "../format";
import { monthKey } from "../seed";
import { $, esc, icon, type IconName } from "./dom";
import { avatar } from "./shared";

export const NAV: readonly { id: ViewId; label: string; short: string; icon: IconName }[] = [
  { id: "pnl", label: "Profit & loss", short: "P&L", icon: "overview" },
  { id: "payables", label: "Accounts payable", short: "Payables", icon: "receipt" },
  { id: "tax", label: "Tax & VAT", short: "Tax", icon: "percent" },
  { id: "cash", label: "Cash & reconciliation", short: "Cash", icon: "wallet" },
];
export const VIEW_IDS: readonly ViewId[] = NAV.map((n) => n.id);

export function renderShell(): void {
  const app = $("#app");
  if (!app) return;
  app.innerHTML = `
    <aside class="sidebar" aria-label="${t("Main navigation")}">
      <div class="brand"><span class="brand-mark" aria-hidden="true">BA</span><span><strong>Bistro Addis</strong><small>${t("Finance & accounting")}</small></span></div>
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

/** Live mode: real account sign-in (username + password). */
export function renderSignIn(message: string, busy: boolean, username: string): string {
  return `
    <div class="signin">
      <div class="signin-card card">
        <div class="brand"><span class="brand-mark" aria-hidden="true">BA</span><span><strong>Bistro Addis</strong><small>${t("Finance & accounting")}</small></span></div>
        <h1>${t("Sign in")}</h1>
        <p class="meta">${t("Every bill, payment, filing and reconciliation is stamped with the person signed in.")}</p>
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

export function renderTopbar(): void {
  const bar = $("#topbar");
  if (!bar) return;
  const u = user();
  bar.innerHTML = `
    <span class="top-brand" aria-hidden="true"><span class="brand-mark">BA</span></span>
    <div class="user-wrap">
      <button type="button" class="user-badge" data-action="user-menu" aria-expanded="${state.userMenu}" aria-controls="userMenu">
        ${avatar(u.id)}
        <span class="who"><small>${t("Logged in as:")}</small><strong>${esc(u.name)} <span class="role-paren">(${esc(tk(`user.${u.id}`))})</span></strong></span>
        <span class="staff-id">${esc(u.id)}</span>
      </button>
      <div class="user-menu" id="userMenu" ${state.userMenu ? "" : "hidden"}>
        ${isLive ? `<button type="button" data-action="sign-out">${icon("arrow")} ${t("Sign out")}</button>` : `<p class="meta">${t("Switch user")}</p>`}
        ${isLive ? "" : USERS.filter((x) => x.id !== u.id).map((x) => `<button type="button" data-action="switch-user" data-value="${x.id}">${avatar(x.id, "xs")}${esc(x.name)} <small>(${esc(tk(`user.${x.id}`))})</small></button>`).join("")}
      </div>
    </div>
    <span class="branch-tag">${icon("store")} ${isLive ? esc(live.branchName) : t("Bole Branch")}</span>
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
  const overdue = db.bills.filter((b) => billStatus(b) === "OVERDUE").length;
  const pending = db.recon.filter((r) => r.status === "PENDING").length;
  const lastMonth = monthKey(addDays(`${monthKey(today())}-01`, -1));
  const taxOpen = (["VAT", "WHT"] as const).filter((k) => filing(lastMonth, k).status === "OPEN").length;
  const counts: Partial<Record<ViewId, [number, string]>> = {
    payables: [overdue, t("{n} overdue", { n: overdue })],
    tax: [taxOpen, t("{n} returns to file", { n: taxOpen })],
    cash: [pending, t("{n} days to reconcile", { n: pending })],
  };
  const link = (n: (typeof NAV)[number], cls: string, short: boolean): string => {
    const c = counts[n.id];
    return `<a href="#${n.id}" class="${cls}" ${state.view === n.id ? 'aria-current="page"' : ""}>${icon(n.icon)}<span>${t(short ? n.short : n.label)}</span>${
      c && c[0] ? `<span class="count" aria-label="${esc(c[1])}">${c[0]}</span>` : ""}</a>`;
  };
  if (side) side.innerHTML = NAV.map((n) => link(n, "nav-link", false)).join("");
  if (bottom) { bottom.style.setProperty("--tabs", String(NAV.length)); bottom.innerHTML = NAV.map((n) => link(n, "", true)).join(""); }
}
