/* SEER · waking a sleeping server (shared; the same file sits in every app).

   The backend runs on a host that sleeps when nobody has used it for a while,
   and the first request afterwards can take up to a minute. Instead of showing
   "Cannot reach the server" and making people try again by hand:
     - warm() pings the server as soon as the page opens, so it is usually
       awake by the time someone has typed their password;
     - wakeFetch() is fetch() that keeps trying for a while when the server is
       unreachable or still starting, and shows a small notice while it waits. */

const ENV = (import.meta as unknown as { env?: Record<string, string | undefined> }).env ?? {};
const BASE = (ENV.VITE_API_URL || ENV.VITE_KDS_API_URL || "").trim().replace(/\/$/, "");

const WAIT_MS = 90_000;      // a cold start is normally well under this
const EVERY_MS = 3_000;
const STARTING = new Set([502, 503, 504]);

const TEXT: Record<string, [string, string]> = {
  en: ["Starting the server", "This can take up to a minute after a quiet period. Signing you in as soon as it is ready."],
  am: ["ሰርቨሩ እየተነሳ ነው", "ከእረፍት በኋላ እስከ አንድ ደቂቃ ሊወስድ ይችላል። ዝግጁ እንደሆነ ወዲያውኑ ያስገባዎታል።"],
  om: ["Sarvariin ka'aa jira", "Boqonnaa booda hanga daqiiqaa tokko fudhachuu danda'a. Akkuma qophaa'een si seensisa."],
};

let notice: HTMLElement | null = null;
function show(seconds: number): void {
  const [title, body] = TEXT[document.documentElement.lang] ?? TEXT.en;
  if (!notice) {
    notice = document.createElement("div");
    notice.setAttribute("role", "status");
    notice.style.cssText = "position:fixed;left:50%;bottom:24px;transform:translateX(-50%);z-index:2000;width:min(420px,calc(100vw - 24px));" +
      "padding:12px 16px;border-radius:12px;background:#171717;color:#fff;font:14px/1.45 system-ui,sans-serif;box-shadow:0 8px 24px rgba(0,0,0,.25)";
    document.body.append(notice);
  }
  notice.innerHTML = "";
  const strong = document.createElement("strong");
  strong.textContent = `${title} · ${seconds}s`;
  strong.style.cssText = "display:block;font-weight:600;font-variant-numeric:tabular-nums";
  const span = document.createElement("span");
  span.textContent = body;
  span.style.opacity = "0.75";
  notice.append(strong, span);
}
function hide(): void { notice?.remove(); notice = null; }

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** Start waking the server now, without waiting for the answer. */
export function warm(): void {
  if (BASE) void fetch(`${BASE}/health`, { cache: "no-store" }).catch(() => undefined);
}

/** fetch() that waits for a sleeping server instead of failing straight away.
    Use it for sign-in and other requests that are safe to send again. */
export async function wakeFetch(input: string, init?: RequestInit): Promise<Response> {
  const began = Date.now();
  try {
    for (;;) {
      let res: Response | null = null, failure: unknown = null;
      try { res = await fetch(input, init); } catch (err) { failure = err; }
      if (res && !STARTING.has(res.status)) return res;
      const waited = Date.now() - began;
      // no connection at all on this device: waiting will not help
      if (waited + EVERY_MS > WAIT_MS || (failure && navigator.onLine === false)) {
        if (res) return res;
        throw failure;
      }
      show(Math.round(waited / 1000));
      await sleep(EVERY_MS);
    }
  } finally { hide(); }
}

warm();
