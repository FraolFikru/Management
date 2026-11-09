export type Status = "Success" | "Pending" | "Failed";
export type Category = "Food Cost" | "Labor" | "Utilities" | "Rent" | "Marketing" | "Supplies";
export type PaymentMethod = "telebirr" | "cash" | "cbe";
/** "Today" / "Yesterday" are translated; a Date is formatted in the active language. */
export type When = "Today" | "Yesterday" | Date;

export interface Transaction {
  id: string;
  description: string;
  category: Category;
  date: Date;
  amount: number;
  status: Status;
}

export interface MonthPoint {
  month: string;
  revenue: number;
  expenses: number;
}

export interface PaymentInfo {
  id: PaymentMethod;
  name: string;
  balance: number;
  change: number;
  account: string;
  spent: number;
  limit: number;
  moneyIn: number;
  activity: { label: string; when: When; amount: number }[];
}

export interface Stat {
  label: string;
  value: number;
  note: string;
  change: number;
  icon: string;
  unit: "ETB" | "%";
  lowerIsBetter: boolean;
}

export const user = {
  name: "Abebe Kebede",
  email: "owner@bistroaddis.com",
  restaurant: "Bistro Addis",
};

export const cashFlow: MonthPoint[] = [
  { month: "Jan", revenue: 87000, expenses: 62500 },
  { month: "Feb", revenue: 92500, expenses: 64800 },
  { month: "Mar", revenue: 88000, expenses: 67200 },
  { month: "Apr", revenue: 94500, expenses: 69100 },
  { month: "May", revenue: 101200, expenses: 71200 },
  { month: "Jun", revenue: 112500, expenses: 75800 },
  { month: "Jul", revenue: 118000, expenses: 78200 },
  { month: "Aug", revenue: 124500, expenses: 76500 },
  { month: "Sep", revenue: 119800, expenses: 74100 },
  { month: "Oct", revenue: 128400, expenses: 76900 },
  { month: "Nov", revenue: 115200, expenses: 72800 },
  { month: "Dec", revenue: 132000, expenses: 81200 },
];

/** Typical takings by weekday (index 0 = Sunday), used for the Daily chart. */
export const dailyPattern = {
  revenue: [5200, 3400, 3600, 3900, 4100, 4900, 5600],
  expenses: [2900, 2300, 2400, 2500, 2600, 2800, 3100],
};

export const paymentMethods: Record<PaymentMethod, PaymentInfo> = {
  telebirr: {
    id: "telebirr",
    name: "Telebirr",
    balance: 28450.75,
    change: 5.2,
    account: "0912 345 678",
    spent: 12480,
    limit: 50000,
    moneyIn: 64200,
    activity: [
      { label: "Dinner service payments", when: "Today", amount: 4850 },
      { label: "Fresh Produce Supplier", when: "Yesterday", amount: -4250 },
      { label: "Water Bill", when: new Date(2026, 9, 6), amount: -890 },
    ],
  },
  cash: {
    id: "cash",
    name: "Cash",
    balance: 8200,
    change: -2.1,
    account: "Drawer",
    spent: 3150,
    limit: 15000,
    moneyIn: 21300,
    activity: [
      { label: "Lunch service cash", when: "Today", amount: 2300 },
      { label: "Kitchen Supplies - Restock", when: "Yesterday", amount: -980 },
      { label: "Menu Printing", when: new Date(2026, 9, 7), amount: -450 },
    ],
  },
  cbe: {
    id: "cbe",
    name: "CBE",
    balance: 186400.2,
    change: 9.4,
    account: "1000 1234 5678",
    spent: 42800,
    limit: 200000,
    moneyIn: 182500,
    activity: [
      { label: "Daily sales deposit", when: "Today", amount: 18420 },
      { label: "Monthly Rent - Bole", when: new Date(2026, 9, 3), amount: -25000 },
      { label: "Staff Payroll - Week 44", when: new Date(2026, 9, 1), amount: -18700 },
    ],
  },
};

/* ---------- headline metrics (derived, so the cards always agree with the data) ---------- */

const round1 = (n: number): number => Math.round(n * 10) / 10;
const pctChange = (now: number, before: number): number => round1(((now - before) / before) * 100);
const margin = (p: MonthPoint): number => ((p.revenue - p.expenses) / p.revenue) * 100;

const current = cashFlow[9]; // October — latest closed month
const previous = cashFlow[8];
const totalBalance = Math.round(Object.values(paymentMethods).reduce((s, p) => s + p.balance, 0) * 100) / 100;

export const stats: Stat[] = [
  { label: "Total Balance", value: totalBalance, note: "across 3 accounts", change: 6.8, icon: "wallet", unit: "ETB", lowerIsBetter: false },
  { label: "Total Revenue", value: current.revenue, note: "this month", change: pctChange(current.revenue, previous.revenue), icon: "trend-up", unit: "ETB", lowerIsBetter: false },
  { label: "Total Expense", value: current.expenses, note: "this month", change: pctChange(current.expenses, previous.expenses), icon: "receipt", unit: "ETB", lowerIsBetter: true },
  { label: "Profit Margin", value: round1(margin(current)), note: "target ≥ 35%", change: round1(margin(current) - margin(previous)), icon: "percent", unit: "%", lowerIsBetter: false },
];

/* ---------- transactions ---------- */

