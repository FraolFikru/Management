/* Thermal receipt & printer settings. The preview is rebuilt on every
   keystroke at the real character width of the paper (80 mm ≈ 48
   characters, 58 mm ≈ 32 with the standard font). */

import type { PrinterConnection, ReceiptConfig } from "../types";
import { t, tk } from "../i18n";
import { round2 } from "../format";
import { VAT_RATE } from "../catalog";
import { branchName, db, priceAt, saveReceipt, state, user } from "../store";
import { $, esc, icon } from "../ui/dom";
import { clearErrors, errText, invalid, setPressed, showErrors } from "../ui/shared";
import { rerender, type ActionMap } from "../ui/app";
import { toast } from "../ui/toast";
import { switchBtn } from "./store";

let draft: ReceiptConfig | null = null;
const d = (): ReceiptConfig => (draft ??= { ...db.receipt });
const dirty = (): number => (Object.keys(d()) as (keyof ReceiptConfig)[]).filter((k) => d()[k] !== db.receipt[k]).length;

const COLS = { 80: 48, 58: 32 } as const;
const SAMPLE: [string, number][] = [["DORO_WAT", 1], ["SPECIAL_TIBS", 2], ["SHIRO", 1], ["MACCHIATO", 3], ["AMBO", 2]];

const amt = (n: number): string => n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function wrap(s: string, w: number): string[] {
  const out: string[] = [];
  for (const raw of s.split("\n")) {
    let line = raw.trim();
    if (!line) { out.push(""); continue; }
    while (line.length > w) {
      const cut = line.lastIndexOf(" ", w);
      const at = cut > w / 3 ? cut : w;
      out.push(line.slice(0, at).trimEnd());
      line = line.slice(at).trimStart();
    }
    out.push(line);
  }
  return out;
}
const center = (s: string, w: number): string => " ".repeat(Math.max(0, Math.floor((w - s.length) / 2))) + s;
const lr = (l: string, r: string, w: number): string => {
  const room = w - r.length - 1;
  const left = l.length > room ? `${l.slice(0, room - 1)}…` : l;
  return left + " ".repeat(Math.max(1, w - left.length - r.length)) + r;
};

/** The receipt as lines of text (exactly what a text-mode printer gets). */
export function receiptLines(c: ReceiptConfig): { text: string; cls?: string }[] {
  const w = COLS[c.paperWidthMm];
  const p = db.profile;
  const branch = state.scope === "ALL" ? db.branches.find((b) => b.name === p.branchName) ?? db.branches[0] : db.branches.find((b) => b.id === state.scope) ?? db.branches[0];
  const rule = "-".repeat(w);
  const L: { text: string; cls?: string }[] = [];
  const push = (text: string, cls?: string): void => { L.push({ text, cls }); };
  wrap(c.headerMessage, w).forEach((x) => push(center(x, w), "hdr"));
  push("");
  wrap(p.businessName.toUpperCase(), w).forEach((x) => push(center(x, w), "strong"));
  push(center(branch.name, w));
  wrap(branch.address, w).forEach((x) => push(center(x, w)));
  push(center(`${t("Tel")}: ${branch.phone}`, w));
  if (c.showTinOnReceipt) {
    push(center(`TIN: ${p.tinNumber}`, w));
    if (p.isVatEnabled && p.vatNumber) push(center(`${t("VAT Reg")}: ${p.vatNumber}`, w));
  }
  push(rule);
  push(lr(`${t("Receipt")}: ${branch.code}-10482`, new Date().toLocaleDateString("en-GB"), w));
  push(lr(`${t("Cashier")}: ${user().fullName}`, new Date().toTimeString().slice(0, 5), w));
  push(rule);
  let sub = 0;
  for (const [id, qty] of SAMPLE) {
    const item = db.prices.find((x) => x.id === id);
    if (!item) continue;
    const price = priceAt(item, branch.id);
    sub += price * qty;
    push(lr(`${qty} x ${tk(`menu.${id}`)}`, amt(price * qty), w));
  }
  push(rule);
  const vat = p.isVatEnabled ? round2((sub * VAT_RATE) / 100) : 0;
  if (p.isVatEnabled && c.showVatBreakdown) {
    push(lr(t("Subtotal"), amt(sub), w));
    push(lr(t("VAT {p}%", { p: VAT_RATE }), amt(vat), w));
  }
  push(lr(`${t("TOTAL")} (${p.currencySymbol})`, amt(sub + vat), w), "strong big");
  if (p.isVatEnabled && !c.showVatBreakdown) push(center(t("Prices include VAT"), w), "small");
  push(lr(t("Paid by"), tk("pay.TELEBIRR"), w));
  push(rule);
  wrap(c.footerMessage, w).forEach((x) => push(center(x, w), "ftr"));
  return L;
}

