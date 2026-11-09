/* =========================================================
   Reference data and HR rules: roles, branches, shift templates,
   log types, Ethiopian payroll rules (PAYE brackets after
   Proclamation 1395/2025, pension 7% / 11%) and overtime
   multipliers (Labour Proclamation 1156/2019).
   Every display name is a LocalizedText registered for tk().
   ========================================================= */

import type { Branch, LocalizedText, LogType, ShiftCode, ShiftTemplate, UserRole } from "./types";
import { registerText } from "./i18n";

const L = (en: string, am: string, om: string): LocalizedText => ({ en, am, om });

function reg<K extends string>(prefix: string, map: Record<K, LocalizedText>): Record<K, LocalizedText> {
  for (const k of Object.keys(map) as K[]) registerText(`${prefix}.${k}`, map[k]);
  return map;
}

/* ---------- roles ---------- */

export const ROLES = reg<UserRole>("role", {
  BRANCH_MANAGER: L("Branch Manager", "የቅርንጫፍ ሥራ አስኪያጅ", "Hoji Gaggeessaa Damee"),
  SALES_STAFF: L("Sales Staff", "የሽያጭ ሰራተኛ", "Hojjetaa Gurgurtaa"),
  KITCHEN_STAFF: L("Kitchen Crew", "የወጥ ቤት ሰራተኛ", "Hojjetaa Kushinaa"),
  INVENTORY_CLERK: L("Inventory Clerk", "የክምችት ባለሙያ", "Ogeessa Kuusaa"),
  ADMIN: L("Admin", "አስተዳዳሪ", "Bulchaa"),
});
export const ROLE_IDS = Object.keys(ROLES) as UserRole[];
export const ROLE_COLOR: Record<UserRole, string> = {
  BRANCH_MANAGER: "#c9a0f2", SALES_STAFF: "#8fd3f4", KITCHEN_STAFF: "#f2c48d", INVENTORY_CLERK: "#5bd18b", ADMIN: "#a4acc4",
};
export const isRole = (v: string): v is UserRole => v in ROLES;

/* ---------- branches ---------- */

const branchNames = reg("branch", {
  "BR-BOLE-01": L("Bole Branch", "ቦሌ ቅርንጫፍ", "Damee Boolee"),
  "BR-PIASSA-02": L("Piassa Branch", "ፒያሳ ቅርንጫፍ", "Damee Piyaassaa"),
  "BR-CMC-03": L("CMC Branch", "ሲኤምሲ ቅርንጫፍ", "Damee CMC"),
});
export const BRANCHES: readonly Branch[] = (Object.keys(branchNames) as (keyof typeof branchNames)[]).map((id) => ({ id, nameKey: `branch.${id}` }));

/* ---------- shifts ---------- */

export const SHIFT_NAMES = reg<ShiftCode>("shift", {
  MORNING: L("Morning", "ጠዋት", "Ganama"),
  DAY: L("Day", "ቀን", "Guyyaa"),
  EVENING: L("Evening", "ምሽት", "Galgala"),
});
export const SHIFTS: Record<ShiftCode, ShiftTemplate> = {
  MORNING: { code: "MORNING", start: "06:00", end: "14:00", hours: 8 },
  DAY: { code: "DAY", start: "10:00", end: "18:00", hours: 8 },
  EVENING: { code: "EVENING", start: "14:00", end: "22:00", hours: 8 },
};
export const SHIFT_IDS = Object.keys(SHIFTS) as ShiftCode[];
export const SHIFT_COLOR: Record<ShiftCode, string> = { MORNING: "#f2c48d", DAY: "#8fd3f4", EVENING: "#c9a0f2" };
export const isShift = (v: string): v is ShiftCode => v in SHIFTS;
/** Minimum people wanted per shift, used for the coverage row of the planner. */
export const COVERAGE_TARGET: Record<ShiftCode, number> = { MORNING: 3, DAY: 2, EVENING: 4 };

/* ---------- working time & overtime (Labour Proclamation 1156/2019) ---------- */

export const NORMAL_DAY_HOURS = 8;
export const NORMAL_WEEK_HOURS = 48;
/** Hours in a working month used to derive the hourly rate of salaried staff (48 h × 52 weeks ÷ 12). */
export const MONTH_HOURS = 208;
export const OT_DAY = 1.5;
export const OT_NIGHT = 1.75;
export const OT_REST_DAY = 2.0;
/** Grace period before a clock-in counts as late. */
export const LATE_GRACE_MIN = 5;

/* ---------- statutory deductions ---------- */

/** Monthly PAYE on employment income after Proclamation 1395/2025 (in force from July 2025): tax = income × rate − deduction. */
export const PAYE_BRACKETS: readonly { upTo: number; rate: number; deduction: number }[] = [
  { upTo: 2000, rate: 0, deduction: 0 },
  { upTo: 4000, rate: 0.15, deduction: 300 },
  { upTo: 7000, rate: 0.2, deduction: 500 },
  { upTo: 10000, rate: 0.25, deduction: 850 },
  { upTo: 14000, rate: 0.3, deduction: 1350 },
  { upTo: Infinity, rate: 0.35, deduction: 2050 },
];
/** Private-sector pension, on basic salary. */
export const PENSION_EMPLOYEE = 0.07;
export const PENSION_EMPLOYER = 0.11;

export function incomeTax(monthlyTaxable: number): number {
  const b = PAYE_BRACKETS.find((x) => monthlyTaxable <= x.upTo) ?? PAYE_BRACKETS[PAYE_BRACKETS.length - 1];
  return Math.max(0, Math.round((monthlyTaxable * b.rate - b.deduction) * 100) / 100);
}

/* ---------- performance & discipline ---------- */

export const LOG_TYPES = reg<LogType>("log", {
  REVIEW: L("Performance review", "የአፈጻጸም ግምገማ", "Madaallii raawwii"),
  COMMENDATION: L("Commendation", "ምስጋና", "Galateeffannaa"),
  VOID_INCIDENT: L("Void / cancellation incident", "የመሰረዝ ክስተት", "Taatee haquu"),
  LATENESS: L("Lateness", "ማርፈድ", "Turuu"),
  WARNING: L("Disciplinary warning", "የዲሲፕሊን ማስጠንቀቂያ", "Akeekkachiisa naamusaa"),
  INCIDENT: L("General incident", "አጠቃላይ ክስተት", "Taatee waliigalaa"),
});
export const LOG_IDS = Object.keys(LOG_TYPES) as LogType[];
export const LOG_COLOR: Record<LogType, string> = {
  REVIEW: "#8fd3f4", COMMENDATION: "#5bd18b", VOID_INCIDENT: "#f2c48d", LATENESS: "#fb9a4b", WARNING: "#ff7b6e", INCIDENT: "#c9a0f2",
};
export const isLogType = (v: string): v is LogType => v in LOG_TYPES;
/** Negative entries count against the employee's record. */
export const NEGATIVE_LOGS: ReadonlySet<LogType> = new Set<LogType>(["VOID_INCIDENT", "LATENESS", "WARNING", "INCIDENT"]);

export const SEVERITY = reg("sev", {
  LOW: L("Low", "ዝቅተኛ", "Gadi aanaa"),
  MEDIUM: L("Medium", "መካከለኛ", "Giddugaleessa"),
  HIGH: L("High", "ከፍተኛ", "Ol aanaa"),
});
