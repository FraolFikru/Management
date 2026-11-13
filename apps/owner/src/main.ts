import "./style.css";
import {
  budgetPeriod,
  budgets,
  cashFlow,
  categoryColor,
  dailyPattern,
  goals,
  paymentMethods,
  peakHours,
  stats,
  topDishes,
  transactions,
  user,
  type BudgetLine,
  type Category,
  type PaymentMethod,
  type Status,
  type Transaction,
  type When,
} from "./data";
import { icon } from "./icons";
import { getLiveSeries, loadLive } from "./live";
import { adminsClick, adminsSubmit, renderAdmins } from "./admins";
import { renderSupport } from "./help";
import { isLive, saveBudget as apiSaveBudget, sessionUser, signIn as apiSignIn, signOut as apiSignOut } from "./api";
import { LANGS, dayLong, dayShort, monthShort, translate, type Lang } from "./i18n";

/* ---------- helpers ---------- */

const $ = <T extends Element = HTMLElement>(sel: string, root: ParentNode = document): T => {
  const el = root.querySelector<T>(sel);
  if (!el) throw new Error(`Element not found: ${sel}`);
  return el;
};

const escapeHtml = (s: string): string =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string);

/* ---------- settings (persisted on this device) ---------- */

type Range = "Daily" | "Weekly" | "Monthly";
type BudgetSort = "worst" | "largest" | "az";
type ThemePref = "dark" | "light" | "system";
type CurrencyStyle = "code" | "birr";
type Page =
  | "Dashboard"
  | "Analytics"
  | "Transactions"
  | "Budgets"
  | "Investments"
  | "Goals"
  | "Reports"
  | "System Admins"
  | "Settings"
  | "Help & Support";

interface Settings {
  lang: Lang;
  theme: ThemePref;
  glow: boolean;
  reduceMotion: boolean;
  currency: CurrencyStyle;
  defaultRange: Range;
  defaultPayment: PaymentMethod;
  showAlert: boolean;
  failedAlerts: boolean;
  budgetWarn: number;
}

const DEFAULTS: Settings = {
  lang: "en",
  theme: "dark",
  glow: true,
  reduceMotion: false,
  currency: "code",
  defaultRange: "Monthly",
  defaultPayment: "telebirr",
  showAlert: true,
  failedAlerts: true,
  budgetWarn: 90,
};

const STORE_KEY = "seer-settings";
const RANGES: Range[] = ["Daily", "Weekly", "Monthly"];
const PAYMENTS: PaymentMethod[] = ["telebirr", "cash", "cbe"];

function loadSettings(): Settings {
  let s: Settings = { ...DEFAULTS };
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) s = { ...DEFAULTS, ...(JSON.parse(raw) as Partial<Settings>) };
    else {
      const legacy = localStorage.getItem("seer-theme"); // from the previous version
      if (legacy === "light" || legacy === "dark") s.theme = legacy;
    }
  } catch {
    /* storage unavailable — use defaults */
  }
  if (!LANGS.some((l) => l.code === s.lang)) s.lang = "en";
  if (!RANGES.includes(s.defaultRange)) s.defaultRange = "Monthly";
  if (!PAYMENTS.includes(s.defaultPayment)) s.defaultPayment = "telebirr";
  return s;
}

function saveSettings(): void {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(settings));
  } catch {
    /* ignore */
  }
}

const settings = loadSettings();

/* ---------- view state ---------- */

interface State {
  page: number;
  pageSize: number;
  query: string;
  statusFilter: Status | "All";
  selected: Set<string>;
  range: Range;
  activeNav: Page;
  payment: PaymentMethod;
  budgetSort: BudgetSort;
  editingBudget: Category | null;
  budgetError: string;
  lastBudgetEdit: { category: Category; previous: number } | null;
}

const state: State = {
  page: 1,
  pageSize: 10,
  query: "",
  statusFilter: "All",
  selected: new Set(),
  range: settings.defaultRange,
  activeNav: "Dashboard",
  payment: settings.defaultPayment,
  budgetSort: "worst",
  editingBudget: null,
  budgetError: "",
  lastBudgetEdit: null,
};

/* ---------- localization & formatting ---------- */

const t = (s: string, vars?: Record<string, string | number>): string => translate(s, settings.lang, vars);

const money = (n: number, digits = 0): string => {
  const num = n.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
  return settings.currency === "birr" ? `${num} ${t("Birr")}` : `ETB ${num}`;
};

const pad2 = (n: number): string => String(n).padStart(2, "0");
const fmtShort = (d: Date): string => `${monthShort(settings.lang)[d.getMonth()]} ${pad2(d.getDate())}`;
const fmtDate = (d: Date): string => `${fmtShort(d)}, ${d.getFullYear()}`;
const fmtWhen = (w: When): string => (w instanceof Date ? fmtShort(w) : t(w));
const signed = (n: number): string => `${n >= 0 ? "+" : ""}${n.toFixed(1)}%`;

const isMac = /Mac|iPhone|iPad/.test(navigator.userAgent);
const modKey = isMac ? "⌘" : "Ctrl";

/* ---------- appearance ---------- */

const lightQuery = window.matchMedia("(prefers-color-scheme: light)");
const resolvedTheme = (): "dark" | "light" =>
  settings.theme === "system" ? (lightQuery.matches ? "light" : "dark") : settings.theme;
const motionOff = (): boolean => settings.reduceMotion || window.matchMedia("(prefers-reduced-motion: reduce)").matches;

function applyAppearance(): void {
  const root = document.documentElement;
  const theme = resolvedTheme();
  root.dataset.theme = theme;
  root.lang = settings.lang;
  root.classList.toggle("no-glow", !settings.glow);
  root.classList.toggle("reduce-motion", settings.reduceMotion);
  document.querySelectorAll<HTMLElement>("[data-theme-btn]").forEach((b) => {
    const on = b.dataset.themeBtn === theme;
    b.classList.toggle("active", on);
    b.setAttribute("aria-pressed", String(on));
  });
  document.querySelectorAll<HTMLElement>("[data-lang]").forEach((b) => {
    const on = b.dataset.lang === settings.lang;
    b.classList.toggle("active", on);
    b.setAttribute("aria-pressed", String(on));
  });
}

lightQuery.addEventListener("change", () => {
  if (settings.theme === "system") applyAppearance();
});

/* ---------- layout ---------- */

const mainNav: { label: Page; icon: string }[] = [
  { label: "Dashboard", icon: "home" },
  { label: "Analytics", icon: "bars" },
  { label: "Transactions", icon: "receipt" },
  { label: "Budgets", icon: "wallet" },
  { label: "Investments", icon: "trend-up" },
  { label: "Goals", icon: "target" },
  { label: "Reports", icon: "file" },
  { label: "System Admins", icon: "users" },
];

const supportNav: { label: Page; icon: string }[] = [
  { label: "Settings", icon: "settings" },
  { label: "Help & Support", icon: "help" },
];

const navLink = (n: { label: Page; icon: string }): string =>
  `<a href="#" data-nav="${escapeHtml(n.label)}" class="${n.label === state.activeNav ? "active" : ""}">${icon(n.icon)}<span>${t(n.label)}</span></a>`;

function renderShell(): void {
  const hasFailed = transactions.some((x) => x.status === "Failed");
  $("#app").innerHTML = `
  <div class="layout">
    <aside class="sidebar" id="sidebar">
      <div class="brand">
        <img class="brand-logo" src="/logo-light.png" alt="SEER"><img class="brand-logo dark-only" src="/logo-dark.png" alt="SEER">
        <span><strong>SEER</strong></span>
      </div>

      <button class="profile" ${isLive ? `data-signout title="${t("Sign out")}"` : ""}>
        <span class="avatar">${user.name.split(" ").map((p) => p[0]).join("")}</span>
        <span class="profile-text">
          <strong>${escapeHtml(user.name)}</strong>
          <small>${escapeHtml(user.restaurant)}</small>
        </span>
        ${icon("chevrons")}
      </button>

      <p class="nav-heading">${t("Main menu")}</p>
      <nav class="nav" aria-label="${t("Main menu")}">${mainNav.map(navLink).join("")}</nav>

      <div class="sidebar-bottom">
        <p class="nav-heading">${t("Support")}</p>
        <nav class="nav" aria-label="${t("Support")}">${supportNav.map(navLink).join("")}</nav>
      </div>
    </aside>

    <main class="main">
      <header class="topbar">
        <button class="icon-btn menu-btn" id="menuBtn" aria-label="${t("Open menu")}">${icon("menu")}</button>
        <div class="title-wrap"><h1 id="pageTitle"></h1>${isLive ? `<span class="live-stamp" id="liveStamp" title="${t("Compared with the same days last month")}"></span>` : ""}</div>
        <div class="topbar-right">
          <label class="search">
            ${icon("search")}
            <input type="text" placeholder="${t("Search")}" id="globalSearch" aria-label="${t("Search transactions")}" />
            <kbd>${modKey} K</kbd>
          </label>
          <div class="seg-toggle lang-toggle" role="group" aria-label="${t("Language")}">
            ${LANGS.map((l) => `<button data-lang="${l.code}" lang="${l.code}" title="${l.name}">${l.short}</button>`).join("")}
          </div>
          <button class="icon-btn notif" aria-label="${t("Notifications")}">
            ${icon("bell")}${settings.failedAlerts && hasFailed ? `<span class="dot"></span>` : ""}
          </button>
          <div class="seg-toggle theme-toggle" role="group" aria-label="${t("Theme")}">
            <button data-theme-btn="dark" aria-label="${t("Dark")}" title="${t("Dark")}">${icon("moon")}</button>
            <button data-theme-btn="light" aria-label="${t("Light")}" title="${t("Light")}">${icon("sun")}</button>
          </div>
        </div>
      </header>

      <div id="pageContent"></div>
    </main>
    <div class="scrim" id="scrim"></div>
  </div>`;
}

