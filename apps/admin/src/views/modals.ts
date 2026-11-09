/* Dialogs: add/edit branch, add/edit user, change one price, master
   price update. Focus is trapped and returned; Escape closes. Each save
   is logged and can be undone from the toast. */

import type { Branch, FieldErrors, UserAccount, UserRole } from "../types";
import { isLive } from "../api";
import { t, tk } from "../i18n";
import { money, parseAmount, plain } from "../format";
import { ROLE_APPS, ROLE_IDS, isRole } from "../catalog";
import { activeAdmins, branchById, branchName, bulkPrice, db, priceAt, saveBranch, saveUser, setPrice, state, user } from "../store";
import { $, $$, esc, icon } from "../ui/dom";
import { clearErrors, errText, invalid, setPressed, showErrors } from "../ui/shared";
import { registerModalOpener } from "../ui/modal-bus";
import { toast } from "../ui/toast";
import { rerender, type ActionMap } from "../ui/app";
import { renderNav, renderTopbar } from "../ui/shell";
import type { Modal } from "../store";

let opener: HTMLElement | null = null;

type BranchDraft = Omit<Branch, "id" | "openedOn">;
let bd: BranchDraft = { name: "", code: "", address: "", phone: "", managerId: "", isActive: true };
type UserDraft = Omit<UserAccount, "id" | "lastLoginAt">;
let ud: UserDraft = { fullName: "", username: "", role: "SALES_STAFF", assignedBranchId: "", isActive: true, phone: "" };
/** Live mode only: password for a new account, or a new one for an existing account (empty = keep). */
let pw = "";
let pd = { price: "", scope: "ALL" };
let bk = { percent: "", category: "ALL" as "ALL" | "FOOD" | "DRINK" };

export function openModal(m: Exclude<Modal, null>, from: HTMLElement): void {
  opener = from;
  state.modal = m;
  state.errors = {};
  if (m.kind === "branch") {
    const b = m.id ? branchById(m.id) : undefined;
    bd = b ? { name: b.name, code: b.code, address: b.address, phone: b.phone, managerId: b.managerId, isActive: b.isActive } : { name: "", code: "", address: "", phone: "", managerId: "", isActive: true };
  } else if (m.kind === "user") {
    pw = "";
    const u = m.id ? db.users.find((x) => x.id === m.id) : undefined;
    ud = u ? { fullName: u.fullName, username: u.username, role: u.role, assignedBranchId: u.assignedBranchId, isActive: u.isActive, phone: u.phone }
      : { fullName: "", username: "", role: "SALES_STAFF", assignedBranchId: state.scope === "ALL" ? db.branches[0].id : state.scope, isActive: true, phone: "" };
  } else if (m.kind === "price") {
    const p = db.prices.find((x) => x.id === m.id);
    pd = { scope: state.scope, price: p ? plain(priceAt(p, state.scope === "ALL" ? "" : state.scope)) : "" };
  } else bk = { percent: "", category: "ALL" };
  renderModal();
}
registerModalOpener(openModal);

export function closeModal(): void {
  state.modal = null;
  state.errors = {};
  const root = $("#modalRoot");
  if (root) root.innerHTML = "";
  document.body.classList.remove("modal-open");
  if (opener && document.contains(opener)) opener.focus();
  opener = null;
}

const foot = (submit: string): string => `<div class="modal-foot">
  <small class="stamp">${icon("user")} ${t("Will be logged by {name} ({id})", { name: esc(user().fullName), id: esc(user().id) })}</small>
  <div class="form-actions"><button type="button" class="btn" data-action="modal-close">${t("Cancel")}</button>
    <button type="submit" class="btn primary">${icon("check")} ${submit}</button></div></div>`;

const input = (id: string, bind: string, label: string, value: string, key: string, extra = "", mono = false): string => `<div class="field"><label for="${id}">${label}</label>
  <input id="${id}" class="input${mono ? " mono" : ""}" autocomplete="off" value="${esc(value)}" data-bind="${bind}" ${invalid(state.errors, key)} ${extra}>${errText(state.errors, key)}</div>`;

