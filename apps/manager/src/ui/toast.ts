/* One toast at a time, with an optional Undo. Announced politely to screen readers. */

import { t } from "../i18n";
import { $, esc, icon } from "./dom";

let timer = 0;
let undoFn: (() => void) | null = null;

export function toast(message: string, undo?: () => void): void {
  const wrap = $("#toastWrap");
  if (!wrap) return;
  window.clearTimeout(timer);
  undoFn = undo ?? null;
  wrap.innerHTML = `<div class="toast">${icon("check")}<p>${esc(message)}</p>${
    undo ? `<button type="button" data-action="undo">${t("Undo")}</button>` : ""}</div>`;
  timer = window.setTimeout(clearToast, 6500);
}

export function clearToast(): void {
  const wrap = $("#toastWrap");
  if (wrap) wrap.innerHTML = "";
  undoFn = null;
}

export function runUndo(): void {
  const fn = undoFn;
  clearToast();
  fn?.();
}
