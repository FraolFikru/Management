/* =========================================================
   Finding stock items fast — shared by Purchases and Waste.

   Forgiving on purpose: case and extra spaces don't matter, any word of
   the name (or an alias, or its Amharic/Oromo name) can match, and one
   wrong letter is tolerated ("carot", "tomatoe"). Items the branch buys
   most often come first, so the usual ones are a keystroke or two away.
   ========================================================= */

import type { InventoryItem } from "../types";
import { tk, tkAll } from "../i18n";
import { db, inventory } from "../store";

/** lower-case, no punctuation, single spaces */
export const fold = (s: string): string =>
  s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();

/** true when a and b differ by at most one letter (added, removed or changed) */
function oneEditApart(a: string, b: string): boolean {
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0, j = 0, edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i++; j++; continue; }
    if (++edits > 1) return false;
    if (a.length > b.length) i++;
    else if (b.length > a.length) j++;
    else { i++; j++; }
  }
  return edits + (a.length - i) + (b.length - j) <= 1;
}

/** How often each item was bought in the loaded period (most-used first in results). */
function usage(): Map<string, { count: number; last: string }> {
  const m = new Map<string, { count: number; last: string }>();
  for (const p of db.purchases) {
    const u = m.get(p.itemId) ?? { count: 0, last: "" };
    u.count++;
    if (p.timestamp > u.last) u.last = p.timestamp;
    m.set(p.itemId, u);
  }
  return m;
}

export interface ItemHit {
  item: InventoryItem;
  /** where the query starts inside the shown name, for highlighting; -1 = matched elsewhere */
  start: number;
  /** only matched by tolerating a wrong letter ("beet" ~ Beef): never pick it automatically */
  nearMiss: boolean;
}

function score(texts: string[], q: string): number {
  let best = 0;
  for (const raw of texts) {
    const n = fold(raw);
    if (!n) continue;
    if (n === q) return 120;
    if (n.startsWith(q)) best = Math.max(best, 100);
    const words = n.split(" ");
    if (words.some((w) => w.startsWith(q))) best = Math.max(best, 90);
    if (n.includes(q)) best = Math.max(best, 70);
    if (q.length >= 4 && words.some((w) => oneEditApart(w.slice(0, q.length), q) || oneEditApart(w, q))) best = Math.max(best, 50);
  }
  return best;
}

/** Items matching what was typed, best first. */
export function searchItems(query: string, limit = 8): ItemHit[] {
  const q = fold(query);
  if (!q) return [];
  const use = usage();
  return inventory()
    .map((item) => {
      const name = tk(item.nameKey);
      const s = score([name, ...tkAll(item.nameKey), ...item.aliases], q);
      return { item, name, s, n: use.get(item.id)?.count ?? 0, start: name.toLowerCase().indexOf(query.trim().toLowerCase()) };
    })
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s || b.n - a.n || a.name.localeCompare(b.name))
    .slice(0, limit)
    .map(({ item, start, s }) => ({ item, start, nearMiss: s < 70 }));
}

/** The items bought most recently (newest first) — shown before anything is typed. */
export function recentItems(limit = 8): InventoryItem[] {
  return [...usage().entries()]
    .sort((a, b) => (a[1].last < b[1].last ? 1 : -1))
    .map(([id]) => inventory().find((i) => i.id === id))
    .filter((i): i is InventoryItem => Boolean(i))
    .slice(0, limit);
}

/** An item whose name is exactly this (ignoring case, spaces and punctuation), in any category. */
export function itemNamed(name: string): InventoryItem | undefined {
  const q = fold(name);
  if (!q) return undefined;
  return inventory().find((i) => [tk(i.nameKey), ...tkAll(i.nameKey), ...i.aliases].some((x) => fold(x) === q));
}