/* ---------- branch ---------- */

function branchForm(id: string | null): string {
  const managers = db.users.filter((u) => u.isActive && (u.role === "BRANCH_MANAGER" || u.role === "ADMIN"));
  return `<form id="branchForm" class="form" novalidate>
    <div class="row">
      ${input("bName", "branch.name", t("Branch name"), bd.name, "name", `placeholder="${t("e.g. Sarbet Branch")}"`)}
      ${input("bCode", "branch.code", t("Short code"), bd.code, "code", 'maxlength="4" placeholder="SAR"', true)}
    </div>
    ${input("bAddr", "branch.address", t("Address"), bd.address, "address")}
    <div class="row">
      ${input("bPhone", "branch.phone", t("Phone number"), bd.phone, "phone", 'inputmode="tel" placeholder="+251 911 000 000"')}
      <div class="field"><label for="bMgr">${t("Manager")}</label><select id="bMgr" class="input" data-bind="branch.managerId" ${invalid(state.errors, "managerId")}>
        <option value="">${t("Choose…")}</option>${managers.map((u) => `<option value="${u.id}" ${bd.managerId === u.id ? "selected" : ""}>${esc(u.fullName)} (${esc(tk(`role.${u.role}`))})</option>`).join("")}</select>${errText(state.errors, "managerId")}</div>
    </div>
    ${id ? `<label class="check-line"><input type="checkbox" data-bind="branch.isActive" ${bd.isActive ? "checked" : ""}> ${t("Branch is open")}</label>` : ""}
    ${foot(id ? t("Save branch") : t("Add branch"))}
  </form>`;
}

function submitBranch(id: string | null): void {
  const e: FieldErrors = {};
  const code = bd.code.trim().toUpperCase();
  if (bd.name.trim().length < 3) e.name = t("Enter the branch name.");
  else if (db.branches.some((b) => b.id !== id && b.name.toLowerCase() === bd.name.trim().toLowerCase())) e.name = t("A branch with this name already exists.");
  if (!/^[A-Z]{2,4}$/.test(code)) e.code = t("Use 2–4 letters.");
  else if (db.branches.some((b) => b.id !== id && b.code === code)) e.code = t("Code already used.");
  if (bd.address.trim().length < 5) e.address = t("Enter the address.");
  if (!/^(\+251|0)\s?[79]\d{2}\s?\d{3}\s?\d{3}$/.test(bd.phone.trim())) e.phone = t("Use an Ethiopian number, e.g. +251 911 234 567.");
  if (!bd.managerId) e.managerId = t("Choose a manager.");
  if (showErrors(e, ["name", "code", "address", "phone", "managerId"])) return;
  const { branch, undo } = saveBranch({ ...bd, id, name: bd.name.trim(), code, address: bd.address.trim(), phone: bd.phone.trim() });
  closeModal();
  rerender();
  renderTopbar();
  toast(id ? t("{name} updated", { name: branch.name }) : t("{name} added", { name: branch.name }), () => { undo(); rerender(); renderTopbar(); });
}

/* ---------- user ---------- */