/* ---------- Dashboard ---------- */

function renderDashboard(): string {
  const worst = isLive ? sortedBudgetViews().find((v) => v.status !== "ok") : undefined;
  const alertText = isLive
    ? worst ? `${t(worst.line.category)}: ${t(STATUS_LABEL[worst.status])}` : ""
    : t("Food cost is running 1.2% above target this week.");
  const alert = settings.showAlert && alertText
    ? `<div class="alert" role="status">
        <span>${icon("warning")} <strong>${t("Alert:")}</strong> ${escapeHtml(alertText)}</span>
        <a href="#" data-goto="Budgets">${t("Review budgets")} ${icon("arrow-right")}</a>
      </div>`
    : "";

  return `
    ${alert}
    <section class="grid">
      <div class="stats">
        ${stats
          .map((s, i) => {
            const good = s.lowerIsBetter ? s.change <= 0 : s.change >= 0;
            return `
          <article class="panel stat${i === 0 ? " featured glow" : ""}">
            <div class="stat-head">
              <span class="stat-icon">${icon(s.icon)}</span>
              <span class="stat-label">${t(s.label)}</span>
              <button class="more" aria-label="${t("More")}">${icon("dots-v")}</button>
            </div>
            <div class="stat-value" data-count="${s.value}" data-unit="${s.unit}">${s.unit === "%" ? "0.0%" : money(0)}</div>
            <div class="stat-foot">
              <span>${t(s.note)}</span>
              <span class="badge ${good ? "up" : "down"}">${signed(s.change)}</span>
            </div>
          </article>`;
          })
          .join("")}
      </div>

      <article class="panel chart-panel">
        <div class="panel-head">
          <h2>${t("Revenue vs Expenses")}</h2>
          <div class="segmented" id="rangeSeg" role="group">
            ${RANGES.map((r) => `<button data-range="${r}" class="${r === state.range ? "active" : ""}">${t(r)}</button>`).join("")}
          </div>
        </div>
        <div class="chart-wrap" id="chartWrap">
          <svg id="chart" role="img" aria-label="${t("Cash flow chart")}"></svg>
          <div class="tooltip" id="tooltip" hidden></div>
        </div>
      </article>

      <article class="panel cards-panel" id="paymentPanel"></article>
    </section>

    <article class="panel table-panel">
      <div class="panel-head">
        <h2>${t("Recent Transactions")}</h2>
        <button class="btn" data-goto="Transactions">${t("View all")} ${icon("arrow-right")}</button>
      </div>
      <div class="table-scroll">
        <table>
          <thead>
            <tr>
              <th>${t("ID")}</th>
              <th>${t("Description")}</th>
              <th>${t("Category")}</th>
              <th>${t("Date")}</th>
              <th>${t("Amount")}</th>
              <th>${t("Status")}</th>
            </tr>
          </thead>
          <tbody>
            ${transactions
              .slice(0, 6)
              .map(
                (x) => `
              <tr>
                <td class="mono">${x.id}</td>
                <td>${escapeHtml(t(x.description))}</td>
                <td><span class="cat"><i style="background:${categoryColor[x.category]}"></i>${t(x.category)}</span></td>
                <td>${fmtDate(x.date)}</td>
                <td class="mono">${money(Math.abs(x.amount))}</td>
                <td><span class="status ${x.status.toLowerCase()}">${t(x.status)}</span></td>
              </tr>`,
              )
              .join("")}
          </tbody>
        </table>
      </div>
    </article>
  `;
}

/* ---------- Analytics ---------- */

function renderAnalytics(): string {
  const max = Math.max(...peakHours.map((x) => x.orders));
  return `
    <div class="page-grid">
      <article class="panel">
        <div class="panel-head"><h2>${t("Top Selling Dishes")}</h2></div>
        ${topDishes
          .map(
            (d) => `
          <div class="dish-row">
            <div class="grow">
              <strong>${t(d.name)}</strong>
              <div class="dish-meta">${d.sold} ${t("sold")} · ${money(d.revenue)}</div>
              <div class="progress-bar"><i style="width:${d.pct * 3}%;background:var(--revenue)"></i></div>
            </div>
            <span class="badge up">${d.pct}%</span>
          </div>`,
          )
          .join("")}
      </article>

      <article class="panel">
        <div class="panel-head"><h2>${t("Peak Hours (Orders)")}</h2></div>
        <div class="peak-bars">
          ${peakHours
            .map((p) => {
              const h = Math.round((p.orders / max) * 100);
              return `<div title="${p.orders}"><div class="bar${p.orders === max ? " top" : ""}" style="height:${h}%"></div><small>${p.hour}</small></div>`;
            })
            .join("")}
        </div>
        <p class="note">${t("Dinner service (19–20) is your strongest window. Consider staffing accordingly.")}</p>
      </article>

      <article class="panel">
        <div class="panel-head"><h2>${t("Quick Insights")}</h2></div>
        <div class="insight-list">
          ${quickInsightCards()}
        </div>
      </article>
    </div>
  `;
}

function quickInsightCards(): string {
  const aov = goals.find((g) => g.title === "Average Order Value");
  const aovCard = aov ? `
          <div class="report-card">
            <h3>${t("Average Order Value")}</h3>
            <strong class="insight-value">${money(aov.current)}</strong>
            <p>${t("Target {x}", { x: money(aov.target) })}</p>
          </div>` : "";
  const topHour = peakHours.reduce((a, b) => (b.orders > a.orders ? b : a), peakHours[0] ?? { hour: "", orders: 0 });
  const peakCard = topHour.orders ? `
          <div class="report-card">
            <h3>${t("Peak hour")}</h3>
            <strong class="insight-value">${escapeHtml(topHour.hour)}</strong>
            <p>${t("{n} orders in your busiest hour", { n: topHour.orders })}</p>
          </div>` : "";
  const bestDish = topDishes[0];
  const dishCard = bestDish ? `
          <div class="report-card">
            <h3>${t("Best seller")}</h3>
            <strong class="insight-value">${escapeHtml(t(bestDish.name))}</strong>
            <p>${t("{n} sold · {x}", { n: bestDish.sold, x: money(bestDish.revenue) })}</p>
          </div>` : "";
  return aovCard + peakCard + dishCard;
}

/* ---------- Transactions ---------- */

function renderTransactionsPage(): string {
  return `
    <article class="panel table-panel">
      <div class="panel-head">
        <h2>${t("All Transactions")}</h2>
        <div class="table-tools">
          <label class="search small">
            ${icon("search")}
            <input type="text" placeholder="${t("Search")}" id="tableSearch" value="${escapeHtml(state.query)}" aria-label="${t("Search transactions")}" />
          </label>
          <div class="filter-wrap">
            <button class="btn" id="filterBtn">${icon("filter")} ${t("Filter")}</button>
            <div class="menu" id="filterMenu" hidden>
              ${(["All", "Success", "Pending", "Failed"] as const)
                .map((s) => `<button data-status="${s}" class="${s === state.statusFilter ? "active" : ""}">${t(s)}</button>`)
                .join("")}
            </div>
          </div>
        </div>
      </div>
      <div class="table-scroll">
        <table>
          <thead>
            <tr>
              <th><input type="checkbox" id="selectAll" aria-label="${t("Select all")}" /></th>
              <th>${t("Transaction ID")}</th>
              <th>${t("Description")}</th>
              <th>${t("Category")}</th>
              <th>${t("Date")}</th>
              <th>${t("Amount")}</th>
              <th>${t("Status")}</th>
              <th></th>
            </tr>
          </thead>
          <tbody id="tbody"></tbody>
        </table>
      </div>
      <div class="table-foot">
        <span id="showing"></span>
        <div class="pager">
          <button class="icon-btn" id="prev" aria-label="${t("Previous page")}">${icon("chevron-left")}</button>
          <span id="pageLabel"></span>
          <button class="icon-btn" id="next" aria-label="${t("Next page")}">${icon("chevron-right")}</button>
        </div>
      </div>
    </article>
  `;
}

/* ---------- Budgets ---------- */

type BudgetStatus = "over" | "risk" | "ok";

interface BudgetView {
  line: BudgetLine;
  projected: number; // month-end estimate at the current spend rate
  variance: number; // projected − budget (positive = over)
  variancePct: number;
  plannedToDate: number; // what an even spread of the budget would have spent by today
  pacePct: number; // how far spend is ahead (+) or behind (−) that plan
  usedPct: number;
  planPct: number; // share of the month elapsed
  vsLastPct: number; // projected vs last month's actual
  status: BudgetStatus;
}

const BUDGET_MAX = 10_000_000;
const STATUS_RANK: Record<BudgetStatus, number> = { over: 0, risk: 1, ok: 2 };
const STATUS_LABEL: Record<BudgetStatus, string> = { over: "Over budget", risk: "At risk", ok: "On track" };
const STATUS_BADGE: Record<BudgetStatus, string> = { over: "down", risk: "warn", ok: "up" };

const budgetAdvice: Record<Category, string> = {
  "Food Cost": "Review produce and meat purchases this week.",
  Labor: "Check overtime and shift cover before next week's rota.",
  Utilities: "Check for equipment left running after closing.",
  Marketing: "Pause the lowest-performing ad campaign.",
  Supplies: "Delay non-essential restocking until next month.",
  Rent: "Rent is fixed. Plan the difference into next month's budget.",
};

