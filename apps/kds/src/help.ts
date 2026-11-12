/* Help & support for this app: what the role does, common problems, who to ask.
   Opens over the screen from the ? button in the header. */

import { installSupport, type HelpContent, type Translate, type Who } from "./support";
import { t } from "./i18n";
import { currentUser } from "./auth";

/** Role codes → the names people use. */
export const ROLE_NAME: Record<string, string> = {
  OWNER: "Owner", ADMIN: "System Admin", BRANCH_MANAGER: "Branch manager", ACCOUNTANT: "Accountant", HR_OFFICER: "HR officer",
  INVENTORY_CLERK: "Inventory clerk", SALES_STAFF: "Cashier", KITCHEN_STAFF: "Kitchen staff", WAITER: "Waiter",
};

export const CONTENT: HelpContent = {
  app: "Kitchen display",
  intro: "For the kitchen: every order from the counter and the waiters appears here in the order it arrived.",
  steps: [
    { title: "New orders arrive in Pending", body: "Each ticket shows the table or takeaway number, the time and the items, with any notes." },
    { title: "Tap Start when you begin cooking", body: "The ticket moves to Preparing, so everyone can see it's being cooked." },
    { title: "Tap Mark ready when it's done", body: "The waiter or cashier sees it's ready to serve. If other stations are still cooking, the ticket waits for them." },
    { title: "Tap Picked up when it leaves the pass", body: "The ticket leaves the screen. Recall brings back the last one if you tapped it by mistake." },
    { title: "Watch the timer colours", body: "A ticket changes colour as it gets older, so late orders stand out." },
  ],
  faqs: [
    { q: "There's no sound when an order arrives.", a: "Browsers block sound until the screen is touched once. Tap the screen, and check the bell button is on." },
    { q: "Orders stopped coming in.", a: "Look at the connection light at the top. If it says offline, check the Wi-Fi. The screen reconnects by itself and catches up on missed orders." },
    { q: "I moved a ticket by mistake.", a: "Use Back on the ticket, or Recall for an order that was already picked up." },
    { q: "An order needs changing.", a: "Changes come from the waiter or the cashier. Tell them, or the branch manager, straight away." },
  ],
  contacts: [
    { who: "Branch manager", when: "Running out of an item, and problems with an order." },
    { who: "Waiter or cashier", when: "Questions about what a customer ordered." },
  ],
  notHere: [
    "Changing or cancelling orders — the waiter or the cashier.",
    "Stock and waste — the Purchasing app.",
  ],
};

const tr: Translate = (key, vars) => t(key, vars);

const who = (): Who | null => {
  const u = currentUser();
  return u ? { name: u.name, role: tr(ROLE_NAME[u.role] ?? u.role) } : null;
};

export function initHelp(): void {
  installSupport(CONTENT, tr, who);
}