function userForm(id: string | null): string {
  return `<form id="userForm" class="form" novalidate>
    <div class="row">
      ${input("uName", "user.fullName", t("Full name"), ud.fullName, "fullName")}
      ${input("uUser", "user.username", t("Username"), ud.username, "username", 'autocapitalize="off" placeholder="abebe.k"', true)}
    </div>
    <div class="field"><span class="label" id="roleLbl">${t("Role")}</span>
      <div class="role-grid" role="group" aria-labelledby="roleLbl">${ROLE_IDS.map((r) => `<button type="button" class="pay-opt" data-action="user-role" data-value="${r}" aria-pressed="${ud.role === r}"><strong>${esc(tk(`role.${r}`))}</strong><small>${esc(t(ROLE_APPS[r]))}</small></button>`).join("")}</div>
      ${errText(state.errors, "role")}</div>
    <div class="row">
      <div class="field"><label for="uBranch">${t("Branch")}</label><select id="uBranch" class="input" data-bind="user.assignedBranchId">${db.branches.map((b) =>
        `<option value="${b.id}" ${ud.assignedBranchId === b.id ? "selected" : ""}>${esc(b.name)}</option>`).join("")}</select></div>
      ${input("uPhone", "user.phone", t("Phone number"), ud.phone, "phone", 'inputmode="tel" placeholder="+251 911 000 000"')}
    </div>
    ${isLive ? `<div class="field"><label for="uPass">${id ? t("New password (leave empty to keep the current one)") : t("Password")}</label>
      <input id="uPass" class="input" type="password" autocomplete="new-password" value="${esc(pw)}" data-bind="user.password" ${invalid(state.errors, "password")}>
      ${errText(state.errors, "password")}<small class="hint">${t("At least 8 characters. Tell the person in private; they can change it after signing in.")}</small></div>` : ""}
    ${id ? `<label class="check-line"><input type="checkbox" data-bind="user.isActive" ${ud.isActive ? "checked" : ""}> ${t("Account can sign in")}</label>` : isLive ? "" : `<p class="hint">${t("A temporary password is sent to the phone number by SMS.")}</p>`}
    ${foot(id ? t("Save user") : t("Create user"))}
  </form>`;
}

function submitUser(id: string | null): void {
  const e: FieldErrors = {};
  const username = ud.username.trim().toLowerCase();
  const was = id ? db.users.find((u) => u.id === id) : undefined;
  if (ud.fullName.trim().split(/\s+/).length < 2) e.fullName = t("Enter first and last name.");
  if (!/^[a-z][a-z0-9._]{2,19}$/.test(username)) e.username = t("3–20 letters, numbers, dots or underscores.");
  else if (db.users.some((u) => u.id !== id && u.username === username)) e.username = t("Username already taken.");
  if (!/^(\+251|0)\s?[79]\d{2}\s?\d{3}\s?\d{3}$/.test(ud.phone.trim())) e.phone = t("Use an Ethiopian number, e.g. +251 911 234 567.");
  if (was && was.role === "ADMIN" && was.isActive && (ud.role !== "ADMIN" || !ud.isActive) && activeAdmins().length <= 1) e.role = t("Keep at least one active Admin.");
  if (was && was.id === state.userId && (ud.role !== "ADMIN" || !ud.isActive)) e.role = t("You can't remove your own Admin access.");
  if (isLive && ((!id && pw.length < 8) || (id && pw && pw.length < 8))) e.password = t("At least 8 characters.");
  if (showErrors(e, ["fullName", "username", "role", "phone", "password"])) return;
  const { account, undo } = saveUser({ ...ud, id, fullName: ud.fullName.trim(), username, phone: ud.phone.trim() }, pw);
  pw = "";
  closeModal();
  rerender();
  renderNav();
  toast(id ? t("{name} updated", { name: account.fullName }) : t("{name} added as {role}", { name: account.fullName, role: tk(`role.${account.role}`) }), () => { undo(); rerender(); renderNav(); });
}

/* ---------- prices ---------- */

function priceForm(id: string): string {
  const p = db.prices.find((x) => x.id === id);
  if (!p) return "";
  const branches = db.branches.filter((b) => b.isActive);
  return `<form id="priceForm" class="form" novalidate>
    <p class="modal-summary"><strong>${esc(tk(`menu.${id}`))}</strong><br>${t("Base price")} ${money(p.basePrice, 0)}${Object.keys(p.overrides).length ? ` · ${Object.entries(p.overrides).map(([b, v]) => `${esc(branchName(b))} ${money(v, 0)}`).join(" · ")}` : ""}</p>
    <div class="field"><span class="label" id="psLbl">${t("Apply to")}</span>
      <div class="seg wrap" role="group" aria-labelledby="psLbl">
        <button type="button" data-action="price-scope" data-value="ALL" aria-pressed="${pd.scope === "ALL"}">${t("All branches")}</button>
        ${branches.map((b) => `<button type="button" data-action="price-scope" data-value="${b.id}" aria-pressed="${pd.scope === b.id}">${esc(b.name)}</button>`).join("")}</div>
      <p class="hint" id="psHint">${pd.scope === "ALL" ? t("Sets the base price and removes branch-only prices.") : t("Only this branch. Other branches keep their price.")}</p></div>
    <div class="field"><label for="pPrice">${t("New price")}</label>
      <div class="affix"><span>${esc(db.profile.currencySymbol)}</span><input id="pPrice" class="input num-in" inputmode="decimal" value="${esc(pd.price)}" data-bind="price.price" ${invalid(state.errors, "price")}></div>${errText(state.errors, "price")}</div>
    ${foot(t("Save price"))}
  </form>`;
}