const pct = (n: number): string => `${Math.round(n)}%`;
const signedMoney = (n: number): string => `${n > 0 ? "+" : n < 0 ? "−" : ""}${money(Math.abs(n))}`;

function budgetView(line: BudgetLine): BudgetView {
  const frac = budgetPeriod.day / budgetPeriod.daysInMonth;
  const projected = line.fixed ? line.fixed.committed : Math.round(line.spent / frac / 10) * 10;
  const plannedToDate = line.fixed ? line.allocated : line.allocated * frac;
  const variance = projected - line.allocated;
  const usedPct = (line.spent / line.allocated) * 100;

  let status: BudgetStatus = "ok";
  if (line.spent > line.allocated) status = "over";
  else if (variance > 0 || (!line.fixed && usedPct >= settings.budgetWarn)) status = "risk";

  return {
    line,
    projected,
    variance,
    variancePct: (variance / line.allocated) * 100,
    plannedToDate,
    pacePct: line.fixed ? 0 : (line.spent / plannedToDate - 1) * 100,
    usedPct,
    planPct: frac * 100,
    vsLastPct: ((projected - line.lastMonth) / line.lastMonth) * 100,
    status,
  };
}

function sortedBudgetViews(): BudgetView[] {
  const views = budgets.map(budgetView);
  const byWorst = (a: BudgetView, b: BudgetView): number =>
    STATUS_RANK[a.status] - STATUS_RANK[b.status] || b.variance - a.variance;
  if (state.budgetSort === "largest") return views.sort((a, b) => b.line.allocated - a.line.allocated);
  if (state.budgetSort === "az") return views.sort((a, b) => t(a.line.category).localeCompare(t(b.line.category), settings.lang));
  return views.sort(byWorst);
}

function renderBudgetCallout(views: BudgetView[]): string {
  const worst = [...views].sort((a, b) => STATUS_RANK[a.status] - STATUS_RANK[b.status] || b.variance - a.variance)[0];

  if (!worst || worst.status === "ok") {
    const under = views.reduce((s, v) => s + v.variance, 0);
    return `
      <section class="panel callout ok" aria-labelledby="calloutTitle">
        <div class="callout-icon">${icon("check")}</div>
        <div class="callout-body">
          <p class="callout-kicker" id="calloutTitle">${t("All budgets on track")}</p>
          <p class="callout-headline">${t("Projected to finish {x} under budget this month.", { x: money(Math.abs(under)) })}</p>
        </div>
      </section>`;
  }

  const name = t(worst.line.category);
  const headline =
    worst.status === "over"
      ? t("{x} is already {y} over budget.", { x: name, y: money(worst.line.spent - worst.line.allocated) })
      : t("{x} is on pace to finish {y} over budget ({z}).", { x: name, y: money(worst.variance), z: signed(worst.variancePct) });
  const pace =
    worst.pacePct > 0.5 ? `<p>${t("Spending is {x} ahead of plan for day {d}.", { x: pct(worst.pacePct), d: budgetPeriod.day })}</p>` : "";

  return `
    <section class="panel callout ${worst.status}" aria-labelledby="calloutTitle">
      <div class="callout-icon">${icon("warning")}</div>
      <div class="callout-body">
        <div class="callout-top">
          <p class="callout-kicker" id="calloutTitle">${t("Biggest problem")}</p>
          <span class="badge ${STATUS_BADGE[worst.status]}">${t(STATUS_LABEL[worst.status])}</span>
        </div>
        <p class="callout-headline">${escapeHtml(headline)}</p>
        ${pace}
        <p><strong>${t("Next step:")}</strong> ${t(budgetAdvice[worst.line.category])}</p>
        <div class="callout-actions">
          <button class="btn btn-primary" data-budget-review="${worst.line.category}">
            ${t("Review {x} transactions", { x: name })} ${icon("arrow-right")}
          </button>
          <button class="btn" data-budget-edit="${worst.line.category}">${icon("pencil")} ${t("Adjust budget")}</button>
        </div>
      </div>
    </section>`;
}

function renderBudgetKpis(views: BudgetView[]): string {
  const sum = (f: (v: BudgetView) => number): number => views.reduce((s, v) => s + f(v), 0);
  const total = sum((v) => v.line.allocated);
  const spent = sum((v) => v.line.spent);
  const planned = sum((v) => v.plannedToDate);
  const projected = sum((v) => v.projected);
  const lastMonth = sum((v) => v.line.lastMonth);
  const over = views.filter((v) => v.status === "over").length;
  const risk = views.filter((v) => v.status === "risk").length;
  const gap = projected - total;
  const paceDelta = (spent / planned - 1) * 100;

  return `
    <section class="panel kpi-strip" aria-label="${t("Budgets")}">
      <div class="kpi">
        <span class="kpi-label">${t("Total budget")}</span>
        <strong class="kpi-value">${money(total)}</strong>
        <span class="kpi-note">${t("Last month: {x}", { x: money(lastMonth) })}</span>
      </div>
      <div class="kpi">
        <span class="kpi-label">${t("Spent so far")}</span>
        <strong class="kpi-value">${money(spent)}</strong>
        <span class="kpi-note">${t("Plan by today: {x}", { x: money(Math.round(planned)) })}
          <span class="badge ${paceDelta > 0.5 ? "warn" : "up"}">${signed(paceDelta)}</span></span>
      </div>
      <div class="kpi">
        <span class="kpi-label">${t("Projected month-end")}</span>
        <strong class="kpi-value">${money(projected)}</strong>
        <span class="kpi-note"><span class="badge ${gap > 0 ? "down" : "up"}">${
          gap > 0 ? t("{x} over", { x: money(gap) }) : t("{x} under", { x: money(-gap) })
        }</span></span>
      </div>
      <div class="kpi">
        <span class="kpi-label">${t("Needs attention")}</span>
        <strong class="kpi-value">${t("{x} of {y} categories", { x: over + risk, y: views.length })}</strong>
        <span class="kpi-note">${t("{x} over · {y} at risk", { x: over, y: risk })}</span>
      </div>
    </section>`;
}

function renderBudgetEditor(v: BudgetView): string {
  const cat = v.line.category;
  const suggestion = Math.ceil(v.projected / 500) * 500;
  const err = state.budgetError;
  return `
    <div class="budget-editor" id="editor-${slug(cat)}" role="group" aria-label="${t("Edit budget for {x}", { x: t(cat) })}">
      <label class="budget-input">
        <span>ETB</span>
        <input type="text" inputmode="numeric" autocomplete="off" id="budgetInput" data-budget-input="${cat}"
          value="${v.line.allocated.toLocaleString("en-US")}"
          aria-label="${t("Budget amount for {x}", { x: t(cat) })}"
          aria-invalid="${err ? "true" : "false"}" aria-describedby="budgetErr" />
      </label>
      ${!v.line.fixed && suggestion !== v.line.allocated
        ? `<button class="btn" data-budget-match="${suggestion}">${t("Match projection ({x})", { x: money(suggestion) })}</button>`
        : ""}
      <div class="editor-actions">
        <button class="btn" data-budget-cancel>${icon("x")} ${t("Cancel")}</button>
        <button class="btn btn-primary" data-budget-save="${cat}">${icon("check")} ${t("Save")}</button>
      </div>
      <p class="field-error" id="budgetErr" role="alert">${err ? t(err) : ""}</p>
    </div>`;
}

const slug = (s: string): string => s.toLowerCase().replace(/[^a-z]+/g, "-");