const merchants: { description: string; category: Category; amount: number }[] = [
  { description: "Fresh Produce Supplier", category: "Food Cost", amount: 4250 },
  { description: "Staff Payroll - Week 44", category: "Labor", amount: 18700 },
  { description: "Electricity - Ethio Telecom", category: "Utilities", amount: 3200 },
  { description: "Monthly Rent - Bole", category: "Rent", amount: 25000 },
  { description: "Facebook Ads Campaign", category: "Marketing", amount: 1850 },
  { description: "Kitchen Supplies - Restock", category: "Supplies", amount: 980 },
  { description: "Meat & Poultry Vendor", category: "Food Cost", amount: 6750 },
  { description: "Part-time Waiters", category: "Labor", amount: 4200 },
  { description: "Water Bill", category: "Utilities", amount: 890 },
  { description: "Menu Printing", category: "Marketing", amount: 450 },
];

const statuses: Status[] = ["Success", "Success", "Pending", "Failed", "Success", "Success", "Success", "Pending"];

export const transactions: Transaction[] = Array.from({ length: 50 }, (_, i) => {
  const m = merchants[i % merchants.length];
  const date = new Date(2026, 9, 1 + Math.floor(i * 0.7));
  return {
    id: `ORD-2026-${String(i + 1).padStart(3, "0")}`,
    description: m.description,
    category: m.category,
    date,
    amount: -m.amount,
    status: i < 4 ? (["Success", "Success", "Pending", "Failed"] as Status[])[i] : statuses[i % statuses.length],
  };
});

export const categoryColor: Record<Category, string> = {
  "Food Cost": "#7fcf8f",
  Labor: "#7fa3e0",
  Utilities: "#e07fae",
  Rent: "#ec5f48",
  Marketing: "#b18ae8",
  Supplies: "#4fc6b0",
};

/* ---------- analytics ---------- */

export const topDishes = [
  { name: "Kitfo Special", sold: 186, revenue: 37200, pct: 22 },
  { name: "Doro Wat", sold: 142, revenue: 28400, pct: 17 },
  { name: "Tibs Mix", sold: 128, revenue: 25600, pct: 15 },
  { name: "Shiro", sold: 97, revenue: 14550, pct: 9 },
  { name: "Firfir", sold: 84, revenue: 12600, pct: 7 },
];

export const peakHours = [
  { hour: "11–12", orders: 18 },
  { hour: "12–13", orders: 42 },
  { hour: "13–14", orders: 38 },
  { hour: "18–19", orders: 51 },
  { hour: "19–20", orders: 67 },
  { hour: "20–21", orders: 44 },
];

/* ---------- budgets ---------- */

export interface BudgetLine {
  category: Category;
  /** monthly budget target — editable in the UI (kept in memory only) */
  allocated: number;
  /** actual spend so far this month */
  spent: number;
  /** last month's actual, for comparison */
  lastMonth: number;
  /** fixed costs (rent) are not extrapolated: the month-end figure is the contract amount */
  fixed?: { committed: number; paidOn: Date | null };
}

/** The current budget month, so the pace and projections always match today's date. */
const now = new Date();
export const budgetPeriod = {
  year: now.getFullYear(),
  month: now.getMonth(),
  day: now.getDate(),
  daysInMonth: new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate(),
};
const elapsed = budgetPeriod.day / budgetPeriod.daysInMonth;

// pace = how fast each category is spending relative to an even spread over the month (1 = exactly on plan)
const budgetPlan: { category: Category; allocated: number; pace: number; lastMonth: number }[] = [
  { category: "Food Cost", allocated: 35000, pace: 1.08, lastMonth: 33900 },
  { category: "Labor", allocated: 42000, pace: 1.04, lastMonth: 41200 },
  { category: "Utilities", allocated: 8000, pace: 0.92, lastMonth: 7650 },
  { category: "Marketing", allocated: 5000, pace: 0.7, lastMonth: 4100 },
  { category: "Supplies", allocated: 4000, pace: 1.15, lastMonth: 3950 },
];

const RENT = 25000;
const rentPaidOn = budgetPeriod.day >= 3 ? new Date(budgetPeriod.year, budgetPeriod.month, 3) : null;

export const budgets: BudgetLine[] = [
  ...budgetPlan.map((p) => ({
    category: p.category,
    allocated: p.allocated,
    spent: Math.round((p.allocated * elapsed * p.pace) / 10) * 10,
    lastMonth: p.lastMonth,
  })),
  {
    category: "Rent",
    allocated: RENT,
    spent: rentPaidOn ? RENT : 0,
    lastMonth: RENT,
    fixed: { committed: RENT, paidOn: rentPaidOn },
  },
];

/* ---------- goals ---------- */

export const goals: { title: string; current: number; target: number; unit: "ETB" | "%" | "★"; deadline: Date | null; lowerIsBetter?: boolean }[] = [
  { title: "Monthly Revenue Target", current: 128400, target: 150000, unit: "ETB", deadline: new Date(2026, 10, 30) },
  { title: "Food Cost under 30%", current: 31.2, target: 30, unit: "%", deadline: new Date(2026, 11, 15), lowerIsBetter: true },
  { title: "Average Order Value", current: 420, target: 480, unit: "ETB", deadline: new Date(2026, 11, 31) },
  { title: "Customer Reviews (4.5+)", current: 4.3, target: 4.5, unit: "★", deadline: null },
];
