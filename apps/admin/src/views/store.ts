/* Store profile & Ethiopian fiscal settings: business details, TIN,
   VAT registration, the 15% VAT switch and how amounts are written.
   Edits stay in a draft until saved; the save bar shows what changed. */

import type { CurrencySymbol, StoreProfile } from "../types";
import { t } from "../i18n";
import { money } from "../format";
import { VAT_RATE } from "../catalog";
import { db, saveProfile, state } from "../store";
import { $, esc, icon } from "../ui/dom";
import { clearErrors, errText, invalid, setPressed, showErrors } from "../ui/shared";
import { rerender, type ActionMap } from "../ui/app";
import { toast } from "../ui/toast";
import { renderTopbar } from "../ui/shell";

let draft: StoreProfile | null = null;
const d = (): StoreProfile => (draft ??= { ...db.profile });
const dirtyKeys = (): (keyof StoreProfile)[] => (Object.keys(d()) as (keyof StoreProfile)[]).filter((k) => d()[k] !== db.profile[k]);

export const switchBtn = (action: string, on: boolean, label: string, value = ""): string =>
  `<button type="button" class="switch" role="switch" aria-checked="${on}" aria-label="${esc(label)}" data-action="${action}" ${value ? `data-value="${esc(value)}"` : ""}><i></i></button>`;

const field = (key: keyof StoreProfile, label: string, o: { hint?: string; placeholder?: string; mono?: boolean; inputmode?: string } = {}): string => `
  <div class="field"><label for="sp-${key}">${label}</label>
    <input id="sp-${key}" class="input ${o.mono ? "mono" : ""}" autocomplete="off" value="${esc(String(d()[key]))}" data-bind="profile.${key}"
      ${o.placeholder ? `placeholder="${esc(o.placeholder)}"` : ""} ${o.inputmode ? `inputmode="${o.inputmode}"` : ""} ${invalid(state.errors, key)}>
    ${o.hint ? `<p class="hint">${o.hint}</p>` : ""}${errText(state.errors, key)}</div>`;

function vatExample(): string {
  const p = d();
  const sub = 1000;
  const vat = p.isVatEnabled ? (sub * VAT_RATE) / 100 : 0;
  const fmt = (n: number): string => `${p.currencySymbol} ${n.toLocaleString("en-US", { minimumFractionDigits: 2 })}`;
  return `<dl class="calc-lines">
    <div><dt>${t("Order subtotal")}</dt><dd>${fmt(sub)}</dd></div>
    <div><dt>${p.isVatEnabled ? t("VAT {p}%", { p: VAT_RATE }) : t("VAT")}</dt><dd>${p.isVatEnabled ? fmt(vat) : t("not added")}</dd></div>
    <div class="total"><dt>${t("Customer pays")}</dt><dd>${fmt(sub + vat)}</dd></div>
  </dl>`;
}

function saveBar(): string {
  const n = dirtyKeys().length;
  return n ? `<div class="save-bar" role="region" aria-label="${t("Unsaved changes")}">
    <span>${icon("edit")} ${t("{n} unsaved changes", { n })}</span>
    <span class="form-actions"><button type="button" class="btn" data-action="profile-discard">${t("Discard")}</button>
    <button type="button" class="btn primary" data-action="profile-save">${icon("check")} ${t("Save changes")}</button></span></div>` : "";
}

