/* =========================================================
   Owners: who has full control of the restaurant.

   Adding an Owner, removing one, or setting a new password for
   one is a request: another Owner approves it (the Owner being
   removed can agree to it). If nobody decides within the
   waiting period, the Owner who asked can apply it. With a
   single Owner, adding a co-owner happens at once.
   ========================================================= */

import { icon } from "./icons";
import {
  askOwnerChange, changeMyPassword, decideOwnerChange, isLive, listOwners,
  type OwnerAccount, type OwnerChange, type OwnerChangeInput, type OwnersOverview,
} from "./api";
import { ownerInbox } from "./data";

type T = (s: string, vars?: Record<string, string | number>) => string;

const esc = (s: unknown): string =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string);

interface AddForm { mode: "new" | "staff"; fullName: string; username: string; branchId: string; phone: string; password: string; staffId: string; error: string; busy: boolean }
interface PassForm { userId: string; current: string; password: string; error: string; busy: boolean }

const ui = {
  loaded: false,
  loading: false,
  error: "",
  data: null as OwnersOverview | null,
  add: null as AddForm | null,
  pass: null as PassForm | null,
  confirm: null as string | null,       // "remove:<id>" or "reject:<id>" waiting for a second tap
  notice: "",
  busy: null as string | null,
};

let rerender: () => void = () => {};

const active = (a: OwnerAccount): boolean => a.is_active === true || a.is_active === 1;
const fmtDay = (iso: string | null): string => {
  if (!iso) return "";
  const d = new Date(iso);
  return isNaN(d.getTime()) ? "" : d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
};
const errText = (err: unknown): string => (err instanceof Error ? err.message : String(err));

async function load(): Promise<void> {
  if (!isLive || ui.loading) return;
  ui.loading = true; ui.error = "";
  try {
    ui.data = await listOwners();
    ui.loaded = true;
    const me = ui.data.me;
    ownerInbox.waiting = ui.data.requests.filter((r) => r.status === "PENDING" && r.requestedBy !== me).length;
  } catch (err) {
    ui.error = errText(err);
  } finally {
    ui.loading = false;
    rerender();
  }
}

/** Called when the Owner opens the page: always fetch fresh (another Owner may have acted). */
export function ownersEnter(): void { ui.loaded = false; ui.notice = ""; ui.add = null; ui.pass = null; ui.confirm = null; }

function branchName(id: string): string {
  return ui.data?.branches.find((b) => b.id === id)?.name ?? id;
}

/* ---------- requests ---------- */

const KIND_ICON: Record<OwnerChange["kind"], string> = { ADD: "plus", REMOVE: "x", RESET_PASSWORD: "pencil" };

function requestText(r: OwnerChange, t: T): string {
  const name = esc(r.targetName || "");
  if (r.kind === "ADD") return r.username ? t("Add {name} (@{user}) as an Owner", { name, user: esc(r.username) }) : t("Make {name} an Owner", { name });
  if (r.kind === "REMOVE") return t("Remove {name} as an Owner", { name });
  return t("Set a new password for {name}", { name });
}

function waitingForMe(r: OwnerChange, t: T): string {
  const rejecting = ui.confirm === `reject:${r.id}`;
  return `<li class="own-req">
    <span class="own-req-icon">${icon(KIND_ICON[r.kind])}</span>
    <div class="own-req-main">
      <strong>${requestText(r, t)}</strong>
      <small>${t("Asked by {name} · {date}", { name: esc(r.requestedByName), date: fmtDay(r.requestedAt) })}</small>
      ${r.kind === "REMOVE" && r.targetUserId === ui.data?.me ? `<small class="warn-text">${t("This is about you. If you approve, you are signed out and can't sign in again.")}</small>` : ""}
    </div>
    <div class="admin-actions">
      <button type="button" class="btn ${rejecting ? "btn-danger" : ""}" data-own-reject="${esc(r.id)}" ${ui.busy ? "disabled" : ""}>${rejecting ? t("Tap again to reject") : t("Reject")}</button>
      <button type="button" class="btn btn-primary" data-own-approve="${esc(r.id)}" ${ui.busy ? "disabled" : ""}>${icon("check")} ${t("Approve")}</button>
    </div>
  </li>`;
}

