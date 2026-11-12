/* Help & support for the Owner app. */

import { installSupport, supportHtml, type HelpContent, type Translate, type Who } from "./support";
import { isLive, sessionUser } from "./api";
import { user } from "./data";

/** Role codes → the names people use. */
export const ROLE_NAME: Record<string, string> = {
  OWNER: "Owner", ADMIN: "System Admin", BRANCH_MANAGER: "Branch manager", ACCOUNTANT: "Accountant", HR_OFFICER: "HR officer",
  INVENTORY_CLERK: "Inventory clerk", SALES_STAFF: "Cashier", KITCHEN_STAFF: "Kitchen staff", WAITER: "Waiter",
};

export const CONTENT: HelpContent = {
  app: "Owner",
  intro: "For the Owner: the whole business at a glance, budgets and goals, and who runs the system.",
  steps: [
    { title: "Check your day at a glance", body: "Open the Dashboard each morning: balances across telebirr, cash and CBE, this month's revenue and expenses, and your profit margin." },
    { title: "Keep costs inside budget", body: "Budgets ranks categories worst first and projects month-end spend from today's pace. Tap the pencil to change a budget." },
    { title: "Follow up on transactions", body: "On Transactions, search by ID, supplier or category, and check Pending and Failed payments every day." },
    { title: "Plan with Goals and Reports", body: "Track monthly targets on Goals, and generate the weekly P&L and the monthly tax summary for your accountant." },
    { title: "Give access to the System Admins", body: "System Admins: create the accounts that run the Admin app. They create everyone else. Deactivate one and they're signed out at once." },
  ],
  faqs: [
    { q: "A System Admin can't open this app.", a: "That's on purpose: the Owner app is yours alone. System Admins use the Admin app." },
    { q: "A System Admin forgot their password.", a: "System Admins → Edit → type a new password and save. They are signed out everywhere and must use the new one." },
    { q: "Someone else needs a staff account.", a: "Ask a System Admin to create it in the Admin app → Users & roles." },
    { q: "The numbers look wrong or empty.", a: "The dashboard only shows what was recorded: sales from the tills, and purchases and expenses from the Purchasing app. Check that they're being entered." },
    { q: "The app is slow to sign in in the morning.", a: "The server sleeps when nobody uses it and takes up to a minute to wake. Use Check connection below, then try again." },
  ],
  contacts: [
    { who: "System Admin", when: "Staff accounts, menu prices, branches and receipts." },
    { who: "Accountant", when: "Bills, VAT and withholding, and the cash reconciliation." },
    { who: "SEER technical support", when: "The server, sign-in for everyone, or data that looks wrong. Send the details from Report a problem." },
  ],
};

export function renderSupport(t: Translate): string {
  const who = (): Who | null => {
    const u = isLive ? sessionUser() : null;
    return u ? { name: u.name, role: t(ROLE_NAME[u.role] ?? u.role), branch: user.restaurant } : null;
  };
  installSupport(CONTENT, t, who);
  return supportHtml(CONTENT, t, who());
}
