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
  app: "Purchasing & inventory",
  intro: "For purchasing and inventory: record what you buy, what is wasted and what you spend, so stock and costs stay correct.",
  steps: [
    { title: "Record every purchase", body: "Purchases: the supplier, items, quantities and prices exactly as on the invoice. Stock goes up when it's saved." },
    { title: "Report waste", body: "Waste: what was thrown away and why. The branch manager approves it before stock goes down." },
    { title: "Log expenses", body: "Expenses: spending that isn't stock — transport, repairs, small supplies." },
    { title: "Check the dashboard", body: "Spending for the period and the items running low." },
    { title: "Fix mistakes", body: "Right after saving, use Undo on the message that appears. Later, only a branch manager can delete an entry. Everything stays in the audit log." },
  ],
  faqs: [
    { q: "I entered the wrong quantity or price.", a: "If you just saved it, tap Undo on the message. Otherwise ask your branch manager to delete it, then enter it again with the right figures." },
    { q: "My waste report is still pending.", a: "It's waiting for the branch manager to approve it." },
    { q: "A supplier is missing from the list.", a: "Ask your branch manager or a System Admin to add it." },
    { q: "\"Not saved\" appeared after a change.", a: "The server didn't accept the change, so it was undone on your screen. Check the connection below, then try again." },
  ],
  contacts: [
    { who: "Branch manager", when: "Waste approvals and what to buy." },
    { who: "Finance", when: "Supplier bills and payments." },
    { who: "System Admin", when: "Sign-in problems and passwords." },
  ],
  notHere: [
    "Paying suppliers — the Finance app.",
    "Menu prices — the Admin app.",
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