function preview(): string {
  const c = d();
  return `<div class="paper w${c.paperWidthMm}" style="--cols:${COLS[c.paperWidthMm]}" role="img" aria-label="${t("Receipt preview")}">
    <pre>${receiptLines(c).map((l) => `<span class="${l.cls ?? ""}">${esc(l.text) || " "}</span>`).join("\n")}</pre>
    <div class="tear" aria-hidden="true"></div></div>`;
}

const longLines = (s: string): number => s.split("\n").filter((x) => x.trim().length > COLS[d().paperWidthMm]).length;
const lenHint = (key: "headerMessage" | "footerMessage"): string => {
  const n = longLines(d()[key]);
  return n ? `<span class="warn-text">${t("{n} lines longer than {w} characters will wrap", { n, w: COLS[d().paperWidthMm] })}</span>` : t("Up to {w} characters per line", { w: COLS[d().paperWidthMm] });
};

function saveBar(): string {
  const n = dirty();
  return n ? `<div class="save-bar" role="region" aria-label="${t("Unsaved changes")}">
    <span>${icon("edit")} ${t("{n} unsaved changes", { n })}</span>
    <span class="form-actions"><button type="button" class="btn" data-action="receipt-discard">${t("Discard")}</button>
    <button type="button" class="btn primary" data-action="receipt-save">${icon("check")} ${t("Save changes")}</button></span></div>` : "";
}

export function renderReceipt(): string {
  const c = d();
  const e = state.errors;
  return `
    <div class="page-head"><div><h1 tabindex="-1">${t("Receipt & printer")}</h1>
      <p>${t("Layout of the customer receipt and the thermal printer it goes to. The preview updates as you type.")}</p></div></div>
    <div class="receipt-layout">
      <div class="stack-col">
        <section class="card" aria-labelledby="lyTitle">
          <div class="card-head"><div><h2 id="lyTitle">${t("Layout")}</h2></div></div>
          <div class="form">
            <div class="field"><span class="label" id="pwLbl">${t("Paper width")}</span>
              <div class="seg lg" role="group" aria-labelledby="pwLbl">${([80, 58] as const).map((w) => `<button type="button" data-action="paper" data-value="${w}" aria-pressed="${c.paperWidthMm === w}">${w} mm <small>${w === 80 ? t("standard") : t("narrow")}</small></button>`).join("")}</div></div>
            <div class="field"><label for="rHeader">${t("Header text")}</label>
              <textarea id="rHeader" class="input" rows="3" data-bind="receipt.headerMessage">${esc(c.headerMessage)}</textarea><p class="hint" id="hHint">${lenHint("headerMessage")}</p></div>
            <div class="field"><label for="rFooter">${t("Footer text")}</label>
              <textarea id="rFooter" class="input" rows="3" data-bind="receipt.footerMessage">${esc(c.footerMessage)}</textarea><p class="hint" id="fHint">${lenHint("footerMessage")}</p></div>
            <div class="toggle-row"><span><strong>${t("Print TIN and VAT number")}</strong><small>${t("Required on tax receipts")}</small></span>${switchBtn("receipt-tin", c.showTinOnReceipt, t("Print TIN and VAT number"))}</div>
            <div class="toggle-row"><span><strong>${t("Show VAT breakdown")}</strong><small>${db.profile.isVatEnabled ? t("Subtotal and VAT on separate lines") : `<span class="warn-text">${t("VAT is off in Store & tax")}</span>`}</small></span>${switchBtn("receipt-vat", c.showVatBreakdown, t("Show VAT breakdown"))}</div>
          </div>
        </section>
        <section class="card" aria-labelledby="prTitle">
          <div class="card-head"><div><h2 id="prTitle">${t("Printer")}</h2><p>${state.scope === "ALL" ? t("Preview uses the main branch") : esc(branchName(state.scope))}</p></div></div>
          <div class="form">
            <div class="field"><label for="rPrinter">${t("Printer name")}</label><input id="rPrinter" class="input" autocomplete="off" value="${esc(c.printerName)}" data-bind="receipt.printerName" ${invalid(e, "printerName")}>${errText(e, "printerName")}</div>
            <div class="field"><span class="label" id="cnLbl">${t("Connection")}</span>
              <div class="seg lg" role="group" aria-labelledby="cnLbl">${(["USB", "LAN"] as PrinterConnection[]).map((x) => `<button type="button" data-action="connection" data-value="${x}" aria-pressed="${c.connection === x}">${x === "USB" ? "USB" : t("LAN (network)")}</button>`).join("")}</div></div>
            ${c.connection === "LAN" ? `<div class="field"><label for="rIp">${t("Printer IP address")}</label><input id="rIp" class="input mono" inputmode="decimal" autocomplete="off" placeholder="192.168.1.50" value="${esc(c.printerIp)}" data-bind="receipt.printerIp" ${invalid(e, "printerIp")}>
              <p class="hint">${t("Port 9100 (raw printing)")}</p>${errText(e, "printerIp")}</div>` : `<p class="hint">${t("Plug the printer into the register PC. It is picked up automatically.")}</p>`}
            <button type="button" class="btn" data-action="test-print">${icon("receipt")} ${t("Send test print")}</button>
          </div>
        </section>
      </div>
      <section class="card preview-card" aria-labelledby="pvTitle">
        <div class="card-head"><div><h2 id="pvTitle">${t("Print preview")}</h2><p>${t("{w} mm · {n} characters per line", { w: c.paperWidthMm, n: COLS[c.paperWidthMm] })}</p></div></div>
        <div id="receiptPreview" class="paper-wrap">${preview()}</div>
      </section>
    </div>
    <div id="saveBar">${saveBar()}</div>`;
}

