/* =========================================================
   Sign-in for live mode (SEER backend).
   The kitchen signs in once per screen; the session survives reloads.
   Access tokens last 15 minutes and are refreshed automatically.
   ========================================================= */

import { t } from "./i18n";

export interface KdsUser { id: string; name: string; role: string; branchId: string }
interface Session { accessToken: string; refreshToken: string; user: KdsUser }

const KEY = "seer.kds.session";
let session: Session | null = (() => {
  try { return JSON.parse(localStorage.getItem(KEY) ?? "null") as Session | null; } catch { return null; }
})();

function save(s: Session | null): void {
  session = s;
  try { s ? localStorage.setItem(KEY, JSON.stringify(s)) : localStorage.removeItem(KEY); } catch { /* memory only */ }
}

const apiBase = (): string => {
  const env = import.meta.env ?? {};
  const ws = env.VITE_KDS_WS_URL?.trim() ?? "";
  return (env.VITE_KDS_API_URL?.trim() || (ws ? new URL(ws.replace(/^ws/, "http")).origin : "")).replace(/\/$/, "");
};

export const currentUser = (): KdsUser | null => session?.user ?? null;

/** Seconds until the access token expires (JWT `exp`), or 0 if unreadable. */
function secondsLeft(token: string): number {
  try {
    const payload = JSON.parse(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"))) as { exp?: number };
    return (payload.exp ?? 0) - Date.now() / 1000;
  } catch { return 0; }
}

async function refresh(): Promise<boolean> {
  if (!session) return false;
  try {
    const res = await fetch(`${apiBase()}/auth/refresh`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refreshToken: session.refreshToken }),
    });
    if (!res.ok) { if (res.status === 401) save(null); return false; }
    const s = (await res.json()) as Session;
    save({ accessToken: s.accessToken, refreshToken: s.refreshToken, user: s.user });
    return true;
  } catch { return false; }  // offline: keep the session, try again later
}

/** A usable access token, refreshed when it has less than a minute left. */
export async function accessToken(force = false): Promise<string | null> {
  if (!session) return null;
  if (force || secondsLeft(session.accessToken) < 60) await refresh();
  return session?.accessToken ?? null;
}

/** The backend no longer accepts this session: forget it and show the sign-in screen. */
export function handleUnauthorized(): void {
  save(null);
  location.reload();
}

/** Show the sign-in form over the board; resolves once signed in. */
export function signInScreen(): Promise<void> {
  return new Promise((resolve) => {
    const wrap = document.createElement("div");
    wrap.className = "signin-backdrop";
    const draw = (msg = ""): void => {
      wrap.innerHTML = `
        <form class="signin-card" id="kds-signin">
          <div class="brand kds-brand"><img class="brand-logo" src="/logo-light.png" alt="SEER"><img class="brand-logo dark-only" src="/logo-dark.png" alt="SEER"></div><h1>${t("Kitchen Display")}</h1>
          <label>${t("Username")}<input name="username" autocomplete="username" autocapitalize="none" required></label>
          <label>${t("Password")}<input name="password" type="password" autocomplete="current-password" required></label>
          ${msg ? `<p class="signin-error" role="alert">${msg}</p>` : ""}
          <button class="btn" type="submit">${t("Sign in")}</button>
        </form>`;
      wrap.querySelector<HTMLInputElement>("input")?.focus();
    };
    draw();
    wrap.addEventListener("submit", async (e) => {
      e.preventDefault();
      const data = new FormData(e.target as HTMLFormElement);
      try {
        const res = await fetch(`${apiBase()}/auth/login`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ username: String(data.get("username")).trim(), password: String(data.get("password")) }),
        });
        if (res.status === 401) return draw(t("Wrong username or password"));
        if (!res.ok) return draw(t("Cannot reach the server. Try again in a minute."));
        const s = (await res.json()) as Session;
        save({ accessToken: s.accessToken, refreshToken: s.refreshToken, user: s.user });
        wrap.remove();
        resolve();
      } catch {
        draw(t("Cannot reach the server. Try again in a minute."));
      }
    });
    document.body.append(wrap);
  });
}
