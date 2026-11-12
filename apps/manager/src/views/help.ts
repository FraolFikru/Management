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
  app: "Branch manager",
  intro: "For branch managers: today's sales, the approvals waiting for you, and your branch's costs and expenses.",
  steps: [
    { title: "Open the Overview first", body: "Sales so far, what needs your approval, and anything unusual today." },
    { title: "Approve dispatch", body: "Dispatch: stock requests from the kitchen and the counter wait for you. Approve them, or reject them with a reason." },
    { title: "Approve waste", body: "Waste: reports from staff need your OK before stock goes down." },
    { title: "Watch food cost", body: "COGS: what the food you sold cost. A sudden jump usually means waste, wrong portions or a supplier price rise." },
    { title: "Record expenses", body: "Expenses: small branch spending that isn't stock." },
    { title: "See who did what", body: "Audit: every change in your branch, with name and time." },
  ],
  faqs: [
    { q: "I approved or rejected something by mistake.", a: "Undo it within 10 minutes from the message that appears. After that, ask the Owner." },
    { q: "A request I'm expecting isn't showing.", a: "Check that your branch is selected at the top. Requests appear as soon as they're sent; if not, check the connection below." },
    { q: "Sales look lower than expected.", a: "Sales are counted when an order is paid. Tables that are still open aren't included yet." },
    { q: "\"Not saved\" appeared after a change.", a: "The server didn't accept the change, so it was undone on your screen. Check the connection below, then try again." },
  ],
  contacts: [
    { who: "System Admin", when: "Staff accounts, passwords, PINs, menu prices and receipts." },
    { who: "HR", when: "Schedules, attendance and payroll." },
    { who: "Owner", when: "Budgets and decisions above a branch manager." },
  ],
  notHere: [
    "Staff accounts and prices — the Admin app.",
    "Shifts and payroll — the HR app.",
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
