/* Bottom toasts with an optional Undo, like the other modules. */

import { t } from "../i18n";
import { esc } from "./dom";

export type ToastKind = "info" | "good" | "bad" | "new";

export function toast(message: string, opts: { kind?: ToastKind; undo?: () => void; ms?: number } = {}): void {
  const wrap = document.getElementById("toastWrap");
  if (!wrap) return;
  const el = document.createElement("div");
  el.className = `toast ${opts.kind ?? "info"}`;
  el.setAttribute("role", opts.kind === "bad" ? "alert" : "status");
  el.innerHTML = `<span>${esc(message)}</span>${opts.undo ? `<button type="button" class="toast-undo">${esc(t("Undo"))}</button>` : ""}`;
  const close = (): void => { el.classList.add("out"); window.setTimeout(() => el.remove(), 250); };
  el.querySelector<HTMLButtonElement>(".toast-undo")?.addEventListener("click", () => { opts.undo?.(); close(); });
  wrap.append(el);
  while (wrap.children.length > 4) wrap.firstElementChild?.remove();
  window.setTimeout(close, opts.ms ?? (opts.undo ? 6000 : 3500));
}
