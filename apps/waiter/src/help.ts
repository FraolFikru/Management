/* Help & support for this app: what the role does, common problems, who to ask.
   Opens over the screen from the ? button in the header. */

import { installSupport, type HelpContent, type Translate, type Who } from "./support";
import { t } from "./i18n";
import { sessionUser } from "./api";

/** Role codes → the names people use. */
export const ROLE_NAME: Record<string, string> = {
  OWNER: "Owner", ADMIN: "System Admin", BRANCH_MANAGER: "Branch manager", ACCOUNTANT: "Accountant", HR_OFFICER: "HR officer",
  INVENTORY_CLERK: "Inventory clerk", SALES_STAFF: "Cashier", KITCHEN_STAFF: "Kitchen staff", WAITER: "Waiter",
};

export const CONTENT: HelpContent = {
  app: "Waiter",
  intro: "For waiters: your tables, their orders, the kitchen and the bill, on your phone.",
  steps: [
    { title: "Sign in with your staff code and PIN", body: "Your staff code is on your badge, for example W-101." },
    { title: "Open a table", body: "Tap a free table and enter the number of guests." },
    { title: "Take the order", body: "Add items, then send them now, or hold a course and send it later. Items not yet sent are shown apart from sent ones." },
    { title: "Serve", body: "When the kitchen marks food ready, the table shows Ready. Mark the items served." },
    { title: "Close the bill", body: "Request the bill. You can take telebirr or CBE Birr yourself; cash goes to the cashier." },
    { title: "Hand over at the end of your shift", body: "Transfer your open tables to the waiter taking over." },
  ],
  faqs: [
    { q: "The phone lost connection.", a: "Keep working. Your actions are kept on the phone and sent when it reconnects; the banner shows how many are waiting. Don't sign out while something is waiting." },
    { q: "My PIN doesn't work.", a: "After 5 wrong tries, wait 5 minutes. If you forgot it, ask a System Admin or your branch manager for a new PIN." },
    { q: "I sent the wrong item to the kitchen.", a: "Tell the kitchen straight away and ask your branch manager to remove it." },
    { q: "A table isn't in My tables.", a: "It belongs to another waiter. Look under All, or ask them to transfer it to you." },
  ],
  contacts: [
    { who: "Branch manager", when: "Removing sent items, discounts and table problems." },
    { who: "Cashier", when: "Cash payments." },
    { who: "System Admin", when: "A new PIN or password." },
  ],
  notHere: [
    "Cash payments and the cash drawer — the cashier.",
    "Closing the day, stock and reports.",
  ],
};

const tr: Translate = (key, vars) => t(key, vars ?? {});

const who = (): Who | null => {
  const u = sessionUser();
  return u ? { name: u.name, role: tr(ROLE_NAME[u.role] ?? u.role) } : null;
};

export function initHelp(): void {
  installSupport(CONTENT, tr, who);
}
