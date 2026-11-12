/* Help & support for this app: what the role does, common problems, who to ask. */

import { installSupport, supportHtml, type HelpContent, type Who } from "../support";
import { t } from "../i18n";
import { isLive, sessionUser } from "../api";
import { branchName } from "../store";

/** Role codes → the names people use. */
export const ROLE_NAME: Record<string, string> = {
  OWNER: "Owner", ADMIN: "System Admin", BRANCH_MANAGER: "Branch manager", ACCOUNTANT: "Accountant", HR_OFFICER: "HR officer",
  INVENTORY_CLERK: "Inventory clerk", SALES_STAFF: "Cashier", KITCHEN_STAFF: "Kitchen staff", WAITER: "Waiter",
};

export const CONTENT: HelpContent = {
  app: "System Admin",
  intro: "For System Admins: set up the restaurant, branches, prices and receipts, and create the accounts for everyone who works here. Owner and System Admin accounts are created by the Owner.",
  steps: [
    { title: "Check the store details", body: "Store & tax: business name, TIN, VAT number and rate. They print on every receipt and feed the tax figures." },
    { title: "Set up branches and prices", body: "Branches & prices: add each branch and its manager, then change menu prices for every branch or for one branch only." },
    { title: "Create staff accounts", body: "Users & roles → Add user. The role decides which app they use. Give the password in private. Waiters, cashiers and kitchen staff can also get a 4–6 digit PIN for the Waiter app." },
    { title: "Decide what each role may do", body: "Users & roles → Permissions by role. Cells with a lock are fixed by policy and can't be changed." },
    { title: "Set up the receipt", body: "Receipt: header, footer and paper width for each branch's printer." },
    { title: "Check what changed", body: "Audit log: every change, who made it and when. Export it from there when someone asks." },
  ],
  faqs: [
    { q: "Someone forgot their password.", a: "Users & roles → Edit → type a new password and save. They are signed out everywhere and must use the new one. Tell them the password in private." },
    { q: "A waiter is locked out of the Waiter app.", a: "After 5 wrong PINs the account waits 5 minutes. To unlock it now, set a new PIN in Users & roles → Edit." },
    { q: "Someone left the restaurant.", a: "Turn their Active switch off. They are signed out at once and can't sign in again. Their history is kept." },
    { q: "I can't create a System Admin or change the Owner's account.", a: "Only the Owner can. Ask the Owner to do it in the Owner app → System Admins." },
    { q: "A new price isn't showing at the till.", a: "The till picks up new prices when it reloads. Ask the cashier to sign out and back in." },
    { q: "\"Not saved\" appeared after a change.", a: "The server didn't accept the change, so it was undone on your screen. Check the connection below, then try again." },
  ],
  contacts: [
    { who: "Owner", when: "System Admin accounts, the Owner app, and business decisions like new branches." },
    { who: "SEER technical support", when: "The server, data that looks wrong, or anything you can't fix here. Send the details from Report a problem." },
  ],
  notHere: [
    "Sales figures, budgets and goals — the Owner app.",
    "Approving waste and dispatch — the Manager app.",
    "Shifts, attendance and payroll — the HR app.",
  ],
};

const who = (): Who | null => {
  const u = isLive ? sessionUser() : null;
  return u ? { name: u.name, role: t(ROLE_NAME[u.role] ?? u.role), branch: branchName(u.branchId) } : null;
};

export function initHelp(): void {
  installSupport(CONTENT, t, who);
}

export function renderHelp(): string {
  initHelp();
  return supportHtml(CONTENT, t, who());
}
