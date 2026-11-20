/* =========================================================
   Auto-refresh + Refresh button, the same in every SEER app.
   MASTER COPY: apps/shared/refresh.ts. Each app has a copy at
   src/refresh.ts (like support.ts); change this one and copy it.

   - Reloads the app's data every `everyMs` while the tab is visible,
     straight away when the tab comes back or the network returns.
   - A small "Refresh" pill (fixed, bottom corner) reloads on demand,
     with a spinner while loading and "Updated hh:mm".
   - If a refresh fails (no network, server asleep) it says so and the
     pill becomes "Couldn't refresh — tap to retry" (never silent).
   - Never redraws while someone is typing, a dialog is open or the
     app says it is busy (a save still on its way): it waits, then redraws.
   ========================================================= */

type Vars = Record<string, string | number>;

export interface AutoRefreshOptions {
  /** fetch fresh data into the app's store; return false when nothing changed (skips the redraw) */
  reload: () => Promise<boolean | void>;
  /** draw the current screen again */
  redraw: () => void;
  /** live mode and signed in: only then is anything fetched or the pill shown */
  enabled: () => boolean;
  /** the app's current language: "en" | "am" | "om" */
  lang: () => string;
  /** a save is on its way, or the app has a form/dialog open: wait */
  busy?: () => boolean;
  everyMs?: number;
  /** which bottom corner the pill sits in (default right) */
  corner?: "left" | "right";
  /** extra space from the bottom, e.g. above a bottom navigation bar */
  bottom?: number;
}

const STYLE = `
.rf-pill{position:fixed;z-index:40;display:flex;align-items:center;gap:8px;padding:6px 6px 6px 12px;border-radius:999px;
  background:var(--surface,#111);color:var(--muted,#a1a1a6);border:1px solid var(--line-strong,rgba(237,237,237,.14));
  font:500 13px/1.2 system-ui,"Noto Sans Ethiopic",sans-serif;box-shadow:0 6px 20px rgba(0,0,0,.35)}
.rf-pill.bad{color:var(--text,#ededed);border-color:var(--late,var(--bad,#f2777a));background:var(--surface,#111)}
.rf-pill button{display:inline-flex;align-items:center;gap:6px;min-height:36px;padding:0 12px;border-radius:999px;cursor:pointer;
  border:1px solid var(--line-strong,rgba(237,237,237,.14));background:var(--surface-2,#1c1c1e);color:var(--text,#ededed);font:inherit;font-weight:600}
.rf-pill button:disabled{opacity:.6;cursor:default}
.rf-pill svg{width:16px;height:16px}
.rf-pill .rf-spin svg{animation:rf-spin .9s linear infinite}
@keyframes rf-spin{to{transform:rotate(360deg)}}
@media (prefers-reduced-motion:reduce){.rf-pill .rf-spin svg{animation:none}}
@media print{.rf-pill{display:none}}`;

const ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 4v7h-7"/></svg>`;

const pad = (n: number): string => String(n).padStart(2, "0");

function typing(): boolean {
  const a = document.activeElement as HTMLElement | null;
  return !!a && (a.tagName === "INPUT" || a.tagName === "TEXTAREA" || a.tagName === "SELECT" || a.isContentEditable);
}

function dialogOpen(): boolean {
  return !!document.querySelector('dialog[open], [role="dialog"], [aria-modal="true"], .modal.open');
}

export interface AutoRefresh {
  /** reload now (the button does this) */
  now: () => Promise<void>;
  /** call after the app re-renders its shell, so the pill shows (or hides on sign-out) */
  sync: () => void;
}

export function startAutoRefresh(o: AutoRefreshOptions): AutoRefresh {
  const tr = (k: string, vars?: Vars): string => {
    const l = o.lang();
    let out = (l === "am" || l === "om" ? STRINGS[k]?.[l] : undefined) || k;
    for (const [n, v] of Object.entries(vars ?? {})) out = out.split(`{${n}}`).join(String(v));
    return out;
  };
  const every = o.everyMs ?? 20_000;
  let last = 0;
  let loading = false;
  let failed = false;
  let waiting = false;        // fresh data arrived while the screen couldn't be redrawn

  if (!document.getElementById("rf-style")) {
    const st = document.createElement("style");
    st.id = "rf-style";
    st.textContent = STYLE;
    document.head.appendChild(st);
  }
  const pill = document.createElement("div");
  pill.className = "rf-pill";
  pill.setAttribute("role", "status");
  pill.setAttribute("aria-live", "polite");
  pill.style[o.corner === "left" ? "left" : "right"] = "12px";
  pill.style.bottom = `calc(${o.bottom ?? 12}px + env(safe-area-inset-bottom, 0px))`;

  function draw(): void {
    if (!o.enabled()) { pill.remove(); return; }
    if (!pill.isConnected) document.body.appendChild(pill);
    const d = new Date(last);
    const stamp = last ? tr("Updated {time}", { time: `${pad(d.getHours())}:${pad(d.getMinutes())}` }) : "";
    pill.classList.toggle("bad", failed);
    pill.innerHTML = `<span>${failed ? tr("Couldn't refresh") : loading ? tr("Refreshing…") : stamp}</span>
      <button type="button" class="${loading ? "rf-spin" : ""}" ${loading ? "disabled" : ""}
        aria-label="${failed ? tr("Couldn't refresh — tap to retry") : tr("Refresh")}">${ICON}<span>${failed ? tr("Retry") : tr("Refresh")}</span></button>`;
  }
  pill.addEventListener("click", (e) => { if ((e.target as HTMLElement).closest("button")) void now(); });

  const canRedraw = (): boolean => !typing() && !dialogOpen() && !(o.busy?.() ?? false);

  function redrawWhenFree(): void {
    if (!waiting) return;
    if (!canRedraw()) return;
    waiting = false;
    const y = window.scrollY;
    o.redraw();
    window.scrollTo(0, y);
    draw();
  }

  async function now(manual = true): Promise<void> {
    if (!o.enabled() || loading) { draw(); return; }
    if (!manual && (o.busy?.() ?? false)) return;      // a save is on its way: next time
    loading = true;
    draw();
    try {
      const changed = await o.reload();
      last = Date.now();
      failed = false;
      if (changed !== false) waiting = true;
    } catch {
      failed = true;
    } finally {
      loading = false;
    }
    redrawWhenFree();
    draw();
  }

  window.setInterval(() => { if (!document.hidden) void now(false); else draw(); }, every);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && Date.now() - last > Math.min(every, 15_000)) void now(false);
  });
  window.addEventListener("online", () => void now(false));
  document.addEventListener("focusout", () => window.setTimeout(redrawWhenFree, 0));
  document.addEventListener("click", () => window.setTimeout(() => { redrawWhenFree(); draw(); }, 50));
  window.setTimeout(draw, 0);

  return { now: () => now(true), sync: draw };
}

/** The pill's own text (English is the key). */
const STRINGS: Record<string, { am: string; om: string }> = {
  Refresh: { am: "አድስ", om: "Haaromsi" },
  Retry: { am: "እንደገና ሞክር", om: "Irra deebi'i" },
  "Refreshing…": { am: "በማደስ ላይ…", om: "Haaromsaa jira…" },
  "Updated {time}": { am: "የታደሰው {time}", om: "Kan haaromfame {time}" },
  "Couldn't refresh": { am: "ማደስ አልተቻለም", om: "Haaromsuu hin dandeenye" },
  "Couldn't refresh — tap to retry": { am: "ማደስ አልተቻለም — እንደገና ለመሞከር ይንኩ", om: "Haaromsuu hin dandeenye — irra deebi'uuf tuqi" },
};