const refresh = (): void => {
  const pv = $("#receiptPreview"); if (pv) pv.innerHTML = preview();
  const bar = $("#saveBar"); if (bar) bar.innerHTML = saveBar();
  const h = $("#hHint"); if (h) h.innerHTML = lenHint("headerMessage");
  const f = $("#fHint"); if (f) f.innerHTML = lenHint("footerMessage");
};

export function onReceiptInput(key: string, value: string): void {
  const c = d();
  if (key === "headerMessage" || key === "footerMessage" || key === "printerName" || key === "printerIp") { c[key] = value; clearErrors([key]); refresh(); }
}

const validIp = (s: string): boolean => /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.test(s.trim()) && s.trim().split(".").every((x) => Number(x) <= 255);

function validate(): boolean {
  const c = d();
  const e: Record<string, string> = {};
  if (!c.printerName.trim()) e.printerName = t("Enter a name for the printer.");
  if (c.connection === "LAN" && !validIp(c.printerIp)) e.printerIp = t("Enter an IP address like 192.168.1.50.");
  return !showErrors(e, ["printerName", "printerIp"]);
}

export const receiptActions: ActionMap = {
  paper: (el) => { const v = Number(el.dataset.value); if (v === 80 || v === 58) { d().paperWidthMm = v; setPressed(el); rerender(`[data-action="paper"][data-value="${v}"]`); } },
  connection: (el) => { const v = el.dataset.value; if (v === "USB" || v === "LAN") { d().connection = v; state.errors = {}; rerender(`[data-action="connection"][data-value="${v}"]`); } },
  "receipt-tin": (el) => { d().showTinOnReceipt = !d().showTinOnReceipt; el.setAttribute("aria-checked", String(d().showTinOnReceipt)); refresh(); },
  "receipt-vat": (el) => { d().showVatBreakdown = !d().showVatBreakdown; el.setAttribute("aria-checked", String(d().showVatBreakdown)); refresh(); },
  "test-print": () => {
    if (!validate()) return;
    const c = d();
    toast(t("Test receipt sent to {p} ({c})", { p: c.printerName, c: c.connection === "LAN" ? `${c.printerIp}:9100` : "USB" }));
  },
  "receipt-discard": () => { draft = null; state.errors = {}; rerender(); },
  "receipt-save": () => {
    if (!validate()) return;
    const undo = saveReceipt({ ...d(), printerName: d().printerName.trim(), printerIp: d().printerIp.trim() });
    draft = null;
    rerender();
    toast(t("Receipt layout saved"), () => { undo(); draft = null; rerender(); });
  },
};

export const resetReceiptDraft = (): void => { draft = null; };
