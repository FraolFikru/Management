/* =========================================================
   Owner planning pages:
     Goals        — real figures against targets the owner can change
     Investments  — plans the owner is saving for (oven, second branch…)
     Reports      — six reports, built on the server, downloaded as CSV
   Live mode saves to the backend; the demo keeps changes in memory.
   ========================================================= */

import { icon } from "./icons";
import {
  addInvestment, deleteInvestment, getReport, isLive, resetGoal, setGoal, updateInvestment, type InvestmentInput,
} from "./api";
import { goals, investments, topDishes, type Goal, type GoalKey, type Investment, type InvestmentKind } from "./data";
import { getLiveSeries, loadLive } from "./live";

type T = (s: string, vars?: Record<string, string | number>) => string;
export interface PlanningDeps {
  t: T;
  money: (n: number, digits?: number) => string;
  fmtDate: (d: Date) => string;
  rerender: () => void;
}

let deps: PlanningDeps;
export const initPlanning = (d: PlanningDeps): void => { deps = d; };

const esc = (s: unknown): string =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string);
const num = (v: string): number => Number(String(v).replace(/[,\s]/g, ""));
const errText = (err: unknown): string => (err instanceof Error ? err.message : String(err));

/** Reload the dashboard data after a change, then redraw. */
async function refresh(): Promise<void> {
  if (isLive) {
    try { await loadLive(); } catch { /* keep what's shown */ }
  }
  deps.rerender();
}

/* ======================= Goals ======================= */

const goalUi = { editing: null as GoalKey | null, value: "", error: "", busy: false, notice: "" };

function goalValue(g: Goal, v: number): string {
  return g.unit === "ETB" ? deps.money(v) : `${v}${g.unit}`;
}

export function renderGoals(): string {
  const { t } = deps;
  return `
    <div class="help-intro">
      <h2>${t("Goals")}</h2>
      <p>${t("Real figures for this month against your targets. Change a target any time — the automatic one is used until you do.")}</p>
    </div>
    ${goalUi.notice ? `<p class="admin-notice" role="status">${icon("check")} ${esc(goalUi.notice)}</p>` : ""}
    <div class="page-grid single">
      ${goals.map((g) => {
        const ratio = g.lowerIsBetter ? (g.current ? g.target / g.current : 1) : g.current / g.target;
        const pct = Math.max(0, Math.min(100, Math.round(ratio * 100)));
        const due = g.deadline ? t("Due {x}", { x: deps.fmtDate(g.deadline) }) : t("Ongoing");
        const editing = g.key && goalUi.editing === g.key;
        const met = g.lowerIsBetter ? g.current <= g.target : g.current >= g.target;
        return `
        <div class="goal-card">
          <div class="goal-top">
            <strong>${t(g.title)}</strong>
            <span class="goal-due">${due}</span>
          </div>
          <div class="goal-value">${goalValue(g, g.current)}<small> / ${goalValue(g, g.target)}</small></div>
          <div class="progress-bar"><i style="width:${pct}%;background:${met || pct >= 90 ? "var(--revenue)" : "var(--muted)"}"></i></div>
          ${g.key ? editing ? `
            <form class="goal-edit" id="goalForm" data-goal="${g.key}" novalidate>
              <label class="signin-field"><span>${g.unit === "%" ? t("Target (% of revenue)") : t("Target (ETB)")}</span>
                <input id="goalInput" inputmode="decimal" autocomplete="off" value="${esc(goalUi.value)}"></label>
              <div class="goal-edit-actions">
                <button type="button" class="btn" data-goal-cancel>${t("Cancel")}</button>
                <button type="submit" class="btn btn-primary" ${goalUi.busy ? "disabled" : ""}>${goalUi.busy ? t("Saving…") : t("Save target")}</button>
              </div>
              <p class="field-error" role="alert">${esc(goalUi.error)}</p>
            </form>` : `
            <div class="goal-foot">
              <span class="muted-note">${g.custom ? t("Target set by you") : t("Automatic target")}</span>
              <span class="goal-foot-actions">
                ${g.custom ? `<button type="button" class="btn" data-goal-reset="${g.key}">${t("Use automatic")}</button>` : ""}
                <button type="button" class="btn" data-goal-edit="${g.key}">${icon("pencil")} ${t("Change target")}</button>
              </span>
            </div>` : ""}
        </div>`;
      }).join("")}
    </div>`;
}

