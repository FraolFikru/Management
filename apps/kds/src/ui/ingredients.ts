/* =========================================================
   "Confirm Ingredients Used" — shown when the kitchen marks a
   ticket ready (live mode). Every dish not yet recorded is listed
   with its recipe ingredients; each amount is pre-filled with the
   recipe × quantity and can be changed to what was really used.
   Confirm & Complete sends the amounts with the READY status: the
   server deducts them and marks the ticket ready in one step.
   Cancel leaves the ticket as it was.
   ========================================================= */

import type { IngredientUse, LocalizedText, TicketIngredients } from "../types";
import { apiBase, accessToken } from "../auth";
import { branchId } from "../feed";
import { getLanguage, t, tkMaybe } from "../i18n";
import { esc, icon } from "./dom";

const name = (n: LocalizedText): string => n[getLanguage()] || n.en;

/** Up to 3 decimals, no trailing zeros. */
export const qty = (n: number): string => String(Math.round(n * 1000) / 1000);

/** 0.5 kg → "500 g", 1.2 kg → "1.2 kg" (same for liters → ml). */
export function amount(n: number, unit: string, units?: Record<string, LocalizedText>): string {
  if (unit === "kg" && Math.abs(n) < 1) return `${qty(n * 1000)} g`;
  if (unit === "liters" && Math.abs(n) < 1) return `${qty(n * 1000)} ml`;
  const u = units?.[unit];
  return `${qty(n)} ${u ? name(u) : unit}`;
}

