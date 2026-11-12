/* Help & support for this app: what the role does, common problems, who to ask. */

import { installSupport, supportHtml, type HelpContent, type Who } from "../support";
import { t } from "../i18n";
import { isLive, sessionUser } from "../api";
import { live } from "../store";

/** Role codes → the names people use. */
export const ROLE_NAME: Record<string, string> = {
  OWNER: "Owner", ADMIN: "System Admin", BRANCH_MANAGER: "Branch manager", ACCOUNTANT: "Accountant", HR_OFFICER: "HR officer",
  INVENTORY_CLERK: "Inventory clerk", SALES_STAFF: "Cashier", KITCHEN_STAFF: "Kitchen staff", WAITER: "Waiter",
};

export const CONTENT: HelpContent = {
  app: "Finance & accounting",
  intro: "For the accountant: profit and loss, supplier bills, VAT and withholding returns, and the daily cash reconciliation.",
  steps: [
    { title: "Read the profit & loss", body: "Profit & loss shows revenue, costs and profit by month and branch, built from sales, purchases and expenses as they are recorded." },
    { title: "Pay supplier bills", body: "Accounts payable: bills from purchases land here. Record each payment and the account it came from. Overdue bills are marked." },
    { title: "File VAT and withholding", body: "Tax & VAT: each month's VAT and WHT totals are worked out for you. Mark a return as filed once it's filed with the tax office." },
    { title: "Reconcile cash every day", body: "Cash & reconciliation: compare each day's takings with the bank deposit and record where the money went." },
  ],
  faqs: [
    { q: "I recorded a payment by mistake.", a: "Undo it within 10 minutes from the message that appears. After that, ask the Owner — the payment and its reversal both stay in the audit trail." },
    { q: "The profit & loss looks wrong.", a: "It only counts what was recorded. Check that the period's purchases and expenses were entered in the Purchasing app and that the right branch is selected." },
    { q: "A return is marked filed but it wasn't.", a: "Reopen it in Tax & VAT. The change is recorded with your name." },
    { q: "A day won't reconcile.", a: "Compare the till total with the deposit slip. A difference is usually a payment recorded with the wrong method — cash instead of telebirr or CBE Birr." },
    { q: "\"Not saved\" appeared after a change.", a: "The server didn't accept the change, so it was undone on your screen. Check the connection below, then try again." },
  ],
  contacts: [
    { who: "Branch manager", when: "Missing purchases, expenses or waste for a branch." },
    { who: "Owner", when: "Budgets, large payments and spending decisions." },
    { who: "System Admin", when: "Your password, the VAT rate and the business details." },
  ],
  notHere: [
    "Entering purchases and expenses — the Purchasing app.",
    "Budgets — the Owner app.",
  ],
};

const who = (): Who | null => {
  const u = isLive ? sessionUser() : null;
  return u ? { name: u.name, role: t(ROLE_NAME[u.role] ?? u.role), branch: live.branchName } : null;
};

export function initHelp(): void {
  installSupport(CONTENT, t, who);
}

export function renderHelp(): string {
  initHelp();
  return supportHtml(CONTENT, t, who());
}
