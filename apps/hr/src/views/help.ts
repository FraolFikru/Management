/* Help & support for this app: what the role does, common problems, who to ask. */

import { installSupport, supportHtml, type HelpContent, type Who } from "../support";
import { t } from "../i18n";
import { isLive, sessionUser } from "../api";


/** Role codes → the names people use. */
export const ROLE_NAME: Record<string, string> = {
  OWNER: "Owner", ADMIN: "System Admin", BRANCH_MANAGER: "Branch manager", ACCOUNTANT: "Accountant", HR_OFFICER: "HR officer",
  INVENTORY_CLERK: "Inventory clerk", SALES_STAFF: "Cashier", KITCHEN_STAFF: "Kitchen staff", WAITER: "Waiter",
};

export const CONTENT: HelpContent = {
  app: "HR & staff",
  intro: "For HR: the staff list, shift planning, attendance, payroll and performance.",
  steps: [
    { title: "Start with Today", body: "Who is on shift, who is late and who hasn't arrived." },
    { title: "Keep the staff list current", body: "Staff directory: hire new people, edit their details and pay, and deactivate anyone who leaves. Deactivating also blocks their sign-in." },
    { title: "Plan the shifts", body: "Shift planner: plan each branch's week ahead." },
    { title: "Correct attendance", body: "Attendance: mark someone absent or restore a record, with a reason." },
    { title: "Run payroll", body: "Payroll: check the month's hours and pay for each branch, then approve it. Reopen it if something must be fixed before paying." },
  ],
  faqs: [
    { q: "A new employee can't sign in.", a: "Hiring creates their account without a password. Ask a System Admin to set a password, or a PIN for the Waiter app, in the Admin app." },
    { q: "I can't give someone the System Admin or Owner role.", a: "Only the Owner can give those roles." },
    { q: "Payroll is approved but a figure is wrong.", a: "Reopen payroll for that branch, fix the attendance or the pay rate, and approve it again." },
    { q: "Someone's hours are missing.", a: "Open Attendance for that day and add or restore the record." },
    { q: "\"Not saved\" appeared after a change.", a: "The server didn't accept the change, so it was undone on your screen. Check the connection below, then try again." },
  ],
  contacts: [
    { who: "Branch manager", when: "Shift swaps, lateness and day-to-day staffing." },
    { who: "System Admin", when: "Sign-in problems, passwords and PINs." },
    { who: "Owner", when: "Pay rates, hiring decisions and anything about System Admin or Owner accounts." },
  ],
  notHere: [
    "Passwords and app access — the Admin app.",
    "Paying salaries out — Finance.",
  ],
};

const who = (): Who | null => {
  const u = isLive ? sessionUser() : null;
  return u ? { name: u.name, role: t(ROLE_NAME[u.role] ?? u.role), branch: "" } : null;
};

export function initHelp(): void {
  installSupport(CONTENT, t, who);
}

export function renderHelp(): string {
  initHelp();
  return supportHtml(CONTENT, t, who());
}
