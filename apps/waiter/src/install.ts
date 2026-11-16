/* Installing the Waiter as an app on the phone (home-screen icon, full screen, opens offline). */

interface InstallPrompt extends Event { prompt(): Promise<void>; userChoice: Promise<{ outcome: "accepted" | "dismissed" }> }

let pending: InstallPrompt | null = null;
let onChange: () => void = () => undefined;

const standalone = (): boolean =>
  window.matchMedia("(display-mode: standalone)").matches || (navigator as unknown as { standalone?: boolean }).standalone === true;
const isIos = (): boolean => /iphone|ipad|ipod/i.test(navigator.userAgent);

/** "ready": the phone can install it now · "ios": must be added from the Share menu · "no": already installed or not supported. */
export function installState(): "ready" | "ios" | "no" {
  if (standalone()) return "no";
  if (pending) return "ready";
  return isIos() ? "ios" : "no";
}

export async function install(): Promise<boolean> {
  if (!pending) return false;
  const p = pending; pending = null;
  await p.prompt();
  const { outcome } = await p.userChoice;
  onChange();
  return outcome === "accepted";
}

export function initInstall(changed: () => void): void {
  onChange = changed;
  window.addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); pending = e as InstallPrompt; onChange(); });
  window.addEventListener("appinstalled", () => { pending = null; onChange(); });
  // the service worker is what lets the installed app open without a signal
  const dev = (import.meta as unknown as { env?: { DEV?: boolean } }).env?.DEV;
  const native = "Capacitor" in window;   // the packaged Android app ships its own files, so it needs no service worker
  if ("serviceWorker" in navigator && !dev && !native) window.addEventListener("load", () => { void navigator.serviceWorker.register("/sw.js").catch(() => undefined); });
}