/** The dishes and pre-filled amounts for one ticket. Throws when the server can't be reached. */
export async function loadIngredients(ticketId: string): Promise<TicketIngredients> {
  const token = await accessToken();
  const res = await fetch(`${apiBase()}/kds/tickets/${encodeURIComponent(ticketId)}/ingredients`, {
    headers: { "X-Branch-Id": branchId(), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
  });
  if (!res.ok) throw new Error(`ingredients ${res.status}`);
  return (await res.json()) as TicketIngredients;
}

interface Row { key: string; ticketItemId: string; itemId: string; unit: string; expected: number | null; value: string; onHand?: number }

let open: HTMLElement | null = null;

/** Show the step. Resolves when the kitchen confirms (submit gets the entries) or cancels (null). */
export function confirmIngredients(
  data: TicketIngredients,
  submit: (usage: IngredientUse[]) => Promise<boolean>,
): Promise<boolean> {
  open?.remove();
  const returnFocus = document.activeElement as HTMLElement | null;
  let seq = 0;
  const rows: Row[] = data.dishes.flatMap((d) => d.ingredients.map((i) => ({
    key: `r${++seq}`, ticketItemId: d.ticketItemId, itemId: i.itemId, unit: i.unit, expected: i.expected, value: qty(i.expected), onHand: i.onHand,
  })));
  const itemName = (id: string): string => {
    const hit = data.items.find((x) => x.itemId === id) ?? data.dishes.flatMap((d) => d.ingredients).find((x) => x.itemId === id);
    return hit ? name(hit.names) : id;
  };
  const unitName = (u: string): string => (data.units[u] ? name(data.units[u]) : u);
  const dishName = (d: TicketIngredients["dishes"][number]): string => tkMaybe(`menu.${d.menuItemId}`) ?? name(d.dishNames) ?? d.dishName;
  const one = data.dishes.length === 1 ? data.dishes[0] : undefined;
  const subtitle = one
    ? t("{dish} — Order #{no}", { dish: `${one.quantity > 1 ? `${qty(one.quantity)}× ` : ""}${dishName(one)}`, no: data.orderNumber })
    : t("Order #{no}", { no: data.orderNumber });

  const box = document.createElement("div");
  box.className = "iu-overlay";
  box.setAttribute("role", "dialog");
  box.setAttribute("aria-modal", "true");
  box.setAttribute("aria-labelledby", "iuTitle");
  open = box;

  let error = "";
  let saving = false;

  const rowHtml = (r: Row): string => {
    const bad = error && !valid(r.value);
    return `<li class="iu-row" data-key="${r.key}">
      <label class="iu-name" for="iu-${r.key}">${esc(itemName(r.itemId))}
        ${r.expected !== null ? `<small>${esc(t("Recipe: {x}", { x: `${qty(r.expected)} ${unitName(r.unit)}` }))}</small>`
          : `<small>${esc(t("Added"))}</small>`}</label>
      <span class="iu-input">
        <input id="iu-${r.key}" type="text" inputmode="decimal" autocomplete="off" enterkeyhint="done" value="${esc(r.value)}"
          data-iu-input="${r.key}" aria-invalid="${bad ? "true" : "false"}" ${saving ? "disabled" : ""} />
        <span class="iu-unit">${esc(unitName(r.unit))}</span>
      </span>
      ${r.expected === null ? `<button type="button" class="iu-x" data-iu="remove" data-key="${r.key}" aria-label="${esc(t("Remove"))}" ${saving ? "disabled" : ""}>×</button>` : `<span class="iu-x-gap"></span>`}
    </li>`;
  };

  const addPicker = (ticketItemId: string): string => {
    const have = new Set(rows.filter((r) => r.ticketItemId === ticketItemId).map((r) => r.itemId));
    const opts = data.items.filter((i) => !have.has(i.itemId)).sort((a, b) => name(a.names).localeCompare(name(b.names)));
    return `<label class="iu-add"><span class="sr">${esc(t("+ Add ingredient"))}</span>
      <select data-iu-add="${esc(ticketItemId)}" ${saving ? "disabled" : ""}>
        <option value="">${esc(t("+ Add ingredient"))}</option>
        ${opts.map((i) => `<option value="${esc(i.itemId)}">${esc(name(i.names))}</option>`).join("")}
      </select></label>`;
  };

  function render(): void {
    box.innerHTML = `<form class="iu-sheet" novalidate>
      <header class="iu-head">
        <h2 id="iuTitle">${esc(t("Confirm Ingredients Used"))}</h2>
        <p class="iu-sub">${esc(subtitle)}</p>
        <p class="iu-hint">${esc(t("Enter what was really used. The recipe amount is filled in."))}</p>
      </header>
      <div class="iu-body">
        ${data.dishes.map((d) => `<section class="iu-dish">
          ${one ? "" : `<h3>${esc(`${qty(d.quantity)}× ${dishName(d)}`)}</h3>`}
          <ul class="iu-list">${rows.filter((r) => r.ticketItemId === d.ticketItemId).map(rowHtml).join("")}</ul>
          ${addPicker(d.ticketItemId)}
        </section>`).join("")}
      </div>
      ${error ? `<p class="iu-error" role="alert">${icon("alert")}${esc(error)}</p>` : ""}
      <footer class="iu-foot">
        <button type="button" class="btn ghost iu-cancel" data-iu="cancel" ${saving ? "disabled" : ""}>${esc(t("Cancel"))}</button>
        <button type="submit" class="btn primary ready iu-ok" ${saving ? "disabled" : ""}>${icon("check")}<span>${esc(saving ? t("Saving…") : t("Confirm & Complete"))}</span></button>
      </footer>
    </form>`;
  }

  const valid = (v: string): boolean => /^\d+([.,]\d+)?$/.test(v.trim()) && Number(v.trim().replace(",", ".")) >= 0;

  return new Promise<boolean>((resolve) => {
    const close = (done: boolean): void => {
      box.remove();
      if (open === box) open = null;
      document.removeEventListener("keydown", onKey, true);
      returnFocus?.focus?.();
      resolve(done);
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape" && !saving) { e.preventDefault(); close(false); }
      if (e.key === "Tab") {             // keep focus inside the dialog
        const f = [...box.querySelectorAll<HTMLElement>("input, select, button")].filter((x) => !x.hasAttribute("disabled"));
        if (!f.length) return;
        const first = f[0] as HTMLElement, last = f[f.length - 1] as HTMLElement;
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener("keydown", onKey, true);

    box.addEventListener("input", (e) => {
      const el = e.target as HTMLInputElement;
      const r = rows.find((x) => x.key === el.dataset.iuInput);
      if (!r) return;
      r.value = el.value;
      if (!error) return;
      el.setAttribute("aria-invalid", valid(r.value) ? "false" : "true");
      if (rows.every((x) => valid(x.value))) { error = ""; box.querySelector(".iu-error")?.remove(); }
    });
    box.addEventListener("change", (e) => {
      const el = e.target as HTMLSelectElement;
      const tid = el.dataset.iuAdd;
      if (!tid || !el.value) return;
      const it = data.items.find((x) => x.itemId === el.value);
      if (!it) return;
      const r: Row = { key: `r${++seq}`, ticketItemId: tid, itemId: it.itemId, unit: it.unit, expected: null, value: "" };
      rows.push(r);
      render();
      box.querySelector<HTMLInputElement>(`#iu-${r.key}`)?.focus();
    });
    box.addEventListener("click", (e) => {
      const el = (e.target as HTMLElement).closest<HTMLElement>("[data-iu]");
      if (!el || saving) return;
      if (el.dataset.iu === "cancel") close(false);
      if (el.dataset.iu === "remove") {
        const i = rows.findIndex((x) => x.key === el.dataset.key);
        if (i >= 0) rows.splice(i, 1);
        render();
      }
    });
    box.addEventListener("submit", (e) => {
      e.preventDefault();
      if (saving) return;
      const firstBad = rows.find((r) => !valid(r.value));
      if (firstBad) {
        error = t("Enter an amount (0 or more) for every ingredient.");
        render();
        box.querySelector<HTMLInputElement>(`#iu-${firstBad.key}`)?.focus();
        return;
      }
      const usage: IngredientUse[] = rows.map((r) => ({
        ticketItemId: r.ticketItemId, itemId: r.itemId, unit: r.unit, actual: Number(r.value.trim().replace(",", ".")),
      }));
      saving = true; error = ""; render();
      void submit(usage).then((ok) => {
        if (ok) { close(true); return; }
        saving = false;
        error = t("Couldn't save. Nothing was changed — please try again.");
        render();
        box.querySelector<HTMLButtonElement>(".iu-ok")?.focus();
      });
    });

    render();
    document.body.appendChild(box);
    box.querySelector<HTMLInputElement>("input")?.focus();
    box.querySelector<HTMLInputElement>("input")?.select();
  });
}
