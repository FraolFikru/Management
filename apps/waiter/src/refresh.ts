/* =========================================================
   Auto-refresh, the same in every SEER app (no button: it just updates).
   MASTER COPY: apps/shared/refresh.ts. Each app has a copy at
   src/refresh.ts (like support.ts); change this one and copy it.

   - Reloads the app's data every `everyMs` while the tab is visible,
     straight away when the tab comes back or the network returns.
   - If a reload fails (no network, server asleep) it tries again
     after 10 seconds instead of waiting for the next round.
   - Never redraws while someone is typing, a dialog is open or the
     app says it is busy (a save still on its way): it waits, then redraws.
   ========================================================= */

export interface AutoRefreshOptions {
  /** fetch fresh data into the app's store; return false when nothing changed (skips the redraw) */
  reload: () => Promise<boolean | void>;
  /** draw the current screen again */
  redraw: () => void;
  /** live mode and signed in: only then is anything fetched */
  enabled: () => boolean;
  /** kept for the callers; the refresh has no text of its own any more */
  lang?: () => string;
  /** a save is on its way, or the app has a form/dialog open: wait */
  busy?: () => boolean;
  everyMs?: number;
  /** no longer used (there is no button) */
  corner?: "left" | "right";
  bottom?: number;
}

const RETRY_MS = 10_000;

function typing(): boolean {
  const a = document.activeElement as HTMLElement | null;
  return !!a && (a.tagName === "INPUT" || a.tagName === "TEXTAREA" || a.tagName === "SELECT" || a.isContentEditable);
}

function dialogOpen(): boolean {
  return !!document.querySelector('dialog[open], [role="dialog"], [aria-modal="true"], .modal.open');
}

export interface AutoRefresh {
  /** reload now */
  now: () => Promise<void>;
  /** kept for the callers (nothing to show any more) */
  sync: () => void;
}

export function startAutoRefresh(o: AutoRefreshOptions): AutoRefresh {
  const every = o.everyMs ?? 20_000;
  let last = 0;
  let loading = false;
  let waiting = false;        // fresh data arrived while the screen couldn't be redrawn
  let retry: number | undefined;

  const canRedraw = (): boolean => !typing() && !dialogOpen() && !(o.busy?.() ?? false);

  function redrawWhenFree(): void {
    if (!waiting || !canRedraw()) return;
    waiting = false;
    const y = window.scrollY;
    o.redraw();
    window.scrollTo(0, y);
  }

  async function now(): Promise<void> {
    if (!o.enabled() || loading || document.hidden) return;
    if (o.busy?.() ?? false) return;                    // a save is on its way: next time
    loading = true;
    window.clearTimeout(retry);
    try {
      const changed = await o.reload();
      last = Date.now();
      if (changed !== false) waiting = true;
    } catch {
      retry = window.setTimeout(() => void now(), RETRY_MS);   // offline or asleep: keep the last data, try again soon
    } finally {
      loading = false;
    }
    redrawWhenFree();
  }

  window.setInterval(() => void now(), every);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && Date.now() - last > Math.min(every, 15_000)) void now();
  });
  window.addEventListener("online", () => void now());
  document.addEventListener("focusout", () => window.setTimeout(redrawWhenFree, 0));
  document.addEventListener("click", () => window.setTimeout(redrawWhenFree, 50));

  return { now, sync: () => undefined };
}
