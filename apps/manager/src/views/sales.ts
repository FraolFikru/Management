/* Sales overview (pure sales — no stock purchases here):
   itemized performance table (Item, Category, Units Sold, Selling
   Price, Total Revenue) with sorting, category filter and search, and
   the local payment breakdown by shift. */

import type { MenuCategory } from "../types";
import { t, tk } from "../i18n";
import { money, normalize, num } from "../format";
import { MENU, MENU_CAT_IDS, isMenuCat } from "../catalog";
import { db, inPeriod, periodTotals, state } from "../store";
import { $, esc, icon } from "../ui/dom";
import { changePct, chip, compareLabel, empty, periodSeg, seg, shiftSeg } from "../ui/shared";
import { rerender, type ActionMap } from "../ui/app";
import { paymentPanel } from "./overview";

interface Row { id: string; name: string; category: MenuCategory; units: number; price: number; revenue: number }

function rows(): Row[] {
  const map = new Map<string, Row>();
  for (const m of MENU) map.set(m.id, { id: m.id, name: tk(m.nameKey), category: m.category, units: 0, price: m.price, revenue: 0 });
  for (const s of db.sales) {
    if (!inPeriod(s.timestamp) || (state.shift !== "ALL" && s.shift !== state.shift)) continue;
    const r = map.get(s.menuItemId);
    if (!r) continue;
    r.units += s.quantity;
    r.revenue += s.total;
  }
  const q = normalize(state.salesQuery);
  const { key, dir } = state.salesSort;
  return [...map.values()]
    .filter((r) => (state.salesCat === "ALL" || r.category === state.salesCat) && (!q || normalize(r.name).includes(q)))
    .map((r) => ({ ...r, price: r.units ? r.revenue / r.units : r.price }))
    .sort((a, b) => {
      const av = key === "name" ? a.name : key === "category" ? tk(`menucat.${a.category}`) : a[key];
      const bv = key === "name" ? b.name : key === "category" ? tk(`menucat.${b.category}`) : b[key];
      return (av < bv ? -1 : av > bv ? 1 : 0) * dir;
    });
}

function th(key: UiKey, label: string, numeric = false): string {
  const active = state.salesSort.key === key;
  const sortState = active ? (state.salesSort.dir === 1 ? "ascending" : "descending") : "none";
  return `<th scope="col" aria-sort="${sortState}" class="${numeric ? "num" : ""}">
    <button type="button" class="th-btn" data-action="sales-sort" data-value="${key}">${label}<span class="sort-ind" aria-hidden="true">${active ? (state.salesSort.dir === 1 ? "▲" : "▼") : ""}</span></button></th>`;
}
type UiKey = "name" | "category" | "units" | "price" | "revenue";

function table(): string {
  const list = rows();
  const units = list.reduce((s, r) => s + r.units, 0);
  const revenue = list.reduce((s, r) => s + r.revenue, 0);
  if (!list.length) return empty(t("No menu items match"));
  return `<div class="table-wrap"><table class="data">
    <caption class="sr">${t("Itemized sales performance")}</caption>
    <thead><tr>${th("name", t("Item Name"))}${th("category", t("Category"))}${th("units", t("Units Sold"), true)}${th("price", t("Selling Price"), true)}${th("revenue", t("Total Revenue"), true)}</tr></thead>
    <tbody>${list.map((r) => `<tr class="${r.units ? "" : "muted-row"}">
      <th scope="row">${esc(r.name)}</th><td>${esc(tk(`menucat.${r.category}`))}</td>
      <td class="num">${num(r.units)}</td><td class="num">${money(r.price, 0)}</td><td class="num strong">${money(r.revenue, 0)}</td></tr>`).join("")}</tbody>
    <tfoot><tr><th scope="row">${t("Total")}</th><td></td><td class="num">${num(units)}</td><td></td><td class="num strong">${money(revenue, 0)}</td></tr></tfoot>
  </table></div>`;
}

export function renderSales(): string {
  const { cur, prev } = periodTotals();
  const avg = cur.tickets ? cur.sales / cur.tickets : 0;
  const prevAvg = prev.tickets ? prev.sales / prev.tickets : 0;
  return `
    <div class="page-head"><div><h1>${t("Sales overview")}</h1><p>${t("Pure customer sales. Stock purchases are under Purchases (COGS).")}</p></div>
      <div class="head-controls">${periodSeg()}${shiftSeg()}</div></div>
    <div class="stat-row three">
      <div class="stat"><span>${t("Total sales")}</span><strong class="num">${money(cur.sales, 0)}</strong>${chip(changePct(cur.sales, prev.sales), true)}<small>${compareLabel(state.period)}</small></div>
      <div class="stat"><span>${t("Tickets")}</span><strong class="num">${num(cur.tickets)}</strong>${chip(changePct(cur.tickets, prev.tickets), true)}</div>
      <div class="stat"><span>${t("Average ticket")}</span><strong class="num">${money(avg, 0)}</strong>${chip(changePct(avg, prevAvg), true)}</div>
    </div>
    <div class="sales-layout">
      <section class="card" aria-labelledby="itemTitle">
        <div class="card-head"><div><h2 id="itemTitle">${t("Itemized sales performance")}</h2><p>${state.shift === "ALL" ? t("All shifts") : tk(`shift.${state.shift}`)}</p></div>
          <label class="search">${icon("search")}<span class="sr">${t("Search items")}</span>
            <input id="salesSearch" type="search" autocomplete="off" placeholder="${t("Search items")}" value="${esc(state.salesQuery)}" data-bind="sales.query"></label></div>
        ${seg("sales-cat", state.salesCat, [["ALL", t("All")], ...MENU_CAT_IDS.map((c) => [c, tk(`menucat.${c}`)] as const)], t("Category"), "small wrap")}
        <div id="salesTable">${table()}</div>
      </section>
      <section class="card" aria-labelledby="payTitle2">
        <div class="card-head"><div><h2 id="payTitle2">${t("Payment reconciliation")}</h2><p>${t("Cash, Telebirr and CBE Birr")}</p></div></div>
        ${paymentPanel(state.period, false)}
      </section>
    </div>`;
}

export function onSalesSearch(v: string): void {
  state.salesQuery = v;
  const box = $("#salesTable");
  if (box) box.innerHTML = table();
}

export const salesActions: ActionMap = {
  "sales-sort": (el) => {
    const k = el.dataset.value as UiKey | undefined;
    if (!k) return;
    state.salesSort = state.salesSort.key === k ? { key: k, dir: state.salesSort.dir === 1 ? -1 : 1 } : { key: k, dir: k === "name" || k === "category" ? 1 : -1 };
    const box = $("#salesTable");
    if (box) box.innerHTML = table();
    $<HTMLElement>(`[data-action="sales-sort"][data-value="${k}"]`)?.focus();
  },
  "sales-cat": (el) => {
    const v = el.dataset.value ?? "ALL";
    state.salesCat = v === "ALL" || isMenuCat(v) ? v : "ALL";
    rerender(`[data-action="sales-cat"][data-value="${state.salesCat}"]`);
  },
};