function renderBudgetRow(v: BudgetView): string {
  const cat = v.line.category;
  const editing = state.editingBudget === cat;
  const fill = Math.min(100, v.usedPct);
  const fixed = v.line.fixed;
  const meta = fixed
    ? `<span class="tag">${t("Fixed")}</span> ${fixed.paidOn ? t("Paid {x}", { x: fmtShort(fixed.paidOn) }) : t("Due this month")}`
    : t("{x} used · plan {y}", { x: pct(v.usedPct), y: pct(v.planPct) });
  const varClass = v.variance > 0 ? STATUS_BADGE[v.status === "ok" ? "risk" : v.status] : "up";

  return `
    <li class="budget-line ${v.status}${editing ? " editing" : ""}">
      <div class="c-name">
        <i class="dot" style="background:${categoryColor[cat]}"></i>
        <strong>${t(cat)}</strong>
        <span class="badge ${STATUS_BADGE[v.status]}">${t(STATUS_LABEL[v.status])}</span>
      </div>
      <div class="c-track">
        <div class="budget-track">
          <div class="progress-bar"><i style="width:${fill}%"></i></div>
          ${fixed ? "" : `<span class="pace-mark" style="left:${v.planPct}%" title="${t("Today's planned spend")}"></span>`}
        </div>
        <small>${meta}</small>
      </div>
      <div class="c-budget num"><span class="cell-label">${t("Budget")}</span>${money(v.line.allocated)}</div>
      <div class="c-spent num"><span class="cell-label">${t("Spent")}</span>${money(v.line.spent)}</div>
      <div class="c-proj num">
        <span class="cell-label">${t("Projected")}</span>${money(v.projected)}
        <small class="${v.vsLastPct > 0.5 ? "neg" : "pos"}">${t("vs last month {x}", { x: signed(v.vsLastPct) })}</small>
      </div>
      <div class="c-var num">
        <span class="cell-label">${t("Variance")}</span>
        <span class="var-amt ${varClass}">${signedMoney(v.variance)}</span>
        <small class="${varClass}">${signed(v.variancePct)}</small>
      </div>
      <div class="c-act">
        <button class="icon-btn" data-budget-edit="${cat}" aria-expanded="${editing}" aria-controls="editor-${slug(cat)}"
          aria-label="${t("Edit budget for {x}", { x: t(cat) })}" title="${t("Edit")}">${icon("pencil")}</button>
      </div>
      ${editing ? renderBudgetEditor(v) : ""}
    </li>`;
}

function renderBudgets(): string {
  const views = sortedBudgetViews();
  const L = settings.lang;
  const daysLeft = budgetPeriod.daysInMonth - budgetPeriod.day;
  const sortOpts: [BudgetSort, string][] = [
    ["worst", "Worst first"],
    ["largest", "Largest"],
    ["az", "A–Z"],
  ];
  const undo = state.lastBudgetEdit;

  return `
    <div class="period-line">
      <strong>${monthShort(L)[budgetPeriod.month]} ${budgetPeriod.year}</strong>
      <span>${t("Day {d} of {n}", { d: budgetPeriod.day, n: budgetPeriod.daysInMonth })}</span>
      <span>${t("{x} days left", { x: daysLeft })}</span>
    </div>

    ${renderBudgetCallout(views)}
    ${renderBudgetKpis(views)}

    <article class="panel">
      <div class="panel-head">
        <h2>${t("By category")}</h2>
        <div class="segmented" role="group" aria-label="${t("Sort")}">
          ${sortOpts
            .map(([k, label]) => `<button data-budget-sort="${k}" class="${state.budgetSort === k ? "active" : ""}" aria-pressed="${state.budgetSort === k}">${t(label)}</button>`)
            .join("")}
        </div>
      </div>

      <div class="notice-row">
        <p class="notice" id="budgetNotice" aria-live="polite"></p>
        ${undo ? `<button class="btn" data-budget-undo>${t("Undo")}</button>` : ""}
      </div>

      <div class="budget-head" aria-hidden="true">
        <span>${t("Category")}</span><span></span>
        <span class="num">${t("Budget")}</span><span class="num">${t("Spent")}</span>
        <span class="num">${t("Projected")}</span><span class="num">${t("Variance")}</span><span></span>
      </div>
      <ul class="budget-list">${views.map(renderBudgetRow).join("")}</ul>
      <p class="fine-print">${t("Budget changes are kept until you reload the page.")}</p>
    </article>
  `;
}

/** Re-render the Budgets screen, then put focus somewhere sensible and announce changes. */
function refreshBudgets(focus?: string, announce?: string): void {
  if (state.activeNav !== "Budgets") return;
  $("#pageContent").innerHTML = renderBudgets();
  if (focus) {
    const el = document.querySelector<HTMLElement>(focus);
    el?.focus();
    if (el instanceof HTMLInputElement) el.select();
  }
  if (announce) requestAnimationFrame(() => {
    const n = document.querySelector("#budgetNotice");
    if (n) n.textContent = announce;
  });
}

function startBudgetEdit(cat: Category): void {
  state.editingBudget = state.editingBudget === cat ? null : cat;
  state.budgetError = "";
  refreshBudgets(state.editingBudget ? "#budgetInput" : `[data-budget-edit="${cat}"]`);
}

function cancelBudgetEdit(): void {
  const cat = state.editingBudget;
  state.editingBudget = null;
  state.budgetError = "";
  refreshBudgets(cat ? `.c-act [data-budget-edit="${cat}"]` : undefined);
}

function saveBudget(cat: Category): void {
  const input = document.querySelector<HTMLInputElement>("#budgetInput");
  const value = Number((input?.value ?? "").replace(/[^\d.]/g, ""));
  if (!Number.isFinite(value) || value < 1 || value > BUDGET_MAX) {
    state.budgetError = "Enter an amount between 1 and 10,000,000.";
    const err = document.querySelector("#budgetErr");
    if (err) err.textContent = t(state.budgetError);
    input?.setAttribute("aria-invalid", "true");
    input?.focus();
    return;
  }
  const line = budgets.find((b) => b.category === cat);
  if (!line) return;
  const rounded = Math.round(value);
  state.lastBudgetEdit = rounded !== line.allocated ? { category: cat, previous: line.allocated } : state.lastBudgetEdit;
  const before = line.allocated;
  line.allocated = rounded;
  syncBudget(line, before);
  state.editingBudget = null;
  state.budgetError = "";
  refreshBudgets(`.c-act [data-budget-edit="${cat}"]`, t("{x} budget saved: {y}", { x: t(cat), y: money(rounded) }));
}

function undoBudget(): void {
  const last = state.lastBudgetEdit;
  if (!last) return;
  const line = budgets.find((b) => b.category === last.category);
  if (line) { const before = line.allocated; line.allocated = last.previous; syncBudget(line, before); }
  state.lastBudgetEdit = null;
  refreshBudgets(`.c-act [data-budget-edit="${last.category}"]`, t("{x} budget saved: {y}", { x: t(last.category), y: money(last.previous) }));
}

/** Live mode: save a budget; if the backend refuses, put the old amount back and say why. */
function syncBudget(line: BudgetLine, before: number): void {
  if (!isLive) return;
  const month = `${budgetPeriod.year}-${pad2(budgetPeriod.month + 1)}`;
  apiSaveBudget(month, line.category, line.allocated).catch((err: unknown) => {
    line.allocated = before;
    refreshBudgets(undefined, t("Not saved: {reason}", { reason: err instanceof Error ? err.message : String(err) }));
  });
}

/* ---------- Investments ---------- */

function renderInvestments(): string {
  if (isLive) return `
    <div class="page-grid single">
      <article class="panel"><div class="panel-head"><h2>${t("Investments")}</h2></div>
        <p class="muted-note">${t("Investment plans aren't tracked in the system yet.")}</p></article>
    </div>`;
  return `
    <div class="page-grid">
      <article class="panel">
        <div class="panel-head"><h2>${t("Equipment")}</h2></div>
        <div class="report-card">
          <h3>${t("New Industrial Oven")}</h3>
          <p>${t("Planned Q1 2027 · Est. ETB 185,000")}</p>
          <div class="progress-bar"><i style="width:35%;background:var(--info)"></i></div>
          <small>${t("35% funded from reserves")}</small>
        </div>
        <div class="report-card">
          <h3>${t("POS Terminal Upgrade")}</h3>
          <p>${t("3 new terminals · ETB 42,000")}</p>
          <div class="progress-bar"><i style="width:80%;background:var(--revenue)"></i></div>
          <small>${t("Almost ready")}</small>
        </div>
      </article>
      <article class="panel">
        <div class="panel-head"><h2>${t("Expansion")}</h2></div>
        <div class="report-card">
          <h3>${t("Second Branch – CMC")}</h3>
          <p>${t("Feasibility study complete. Target open date: mid-2027.")}</p>
          <strong class="projection">${t("ETB 1.2M projected")}</strong>
        </div>
        <div class="report-card">
          <h3>${t("Delivery Fleet")}</h3>
          <p>${t("2 motorcycles + branded boxes")}</p>
          <div class="progress-bar"><i style="width:60%;background:var(--muted)"></i></div>
        </div>
      </article>
    </div>
  `;
}

/* ---------- Goals ---------- */

function renderGoals(): string {
  return `
    <div class="page-grid single">
      ${goals
        .map((g) => {
          const ratio = g.lowerIsBetter ? g.target / g.current : g.current / g.target;
          const pct = Math.min(100, Math.round(ratio * 100));
          const fmt = (v: number): string => (g.unit === "ETB" ? money(v) : `${v}${g.unit}`);
          const due = g.deadline ? t("Due {x}", { x: fmtShort(g.deadline) }) : t("Ongoing");
          return `
          <div class="goal-card">
            <div class="goal-top">
              <strong>${t(g.title)}</strong>
              <span class="goal-due">${due}</span>
            </div>
            <div class="goal-value">${fmt(g.current)}<small> / ${fmt(g.target)}</small></div>
            <div class="progress-bar"><i style="width:${pct}%;background:${pct >= 90 ? "var(--revenue)" : "var(--muted)"}"></i></div>
          </div>`;
        })
        .join("")}
    </div>
  `;
}

/* ---------- Reports ---------- */

type ReportKey = "daily-sales" | "weekly-pnl" | "monthly-tax" | "inventory" | "staff" | "menu";
const reports: { key: ReportKey; title: string; desc: string; where?: string }[] = [
  { key: "daily-sales", title: "Daily Sales Report", desc: "Revenue, orders, average ticket, payment mix for any day." },
  { key: "weekly-pnl",  title: "Weekly P&L",          desc: "Profit & loss with food cost, labor and overhead breakdown." },
  { key: "monthly-tax", title: "Monthly Tax Summary", desc: "VAT, withholding and income tax ready for accountant.", where: "Finance" },
  { key: "inventory",   title: "Inventory Valuation", desc: "Current stock value and variance vs last count.",         where: "Purchasing" },
  { key: "staff",       title: "Staff Hours & Cost",  desc: "Hours worked, overtime and labor cost % of sales.",       where: "HR" },
  { key: "menu",        title: "Menu Performance",    desc: "Contribution margin and popularity of every dish." },
];

function renderReports(): string {
  return `
    <div class="page-grid">
      ${reports
        .map((r) => {
          const action = r.where
            ? `<button class="btn" disabled title="${t("Open in the {app} app", { app: r.where })}">${t("Open in {app}", { app: r.where })}</button>`
            : `<button class="btn" data-report="${r.key}">${t("Download CSV")} ${icon("arrow-right")}</button>`;
          return `
        <div class="report-card">
          <h3>${escapeHtml(t(r.title))}</h3>
          <p>${escapeHtml(t(r.desc))}</p>
          ${action}
        </div>`;
        })
        .join("")}
    </div>
  `;
}

/** Make a CSV file in the browser and trigger a download. */
function downloadCsv(filename: string, rows: (string | number)[][]): void {
  const esc = (v: string | number): string => {
    const s = String(v ?? "");
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  const text = rows.map((r) => r.map(esc).join(",")).join("\n");
  const blob = new Blob(["\ufeff" + text], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.style.display = "none";
  document.body.append(a); a.click(); a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function generateReport(key: ReportKey): void {
  const stamp = new Date().toISOString().slice(0, 10);
  if (key === "daily-sales") {
    const live = getLiveSeries();
    const days = live?.daily ?? [];
    const rows: (string | number)[][] = [["Date", "Revenue (ex-VAT)", "Expenses"]];
    for (const d of days) rows.push([d.date, d.revenue, d.expenses]);
    downloadCsv(`seer-daily-sales-${stamp}.csv`, rows);
  } else if (key === "weekly-pnl") {
    const live = getLiveSeries();
    const weeks = live?.weekly ?? [];
    const rows: (string | number)[][] = [["Week starting", "Revenue (ex-VAT)", "Expenses", "Profit"]];
    for (const w of weeks) rows.push([w.start, w.revenue, w.expenses, w.revenue - w.expenses]);
    downloadCsv(`seer-weekly-pnl-${stamp}.csv`, rows);
  } else if (key === "menu") {
    const rows: (string | number)[][] = [["Dish", "Units sold", "Revenue (ETB)", "Share %"]];
    for (const d of topDishes) rows.push([t(d.name), d.sold, d.revenue, d.pct]);
    downloadCsv(`seer-menu-performance-${stamp}.csv`, rows);
  }
}

/* ---------- Settings ---------- */

function choice<K extends keyof Settings>(key: K, options: { value: Settings[K]; label: string; lang?: string }[]): string {
  return `<div class="segmented wrap" role="group">
    ${options
      .map((o) => {
        const on = settings[key] === o.value;
        return `<button data-setting-key="${key}" data-setting-value="${o.value}" class="${on ? "active" : ""}" aria-pressed="${on}"${o.lang ? ` lang="${o.lang}"` : ""}>${o.label}</button>`;
      })
      .join("")}
  </div>`;
}

const toggle = (key: keyof Settings, label: string): string =>
  `<label class="switch"><input type="checkbox" role="switch" data-setting-toggle="${key}" ${settings[key] ? "checked" : ""} aria-label="${label}" /><span></span></label>`;

const row = (title: string, desc: string, control: string): string =>
  `<div class="setting-row"><div class="setting-text"><strong>${title}</strong>${desc ? `<small>${desc}</small>` : ""}</div>${control}</div>`;

function renderSettings(): string {
  return `
    <p class="page-intro">${t("Personalize SEER for how you run your restaurant.")}</p>
    <div class="settings-grid">
      <article class="panel">
        <div class="panel-head"><h2>${t("Appearance")}</h2></div>
        ${row(t("Theme"), "", choice("theme", [
          { value: "dark", label: t("Dark") },
          { value: "light", label: t("Light") },
          { value: "system", label: t("System") },
        ]))}
        ${row(t("Cursor glow"), t("A soft light that follows your cursor near cards and buttons."), toggle("glow", t("Cursor glow")))}
        ${row(t("Reduce motion"), t("Turn off number and chart animations."), toggle("reduceMotion", t("Reduce motion")))}
      </article>

      <article class="panel">
        <div class="panel-head"><h2>${t("Language & region")}</h2></div>
        ${row(t("Language"), t("Applies to menus, labels, dates and reports."), choice("lang", LANGS.map((l) => ({ value: l.code, label: l.name, lang: l.code }))))}
        ${row(t("Currency format"), "", choice("currency", [
          { value: "code", label: "ETB 1,000" },
          { value: "birr", label: `1,000 ${t("Birr")}` },
        ]))}
      </article>

      <article class="panel">
        <div class="panel-head"><h2>${t("Dashboard")}</h2></div>
        ${row(t("Default chart range"), "", choice("defaultRange", RANGES.map((r) => ({ value: r, label: t(r) }))))}
        ${row(t("Default payment method"), "", choice("defaultPayment", PAYMENTS.map((p) => ({ value: p, label: t(paymentMethods[p].name) }))))}
        ${row(t("Show alert banner"), t("Shows cost warnings at the top of the Dashboard."), toggle("showAlert", t("Show alert banner")))}
      </article>

      <article class="panel">
        <div class="panel-head"><h2>${t("Alerts")}</h2></div>
        ${row(t("Failed payment alerts"), t("Show a dot on the bell when a payment fails."), toggle("failedAlerts", t("Failed payment alerts")))}
        ${row(t("Budget warning level"), t("Flag a category when spending reaches this share of its budget."), choice("budgetWarn", [80, 90, 100].map((v) => ({ value: v, label: `${v}%` }))))}
      </article>
    </div>
    <div class="settings-foot">
      <small>${t("Settings are saved on this device.")}</small>
      <button class="btn" id="resetSettings">${icon("refresh")} ${t("Reset to defaults")}</button>
    </div>
  `;
}

/* ---------- Help & Support ---------- */


function renderHelp(): string {
  return `
    ${renderSupport(t)}
    <article class="panel help-shortcuts">
      <div class="panel-head"><h2>${icon("keyboard")} ${t("Keyboard shortcuts")}</h2></div>
      <div class="shortcut"><span><kbd>${modKey}</kbd> + <kbd>K</kbd></span>${t("Search transactions")}</div>
      <div class="shortcut"><span><kbd>Esc</kbd></span>${t("Close menus")}</div>
      <div class="help-tip">
        <p>${t("Language, theme and dashboard defaults can be changed in Settings.")}</p>
        <button class="btn" data-goto="Settings">${t("Open Settings")} ${icon("arrow-right")}</button>
      </div>
    </article>
  `;
}

/* ---------- router ---------- */

function renderPage(): void {
  const content = $("#pageContent");
  $("#pageTitle").textContent = t(state.activeNav);
  stampLive();

  switch (state.activeNav) {
    case "Dashboard":
      content.innerHTML = renderDashboard();
      renderPayment();
      renderChart();
      animateCounters();
      break;
    case "Analytics":
      content.innerHTML = renderAnalytics();
      break;
    case "Transactions":
      content.innerHTML = renderTransactionsPage();
      renderTable();
      break;
    case "Budgets":
      content.innerHTML = renderBudgets();
      break;
    case "Investments":
      content.innerHTML = renderInvestments();
      break;
    case "Goals":
      content.innerHTML = renderGoals();
      break;
    case "Reports":
      content.innerHTML = renderReports();
      break;
    case "System Admins":
      content.innerHTML = renderAdmins(t, () => { if (state.activeNav === "System Admins") renderPage(); });
      break;
    case "Settings":
      content.innerHTML = renderSettings();
      break;
    case "Help & Support":
      content.innerHTML = renderHelp();
      break;
  }
  updateGlow();
}

function go(page: Page): void {
  state.activeNav = page;
  state.editingBudget = null;
  state.budgetError = "";
  document.querySelectorAll<HTMLElement>("[data-nav]").forEach((a) => a.classList.toggle("active", a.dataset.nav === page));
  document.body.classList.remove("nav-open");
  renderPage();
  window.scrollTo({ top: 0 });
}

function setSetting<K extends keyof Settings>(key: K, value: Settings[K]): void {
  settings[key] = value;
  saveSettings();
  if (key === "defaultRange") state.range = value as Range;
  if (key === "defaultPayment") state.payment = value as PaymentMethod;

  if (key === "lang" || key === "failedAlerts") {
    renderShell(); // nav, topbar and labels all change
    renderPage();
  } else if (key !== "theme" || state.activeNav === "Settings") {
    renderPage();
  }
  applyAppearance();
}

function resetSettings(): void {
  Object.assign(settings, DEFAULTS);
  saveSettings();
  state.range = settings.defaultRange;
  state.payment = settings.defaultPayment;
  renderShell();
  renderPage();
  applyAppearance();
}

/* ---------- payment methods ---------- */

const cardGradients: Record<PaymentMethod, string> = {
  telebirr: "linear-gradient(145deg, #0d3f2e 0%, #17684b 45%, #0a2e21 100%)",
  cash: "linear-gradient(145deg, #2c2a29 0%, #46413c 50%, #201e1c 100%)",
  cbe: "linear-gradient(145deg, #3d1a4c 0%, #642875 45%, #2b1035 100%)",
};

function renderPayment(): void {
  const panel = document.querySelector("#paymentPanel");
  if (!panel) return;
  const pm = paymentMethods[state.payment];
  const net = pm.moneyIn - pm.spent;
  const inPct = Math.round((pm.moneyIn / (pm.moneyIn + pm.spent)) * 100);

  panel.innerHTML = `
    <div class="panel-head"><h2>${t("Payment Methods")}</h2></div>
    <div class="payment-switch" role="group">
      ${PAYMENTS.map(
        (key) =>
          `<button data-payment="${key}" class="glow ${key === state.payment ? "active" : ""}" aria-pressed="${key === state.payment}">${t(paymentMethods[key].name)}</button>`,
      ).join("")}
    </div>
    <div class="pv-wrap glow" data-method="${state.payment}">
      <div class="payment-visual" style="background:${cardGradients[state.payment]}">
        <div class="pv-top">
          <span class="pv-brand">${t(pm.name)}</span>
          <span class="pv-chip">${icon("chip")}</span>
        </div>
        <div class="pv-number">${t(pm.account)}</div>
        <div class="pv-bottom">
          <div>
            <small>${t("Available Balance")}</small>
            <strong>${money(pm.balance)}</strong>
          </div>
          <div class="pv-change ${pm.change >= 0 ? "up" : "down"}">${signed(pm.change)}</div>
        </div>
      </div>
    </div>
    <div class="pm-side">
      <div class="flow">
        <div class="flow-head">
          <h3>${t("This month")}</h3>
          <span class="flow-net ${net >= 0 ? "up" : "down"}">${t("Net")} ${net >= 0 ? "+" : "-"}${money(Math.abs(net))}</span>
        </div>
        <div class="flow-nums">
          <div><small>${t("Money in")}</small><strong class="in">${money(pm.moneyIn)}</strong></div>
          <div><small>${t("Money out")}</small><strong class="out">${money(pm.spent)}</strong></div>
        </div>
        <div class="flow-bar" aria-hidden="true">
          <i class="in" style="width:${inPct}%"></i>
          <i class="out" style="width:${100 - inPct}%"></i>
        </div>
      </div>
      <div class="panel-head activity-head"><h3>${t("Latest activity (ETB)")}</h3></div>
      <ul class="activity">
        ${pm.activity
          .map(
            (a) => `
          <li>
            <span class="act-icon ${a.amount >= 0 ? "in" : "out"}">${icon(a.amount >= 0 ? "arrow-down-left" : "arrow-up-right")}</span>
            <span class="act-text"><strong>${escapeHtml(t(a.label))}</strong><small>${fmtWhen(a.when)}</small></span>
            <span class="act-amount ${a.amount >= 0 ? "in" : "out"}">${a.amount >= 0 ? "+" : "-"}${Math.abs(a.amount).toLocaleString("en-US")}</span>
          </li>`,
          )
          .join("")}
      </ul>
    </div>
  `;
  updateGlow();
}

/* ---------- counters ---------- */

let quietRedraw = false;

function animateCounters(): void {
  document.querySelectorAll<HTMLElement>("[data-count]").forEach((el) => {
    const target = Number(el.dataset.count);
    const fmt = (v: number): string => (el.dataset.unit === "%" ? `${v.toFixed(1)}%` : money(v));
    if (motionOff() || quietRedraw) {
      el.textContent = fmt(target);
      return;
    }
    const start = performance.now();
    const dur = 900;
    const tick = (now: number): void => {
      const p = Math.min(1, (now - start) / dur);
      el.textContent = fmt(target * (1 - Math.pow(1 - p, 3)));
      if (p < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}

/* ---------- chart ---------- */

interface ChartPoint {
  label: string; // main axis label
  sub?: string; // second axis line (date)
  title: string; // tooltip heading
  revenue: number;
  expenses: number;
  today?: boolean;
}

const startOfDay = (d: Date): Date => new Date(d.getFullYear(), d.getMonth(), d.getDate());

function seriesFor(range: Range): ChartPoint[] {
  const L = settings.lang;

  if (range === "Monthly") {
    const all = cashFlow.map((p, i) => ({ label: monthShort(L)[i], title: monthShort(L)[i], revenue: p.revenue, expenses: p.expenses }));
    if (!getLiveSeries()) return all;
    // live: from the first month with figures up to this month (no empty future months)
    const first = Math.max(0, cashFlow.findIndex((p) => p.revenue || p.expenses));
    return all.slice(Math.min(first, new Date().getMonth()), new Date().getMonth() + 1);
  }

  const today = startOfDay(new Date());

  const live = getLiveSeries();
  if (live && range === "Weekly") {
    return live.weekly.map((w, i) => {
      const start = new Date(`${w.start}T00:00`);
      return { label: `${t("W")}${i + 1}`, sub: fmtShort(start), title: t("Week of {x}", { x: fmtShort(start) }), revenue: w.revenue, expenses: w.expenses, today: i === live.weekly.length - 1 };
    });
  }
  if (live && range === "Daily") {
    return live.daily.map((x, i) => {
      const d = new Date(`${x.date}T00:00`);
      const dow = d.getDay();
      return { label: dayShort(L)[dow], sub: pad2(d.getDate()), title: `${dayLong(L)[dow]} · ${fmtShort(d)}`, revenue: x.revenue, expenses: x.expenses, today: i === live.daily.length - 1 };
    });
  }

  if (range === "Weekly") {
    // last 8 weeks, each starting on Monday, ending with the current week
    const monday = new Date(today);
    monday.setDate(today.getDate() - ((today.getDay() + 6) % 7));
    return Array.from({ length: 8 }, (_, i) => {
      const start = new Date(monday);
      start.setDate(monday.getDate() - (7 - i) * 7);
      return {
        label: `${t("W")}${i + 1}`,
        sub: fmtShort(start),
        title: t("Week of {x}", { x: fmtShort(start) }),
        revenue: 18000 + Math.round(Math.sin(i * 0.9) * 4000 + i * 800),
        expenses: 14000 + Math.round(Math.cos(i * 0.7) * 3000 + i * 500),
        today: i === 7,
      };
    });
  }

  // Daily: the last 7 calendar days ending today, so the weekday labels follow the real week
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(today);
    d.setDate(today.getDate() - (6 - i));
    const dow = d.getDay();
    const bump = (d.getDate() % 3) * 120;
    return {
      label: dayShort(L)[dow],
      sub: pad2(d.getDate()),
      title: `${dayLong(L)[dow]} · ${fmtShort(d)}`,
      revenue: dailyPattern.revenue[dow] + bump,
      expenses: dailyPattern.expenses[dow] + Math.round(bump / 2),
      today: i === 6,
    };
  });
}

const niceMax = (v: number): number => {
  const step = Math.pow(10, Math.floor(Math.log10(v || 1)));
  return Math.ceil(v / (step / 2)) * (step / 2);
};

function renderChart(): void {
  const svgEl = document.querySelector("#chart");
  const wrap = document.querySelector<HTMLElement>("#chartWrap");
  const tip = document.querySelector<HTMLElement>("#tooltip");
  if (!svgEl || !wrap || !tip) return;

  const svg = svgEl as SVGSVGElement;
  const data = seriesFor(state.range);
  const hasSub = data.some((d) => d.sub);
  const W = wrap.clientWidth;
  const H = wrap.clientHeight;
  const pad = { top: 18, right: 16, bottom: hasSub ? 46 : 30, left: 52 };
  const iw = W - pad.left - pad.right;
  const ih = H - pad.top - pad.bottom;

  const max = niceMax(Math.max(...data.flatMap((d) => [d.revenue, d.expenses])) * 1.15);
  const ticks = 5;
  const x = (i: number): number => pad.left + (iw * i) / Math.max(data.length - 1, 1);
  const y = (v: number): number => pad.top + ih - (v / max) * ih;
  const linePath = (key: "revenue" | "expenses"): string =>
    data.map((d, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(d[key]).toFixed(1)}`).join(" ");

  const revenuePath = linePath("revenue");
  const expensesPath = linePath("expenses");
  const areaPath = `${revenuePath} L${x(data.length - 1)},${pad.top + ih} L${x(0)},${pad.top + ih} Z`;
  const fmtTick = (v: number): string => (v >= 1000 ? `${(v / 1000).toFixed(v % 1000 ? 1 : 0)}K` : `${v}`);
  const skipOdd = W < 520 && data.length > 8;

  const xLabels = data
    .map((d, i) => {
      if (skipOdd && i % 2) return "";
      const cls = `axis${d.today ? " today" : ""}`;
      const main = `<text x="${x(i)}" y="${H - (hasSub ? 26 : 10)}" class="${cls}" text-anchor="middle">${escapeHtml(d.label)}</text>`;
      const sub = d.sub ? `<text x="${x(i)}" y="${H - 9}" class="${cls} sub" text-anchor="middle">${escapeHtml(d.sub)}</text>` : "";
      return main + sub;
    })
    .join("");

  const lastX = x(data.length - 1);
  const todayBand =
    data[data.length - 1]?.today && data.length > 1
      ? `<rect class="today-band" x="${lastX - iw / (data.length - 1) / 2}" y="${pad.top}" width="${iw / (data.length - 1) / 2}" height="${ih}"/>`
      : "";

  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  svg.innerHTML = `
    <defs>
      <linearGradient id="areaGrad" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" style="stop-color:var(--revenue)" stop-opacity="0.22"/>
        <stop offset="60%" style="stop-color:var(--revenue)" stop-opacity="0.06"/>
        <stop offset="100%" style="stop-color:var(--revenue)" stop-opacity="0"/>
      </linearGradient>
      <filter id="lineGlow" x="-20%" y="-20%" width="140%" height="140%">
        <feGaussianBlur stdDeviation="1.6" result="blur"/>
        <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
      </filter>
    </defs>
    ${todayBand}
    ${Array.from({ length: ticks + 1 }, (_, i) => {
      const v = (max / ticks) * i;
      const yy = y(v);
      return `<line x1="${pad.left}" y1="${yy}" x2="${W - pad.right}" y2="${yy}" stroke="var(--border)" stroke-width="1" stroke-dasharray="4 4" opacity="0.6"/>
        <text x="${pad.left - 10}" y="${yy + 4}" class="axis" text-anchor="end">${fmtTick(v)}</text>`;
    }).join("")}
    ${xLabels}
    <path d="${areaPath}" fill="url(#areaGrad)"/>
    <path d="${expensesPath}" class="line-exp" fill="none"/>
    <path d="${revenuePath}" class="line-inc" pathLength="1" fill="none" filter="url(#lineGlow)"/>
    <line id="cursor" class="cursor" y1="${pad.top}" y2="${pad.top + ih}" visibility="hidden"/>
    <circle id="dotInc" r="5" class="dot-inc" visibility="hidden"/>
    <circle id="dotExp" r="4" class="dot-exp" visibility="hidden"/>
    <rect x="${pad.left}" y="${pad.top}" width="${iw}" height="${ih}" fill="transparent" id="hit"/>
  `;

  const cursor = svg.querySelector("#cursor") as SVGLineElement;
  const dotInc = svg.querySelector("#dotInc") as SVGCircleElement;
  const dotExp = svg.querySelector("#dotExp") as SVGCircleElement;
  const hit = svg.querySelector("#hit") as SVGRectElement;

  const show = (i: number): void => {
    const d = data[i];
    const cx = x(i);
    cursor.setAttribute("x1", String(cx));
    cursor.setAttribute("x2", String(cx));
    dotInc.setAttribute("cx", String(cx));
    dotInc.setAttribute("cy", String(y(d.revenue)));
    dotExp.setAttribute("cx", String(cx));
    dotExp.setAttribute("cy", String(y(d.expenses)));
    [cursor, dotInc, dotExp].forEach((el) => el.setAttribute("visibility", "visible"));

    const net = d.revenue - d.expenses;
    tip.innerHTML = `
      <div class="tt-title">${escapeHtml(d.title)}${d.today && state.range === "Daily" ? ` · ${t("Today")}` : ""}</div>
      <div class="tt-row"><i class="sw inc"></i>${t("Revenue")} <b>${money(d.revenue)}</b></div>
      <div class="tt-row"><i class="sw exp"></i>${t("Expenses")} <b>${money(d.expenses)}</b></div>
      <div class="tt-row tt-net">
        <span>${t("Net")}</span>
        <b style="color:${net >= 0 ? "var(--revenue)" : "var(--expense)"}">${money(net)}</b>
      </div>`;
    tip.hidden = false;
    const tw = tip.offsetWidth;
    tip.style.left = `${Math.max(0, cx + 16 + tw > W ? cx - tw - 16 : cx + 16)}px`;
    tip.style.top = `${Math.max(8, y(Math.max(d.revenue, d.expenses)) - 40)}px`;
  };

  const hide = (): void => {
    [cursor, dotInc, dotExp].forEach((el) => el.setAttribute("visibility", "hidden"));
    tip.hidden = true;
  };

  hit.addEventListener("pointermove", (e: PointerEvent) => {
    const rect = svg.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * W;
    const i = Math.round(((px - pad.left) / iw) * (data.length - 1));
    show(Math.max(0, Math.min(data.length - 1, i)));
  });
  hit.addEventListener("pointerleave", hide);

  // open on the most relevant point: October for monthly, the current week / today otherwise
  // monthly: the latest full month (October in the demo)
  show(state.range === "Monthly" ? (getLiveSeries() ? Math.max(0, data.length - 2) : 9) : data.length - 1);
}