async function saveGoal(key: GoalKey): Promise<void> {
  const { t } = deps;
  const v = num(goalUi.value);
  const g = goals.find((x) => x.key === key);
  if (!g) return;
  if (!(v > 0)) { goalUi.error = t("Enter a number above 0."); return deps.rerender(); }
  if (g.unit === "%" && v > 100) { goalUi.error = t("A percentage can't be above 100."); return deps.rerender(); }
  goalUi.busy = true; goalUi.error = ""; deps.rerender();
  try {
    if (isLive) await setGoal(key, v);
    else { g.target = v; g.custom = true; }
    goalUi.editing = null;
    goalUi.notice = t("Target saved.");
    await refresh();
  } catch (err) {
    goalUi.error = errText(err);
    deps.rerender();
  } finally {
    goalUi.busy = false;
  }
}

/* ======================= Investments ======================= */

const KINDS: InvestmentKind[] = ["EQUIPMENT", "EXPANSION", "RENOVATION", "VEHICLE", "OTHER"];
const KIND_NAME: Record<InvestmentKind, string> = {
  EQUIPMENT: "Equipment", EXPANSION: "Expansion", RENOVATION: "Renovation", VEHICLE: "Vehicle", OTHER: "Other",
};

interface InvForm { id: string | null; title: string; kind: InvestmentKind; target: string; saved: string; targetDate: string; note: string; error: string; busy: boolean }
const invUi = { form: null as InvForm | null, confirm: null as string | null, notice: "" };

