/* Branch directory and the master price book. Admins can look at one
   branch or all of them (header switch), edit a price for one branch,
   or apply a master price change to every branch at once. */

import { t, tk } from "../i18n";
import { fmtDay, money } from "../format";
import { branchName, can, db, priceAt, state, userName } from "../store";
import { esc, icon } from "../ui/dom";
import { empty, pill } from "../ui/shared";
import { openModal } from "../ui/modal-bus";
import { rerender, type ActionMap } from "../ui/app";
import { renderTopbar } from "../ui/shell";

function directory(): string {
  return `<div class="branch-grid">${db.branches.map((b) => {
    const staff = db.users.filter((u) => u.assignedBranchId === b.id && u.isActive).length;
    const sel = state.scope === b.id;
    return `<article class="branch-card ${sel ? "selected" : ""} ${b.isActive ? "" : "closed"}">
      <div class="bc-top"><span class="code mono">${esc(b.code)}</span>${b.isActive ? pill("good", t("Open")) : pill("muted", t("Closed"))}</div>
      <h3>${esc(b.name)}</h3>
      <p class="meta">${esc(b.address)}</p>
      <dl class="mini-dl">
        <div><dt>${t("Manager")}</dt><dd>${esc(userName(b.managerId))}</dd></div>
        <div><dt>${t("Phone")}</dt><dd class="mono">${esc(b.phone)}</dd></div>
        <div><dt>${t("Active staff")}</dt><dd>${staff}</dd></div>
        <div><dt>${t("Opened")}</dt><dd>${esc(fmtDay(b.openedOn))}</dd></div>
      </dl>
      <div class="bc-actions">
        <button type="button" class="btn small ${sel ? "" : "ghost"}" data-action="scope" data-value="${sel ? "ALL" : b.id}" aria-pressed="${sel}">${sel ? `${icon("check")} ${t("Viewing")}` : t("View this branch")}</button>
        <button type="button" class="btn small ghost" data-action="edit-branch" data-value="${b.id}">${icon("edit")} ${t("Edit")}</button>
      </div>
    </article>`;
  }).join("")}</div>`;
}

function priceBook(): string {
  const cols = state.scope === "ALL" ? db.branches.filter((b) => b.isActive) : db.branches.filter((b) => b.id === state.scope);
  const editable = can("canEditPrices");
  if (!db.prices.length) return empty(t("No menu items"));
  return `<div class="table-wrap"><table class="data prices">
    <caption class="sr">${t("Master price book")}</caption>
    <thead><tr><th scope="col">${t("Item")}</th><th scope="col" class="num">${t("Base price")}</th>
      ${cols.map((b) => `<th scope="col" class="num">${esc(b.name)}</th>`).join("")}<th scope="col"><span class="sr">${t("Actions")}</span></th></tr></thead>
    <tbody>${db.prices.map((p) => `<tr>
      <th scope="row">${esc(tk(`menu.${p.id}`))}<small>${p.category === "FOOD" ? t("Food") : t("Drink")}</small></th>
      <td class="num">${money(p.basePrice, 0)}</td>
      ${cols.map((b) => { const own = b.id in p.overrides; return `<td class="num ${own ? "own" : "muted"}">${money(priceAt(p, b.id), 0)}${own ? `<small>${t("own price")}</small>` : ""}</td>`; }).join("")}
      <td>${editable ? `<button type="button" class="btn small ghost" data-action="edit-price" data-value="${p.id}">${icon("edit")} ${t("Change")}</button>` : ""}</td>
    </tr>`).join("")}</tbody></table></div>`;
}

export function renderBranches(): string {
  const scopeLabel = state.scope === "ALL" ? t("All branches") : branchName(state.scope);
  return `
    <div class="page-head"><div><h1 tabindex="-1">${t("Branches & prices")}</h1>
      <p>${t("Branch locations and the menu price book. Branches use the base price unless they have their own.")}</p></div>
      <div class="head-controls"><button type="button" class="btn primary" data-action="add-branch">${icon("plus")} ${t("Add branch")}</button></div></div>
    <section aria-labelledby="dirTitle" class="block">
      <h2 id="dirTitle" class="section-title">${t("Branch directory")} <span class="meta">${t("{n} branches", { n: db.branches.length })}</span></h2>
      ${directory()}
    </section>
    <section class="card" aria-labelledby="pbTitle">
      <div class="card-head"><div><h2 id="pbTitle">${t("Master price book")}</h2><p>${t("Showing: {s}", { s: esc(scopeLabel) })}</p></div>
        ${can("canEditPrices") ? `<button type="button" class="btn" data-action="bulk-price">${icon("percent")} ${t("Master price update")}</button>` : ""}</div>
      ${priceBook()}
    </section>`;
}

export const branchActions: ActionMap = {
  scope: (el) => {
    const v = el.dataset.value ?? "ALL";
    if (v !== "ALL" && !db.branches.some((b) => b.id === v)) return;
    state.scope = v;
    renderTopbar();
    // keep focus on the same card's button (its value flips between the branch id and "ALL")
    const cardId = el.parentElement?.querySelector<HTMLElement>('[data-action="edit-branch"]')?.dataset.value ?? "";
    rerender(`.branch-card [data-action="scope"][data-value="${v === "ALL" ? cardId : "ALL"}"]`);
  },
  "add-branch": (el) => openModal({ kind: "branch", id: null }, el),
  "edit-branch": (el) => openModal({ kind: "branch", id: el.dataset.value ?? null }, el),
  "edit-price": (el) => openModal({ kind: "price", id: el.dataset.value ?? "" }, el),
  "bulk-price": (el) => openModal({ kind: "bulk" }, el),
};