/* ---------- transactions table ---------- */

function filtered(): Transaction[] {
  const q = state.query.trim().toLowerCase();
  return transactions.filter(
    (x) =>
      (state.statusFilter === "All" || x.status === state.statusFilter) &&
      (!q ||
        [x.id, x.description, x.category, x.status, t(x.description), t(x.category), t(x.status)].some((s) =>
          s.toLowerCase().includes(q),
        )),
  );
}

function currentPageRows(): Transaction[] {
  const start = (state.page - 1) * state.pageSize;
  return filtered().slice(start, start + state.pageSize);
}

function renderTable(): void {
  const tbody = document.querySelector("#tbody");
  if (!tbody) return;

  const rows = filtered();
  const pages = Math.max(1, Math.ceil(rows.length / state.pageSize));
  state.page = Math.min(Math.max(1, state.page), pages);
  const pageRows = currentPageRows();

  tbody.innerHTML = pageRows.length
    ? pageRows
        .map((x) => {
          const bg = categoryColor[x.category];
          const desc = t(x.description);
          const sel = state.selected.has(x.id);
          return `
      <tr class="${sel ? "selected" : ""}">
        <td><input type="checkbox" data-id="${x.id}" ${sel ? "checked" : ""} aria-label="${x.id}"/></td>
        <td class="mono">${x.id}</td>
        <td><span class="merchant"><span class="m-icon" style="background:${bg}">${escapeHtml([...desc][0] ?? "")}</span>${escapeHtml(desc)}</span></td>
        <td><span class="cat"><i style="background:${bg}"></i>${t(x.category)}</span></td>
        <td>${fmtDate(x.date)}</td>
        <td class="mono">${money(Math.abs(x.amount))}</td>
        <td><span class="status ${x.status.toLowerCase()}">${t(x.status)}</span></td>
        <td><button class="icon-btn row-more" aria-label="${t("More")}">${icon("dots-h")}</button></td>
      </tr>`;
        })
        .join("")
    : `<tr><td colspan="8" class="empty">${t("No transactions match.")}</td></tr>`;

  const showing = document.querySelector("#showing");
  const pageLabel = document.querySelector("#pageLabel");
  if (showing) showing.textContent = t("Showing {x} of {y}", { x: pageRows.length, y: rows.length });
  if (pageLabel) pageLabel.textContent = t("Page {x} of {y}", { x: state.page, y: pages });

  const selectAll = document.querySelector<HTMLInputElement>("#selectAll");
  if (selectAll) selectAll.checked = pageRows.length > 0 && pageRows.every((x) => state.selected.has(x.id));

  const prev = document.querySelector<HTMLButtonElement>("#prev");
  const next = document.querySelector<HTMLButtonElement>("#next");
  if (prev) prev.disabled = state.page <= 1;
  if (next) next.disabled = state.page >= pages;
}