function mine(r: OwnerChange, t: T): string {
  const ready = !r.waitUntil || new Date(r.waitUntil).getTime() <= Date.now();
  return `<li class="own-req">
    <span class="own-req-icon">${icon(KIND_ICON[r.kind])}</span>
    <div class="own-req-main">
      <strong>${requestText(r, t)}</strong>
      <small>${ready ? t("No other Owner decided within the waiting period. You can apply it now.")
        : t("Waiting for another Owner. If nobody decides, you can apply it from {date}.", { date: fmtDay(r.waitUntil) })}</small>
    </div>
    <div class="admin-actions">
      <button type="button" class="btn" data-own-cancel="${esc(r.id)}" ${ui.busy ? "disabled" : ""}>${t("Cancel request")}</button>
      ${ready ? `<button type="button" class="btn btn-primary" data-own-apply="${esc(r.id)}" ${ui.busy ? "disabled" : ""}>${t("Apply now")}</button>` : ""}
    </div>
  </li>`;
}

const STATUS_TEXT: Record<OwnerChange["status"], string> = { PENDING: "Waiting", APPLIED: "Done", REJECTED: "Rejected", CANCELLED: "Cancelled" };
const STATUS_BADGE: Record<OwnerChange["status"], string> = { PENDING: "warn", APPLIED: "up", REJECTED: "down", CANCELLED: "" };

function historyRow(r: OwnerChange, t: T): string {
  const who = r.status === "APPLIED" && r.reason === "applied after the waiting period"
    ? t("applied by {name} after the waiting period", { name: esc(r.decidedByName) })
    : r.status === "APPLIED" && r.reason === "only Owner" ? t("done at once (there was no other Owner to ask)")
    : r.decidedByName ? (r.status === "APPLIED" ? t("approved by {name}", { name: esc(r.decidedByName) })
      : r.status === "REJECTED" ? t("rejected by {name}", { name: esc(r.decidedByName) }) : t("cancelled by {name}", { name: esc(r.decidedByName) })) : "";
  return `<li class="own-hist">
    <div><strong>${requestText(r, t)}</strong>
      <small>${t("Asked by {name} · {date}", { name: esc(r.requestedByName), date: fmtDay(r.requestedAt) })}${who ? ` · ${who}` : ""}${
        r.status === "REJECTED" && r.reason ? ` · “${esc(r.reason)}”` : ""}</small></div>
    <span class="badge ${STATUS_BADGE[r.status]}">${t(STATUS_TEXT[r.status])}</span>
  </li>`;
}

/* ---------- owners ---------- */

function passForm(f: PassForm, t: T): string {
  const self = f.userId === ui.data?.me;
  return `<form class="own-pass" id="ownerPassForm" novalidate>
    ${self ? `<label class="signin-field"><span>${t("Current password")}</span>
      <input id="opCurrent" type="password" autocomplete="current-password" value="${esc(f.current)}"></label>` : ""}
    <label class="signin-field"><span>${t("New password (at least 8 characters)")}</span>
      <input id="opNew" type="password" autocomplete="new-password" value="${esc(f.password)}"></label>
    ${self ? "" : `<p class="muted-note">${t("Another Owner has to approve this. Tell the new password to them in private.")}</p>`}
    <p class="field-error" role="alert">${esc(f.error)}</p>
    <div class="admin-form-actions">
      <button type="button" class="btn" data-own-pass-cancel>${t("Cancel")}</button>
      <button type="submit" class="btn btn-primary" ${f.busy ? "disabled" : ""}>${f.busy ? t("Saving…") : self ? t("Change my password") : t("Ask to set this password")}</button>
    </div>
  </form>`;
}