function submitPrice(id: string): void {
  const v = parseAmount(pd.price);
  if (!(v >= 5 && v <= 100000)) { showErrors({ price: t("Enter a price between 5 and 100,000.") }, ["price"]); return; }
  const undo = setPrice(id, Math.round(v * 100) / 100, pd.scope);
  closeModal();
  rerender(`[data-action="edit-price"][data-value="${id}"]`);
  toast(t("{item}: {x} in {s}", { item: tk(`menu.${id}`), x: money(v, 0), s: pd.scope === "ALL" ? t("all branches") : branchName(pd.scope) }), () => { undo(); rerender(); });
}

function bulkForm(): string {
  const pct = parseAmount(bk.percent);
  const sample = db.prices.find((p) => bk.category === "ALL" || p.category === bk.category);
  const adj = (n: number): number => Math.max(5, Math.round((n * (1 + (pct || 0) / 100)) / 5) * 5);
  return `<form id="bulkForm" class="form" novalidate>
    <p class="modal-summary">${t("Changes every price in every branch by the same percentage, rounded to the nearest 5 birr. Branch-only prices change too.")}</p>
    <div class="field"><span class="label" id="bcLbl">${t("Items")}</span>
      <div class="seg lg" role="group" aria-labelledby="bcLbl">${(["ALL", "FOOD", "DRINK"] as const).map((c) => `<button type="button" data-action="bulk-cat" data-value="${c}" aria-pressed="${bk.category === c}">${c === "ALL" ? t("All items") : c === "FOOD" ? t("Food") : t("Drinks")}</button>`).join("")}</div></div>
    <div class="field"><label for="bkPct">${t("Change by (%)")}</label>
      <div class="affix"><span>%</span><input id="bkPct" class="input num-in" inputmode="decimal" placeholder="10 or -5" value="${esc(bk.percent)}" data-bind="bulk.percent" ${invalid(state.errors, "percent")}></div>${errText(state.errors, "percent")}</div>
    <p class="calc" id="bkEx">${sample && pct ? `${esc(tk(`menu.${sample.id}`))}: ${money(sample.basePrice, 0)} → <strong>${money(adj(sample.basePrice), 0)}</strong>` : `<span class="meta">${t("Enter a percentage to see an example.")}</span>`}</p>
    ${foot(t("Apply to all branches"))}
  </form>`;
}

function submitBulk(): void {
  const pct = parseAmount(bk.percent);
  if (!Number.isFinite(pct) || pct === 0 || pct < -50 || pct > 100) { showErrors({ percent: t("Enter a change between -50% and +100%.") }, ["percent"]); return; }
  const { count, undo } = bulkPrice(pct, bk.category);
  closeModal();
  rerender();
  toast(t("{n} prices changed by {p}% in all branches", { n: count, p: `${pct > 0 ? "+" : ""}${pct}` }), () => { undo(); rerender(); });
}

/* ---------- frame & wiring ---------- */

