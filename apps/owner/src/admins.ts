/* =========================================================
   System Admins — the Owner's page for the accounts that run
   the Admin app. The chain of trust:
     Owner  →  creates the System Admins (here)
     System Admin  →  creates everyone else (Admin app)
   ========================================================= */

import { icon } from "./icons";
import { createAdmin, isLive, listAdmins, updateAdmin, type AdminAccount, type AdminInput } from "./api";

type T = (s: string, vars?: Record<string, string | number>) => string;

const esc = (s: unknown): string =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string);

interface FormState { id: string | null; fullName: string; username: string; branchId: string; phone: string; password: string; error: string; busy: boolean }

const ui = {
  loaded: false,
  loading: false,
  error: "",
  admins: [] as AdminAccount[],
  branches: [] as { id: string; name: string }[],
  form: null as FormState | null,
  confirm: null as string | null,      // id waiting for a second tap to deactivate
  notice: "",
};

let rerender: () => void = () => {};

const active = (a: AdminAccount): boolean => a.is_active === true || a.is_active === 1;

function branchName(id: string): string {
  return ui.branches.find((b) => b.id === id)?.name ?? id;
}

function since(iso: string | null, t: T): string {
  if (!iso) return t("Never signed in");
  const d = new Date(iso);
  return isNaN(d.getTime()) ? "" : t("Last signed in {date}", { date: d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) });
}

async function load(): Promise<void> {
  if (!isLive || ui.loading) return;
  ui.loading = true; ui.error = "";
  try {
    const r = await listAdmins();
    ui.admins = r.admins; ui.branches = r.branches; ui.loaded = true;
  } catch (err) {
    ui.error = err instanceof Error ? err.message : String(err);
  } finally {
    ui.loading = false;
    rerender();
  }
}

function formHtml(f: FormState, t: T): string {
  const editing = !!f.id;
  return `
  <form class="panel admin-form" id="adminForm" novalidate>
    <div class="panel-head"><h2>${icon(editing ? "pencil" : "plus")} ${editing ? t("Edit System Admin") : t("Add a System Admin")}</h2></div>
    <div class="admin-form-grid">
      <label class="signin-field"><span>${t("Full name")}</span>
        <input id="afName" value="${esc(f.fullName)}" autocomplete="off" maxlength="80"></label>
      <label class="signin-field"><span>${t("Username")}</span>
        <input id="afUser" value="${esc(f.username)}" autocomplete="off" autocapitalize="none" spellcheck="false" maxlength="40"></label>
      <label class="signin-field"><span>${t("Home branch")}</span>
        <select id="afBranch">${ui.branches.map((b) => `<option value="${esc(b.id)}" ${b.id === f.branchId ? "selected" : ""}>${esc(b.name)}</option>`).join("")}</select></label>
      <label class="signin-field"><span>${t("Phone (optional)")}</span>
        <input id="afPhone" value="${esc(f.phone)}" inputmode="tel" autocomplete="off"></label>
      <label class="signin-field admin-form-wide"><span>${editing ? t("New password (leave blank to keep the current one)") : t("Password (at least 8 characters)")}</span>
        <input id="afPass" type="password" autocomplete="new-password" value="${esc(f.password)}"></label>
    </div>
    <p class="field-error" role="alert">${esc(f.error)}</p>
    <div class="admin-form-actions">
      <button type="button" class="btn" data-admin-cancel>${t("Cancel")}</button>
      <button type="submit" class="btn btn-primary" ${f.busy ? "disabled" : ""}>${f.busy ? t("Saving…") : editing ? t("Save changes") : t("Create System Admin")}</button>
    </div>
  </form>`;
}

function rowHtml(a: AdminAccount, t: T): string {
  const on = active(a);
  const confirming = ui.confirm === a.id;
  return `
  <li class="admin-row ${on ? "" : "is-off"}">
    <span class="avatar">${esc(a.full_name.split(" ").map((p) => p[0]).slice(0, 2).join(""))}</span>
    <div class="admin-who">
      <strong>${esc(a.full_name)}</strong>
      <small>@${esc(a.username)}${a.staff_code ? ` · ${esc(a.staff_code)}` : ""} · ${esc(branchName(a.home_branch_id))}</small>
      <small class="muted-note">${esc(since(a.last_login_at, t))}</small>
    </div>
    <span class="badge ${on ? "up" : "down"}">${on ? t("Active") : t("Deactivated")}</span>
    <div class="admin-actions">
      <button type="button" class="btn" data-admin-edit="${esc(a.id)}">${icon("pencil")} ${t("Edit")}</button>
      ${on
        ? `<button type="button" class="btn ${confirming ? "btn-danger" : ""}" data-admin-toggle="${esc(a.id)}">${confirming ? t("Tap again to deactivate") : t("Deactivate")}</button>`
        : `<button type="button" class="btn" data-admin-toggle="${esc(a.id)}">${t("Reactivate")}</button>`}
    </div>
  </li>`;
}