function ownerRow(a: OwnerAccount, t: T): string {
  const d = ui.data!;
  const me = a.id === d.me;
  const on = active(a);
  const pending = (kind: string) => d.requests.some((r) => r.status === "PENDING" && r.kind === kind && r.targetUserId === a.id);
  const removing = ui.confirm === `remove:${a.id}`;
  const actions = me
    ? `<button type="button" class="btn" data-own-pass="${esc(a.id)}">${icon("pencil")} ${t("Change my password")}</button>
       ${d.owners.filter(active).length > 1 ? `<button type="button" class="btn ${removing ? "btn-danger" : ""}" data-own-remove="${esc(a.id)}" ${pending("REMOVE") ? "disabled" : ""}>${
         pending("REMOVE") ? t("Removal waiting") : removing ? t("Tap again to ask") : t("Step down as Owner")}</button>` : ""}`
    : on
      ? `<button type="button" class="btn" data-own-pass="${esc(a.id)}" ${pending("RESET_PASSWORD") ? "disabled" : ""}>${pending("RESET_PASSWORD") ? t("Password change waiting") : t("Set new password")}</button>
         <button type="button" class="btn ${removing ? "btn-danger" : ""}" data-own-remove="${esc(a.id)}" ${pending("REMOVE") ? "disabled" : ""}>${
           pending("REMOVE") ? t("Removal waiting") : removing ? t("Tap again to ask") : t("Remove as Owner")}</button>`
      : `<button type="button" class="btn" data-own-readd="${esc(a.id)}" ${pending("ADD") ? "disabled" : ""}>${pending("ADD") ? t("Waiting for approval") : t("Bring back")}</button>`;
  return `<li class="admin-row ${on ? "" : "is-off"}">
    <span class="avatar">${esc(a.full_name.split(" ").map((p) => p[0]).slice(0, 2).join(""))}</span>
    <div class="admin-who">
      <strong>${esc(a.full_name)}${me ? ` <span class="badge">${t("You")}</span>` : ""}</strong>
      <small>@${esc(a.username)}${a.staff_code ? ` · ${esc(a.staff_code)}` : ""} · ${esc(a.home_branch_id ? branchName(a.home_branch_id) : t("All branches"))}</small>
      <small class="muted-note">${a.last_login_at ? t("Last signed in {date}", { date: fmtDay(a.last_login_at) }) : t("Never signed in")}</small>
    </div>
    <span class="badge ${on ? "up" : "down"}">${on ? t("Active") : t("Deactivated")}</span>
    <div class="admin-actions">${actions}</div>
    ${ui.pass && ui.pass.userId === a.id ? passForm(ui.pass, t) : ""}
  </li>`;
}