export function renderStore(): string {
  const p = d();
  return `
    <div class="page-head"><div><h1 tabindex="-1">${t("Store & tax")}</h1>
      <p>${t("Business details, Ministry of Revenues registration and VAT. These appear on every receipt.")}</p></div></div>
    <div class="settings-layout">
      <div class="stack-col">
        <section class="card" aria-labelledby="bizTitle">
          <div class="card-head"><div><h2 id="bizTitle">${t("Business information")}</h2></div></div>
          <div class="form">
            ${field("businessName", t("Business legal name"))}
            <div class="row">
              <div class="field"><label for="sp-branchName">${t("Main branch")}</label>
                <select id="sp-branchName" class="input" data-bind="profile.branchName">${db.branches.map((b) => `<option ${b.name === p.branchName ? "selected" : ""}>${esc(b.name)}</option>`).join("")}</select></div>
              ${field("licenseNumber", t("Business license number"), { mono: true, placeholder: "AA/BL/14/678/2016" })}
            </div>
            ${field("address", t("Physical address"))}
            ${field("phone", t("Phone number"), { placeholder: "+251 911 234 567", inputmode: "tel" })}
          </div>
        </section>
        <section class="card" aria-labelledby="taxTitle">
          <div class="card-head"><div><h2 id="taxTitle">${t("Fiscal & tax")}</h2><p>${t("Ethiopian Ministry of Revenues")}</p></div></div>
          <div class="form">
            <div class="row">
              ${field("tinNumber", t("Taxpayer Identification Number (TIN)"), { mono: true, inputmode: "numeric", placeholder: "0012345678", hint: t("10 digits") })}
              ${field("vatNumber", t("VAT registration number"), { mono: true, placeholder: "VAT-1234567" })}
            </div>
            <div class="toggle-row">
              <span><strong>${t("Add {p}% VAT to sales automatically", { p: VAT_RATE })}</strong><small>${t("Turn off only if the business is not VAT-registered.")}</small></span>
              ${switchBtn("vat-toggle", p.isVatEnabled, t("Add VAT to sales"))}
            </div>
          </div>
        </section>
      </div>
      <div class="stack-col">
        <section class="card" aria-labelledby="curTitle">
          <div class="card-head"><div><h2 id="curTitle">${t("Currency")}</h2><p>${t("Ethiopian Birr (ETB)")}</p></div></div>
          <span class="label" id="symLbl">${t("Show amounts as")}</span>
          <div class="seg lg" role="group" aria-labelledby="symLbl">${(["ETB", "Br"] as CurrencySymbol[]).map((s) =>
            `<button type="button" data-action="currency" data-value="${s}" aria-pressed="${p.currencySymbol === s}">${s} 1,250.00</button>`).join("")}</div>
        </section>
        <section class="card" aria-labelledby="exTitle">
          <div class="card-head"><div><h2 id="exTitle">${t("How a sale is calculated")}</h2><p>${t("Example with the settings above")}</p></div></div>
          <div id="vatExample">${vatExample()}</div>
        </section>
        <section class="card summary-card" aria-labelledby="regTitle">
          <div class="card-head"><div><h2 id="regTitle">${t("Saved registration")}</h2></div></div>
          <dl class="mini-dl">
            <div><dt>TIN</dt><dd class="mono">${esc(db.profile.tinNumber)}</dd></div>
            <div><dt>${t("VAT number")}</dt><dd class="mono">${esc(db.profile.vatNumber || "—")}</dd></div>
            <div><dt>${t("VAT")}</dt><dd>${db.profile.isVatEnabled ? `<span class="good-text">${t("{p}% on", { p: db.profile.vatRate })}</span>` : `<span class="warn-text">${t("off")}</span>`}</dd></div>
            <div><dt>${t("Currency")}</dt><dd>${esc(db.profile.currency)} · ${esc(money(1250, 2))}</dd></div>
          </dl>
        </section>
      </div>
    </div>
    <div id="saveBar">${saveBar()}</div>`;
}

const refreshBits = (): void => {
  const bar = $("#saveBar"); if (bar) bar.innerHTML = saveBar();
  const ex = $("#vatExample"); if (ex) ex.innerHTML = vatExample();
};

export function onProfileInput(key: string, value: string): void {
  const p = d();
  if (key === "businessName" || key === "branchName" || key === "licenseNumber" || key === "address" || key === "phone" || key === "tinNumber" || key === "vatNumber") {
    p[key] = value;
    clearErrors([key]);
    refreshBits();
  }
}

function validate(p: StoreProfile): boolean {
  const e: Record<string, string> = {};
  if (p.businessName.trim().length < 3) e.businessName = t("Enter the business legal name.");
  if (!/^\d{10}$/.test(p.tinNumber.replace(/\s/g, ""))) e.tinNumber = t("TIN must be 10 digits.");
  if (p.isVatEnabled && p.vatNumber.trim().length < 5) e.vatNumber = t("Enter the VAT registration number, or turn VAT off.");
  if (p.licenseNumber.trim().length < 5) e.licenseNumber = t("Enter the business license number.");
  if (!/^(\+251|0)\s?[79]\d{2}\s?\d{3}\s?\d{3}$/.test(p.phone.trim())) e.phone = t("Use an Ethiopian number, e.g. +251 911 234 567.");
  if (p.address.trim().length < 5) e.address = t("Enter the address.");
  return !showErrors(e, ["businessName", "licenseNumber", "address", "phone", "tinNumber", "vatNumber"]);
}

export const storeActions: ActionMap = {
  "vat-toggle": (el) => { d().isVatEnabled = !d().isVatEnabled; el.setAttribute("aria-checked", String(d().isVatEnabled)); clearErrors(["vatNumber"]); refreshBits(); },
  currency: (el) => { const v = el.dataset.value; if (v === "ETB" || v === "Br") { d().currencySymbol = v; setPressed(el); refreshBits(); } },
  "profile-discard": () => { draft = null; state.errors = {}; rerender(); },
  "profile-save": () => {
    const p = d();
    const next: StoreProfile = { ...p, tinNumber: p.tinNumber.replace(/\s/g, ""), businessName: p.businessName.trim(), address: p.address.trim(), phone: p.phone.trim() };
    if (!validate(next)) return;
    const undo = saveProfile(next);
    draft = null;
    rerender();
    renderTopbar();
    toast(t("Store profile saved"), () => { undo(); draft = null; rerender(); });
  },
};

/** Drop unsaved edits (e.g. when another user signs in). */
export const resetStoreDraft = (): void => { draft = null; };
