/* Help & support for this app: what the role does, common problems, who to ask.
   Opens over the screen from the ? button in the header. */

import { installSupport, type HelpContent, type Translate, type Who } from "./support";
import { t, type Key } from "./i18n";
import { currentUser, isLive } from "./api";

/** Role codes → the names people use. */
export const ROLE_NAME: Record<string, string> = {
  OWNER: "Owner", ADMIN: "System Admin", BRANCH_MANAGER: "Branch manager", ACCOUNTANT: "Accountant", HR_OFFICER: "HR officer",
  INVENTORY_CLERK: "Inventory clerk", SALES_STAFF: "Cashier", KITCHEN_STAFF: "Kitchen staff", WAITER: "Waiter",
};

export const CONTENT: HelpContent = {
  app: "Cashier",
  intro: "For cashiers: take orders at the counter, send them to the kitchen, take payment, and collect the bills waiters send from the tables.",
  steps: [
    { title: "Choose dine-in or takeaway", body: "For dine-in, pick the table number too." },
    { title: "Add the items", body: "Tap items on the menu or search by name. Use + and – to change how many." },
    { title: "Charge", body: "Tap Charge and choose cash, telebirr or CBE Birr. For telebirr and CBE Birr, type the transaction reference from the customer's phone." },
    { title: "Hand over the receipt", body: "The order is saved with your name and goes to the kitchen screen." },
    { title: "Collect table bills", body: "When a waiter requests the bill, Table bills at the top turns blue with a count. Open it, pick the table, check the items and take cash, telebirr or CBE Birr. Type the cash received to see the change." },
  ],
  faqs: [
    { q: "The payment failed.", a: "Nothing was charged in SEER. Check the connection below and try again. For telebirr or CBE Birr, check the reference was typed correctly." },
    { q: "I added the wrong item.", a: "Before charging, remove it with – or the remove button. After payment, ask your branch manager." },
    { q: "A waiter's table wants to pay in cash.", a: "Waiters can't take cash, so the cashier does. Tap Table bills at the top: tables that asked for the bill are listed first. Open the table, take the payment, and the table is freed for the waiter." },
    { q: "Table bills turned blue with a number.", a: "That many tables have asked for the bill. It updates by itself every 15 seconds." },
    { q: "A price looks old.", a: "Sign out and back in to load the latest menu and prices." },
    { q: "I can't sign in.", a: "Check the connection below. If the password is wrong, ask a System Admin to set a new one." },
  ],
  contacts: [
    { who: "Branch manager", when: "Refunds, cancelled payments and cash differences." },
    { who: "System Admin", when: "Your password, and menu items or prices." },
  ],
  notHere: [
    "Counting the cash and reconciling the day — Finance.",
    "Changing menu prices — the Admin app.",
  ],
};

/** The till's translator only knows its own keys; anything else stays in English. */
const tr: Translate = (key, vars) => {
  let s: string | undefined;
  try { s = t(key as Key, vars); } catch { s = undefined; }
  if (typeof s === "string" && s !== "undefined") return s;
  let out = key;
  for (const [k, v] of Object.entries(vars ?? {})) out = out.split(`{${k}}`).join(String(v));
  return out;
};

const who = (): Who | null => {
  const u = isLive ? currentUser() : null;
  return u ? { name: u.name, role: tr(ROLE_NAME[u.role] ?? u.role) } : null;
};

export function initHelp(): void {
  installSupport(CONTENT, tr, who);
}