function addForm(f: AddForm, t: T): string {
  const d = ui.data!;
  const alone = d.owners.filter(active).length <= 1;
  return `<form class="panel admin-form" id="ownerAddForm" novalidate>
    <div class="panel-head"><h2>${icon("plus")} ${t("Add an Owner")}</h2></div>
    <div class="seg-toggle own-mode" role="group" aria-label="${t("Who")}">
      <button type="button" class="${f.mode === "new" ? "active" : ""}" aria-pressed="${f.mode === "new"}" data-own-mode="new">${t("New account")}</button>
      <button type="button" class="${f.mode === "staff" ? "active" : ""}" aria-pressed="${f.mode === "staff"}" data-own-mode="staff">${t("Someone already on the staff")}</button>
    </div>
    ${f.mode === "new" ? `
    <div class="admin-form-grid">
      <label class="signin-field"><span>${t("Full name")}</span><input id="oaName" value="${esc(f.fullName)}" autocomplete="off" maxlength="80"></label>
      <label class="signin-field"><span>${t("Username")}</span><input id="oaUser" value="${esc(f.username)}" autocomplete="off" autocapitalize="none" spellcheck="false" maxlength="40"></label>
      <label class="signin-field"><span>${t("Home branch")}</span>
        <select id="oaBranch"><option value="" ${f.branchId ? "" : "selected"}>${t("All branches")}</option>${d.branches.map((b) => `<option value="${esc(b.id)}" ${b.id === f.branchId ? "selected" : ""}>${esc(b.name)}</option>`).join("")}</select></label>
      <label class="signin-field"><span>${t("Phone (optional)")}</span><input id="oaPhone" value="${esc(f.phone)}" inputmode="tel" autocomplete="off"></label>
      <label class="signin-field admin-form-wide"><span>${t("Password (at least 8 characters)")}</span>
        <input id="oaPass" type="password" autocomplete="new-password" value="${esc(f.password)}"></label>
    </div>` : `
    <label class="signin-field"><span>${t("Staff member")}</span>
      <select id="oaStaff"><option value="">${t("Choose…")}</option>${d.staff.map((u) =>
        `<option value="${esc(u.id)}" ${u.id === f.staffId ? "selected" : ""}>${esc(u.full_name)} · ${esc(t(ROLE_NAME[u.role_code] ?? u.role_code))}</option>`).join("")}</select></label>
    <p class="muted-note">${t("They keep their username and password, and get full Owner control instead of their current role.")}</p>`}
    <p class="muted-note">${alone ? t("You are the only Owner, so this happens straight away.") : t("Another Owner has to approve this before it happens.")}</p>
    <p class="field-error" role="alert">${esc(f.error)}</p>
    <div class="admin-form-actions">
      <button type="button" class="btn" data-own-add-cancel>${t("Cancel")}</button>
      <button type="submit" class="btn btn-primary" ${f.busy ? "disabled" : ""}>${f.busy ? t("Saving…") : alone ? t("Add Owner") : t("Ask the other Owners")}</button>
    </div>
  </form>`;
}

const ROLE_NAME: Record<string, string> = {
  ADMIN: "System Admin", BRANCH_MANAGER: "Branch manager", ACCOUNTANT: "Accountant", HR_OFFICER: "HR officer", CASHIER: "Cashier",
  WAITER: "Waiter", KITCHEN_STAFF: "Kitchen staff", INVENTORY_CLERK: "Inventory clerk", SALES_STAFF: "Sales staff",
};

export function renderOwners(t: T, onChange: () => void): string {
  rerender = onChange;
  const intro = `
    <div class="help-intro">
      <h2>${t("Owners")}</h2>
      <p>${t("Every Owner has full control. Adding or removing an Owner, or setting a new password for one, needs another Owner's approval. If nobody decides within {n} days, the Owner who asked can apply it.", { n: ui.data?.waitDays ?? 7 })}</p>
    </div>`;
  if (!isLive) return `${intro}<article class="panel"><p class="muted-note">${t("Connect the app to the server to manage Owners.")}</p></article>`;
  if (!ui.loaded && !ui.loading && !ui.error) void load();
  if (!ui.loaded || !ui.data) {
    return `${intro}<article class="panel"><p class="muted-note">${ui.error ? esc(ui.error) : t("Loading…")}</p>
      ${ui.error ? `<button class="btn" data-own-reload>${icon("refresh")} ${t("Try again")}</button>` : ""}</article>`;
  }
  const d = ui.data;
  const pending = d.requests.filter((r) => r.status === "PENDING");
  const forMe = pending.filter((r) => r.requestedBy !== d.me);
  const mineList = pending.filter((r) => r.requestedBy === d.me);
  const closed = d.requests.filter((r) => r.status !== "PENDING").slice(0, 8);
  const on = d.owners.filter(active).length;
  return `${intro}
    ${ui.notice ? `<p class="admin-notice" role="status">${icon("check")} ${esc(ui.notice)}</p>` : ""}
    ${forMe.length ? `<article class="panel own-attn"><div class="panel-head"><h2>${icon("warning")} ${t("Waiting for your decision")}</h2></div>
      <ul class="own-reqs">${forMe.map((r) => waitingForMe(r, t)).join("")}</ul></article>` : ""}
    ${mineList.length ? `<article class="panel"><div class="panel-head"><h2>${t("Your requests")}</h2></div>
      <ul class="own-reqs">${mineList.map((r) => mine(r, t)).join("")}</ul></article>` : ""}
    ${ui.add ? addForm(ui.add, t) : ""}
    <article class="panel">
      <div class="panel-head">
        <h2>${icon("users")} ${t("{n} active", { n: on })}</h2>
        ${ui.add ? "" : `<button type="button" class="btn btn-primary" data-own-add>${icon("plus")} ${t("Add an Owner")}</button>`}
      </div>
      <ul class="admin-list">${d.owners.map((a) => ownerRow(a, t)).join("")}</ul>
    </article>
    ${closed.length ? `<article class="panel"><div class="panel-head"><h2>${t("Recent changes")}</h2></div>
      <ul class="own-history">${closed.map((r) => historyRow(r, t)).join("")}</ul></article>` : ""}`;
}