export function renderModal(): void {
  const root = $("#modalRoot");
  const m = state.modal;
  if (!root) return;
  if (!m) { root.innerHTML = ""; return; }
  const title = m.kind === "branch" ? (m.id ? t("Edit branch") : t("Add branch"))
    : m.kind === "user" ? (m.id ? t("Edit user") : t("Add user"))
    : m.kind === "price" ? t("Change price") : t("Master price update");
  const body = m.kind === "branch" ? branchForm(m.id) : m.kind === "user" ? userForm(m.id) : m.kind === "price" ? priceForm(m.id) : bulkForm();
  root.innerHTML = `<div class="modal-backdrop" data-action="modal-close"></div>
    <div class="modal" role="dialog" aria-modal="true" aria-labelledby="modalTitle">
      <div class="modal-head"><h2 id="modalTitle">${title}</h2><button type="button" class="btn icon-btn ghost" data-action="modal-close" aria-label="${t("Close")}">${icon("x")}</button></div>
      ${body}
    </div>`;
  document.body.classList.add("modal-open");
  $<HTMLElement>(m.kind === "branch" ? "#bName" : m.kind === "user" ? "#uName" : m.kind === "price" ? "#pPrice" : "#bkPct")?.focus();
}

export function onModalInput(scope: string, key: string, el: HTMLInputElement): void {
  const v = el.value;
  if (scope === "branch") {
    if (key === "isActive") { bd.isActive = el.checked; return; }
    if (key === "name" || key === "code" || key === "address" || key === "phone" || key === "managerId") { bd[key] = v; clearErrors([key]); }
  } else if (scope === "user") {
    if (key === "isActive") { ud.isActive = el.checked; clearErrors(["role"]); return; }
    if (key === "password") { pw = el.value; clearErrors(["password"]); return; }
    if (key === "fullName" || key === "username" || key === "phone" || key === "assignedBranchId") { ud[key] = v; clearErrors([key]); }
  } else if (scope === "price") { pd.price = v; clearErrors(["price"]); }
  else if (scope === "bulk") { bk.percent = v; clearErrors(["percent"]); const ex = $("#bkEx"); if (ex) { const tmp = document.createElement("div"); tmp.innerHTML = bulkForm(); ex.innerHTML = tmp.querySelector("#bkEx")?.innerHTML ?? ""; } }
}

export function submitModal(formId: string): void {
  const m = state.modal;
  if (!m) return;
  if (formId === "branchForm" && m.kind === "branch") submitBranch(m.id);
  else if (formId === "userForm" && m.kind === "user") submitUser(m.id);
  else if (formId === "priceForm" && m.kind === "price") submitPrice(m.id);
  else if (formId === "bulkForm" && m.kind === "bulk") submitBulk();
}

export const modalActions: ActionMap = {
  "modal-close": () => closeModal(),
  "user-role": (el) => { const v = el.dataset.value; if (isRole(v)) { ud.role = v as UserRole; setPressed(el); clearErrors(["role"]); } },
  "price-scope": (el) => {
    const v = el.dataset.value ?? "ALL";
    const m = state.modal;
    pd.scope = v;
    setPressed(el);
    const p = m && m.kind === "price" ? db.prices.find((x) => x.id === m.id) : undefined;
    if (p) { pd.price = plain(v === "ALL" ? p.basePrice : priceAt(p, v)); const inp = $<HTMLInputElement>("#pPrice"); if (inp) inp.value = pd.price; }
    const h = $("#psHint"); if (h) h.textContent = v === "ALL" ? t("Sets the base price and removes branch-only prices.") : t("Only this branch. Other branches keep their price.");
  },
  "bulk-cat": (el) => { const v = el.dataset.value; if (v === "ALL" || v === "FOOD" || v === "DRINK") { bk.category = v; setPressed(el); onModalInput("bulk", "percent", { value: bk.percent } as HTMLInputElement); } },
};

export function modalKeydown(e: KeyboardEvent): void {
  if (!state.modal) return;
  if (e.key === "Escape") { e.preventDefault(); closeModal(); return; }
  if (e.key !== "Tab") return;
  const box = $(".modal");
  if (!box) return;
  const items = $$<HTMLElement>("a[href], button:not([disabled]), input, select, textarea", box).filter((x) => x.offsetParent !== null);
  if (!items.length) return;
  const first = items[0], last = items[items.length - 1];
  if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
}
