/* =========================================================
   SEER · Help & support
   The same engine in every app; each app passes its own content
   (what this role does, its common problems, who to ask).
   Master copy: apps/shared/support.ts — copied into each app's
   src/ because every app is built and deployed on its own.
   ========================================================= */

export type Translate = (key: string, vars?: Record<string, string | number>) => string;

export interface HelpContent {
  /** This app's name, e.g. "Finance & accounting". */
  app: string;
  /** One or two sentences: what this app is for and who uses it. */
  intro: string;
  /** How to do the main jobs, in order. */
  steps: { title: string; body: string }[];
  /** The problems people actually hit, with the fix. */
  faqs: { q: string; a: string }[];
  /** Who to go to for what. */
  contacts: { who: string; when: string }[];
  /** What this app deliberately does not do, and where it's done instead. */
  notHere?: string[];
}

export interface Who { name: string; role: string; branch?: string }

const BASE = (((import.meta as unknown as { env?: Record<string, string | undefined> }).env ?? {}).VITE_API_URL ?? "").trim().replace(/\/$/, "");

const esc = (s: unknown): string =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string);

const SVG = (d: string) =>
  `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
export const HELP_ICON = SVG('<circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.7.3-1 .9-1 1.7M12 17h.01"/>');
const I = {
  steps: SVG('<path d="M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01"/>'),
  faq: SVG('<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>'),
  who: SVG('<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0M16 4.5a3.5 3.5 0 0 1 0 7M21.5 20a6.5 6.5 0 0 0-4-6"/>'),
  not: SVG('<circle cx="12" cy="12" r="9"/><path d="M5.6 5.6l12.8 12.8"/>'),
  report: SVG('<path d="M4 21V4h11l-1 4h6v9h-9l1-4H4"/>'),
  close: SVG('<path d="M6 6l12 12M18 6 6 18"/>'),
};

let server = "";            // result of the last connection check, included in the copied details
let busy = false;

function statusText(t: Translate): string {
  if (!navigator.onLine) return t("This device is offline. Check the Wi-Fi or mobile data.");
  return server || t("Not checked yet.");
}

/** The Help & support content. Shell apps show it as a page; single-screen apps inside openSupport(). */
export function supportHtml(c: HelpContent, t: Translate, who: Who | null): string {
  return `
  <div class="sh">
    <section class="sh-intro">
      <h2>${esc(t("Help & support"))}</h2>
      <p>${esc(t(c.intro))}</p>
      ${who ? `<p class="sh-who">${esc(who.branch ? t("Signed in as {name} · {role} · {branch}", { name: who.name, role: who.role, branch: who.branch })
        : t("Signed in as {name} · {role}", { name: who.name, role: who.role }))}</p>` : ""}
    </section>

    <section class="sh-card" aria-labelledby="shSteps">
      <h3 id="shSteps">${I.steps} ${esc(t("How to use this app"))}</h3>
      <ol class="sh-steps">${c.steps.map((s) => `<li><strong>${esc(t(s.title))}</strong><span>${esc(t(s.body))}</span></li>`).join("")}</ol>
    </section>

    <section class="sh-card" aria-labelledby="shFaq">
      <h3 id="shFaq">${I.faq} ${esc(t("Common problems"))}</h3>
      <div class="sh-faq">${c.faqs.map((f) => `<details><summary>${esc(t(f.q))}</summary><p>${esc(t(f.a))}</p></details>`).join("")}</div>
    </section>

    <div class="sh-two">
      <section class="sh-card" aria-labelledby="shWho">
        <h3 id="shWho">${I.who} ${esc(t("Who to ask"))}</h3>
        <ul class="sh-who-list">${c.contacts.map((x) => `<li><strong>${esc(t(x.who))}</strong><span>${esc(t(x.when))}</span></li>`).join("")}</ul>
      </section>
      ${c.notHere?.length ? `<section class="sh-card" aria-labelledby="shNot">
        <h3 id="shNot">${I.not} ${esc(t("Not in this app"))}</h3>
        <ul class="sh-not">${c.notHere.map((x) => `<li>${esc(t(x))}</li>`).join("")}</ul>
      </section>` : ""}
    </div>

    <section class="sh-card sh-report" aria-labelledby="shReport">
      <h3 id="shReport">${I.report} ${esc(t("Report a problem"))}</h3>
      <p>${esc(t("First check the connection. If it still doesn't work, copy the details below and send them, with what you were doing, to the person in \"Who to ask\"."))}</p>
      <div class="sh-actions">
        <button type="button" class="sh-btn" data-sh="ping" ${busy ? "disabled" : ""}>${esc(busy ? t("Checking…") : t("Check connection"))}</button>
        <button type="button" class="sh-btn" data-sh="copy">${esc(t("Copy details for support"))}</button>
      </div>
      <p class="sh-status" id="shStatus" role="status">${esc(statusText(t))}</p>
    </section>
  </div>`;
}

function details(c: HelpContent, t: Translate, who: Who | null): string {
  return [
    `SEER · ${c.app}`,
    who ? [who.name, who.role, who.branch].filter(Boolean).join(" · ") : "",
    `${new Date().toLocaleString()} (${Intl.DateTimeFormat().resolvedOptions().timeZone})`,
    `${location.href}`,
    `Online: ${navigator.onLine ? "yes" : "no"} · ${statusText((s) => s)}`,
    `Server: ${BASE || "demo (no server)"}`,
    navigator.userAgent,
    "",
    t("What happened:"),
    "",
  ].filter((l, i) => l || i > 6).join("\n");
}

function setStatus(text: string): void {
  const el = document.getElementById("shStatus");
  if (el) el.textContent = text;
}

async function ping(t: Translate): Promise<void> {
  if (busy) return;
  if (!BASE) { server = t("Demo mode: this app isn't connected to a server."); setStatus(server); return; }
  busy = true;
  const btn = document.querySelector<HTMLButtonElement>('[data-sh="ping"]');
  if (btn) { btn.disabled = true; btn.textContent = t("Checking…"); }
  setStatus(t("Checking the server… it can take up to a minute if it was asleep."));
  const start = performance.now();
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 70_000);
  try {
    const res = await fetch(`${BASE}/health`, { cache: "no-store", signal: ctl.signal });
    const ms = Math.round(performance.now() - start);
    server = res.ok
      ? (ms > 8000 ? t("Server OK — it was asleep and took {s} s to wake up. Try again now.", { s: Math.round(ms / 1000) })
        : t("Server OK ({ms} ms).", { ms }))
      : t("The server answered with an error ({code}). Tell support.", { code: res.status });
  } catch {
    server = navigator.onLine ? t("Can't reach the server. Wait a minute and check again; if it keeps failing, tell support.")
      : t("This device is offline. Check the Wi-Fi or mobile data.");
  } finally {
    clearTimeout(timer);
    busy = false;
    if (btn) { btn.disabled = false; btn.textContent = t("Check connection"); }
    setStatus(server);
  }
}

async function copy(c: HelpContent, t: Translate, who: Who | null): Promise<void> {
  const text = details(c, t, who);
  try {
    await navigator.clipboard.writeText(text);
    setStatus(t("Copied. Paste it in a message to support and add what you were doing."));
  } catch {
    // clipboard blocked: show the text so it can be selected by hand
    const el = document.getElementById("shStatus");
    if (el) {
      el.innerHTML = `<textarea class="sh-copybox" rows="8" readonly>${esc(text)}</textarea>`;
      el.querySelector<HTMLTextAreaElement>("textarea")?.select();
    }
  }
}

let wired = false;
let current: { c: HelpContent; t: Translate; who: () => Who | null } | null = null;

/** Hook up the buttons once. `who` is read when a button is pressed, so it is always current. */
export function installSupport(c: HelpContent, t: Translate, who: () => Who | null): void {
  current = { c, t, who };
  if (wired) return;
  wired = true;
  document.addEventListener("click", (e) => {
    const el = (e.target as HTMLElement).closest<HTMLElement>("[data-sh]");
    if (!el || !current) return;
    const k = el.dataset.sh;
    if (k === "ping") { e.preventDefault(); void ping(current.t); }
    else if (k === "copy") { e.preventDefault(); void copy(current.c, current.t, current.who()); }
    else if (k === "close") { e.preventDefault(); closeSupport(); }
    else if (k === "open") { e.preventDefault(); openSupport(); }
  });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && document.getElementById("shOverlay")) closeSupport(); });
}

let returnFocus: HTMLElement | null = null;

/** Single-screen apps (Cashier, Kitchen, Waiter): Help opens over the screen. */
export function openSupport(): void {
  if (!current || document.getElementById("shOverlay")) return;
  returnFocus = document.activeElement as HTMLElement | null;
  const { c, t, who } = current;
  const box = document.createElement("div");
  box.id = "shOverlay";
  box.className = "sh-overlay";
  box.setAttribute("role", "dialog");
  box.setAttribute("aria-modal", "true");
  box.setAttribute("aria-label", t("Help & support"));
  box.innerHTML = `<div class="sh-sheet">
    <button type="button" class="sh-close" data-sh="close" aria-label="${esc(t("Close"))}">${I.close}</button>
    ${supportHtml(c, t, who())}
  </div>`;
  document.body.appendChild(box);
  document.body.classList.add("sh-open");
  box.querySelector<HTMLElement>(".sh-close")?.focus();
}

export function closeSupport(): void {
  document.getElementById("shOverlay")?.remove();
  document.body.classList.remove("sh-open");
  returnFocus?.focus?.();
  returnFocus = null;
}

/** The ? button for a header. */
export const helpButton = (t: Translate, cls = ""): string =>
  `<button type="button" class="sh-help-btn ${cls}" data-sh="open" aria-label="${esc(t("Help & support"))}" title="${esc(t("Help & support"))}">${HELP_ICON}</button>`;