/* ---------- cursor glow (subtle) ---------- */

// Elements with the "glow" class pick up a faint light as the cursor nears them.
// CSS reads --gx / --gy (cursor position relative to the element) and --gi (0 to 1).
const pointer = { x: -9999, y: -9999 };
const GLOW_RANGE = 110;

function updateGlow(): void {
  if (!settings.glow) return;
  document.querySelectorAll<HTMLElement>(".glow").forEach((el) => {
    const r = el.getBoundingClientRect();
    const dx = Math.max(r.left - pointer.x, 0, pointer.x - r.right);
    const dy = Math.max(r.top - pointer.y, 0, pointer.y - r.bottom);
    const pad = el.tagName === "BUTTON" ? 14 : 22;
    const gx = Math.min(Math.max(pointer.x - r.left, -pad), r.width + pad);
    const gy = Math.min(Math.max(pointer.y - r.top, -pad), r.height + pad);
    el.style.setProperty("--gx", `${gx}px`);
    el.style.setProperty("--gy", `${gy}px`);
    el.style.setProperty("--gi", String(Math.max(0, 1 - Math.hypot(dx, dy) / GLOW_RANGE)));
  });
}

function initGlow(): void {
  let frame = 0;
  document.addEventListener("pointermove", (e) => {
    pointer.x = e.clientX;
    pointer.y = e.clientY;
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      updateGlow();
    });
  });
  document.documentElement.addEventListener("mouseleave", () => {
    pointer.x = -9999;
    pointer.y = -9999;
    updateGlow();
  });
}