export function renderAdmins(t: T, onChange: () => void): string {
  rerender = onChange;
  const intro = `
    <div class="help-intro">
      <h2>${t("System Admins")}</h2>
      <p>${t("You give System Admins access. They set up the restaurant and create every other account — cashiers, waiters, kitchen, managers, HR and finance. They can't open this Owner app, and they can't create or change Owner or System Admin accounts.")}</p>
    </div>`;
  if (!isLive) {
    return `${intro}<article class="panel"><p class="muted-note">${t("Connect the app to the server to manage System Admin accounts.")}</p></article>`;
  }
  if (!ui.loaded && !ui.loading && !ui.error) void load();
  if (!ui.loaded) {
    return `${intro}<article class="panel"><p class="muted-note">${ui.error ? esc(ui.error) : t("Loading…")}</p>
      ${ui.error ? `<button class="btn" data-admin-reload>${icon("refresh")} ${t("Try again")}</button>` : ""}</article>`;
  }
  const on = ui.admins.filter(active).length;
  return `${intro}
    ${ui.notice ? `<p class="admin-notice" role="status">${icon("check")} ${esc(ui.notice)}</p>` : ""}
    ${ui.form ? formHtml(ui.form, t) : ""}
    <article class="panel">
      <div class="panel-head">
        <h2>${icon("users")} ${t("{n} active", { n: on })}</h2>
        ${ui.form ? "" : `<button type="button" class="btn btn-primary" data-admin-add>${icon("plus")} ${t("Add a System Admin")}</button>`}
      </div>
      ${ui.admins.length
        ? `<ul class="admin-list">${ui.admins.map((a) => rowHtml(a, t)).join("")}</ul>`
        : `<p class="muted-note">${t("No System Admins yet. Add one so someone can set up staff accounts in the Admin app.")}</p>`}
    </article>`;
}

function readForm(): FormState | null {
  const f = ui.form;
  if (!f) return null;
  const v = (id: string) => (document.querySelector<HTMLInputElement | HTMLSelectElement>(id)?.value ?? "");
  f.fullName = v("#afName").trim();
  f.username = v("#afUser").trim().toLowerCase();
  f.branchId = v("#afBranch");
  f.phone = v("#afPhone").trim();
  f.password = v("#afPass");
  return f;
}

function payload(f: FormState, isActive: boolean): AdminInput {
  return { fullName: f.fullName, username: f.username, branchId: f.branchId, phone: f.phone || null, isActive, ...(f.password ? { password: f.password } : {}) };
}

async function submit(t: T): Promise<void> {
  const f = readForm();
  if (!f || f.busy) return;
  f.error =
    f.fullName.length < 2 ? t("Enter their full name.") :
    !/^[a-z0-9._-]{3,40}$/.test(f.username) ? t("Username: 3–40 letters, numbers, dots, dashes or underscores.") :
    !f.branchId ? t("Choose a home branch.") :
    !f.id && f.password.length < 8 ? t("The password needs at least 8 characters.") :
    f.id && f.password && f.password.length < 8 ? t("The password needs at least 8 characters.") : "";
  if (f.error) { rerender(); return; }
  f.busy = true; rerender();
  try {
    const was = f.id ? ui.admins.find((a) => a.id === f.id) : undefined;
    const saved = f.id ? await updateAdmin(f.id, payload(f, was ? active(was) : true)) : await createAdmin(payload(f, true));
    const i = ui.admins.findIndex((a) => a.id === saved.id);
    if (i >= 0) ui.admins[i] = saved; else ui.admins.push(saved);
    ui.admins.sort((a, b) => a.full_name.localeCompare(b.full_name));
    ui.notice = f.id ? t("Saved {name}.", { name: saved.full_name })
      : t("{name} can now sign in to the Admin app as @{user}.", { name: saved.full_name, user: saved.username });
    ui.form = null;
  } catch (err) {
    const m = err instanceof Error ? err.message : String(err);
    f.error = m.includes("username already taken") ? t("That username is already taken.") : m;
    f.busy = false;
  }
  rerender();
}

async function toggle(id: string, t: T): Promise<void> {
  const a = ui.admins.find((x) => x.id === id);
  if (!a) return;
  readForm();                          // keep anything typed in an open form
  if (active(a) && ui.confirm !== id) { ui.confirm = id; rerender(); return; }
  ui.confirm = null;
  try {
    const saved = await updateAdmin(id, { fullName: a.full_name, username: a.username, branchId: a.home_branch_id, phone: a.phone, isActive: !active(a) });
    Object.assign(a, saved);
    ui.notice = active(a) ? t("{name} can sign in again.", { name: a.full_name }) : t("{name} is signed out and can't sign in.", { name: a.full_name });
  } catch (err) {
    ui.notice = err instanceof Error ? err.message : String(err);
  }
  rerender();
}

/** Delegated click handling; returns true if the click belonged to this page. */
export function adminsClick(el: HTMLElement, t: T): boolean {
  const hit = (sel: string) => el.closest<HTMLElement>(sel);
  if (hit("[data-admin-reload]")) { ui.error = ""; void load(); rerender(); return true; }
  if (hit("[data-admin-add]")) {
    ui.notice = ""; ui.confirm = null;
    ui.form = { id: null, fullName: "", username: "", branchId: ui.branches[0]?.id ?? "", phone: "", password: "", error: "", busy: false };
    rerender(); document.querySelector<HTMLInputElement>("#afName")?.focus(); return true;
  }
  const edit = hit("[data-admin-edit]");
  if (edit) {
    const a = ui.admins.find((x) => x.id === edit.dataset.adminEdit);
    if (a) {
      ui.notice = ""; ui.confirm = null;
      ui.form = { id: a.id, fullName: a.full_name, username: a.username, branchId: a.home_branch_id, phone: a.phone ?? "", password: "", error: "", busy: false };
      rerender(); window.scrollTo({ top: 0, behavior: "smooth" });
    }
    return true;
  }
  if (hit("[data-admin-cancel]")) { ui.form = null; rerender(); return true; }
  const tog = hit("[data-admin-toggle]");
  if (tog) { void toggle(tog.dataset.adminToggle ?? "", t); return true; }
  if (ui.confirm && !hit(".admin-actions")) { ui.confirm = null; rerender(); }
  return false;
}

/** Delegated submit handling; returns true if it was this page's form. */
export function adminsSubmit(form: HTMLFormElement, t: T): boolean {
  if (form.id !== "adminForm") return false;
  void submit(t);
  return true;
}
