/* =========================================================
   Transaction details — opened with the "…" button on a row of
   the Transactions table. A side drawer on wide screens, a bottom
   sheet on phones. Live mode loads everything from the server:
   line items, VAT, payment, status (who decided, when, why), who
   created it and, for a sale, what the kitchen really used.
   ========================================================= */

import type { Transaction } from "./data";
import { getTransaction, isLive, type TxDetail } from "./api";

type T = (s: string, vars?: Record<string, string | number>) => string;

const ESC: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
const esc = (v: unknown): string => String(v ?? "").replace(/[&<>"']/g, (c) => ESC[c] ?? c);

let returnFocus: HTMLElement | null = null;

export function closeTxDetail(): void {
  const el = document.getElementById("txDetail");
  if (!el) return;
  el.remove();
  document.body.classList.remove("tx-open");
  returnFocus?.focus?.();
  returnFocus = null;
}

function shell(t: T, body: string): string {
  return `<div class="txd-backdrop" data-txd-close></div>
    <aside class="txd" role="dialog" aria-modal="true" aria-labelledby="txdTitle">
      <header class="txd-head">
        <h2 id="txdTitle">${esc(t("Transaction details"))}</h2>
        <button type="button" class="icon-btn txd-x" data-txd-close aria-label="${esc(t("Close"))}">×</button>
      </header>
      <div class="txd-body">${body}</div>
    </aside>`;
}

const row = (label: string, value: string): string =>
  value ? `<div class="txd-row"><dt>${esc(label)}</dt><dd>${value}</dd></div>` : "";

function when(iso: string | null | undefined, lang: string): string {
  if (!iso) return "";
  const d = new Date(iso.length <= 10 ? `${iso}T12:00:00` : iso);
  if (Number.isNaN(d.getTime())) return esc(iso);
  const date = d.toLocaleDateString(lang === "am" ? "am-ET" : "en-GB", { day: "2-digit", month: "short", year: "numeric" });
  return iso.length <= 10 ? esc(date) : esc(`${date} · ${d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}`);
}

const STATUS_CLASS: Record<string, string> = {
  APPROVED: "success", PAID: "success", RECORDED: "success", PENDING: "pending", OPEN: "pending", DRAFT: "pending",
  FLAGGED: "failed", REJECTED: "failed", VOID: "failed", VOIDED: "failed", OVERDUE: "failed",
};

function render(d: TxDetail, t: T, money: (n: number, digits?: number) => string, lang: string): string {
  const qty = (n: number): string => String(Math.round(n * 1000) / 1000);
  const st = d.status;
  const lines = d.lines.map((l) => `<tr>
      <th scope="row">${esc(l.item)}${l.note ? `<small>${esc(l.note)}</small>` : ""}</th>
      <td class="mono">${esc(qty(l.quantity))}${l.unit ? ` ${esc(l.unit)}` : ""}</td>
      <td class="mono">${money(l.unitPrice, 2)}</td>
      <td class="mono">${money(l.total, 2)}</td></tr>`).join("");
  const pays = d.payments.map((p) => `<li><span>${esc(t(p.method))}${p.reference ? ` <small class="mono">${esc(p.reference)}</small>` : ""}</span>
      <span class="mono">${money(p.amount, 2)}</span></li>`).join("");
  const ing = d.ingredients?.length
    ? `<section class="txd-sec"><h3>${esc(t("Ingredients used (kitchen)"))}</h3>
        <table class="txd-table"><thead><tr><th>${esc(t("Item"))}</th><th>${esc(t("Expected"))}</th><th>${esc(t("Actual"))}</th></tr></thead>
        <tbody>${d.ingredients.map((x) => {
          const diff = x.actual - x.expected;
          return `<tr><th scope="row">${esc(x.item)}<small>${esc(x.dish)}</small></th><td class="mono">${esc(qty(x.expected))} ${esc(x.unit)}</td>
            <td class="mono ${Math.abs(diff) > 1e-9 && x.expected ? (diff > 0 ? "txd-over" : "txd-under") : ""}">${esc(qty(x.actual))} ${esc(x.unit)}</td></tr>`;
        }).join("")}</tbody></table></section>`
    : "";
  return `
    <div class="txd-top">
      <span class="tx-id">${esc(d.number)}</span>
      <span class="status ${STATUS_CLASS[st.code] ?? "pending"}">${esc(t(st.label))}</span>
    </div>
    <p class="txd-total mono">${money(d.total, 2)}</p>
    <dl class="txd-list">
      ${row(t("Type"), esc(t(d.type)))}
      ${row(t("Date"), when(d.at, lang))}
      ${row(t("Branch"), esc(t(d.branch)))}
      ${row(t("Where"), esc(d.where ? t(d.where) : ""))}
      ${row(t("Vendor"), esc(d.vendor ?? ""))}
      ${row(t("Receipt no."), esc(d.receiptNo ?? ""))}
      ${row(t("Due"), when(d.dueDate, lang))}
      ${row(t("Created by"), d.createdBy ? `${esc(d.createdBy.name)} <small>${esc(t(d.createdBy.role))}</small>` : "")}
      ${row(t("Waiter"), d.waiter ? esc(d.waiter.name) : "")}
      ${row(t("Decided by"), st.decidedBy ? `${esc(st.decidedBy.name)} <small>${when(st.decidedAt, lang)}</small>` : "")}
      ${row(t("Reason"), esc(st.reason ?? ""))}
      ${row(t("Note"), esc(d.note ?? ""))}
    </dl>
    <section class="txd-sec"><h3>${esc(t("Items"))}</h3>
      <table class="txd-table"><thead><tr><th>${esc(t("Item"))}</th><th>${esc(t("Qty"))}</th><th>${esc(t("Unit price"))}</th><th>${esc(t("Total"))}</th></tr></thead>
      <tbody>${lines}</tbody>
      <tfoot>
        <tr><th scope="row" colspan="3">${esc(t("VAT (included)"))}</th><td class="mono">${money(d.vat, 2)}</td></tr>
        <tr><th scope="row" colspan="3">${esc(t("Grand total"))}</th><td class="mono strong">${money(d.total, 2)}</td></tr>
      </tfoot></table>
    </section>
    ${pays ? `<section class="txd-sec"><h3>${esc(t("Payment"))}</h3><ul class="txd-pays">${pays}</ul></section>` : ""}
    ${ing}`;
}

/** Open the drawer for a row of the Transactions table. */
export function openTxDetail(x: Transaction, t: T, money: (n: number, digits?: number) => string, lang: string): void {
  closeTxDetail();
  returnFocus = document.activeElement as HTMLElement | null;
  const box = document.createElement("div");
  box.id = "txDetail";
  box.className = "txd-wrap";
  document.body.appendChild(box);
  document.body.classList.add("tx-open");
  const draw = (body: string): void => {
    box.innerHTML = shell(t, body);
    box.querySelector<HTMLElement>(".txd-x")?.focus();
  };
  box.addEventListener("click", (e) => {
    const el = e.target as HTMLElement;
    if (el.closest("[data-txd-close]")) closeTxDetail();
    else if (el.closest("[data-txd-retry]")) { draw(`<p class="txd-loading" role="status">${esc(t("Loading…"))}</p>`); load(); }
  });
  if (!isLive || !x.ref) {
    // demo data: what the row itself knows
    draw(`<div class="txd-top"><span class="tx-id">${esc(x.id)}</span><span class="status ${x.status.toLowerCase()}">${esc(t(x.status))}</span></div>
      <p class="txd-total mono">${x.amount >= 0 ? "+" : "−"}${money(Math.abs(x.amount), 2)}</p>
      <dl class="txd-list">${row(t("Description"), esc(t(x.description)))}${row(t("Category"), esc(t(x.category)))}</dl>
      <p class="txd-note">${esc(t("Full details (items, VAT, who approved it) appear when the app is connected to the SEER server."))}</p>`);
    return;
  }
  draw(`<p class="txd-loading" role="status">${esc(t("Loading…"))}</p>`);
  const ref = x.ref;
  function load(): void {
    getTransaction(ref.kind, ref.id).then(
      (d) => { if (box.isConnected) draw(render(d, t, money, lang)); },
      () => {
        if (!box.isConnected) return;
        draw(`<p class="txd-error" role="alert">${esc(t("Couldn't load the details."))}</p>
          <button type="button" class="btn" data-txd-retry>${esc(t("Try again"))}</button>`);
      },
    );
  }
  load();
}

document.addEventListener("keydown", (e) => { if (e.key === "Escape" && document.getElementById("txDetail")) closeTxDetail(); });