/* ---------- actions ---------- */

const v = (id: string): string => document.querySelector<HTMLInputElement | HTMLSelectElement>(id)?.value ?? "";

function readAdd(): AddForm | null {
  const f = ui.add;
  if (!f) return null;
  if (f.mode === "new") {
    f.fullName = v("#oaName").trim(); f.username = v("#oaUser").trim().toLowerCase(); f.branchId = v("#oaBranch");
    f.phone = v("#oaPhone").trim(); f.password = v("#oaPass");
  } else f.staffId = v("#oaStaff");
  return f;
}

function nice(m: string, t: T): string {
  if (m.includes("username already taken")) return t("That username is already taken.");
  if (m.includes("already a request waiting")) return t("There is already a request waiting for this.");
  if (m.includes("keep at least one active Owner")) return t("There must always be at least one active Owner.");
  if (m.includes("still have time")) return t("The other Owners still have time to decide.");
  if (m.includes("current password is wrong")) return t("The current password is wrong.");
  return m;
}

async function ask(body: OwnerChangeInput, t: T, done: (r: OwnerChange) => string): Promise<boolean> {
  try {
    const r = await askOwnerChange(body);
    ui.notice = r.status === "APPLIED" ? done(r) : t("Request sent. Another Owner has to approve it.");
    await load();
    return true;
  } catch (err) {
    ui.notice = nice(errText(err), t);
    rerender();
    return false;
  }
}

async function submitAdd(t: T): Promise<void> {
  const f = readAdd();
  if (!f || f.busy) return;
  f.error = f.mode === "staff"
    ? (!f.staffId ? t("Choose who becomes an Owner.") : "")
    : f.fullName.length < 2 ? t("Enter their full name.")
      : !/^[a-z0-9._-]{3,40}$/.test(f.username) ? t("Username: 3–40 letters, numbers, dots, dashes or underscores.")
        : f.password.length < 8 ? t("The password needs at least 8 characters.") : "";
  if (f.error) { rerender(); return; }
  f.busy = true; rerender();
  const body: OwnerChangeInput = f.mode === "staff" ? { kind: "ADD", userId: f.staffId }
    : { kind: "ADD", fullName: f.fullName, username: f.username, branchId: f.branchId || undefined, phone: f.phone || null, password: f.password };
  try {
    const r = await askOwnerChange(body);
    ui.add = null;
    ui.notice = r.status === "APPLIED" ? t("{name} is now an Owner.", { name: r.targetName }) : t("Request sent. Another Owner has to approve it.");
    await load();
  } catch (err) {
    f.error = nice(errText(err), t); f.busy = false; rerender();
  }
}

async function submitPass(t: T): Promise<void> {
  const f = ui.pass;
  if (!f || f.busy) return;
  f.current = v("#opCurrent"); f.password = v("#opNew");
  const self = f.userId === ui.data?.me;
  f.error = self && !f.current ? t("Enter your current password.") : f.password.length < 8 ? t("The password needs at least 8 characters.") : "";
  if (f.error) { rerender(); return; }
  f.busy = true; rerender();
  try {
    if (self) {
      await changeMyPassword(f.current, f.password);
      ui.notice = t("Your password is changed. Other devices are signed out.");
    } else {
      await askOwnerChange({ kind: "RESET_PASSWORD", userId: f.userId, password: f.password });
      ui.notice = t("Request sent. Another Owner has to approve it.");
    }
    ui.pass = null;
    await load();
  } catch (err) {
    f.error = nice(errText(err), t); f.busy = false; rerender();
  }
}