const isoDay = (d: Date | null): string =>
  d ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}` : "";

function monthsLeft(d: Date): number {
  const now = new Date();
  return Math.max(0, (d.getFullYear() - now.getFullYear()) * 12 + d.getMonth() - now.getMonth());
}

function invForm(f: InvForm): string {
  const { t } = deps;
  return `
  <form class="panel admin-form" id="investmentForm" novalidate>
    <div class="panel-head"><h2>${icon(f.id ? "pencil" : "plus")} ${f.id ? t("Edit plan") : t("New investment plan")}</h2></div>
    <div class="admin-form-grid">
      <label class="signin-field admin-form-wide"><span>${t("What is it for?")}</span>
        <input id="ivTitle" value="${esc(f.title)}" maxlength="120" autocomplete="off" placeholder="${t("e.g. New injera mitad")}"></label>
      <label class="signin-field"><span>${t("Type")}</span>
        <select id="ivKind">${KINDS.map((k) => `<option value="${k}" ${k === f.kind ? "selected" : ""}>${t(KIND_NAME[k])}</option>`).join("")}</select></label>
      <label class="signin-field"><span>${t("Target date (optional)")}</span>
        <input id="ivDate" type="date" value="${esc(f.targetDate)}"></label>
      <label class="signin-field"><span>${t("Total cost (ETB)")}</span>
        <input id="ivTarget" inputmode="decimal" autocomplete="off" value="${esc(f.target)}"></label>
      <label class="signin-field"><span>${t("Saved so far (ETB)")}</span>
        <input id="ivSaved" inputmode="decimal" autocomplete="off" value="${esc(f.saved)}"></label>
      <label class="signin-field admin-form-wide"><span>${t("Note (optional)")}</span>
        <input id="ivNote" value="${esc(f.note)}" maxlength="500" autocomplete="off"></label>
    </div>
    <p class="field-error" role="alert">${esc(f.error)}</p>
    <div class="admin-form-actions">
      <button type="button" class="btn" data-inv-cancel>${t("Cancel")}</button>
      <button type="submit" class="btn btn-primary" ${f.busy ? "disabled" : ""}>${f.busy ? t("Saving…") : f.id ? t("Save changes") : t("Add plan")}</button>
    </div>
  </form>`;
}

function invCard(x: Investment): string {
  const { t, money } = deps;
  const pct = x.target > 0 ? Math.min(100, Math.round((x.saved / x.target) * 100)) : 0;
  const left = Math.max(0, x.target - x.saved);
  let plan = "";
  if (x.targetDate) {
    const m = monthsLeft(x.targetDate);
    plan = left <= 0 ? t("Fully funded") : m > 0
      ? t("{n} months left · save {x} a month", { n: m, x: money(Math.ceil(left / m)) })
      : t("Target date reached · {x} still needed", { x: money(left) });
  } else if (left > 0) plan = t("{x} still needed", { x: money(left) });
  else plan = t("Fully funded");
  const confirming = invUi.confirm === x.id;
  return `
    <div class="report-card invest-card">
      <div class="invest-top">
        <span class="badge">${t(KIND_NAME[x.kind])}</span>
        ${x.targetDate ? `<span class="goal-due">${t("By {x}", { x: deps.fmtDate(x.targetDate) })}</span>` : ""}
      </div>
      <h3>${esc(x.title)}</h3>
      ${x.note ? `<p>${esc(x.note)}</p>` : ""}
      <div class="progress-bar"><i style="width:${pct}%;background:${pct >= 100 ? "var(--revenue)" : "var(--info)"}"></i></div>
      <small>${t("{a} of {b} · {p}%", { a: money(x.saved), b: money(x.target), p: pct })}</small>
      <small class="muted-note">${esc(plan)}</small>
      <div class="invest-actions">
        <button type="button" class="btn" data-inv-edit="${esc(x.id)}">${icon("pencil")} ${t("Edit")}</button>
        <button type="button" class="btn ${confirming ? "btn-danger" : ""}" data-inv-delete="${esc(x.id)}">${confirming ? t("Tap again to delete") : t("Delete")}</button>
      </div>
    </div>`;
}

export function renderInvestments(): string {
  const { t, money } = deps;
  const total = investments.reduce((s, x) => s + x.target, 0);
  const saved = investments.reduce((s, x) => s + x.saved, 0);
  return `
    <div class="help-intro">
      <h2>${t("Investments")}</h2>
      <p>${t("Plans you're saving for — equipment, a new branch, renovation. Update what's saved as you go.")}</p>
    </div>
    ${invUi.notice ? `<p class="admin-notice" role="status">${icon("check")} ${esc(invUi.notice)}</p>` : ""}
    ${invUi.form ? invForm(invUi.form) : ""}
    <article class="panel">
      <div class="panel-head">
        <h2>${investments.length ? t("{a} saved of {b}", { a: money(saved), b: money(total) }) : t("No plans yet")}</h2>
        ${invUi.form ? "" : `<button type="button" class="btn btn-primary" data-inv-add>${icon("plus")} ${t("Add a plan")}</button>`}
      </div>
      ${investments.length
        ? `<div class="page-grid invest-grid">${investments.map(invCard).join("")}</div>`
        : `<p class="muted-note">${t("Add the first thing you're saving for, and track how close you are.")}</p>`}
    </article>`;
}

function readInvForm(): InvForm | null {
  const f = invUi.form;
  if (!f) return null;
  const v = (id: string): string => document.querySelector<HTMLInputElement | HTMLSelectElement>(id)?.value ?? "";
  f.title = v("#ivTitle").trim(); f.kind = v("#ivKind") as InvestmentKind; f.target = v("#ivTarget").trim();
  f.saved = v("#ivSaved").trim(); f.targetDate = v("#ivDate"); f.note = v("#ivNote").trim();
  return f;
}

async function saveInvestment(): Promise<void> {
  const { t } = deps;
  const f = readInvForm();
  if (!f || f.busy) return;
  const target = num(f.target), saved = f.saved ? num(f.saved) : 0;
  f.error = !f.title ? t("Say what the plan is for.")
    : !(target > 0) ? t("Enter the total cost.")
    : !(saved >= 0) ? t("Saved so far can't be negative.") : "";
  if (f.error) return deps.rerender();
  const body: InvestmentInput = { title: f.title, kind: f.kind, target, saved, targetDate: f.targetDate || null, note: f.note };
  f.busy = true; deps.rerender();
  try {
    if (isLive) {
      if (f.id) await updateInvestment(f.id, body);
      else await addInvestment(body);
    } else {
      const local: Investment = { id: f.id ?? `local-${Date.now()}`, ...body, targetDate: body.targetDate ? new Date(`${body.targetDate}T00:00:00`) : null };
      const i = investments.findIndex((x) => x.id === f.id);
      if (i >= 0) investments[i] = local; else investments.push(local);
    }
    invUi.notice = f.id ? t("Plan updated.") : t("Plan added.");
    invUi.form = null;
    await refresh();
  } catch (err) {
    f.busy = false; f.error = errText(err); deps.rerender();
  }
}

async function removeInvestment(id: string): Promise<void> {
  const { t } = deps;
  try {
    if (isLive) await deleteInvestment(id);
    else investments.splice(investments.findIndex((x) => x.id === id), 1);
    invUi.confirm = null;
    invUi.notice = t("Plan deleted.");
    await refresh();
  } catch (err) {
    invUi.notice = errText(err);
    deps.rerender();
  }
}

/* ======================= Reports ======================= */

type ReportKey = "daily-sales" | "weekly-pnl" | "monthly-tax" | "inventory" | "staff" | "menu";
const REPORTS: { key: ReportKey; title: string; desc: string; span: "month" | "weeks" | "now" }[] = [
  { key: "daily-sales", title: "Daily Sales Report", desc: "Revenue, orders, average ticket, payment mix for any day.", span: "month" },
  { key: "weekly-pnl", title: "Weekly P&L", desc: "Profit & loss with food cost, labor and overhead breakdown.", span: "weeks" },
  { key: "monthly-tax", title: "Monthly Tax Summary", desc: "VAT, withholding and income tax ready for accountant.", span: "month" },
  { key: "inventory", title: "Inventory Valuation", desc: "Current stock value and variance vs last count.", span: "now" },
  { key: "staff", title: "Staff Hours & Cost", desc: "Hours worked, overtime and labor cost % of sales.", span: "month" },
  { key: "menu", title: "Menu Performance", desc: "Contribution margin and popularity of every dish.", span: "month" },
];
const thisMonth = (): string => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`; };
const repUi = { month: thisMonth(), busy: null as ReportKey | null, notice: "", error: "" };

