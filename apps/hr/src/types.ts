/* =========================================================
   HR & Staff Management — domain types.
   Block 1 is the specification, unchanged.
   Block 2 extends it (documented) for scheduling, breaks,
   payroll and performance logs. Tip pooling was removed.
   ========================================================= */

/* ---------- 1. Specification ---------- */

export type SupportedLanguage = "en" | "am" | "om";

export type UserRole = "BRANCH_MANAGER" | "SALES_STAFF" | "KITCHEN_STAFF" | "INVENTORY_CLERK" | "ADMIN";

export interface Employee {
  id: string;
  fullName: string;
  role: UserRole;
  phone: string;
  hourlyRate: number;
  monthlySalary?: number;
  branchId: string;
  status: "ACTIVE" | "INACTIVE";
}

export interface ShiftRecord {
  id: string;
  employeeId: string;
  employeeName: string;
  shiftDate: string;
  clockIn: string;
  clockOut?: string;
  overtimeHours: number;
  status: "SCHEDULED" | "CLOCKED_IN" | "COMPLETED" | "ABSENT";
}

/* ---------- 2. Extensions ---------- */

export interface LocalizedText {
  en: string;
  am: string;
  om: string;
}

export type ViewId = "today" | "staff" | "schedule" | "attendance" | "payroll" | "performance";

/** Employee profile: spec fields + contact email, hire date and pay basis. */
export interface EmployeeProfile extends Employee {
  email: string;
  hireDate: string;
  /** HOURLY: paid hourlyRate × regular hours. MONTHLY: paid monthlySalary; hourlyRate is used for overtime. */
  payType: "HOURLY" | "MONTHLY";
}

export interface Branch {
  id: string;
  nameKey: string;
}

/* --- scheduling --- */

export type ShiftCode = "MORNING" | "DAY" | "EVENING";

export interface ShiftTemplate {
  code: ShiftCode;
  /** "HH:MM" */
  start: string;
  end: string;
  hours: number;
}

/** One planned shift on the weekly grid. */
export interface ScheduleEntry {
  id: string;
  employeeId: string;
  date: string;
  shift: ShiftCode;
}

/* --- attendance --- */

export interface BreakPeriod {
  start: string;
  end?: string;
}

/** A shift's attendance: spec ShiftRecord + planned times, breaks, lateness and overtime premium. */
export interface AttendanceRecord extends ShiftRecord {
  shift: ShiftCode;
  scheduledStart: string;
  scheduledEnd: string;
  breaks: BreakPeriod[];
  /** minutes after scheduled start (0 if on time) */
  lateMinutes: number;
  /** 1.5 weekday · 1.75 night (after 22:00) · 2.0 weekly rest day (Sunday) */
  overtimeMultiplier: number;
  /** staff ID of whoever pressed the button (self or manager) */
  loggedBy: string;
}

/* --- payroll --- */

export interface Payslip {
  employeeId: string;
  regularHours: number;
  overtimeHours: number;
  basePay: number;
  overtimePay: number;
  grossTaxable: number;
  incomeTax: number;
  pensionEmployee: number;
  pensionEmployer: number;
  netPay: number;
  /** month to date: share of the month elapsed applied to monthly salaries */
  prorated: boolean;
}

export interface PayrollRun {
  month: string; // "YYYY-MM"
  status: "DRAFT" | "APPROVED";
  approvedBy?: string;
  approvedAt?: string;
}

/* --- performance & discipline --- */

export type LogType = "REVIEW" | "COMMENDATION" | "VOID_INCIDENT" | "LATENESS" | "WARNING" | "INCIDENT";

export interface PerformanceLog {
  id: string;
  employeeId: string;
  type: LogType;
  /** 1–5, for reviews */
  rating?: number;
  severity: "LOW" | "MEDIUM" | "HIGH";
  note: string;
  /** where the entry came from: logged here, or linked from the Branch Manager Dashboard */
  source: "HR" | "MANAGER_MODULE";
  /** e.g. a voided ticket number in the manager module */
  reference?: string;
  loggedBy: string;
  timestamp: string;
}

export type FieldErrors = Partial<Record<string, string>>;