/* ---------- events (delegated once, so re-renders never need re-binding) ---------- */

function onClick(e: MouseEvent): void {
  const el = e.target as HTMLElement;
  const hit = (sel: string): HTMLElement | null => el.closest<HTMLElement>(sel);

  const menu = document.querySelector<HTMLElement>("#filterMenu");
  if (menu && !menu.hidden && !hit(".filter-wrap")) menu.hidden = true;

  const nav = hit("[data-nav],[data-goto]");
  if (nav) {
    e.preventDefault();
    go((nav.dataset.nav || nav.dataset.goto) as Page);
    return;
  }

  if (state.activeNav === "System Admins" && adminsClick(el, t)) return;

  const themeBtn = hit("[data-theme-btn]");
  if (themeBtn) return setSetting("theme", themeBtn.dataset.themeBtn as ThemePref);

  const langBtn = hit("[data-lang]");
  if (langBtn) {
    if (langBtn.dataset.lang !== settings.lang) setSetting("lang", langBtn.dataset.lang as Lang);
    return;
  }

  const settingBtn = hit("[data-setting-key]");
  if (settingBtn) {
    const key = settingBtn.dataset.settingKey as keyof Settings;
    const raw = settingBtn.dataset.settingValue ?? "";
    return setSetting(key, (key === "budgetWarn" ? Number(raw) : raw) as never);
  }

  const bEdit = hit("[data-budget-edit]");
  if (bEdit) return startBudgetEdit(bEdit.dataset.budgetEdit as Category);
  const bSave = hit("[data-budget-save]");
  if (bSave) return saveBudget(bSave.dataset.budgetSave as Category);
  if (hit("[data-budget-cancel]")) return cancelBudgetEdit();
  if (hit("[data-budget-undo]")) return undoBudget();
  const bMatch = hit("[data-budget-match]");
  if (bMatch) {
    const input = document.querySelector<HTMLInputElement>("#budgetInput");
    if (input) {
      input.value = Number(bMatch.dataset.budgetMatch).toLocaleString("en-US");
      input.focus();
    }
    return;
  }
  const bSort = hit("[data-budget-sort]");
  if (bSort) {
    state.budgetSort = bSort.dataset.budgetSort as BudgetSort;
    return refreshBudgets(`[data-budget-sort="${state.budgetSort}"]`);
  }
  const bReview = hit("[data-budget-review]");
  if (bReview) {
    state.query = t(bReview.dataset.budgetReview as Category);
    state.statusFilter = "All";
    state.page = 1;
    go("Transactions");
    return;
  }

  const rangeBtn = hit("[data-range]");
  if (rangeBtn) {
    state.range = rangeBtn.dataset.range as Range;
    document.querySelectorAll("#rangeSeg button").forEach((b) => b.classList.toggle("active", b === rangeBtn));
    return renderChart();
  }

  const payBtn = hit("[data-payment]");
  if (payBtn) {
    state.payment = payBtn.dataset.payment as PaymentMethod;
    return renderPayment();
  }

  const statusBtn = hit("[data-status]");
  if (statusBtn && menu) {
    state.statusFilter = statusBtn.dataset.status as State["statusFilter"];
    state.page = 1;
    menu.querySelectorAll("button").forEach((b) => b.classList.toggle("active", b === statusBtn));
    menu.hidden = true;
    return renderTable();
  }

  if (hit("#filterBtn") && menu) {
    menu.hidden = !menu.hidden;
    return;
  }
  if (hit("#prev")) {
    state.page--;
    return renderTable();
  }
  if (hit("#next")) {
    state.page++;
    return renderTable();
  }
  const report = hit("[data-report]");
  if (report) return generateReport(report.dataset.report as ReportKey);
  if (hit("#resetSettings")) return resetSettings();
  if (hit("#menuBtn")) return void document.body.classList.add("nav-open");
  if (hit("#scrim")) return void document.body.classList.remove("nav-open");
}