export function renderReports(): string {
  const { t } = deps;
  const spanText = (s: "month" | "weeks" | "now"): string =>
    s === "weeks" ? t("Last 12 weeks") : s === "now" ? t("Stock right now") : t("For the month above");
  return `
    <div class="report-head panel">
      <label class="signin-field"><span>${t("Month")}</span>
        <input type="month" id="reportMonth" value="${esc(repUi.month)}" max="${thisMonth()}"></label>
      <p class="muted-note">${t("Each report downloads as a CSV file that opens in Excel or Google Sheets.")}</p>
    </div>
    ${repUi.notice ? `<p class="admin-notice" role="status">${icon("check")} ${esc(repUi.notice)}</p>` : ""}
    ${repUi.error ? `<p class="field-error" role="alert">${esc(repUi.error)}</p>` : ""}
    <div class="page-grid">
      ${REPORTS.map((r) => `
        <div class="report-card">
          <h3>${esc(t(r.title))}</h3>
          <p>${esc(t(r.desc))}</p>
          <small class="muted-note">${spanText(r.span)}</small>
          <button class="btn" data-report="${r.key}" ${repUi.busy ? "disabled" : ""}>${repUi.busy === r.key ? t("Preparing…") : `${t("Download CSV")} ${icon("arrow-right")}`}</button>
        </div>`).join("")}
    </div>`;
}