async function decide(id: string, action: "approve" | "reject" | "cancel" | "apply", t: T): Promise<void> {
  ui.busy = id; ui.confirm = null; rerender();
  try {
    const r = await decideOwnerChange(id, action);
    ui.notice = action === "approve" || action === "apply" ? t("Done: {what}", { what: requestText(r, t).replace(/<[^>]+>/g, "") })
      : action === "reject" ? t("Rejected.") : t("Request cancelled.");
    await load();
  } catch (err) {
    ui.notice = nice(errText(err), t);
  } finally {
    ui.busy = null;
    rerender();
  }
}

/** Delegated clicks; true when the click belonged to this page. */
export function ownersClick(el: HTMLElement, t: T): boolean {
  const hit = (sel: string) => el.closest<HTMLElement>(sel);
  if (hit("[data-own-reload]")) { ui.error = ""; void load(); rerender(); return true; }
  if (hit("[data-own-add]")) {
    ui.notice = ""; ui.confirm = null; ui.pass = null;
    ui.add = { mode: "new", fullName: "", username: "", branchId: "", phone: "", password: "", staffId: "", error: "", busy: false };
    rerender(); document.querySelector<HTMLInputElement>("#oaName")?.focus(); return true;
  }
  const mode = hit("[data-own-mode]");
  if (mode && ui.add) { readAdd(); ui.add.mode = mode.dataset.ownMode === "staff" ? "staff" : "new"; ui.add.error = ""; rerender(); return true; }
  if (hit("[data-own-add-cancel]")) { ui.add = null; rerender(); return true; }
  const pass = hit("[data-own-pass]");
  if (pass) {
    ui.notice = ""; ui.confirm = null; ui.add = null;
    ui.pass = { userId: pass.dataset.ownPass ?? "", current: "", password: "", error: "", busy: false };
    rerender(); document.querySelector<HTMLInputElement>(ui.pass.userId === ui.data?.me ? "#opCurrent" : "#opNew")?.focus(); return true;
  }
  if (hit("[data-own-pass-cancel]")) { ui.pass = null; rerender(); return true; }
  const rm = hit("[data-own-remove]");
  if (rm) {
    const id = rm.dataset.ownRemove ?? "";
    if (ui.confirm !== `remove:${id}`) { ui.confirm = `remove:${id}`; rerender(); return true; }
    ui.confirm = null;
    void ask({ kind: "REMOVE", userId: id }, t, (r) => t("Done: {what}", { what: r.summary }));
    return true;
  }
  const re = hit("[data-own-readd]");
  if (re) { void ask({ kind: "ADD", userId: re.dataset.ownReadd ?? "" }, t, (r) => t("{name} is now an Owner.", { name: r.targetName })); return true; }
  const ap = hit("[data-own-approve]");
  if (ap) { void decide(ap.dataset.ownApprove ?? "", "approve", t); return true; }
  const rj = hit("[data-own-reject]");
  if (rj) {
    const id = rj.dataset.ownReject ?? "";
    if (ui.confirm !== `reject:${id}`) { ui.confirm = `reject:${id}`; rerender(); return true; }
    void decide(id, "reject", t); return true;
  }
  const cc = hit("[data-own-cancel]");
  if (cc) { void decide(cc.dataset.ownCancel ?? "", "cancel", t); return true; }
  const go = hit("[data-own-apply]");
  if (go) { void decide(go.dataset.ownApply ?? "", "apply", t); return true; }
  if (ui.confirm && !hit(".admin-actions")) { ui.confirm = null; rerender(); }
  return false;
}

/** Delegated submits; true when it was this page's form. */
export function ownersSubmit(form: HTMLFormElement, t: T): boolean {
  if (form.id === "ownerAddForm") { void submitAdd(t); return true; }
  if (form.id === "ownerPassForm") { void submitPass(t); return true; }
  return false;
}