function onChange(e: Event): void {
  const el = e.target as HTMLInputElement;
  if (el.dataset.id) {
    if (el.checked) state.selected.add(el.dataset.id);
    else state.selected.delete(el.dataset.id);
    renderTable();
  } else if (el.id === "selectAll") {
    currentPageRows().forEach((x) => (el.checked ? state.selected.add(x.id) : state.selected.delete(x.id)));
    renderTable();
  } else if (el.dataset.settingToggle) {
    setSetting(el.dataset.settingToggle as keyof Settings, el.checked as never);
  }
}

function onInput(e: Event): void {
  const el = e.target as HTMLInputElement;
  if (el.dataset.budgetInput && state.budgetError) {
    state.budgetError = "";
    el.setAttribute("aria-invalid", "false");
    const err = document.querySelector("#budgetErr");
    if (err) err.textContent = "";
    return;
  }
  if (el.id !== "tableSearch") return;
  state.query = el.value;
  state.page = 1;
  renderTable();
}

function onKeydown(e: KeyboardEvent): void {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
    e.preventDefault();
    const global = document.querySelector<HTMLInputElement>("#globalSearch");
    if (global && global.offsetParent !== null) global.focus();
    else {
      go("Transactions");
      document.querySelector<HTMLInputElement>("#tableSearch")?.focus();
    }
    return;
  }
  const target = e.target as HTMLElement;
  if (target.dataset?.budgetInput) {
    if (e.key === "Enter") {
      e.preventDefault();
      return saveBudget(target.dataset.budgetInput as Category);
    }
    if (e.key === "Escape") return cancelBudgetEdit();
  }
  if (e.key === "Escape") {
    document.body.classList.remove("nav-open");
    const menu = document.querySelector<HTMLElement>("#filterMenu");
    if (menu) menu.hidden = true;
    return;
  }
  const el = e.target as HTMLInputElement;
  if (e.key === "Enter" && el.id === "globalSearch") {
    state.query = el.value;
    state.page = 1;
    el.value = "";
    go("Transactions");
    const input = document.querySelector<HTMLInputElement>("#tableSearch");
    input?.focus();
    input?.setSelectionRange(input.value.length, input.value.length);
  }
}

/* ---------- boot ---------- */

function init(): void {
  renderShell();
  applyAppearance();

  document.addEventListener("click", onClick);
  document.addEventListener("change", onChange);
  document.addEventListener("input", onInput);
  document.addEventListener("keydown", onKeydown);

  let resizeTimer = 0;
  window.addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(() => {
      if (state.activeNav === "Dashboard") renderChart();
    }, 120);
  });

  initGlow();
  renderPage();
}

/* ---------- live sign-in ---------- */

const liveUi = { message: "", busy: false, username: "" };

function liveMessage(err: unknown): string {
  const m = err instanceof Error ? err.message : String(err);
  if (m === "wrong") return t("Wrong username or password.");
  if (m === "no-access") return t("Only the Owner can open this app. System Admins sign in to the Admin app.");
  if (m.includes("Failed to fetch") || m.includes("NetworkError") || m.includes("Load failed")) return t("Cannot reach the server. It may be waking up — try again in a minute.");
  return m;
}

function renderSignIn(): void {
  applyAppearance();
  $("#app").innerHTML = `
  <div class="signin-wrap">
    <form class="panel signin-card" id="liveSignIn" novalidate>
      <div class="brand"><img class="brand-logo" src="/logo-light.png" alt="SEER"><img class="brand-logo dark-only" src="/logo-dark.png" alt="SEER"><span><strong>SEER</strong></span></div>
      <h1>${t("Sign in")}</h1>
      <p class="muted-note">${t("For the restaurant Owner only.")}</p>
      <label class="signin-field"><span>${t("Username")}</span>
        <input id="liveUser" autocomplete="username" autocapitalize="none" spellcheck="false" value="${escapeHtml(liveUi.username)}"></label>
      <label class="signin-field"><span>${t("Password")}</span>
        <input id="livePass" type="password" autocomplete="current-password"></label>
      <p class="field-error" id="liveErr" role="alert">${escapeHtml(liveUi.message)}</p>
      <button type="submit" class="btn btn-primary" ${liveUi.busy ? "disabled" : ""}>${liveUi.busy ? t("Signing in…") : t("Sign in")}</button>
      <div class="seg-toggle lang-toggle" role="group" aria-label="${t("Language")}">
        ${LANGS.map((l) => `<button type="button" data-signin-lang="${l.code}" lang="${l.code}" aria-pressed="${settings.lang === l.code}">${l.short}</button>`).join("")}
      </div>
    </form>
  </div>`;
  $<HTMLInputElement>(liveUi.message ? "#livePass" : "#liveUser").focus();
}

let started = false;
/* ---------- keep the numbers live: every minute, and when the owner comes back to the tab ---------- */

const REFRESH_MS = 60_000;
const LIVE_PAGES: readonly string[] = ["Dashboard", "Analytics", "Transactions", "Budgets", "Goals", "Investments"];
let lastLoaded = 0;
let refreshing = false;
let redrawWaiting = false;

function stampLive(): void {
  const el = document.getElementById("liveStamp");
  if (!el || !lastLoaded) return;
  const mins = Math.floor((Date.now() - lastLoaded) / 60_000);
  el.textContent = t("Updated {x}", { x: mins < 1 ? t("just now") : t("{n} min ago", { n: mins }) });
}

const typing = (): boolean => {
  const a = document.activeElement as HTMLElement | null;
  return !!a && (a.tagName === "INPUT" || a.tagName === "TEXTAREA" || a.tagName === "SELECT" || a.isContentEditable);
};

function redraw(): void {
  if (!LIVE_PAGES.includes(state.activeNav) || document.querySelector("dialog[open], .modal.open")) return;
  const y = window.scrollY;
  quietRedraw = true;
  try { renderPage(); } finally { quietRedraw = false; }
  window.scrollTo(0, y);
  stampLive();
}

async function refreshLive(): Promise<void> {
  if (!isLive || !started || refreshing || document.hidden || !sessionUser()) return;
  refreshing = true;
  try {
    await loadLive();
    lastLoaded = Date.now();
  } catch {
    return;                       // offline or asleep: keep showing the last numbers
  } finally {
    refreshing = false;
  }
  if (typing()) redrawWaiting = true;
  else redraw();
}

if (isLive) {
  window.setInterval(() => { void refreshLive(); stampLive(); }, REFRESH_MS);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && Date.now() - lastLoaded > 15_000) void refreshLive();
  });
  document.addEventListener("focusout", () => {
    window.setTimeout(() => { if (redrawWaiting && !typing()) { redrawWaiting = false; redraw(); } }, 0);
  });
}

async function startLive(): Promise<void> {
  liveUi.busy = true;
  renderSignIn();
  try {
    await loadLive();
    lastLoaded = Date.now();
    liveUi.message = "";
    liveUi.busy = false;
    if (started) { renderShell(); applyAppearance(); renderPage(); }
    else { started = true; init(); }
  } catch (err) {
    liveUi.message = liveMessage(err);
    liveUi.busy = false;
    if (sessionUser()) await apiSignOut();
    renderSignIn();
  }
}

function onSignInSubmit(e: Event): void {
  const form = e.target as HTMLFormElement;
  if (form.id !== "liveSignIn") return;
  e.preventDefault();
  if (liveUi.busy) return;
  const u = $<HTMLInputElement>("#liveUser").value;
  const p = $<HTMLInputElement>("#livePass").value;
  liveUi.username = u;
  if (!u.trim() || !p) { liveUi.message = t("Enter your username and password."); renderSignIn(); return; }
  liveUi.busy = true; liveUi.message = ""; renderSignIn();
  apiSignIn(u, p).then(startLive, (err) => { liveUi.busy = false; liveUi.message = liveMessage(err); renderSignIn(); });
}

document.addEventListener("submit", (e) => {
  const form = e.target as HTMLFormElement;
  if (form.id === "adminForm") { e.preventDefault(); adminsSubmit(form, t); }
});

if (isLive) {
  document.addEventListener("submit", onSignInSubmit);
  document.addEventListener("click", (e) => {
    const el = e.target as HTMLElement;
    const lang = el.closest<HTMLElement>("[data-signin-lang]")?.dataset.signinLang as Lang | undefined;
    if (lang) { settings.lang = lang; saveSettings(); renderSignIn(); return; }
    if (el.closest("[data-signout]")) { void apiSignOut(); liveUi.message = ""; renderSignIn(); }
  });
  if (sessionUser()) void startLive(); else renderSignIn();
} else {
  init();
}