function downloadCsv(filename: string, rows: (string | number)[][]): void {
  const cell = (v: string | number): string => {
    const s = String(v ?? "");
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  const text = rows.map((r) => r.map(cell).join(",")).join("\n");
  const blob = new Blob(["﻿" + text], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.style.display = "none";
  document.body.append(a); a.click(); a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Demo mode: build what we can from the figures on screen. */
function demoRows(key: ReportKey): (string | number)[][] | null {
  const live = getLiveSeries();
  if (key === "daily-sales") return [["Date", "Revenue (ex-VAT)", "Expenses"], ...(live?.daily ?? []).map((d) => [d.date, d.revenue, d.expenses])];
  if (key === "weekly-pnl") return [["Week starting", "Revenue (ex-VAT)", "Expenses", "Profit"], ...(live?.weekly ?? []).map((w) => [w.start, w.revenue, w.expenses, w.revenue - w.expenses])];
  if (key === "menu") return [["Dish", "Units sold", "Revenue (ETB)", "Share %"], ...topDishes.map((d) => [d.name, d.sold, d.revenue, d.pct])];
  return null;
}

async function generate(key: ReportKey): Promise<void> {
  const { t } = deps;
  const m = (document.querySelector<HTMLInputElement>("#reportMonth")?.value || repUi.month).slice(0, 7);
  repUi.month = m; repUi.busy = key; repUi.error = ""; repUi.notice = ""; deps.rerender();
  try {
    if (isLive) {
      const r = await getReport(key, m);
      downloadCsv(r.filename, [[r.title], r.columns, ...r.rows]);
      repUi.notice = t("Downloaded {x}", { x: r.filename });
    } else {
      const rows = demoRows(key);
      if (!rows) repUi.error = t("Connect the app to the server to make this report.");
      else { downloadCsv(`seer-${key}-${m}.csv`, rows); repUi.notice = t("Downloaded {x}", { x: `seer-${key}-${m}.csv` }); }
    }
  } catch (err) {
    repUi.error = errText(err);
  } finally {
    repUi.busy = null;
    deps.rerender();
  }
}

/* ======================= events ======================= */

/** Clicks on these pages. Returns true when handled. */
export function planningClick(el: Element): boolean {
  const hit = <E extends HTMLElement>(sel: string): E | null => el.closest<E>(sel);
  // goals
  const ge = hit("[data-goal-edit]");
  if (ge) {
    const key = ge.dataset.goalEdit as GoalKey;
    const g = goals.find((x) => x.key === key);
    goalUi.editing = key; goalUi.value = g ? String(g.target) : ""; goalUi.error = ""; goalUi.notice = "";
    deps.rerender();
    document.querySelector<HTMLInputElement>("#goalInput")?.select();
    return true;
  }
  if (hit("[data-goal-cancel]")) { goalUi.editing = null; goalUi.error = ""; deps.rerender(); return true; }
  const gr = hit("[data-goal-reset]");
  if (gr) {
    const key = gr.dataset.goalReset as GoalKey;
    void (async () => {
      try {
        if (isLive) await resetGoal(key);
        goalUi.notice = deps.t("Back to the automatic target.");
        await refresh();
      } catch (err) { goalUi.notice = errText(err); deps.rerender(); }
    })();
    return true;
  }
  // investments
  if (hit("[data-inv-add]")) {
    invUi.form = { id: null, title: "", kind: "EQUIPMENT", target: "", saved: "", targetDate: "", note: "", error: "", busy: false };
    invUi.notice = ""; deps.rerender();
    document.querySelector<HTMLInputElement>("#ivTitle")?.focus();
    return true;
  }
  const ie = hit("[data-inv-edit]");
  if (ie) {
    const x = investments.find((i) => i.id === ie.dataset.invEdit);
    if (x) {
      invUi.form = { id: x.id, title: x.title, kind: x.kind, target: String(x.target), saved: String(x.saved), targetDate: isoDay(x.targetDate), note: x.note, error: "", busy: false };
      invUi.notice = ""; deps.rerender();
      document.querySelector<HTMLInputElement>("#ivTitle")?.focus();
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
    return true;
  }
  if (hit("[data-inv-cancel]")) { invUi.form = null; deps.rerender(); return true; }
  const idel = hit("[data-inv-delete]");
  if (idel) {
    const id = idel.dataset.invDelete ?? "";
    if (invUi.confirm === id) void removeInvestment(id);
    else { invUi.confirm = id; deps.rerender(); }
    return true;
  }
  // reports
  const rep = hit("[data-report]");
  if (rep) { void generate(rep.dataset.report as ReportKey); return true; }
  return false;
}

/** Form submits on these pages. Returns true when handled. */
export function planningSubmit(form: HTMLFormElement): boolean {
  if (form.id === "goalForm") {
    goalUi.value = document.querySelector<HTMLInputElement>("#goalInput")?.value ?? "";
    void saveGoal(form.dataset.goal as GoalKey);
    return true;
  }
  if (form.id === "investmentForm") { void saveInvestment(); return true; }
  return false;
}

/** Clear one-off messages when the owner moves to another page. */
export function planningLeave(): void {
  goalUi.notice = ""; goalUi.editing = null; invUi.notice = ""; invUi.confirm = null; repUi.notice = ""; repUi.error = "";
}
