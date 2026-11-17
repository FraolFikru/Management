/* Runs in the shell window and in every app frame.

   Shell (top frame): gets a small "seerDesktop" bridge.
   App frames: when an app shows its own sign-in screen, fill it with the sign-in the person already
   gave the shell and submit it, once. If it is refused (this role cannot use that app) the app's own
   message stays on screen and nothing is retried. */

const { contextBridge, ipcRenderer } = require("electron");

if (process.isMainFrame) {
  contextBridge.exposeInMainWorld("seerDesktop", {
    config: () => ipcRenderer.invoke("seer:config"),
    setCredentials: (userId, username, password) => ipcRenderer.invoke("seer:set-creds", { userId, username, password }),
    signOut: () => ipcRenderer.invoke("seer:logout"),
  });
} else {
  const getCreds = () => ipcRenderer.invoke("seer:creds");
  // SEER_AUTOFILL_START (the same function is exercised by the tests with a stand-in for getCreds)
  const autofill = (getCredentials) => {
    let tried = false;
    const setValue = (input, value) => {
      const proto = Object.getPrototypeOf(input);
      const setter = Object.getOwnPropertyDescriptor(proto, "value");
      if (setter && setter.set) setter.set.call(input, value); else input.value = value;
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
    };
    const attempt = async () => {
      if (tried) return;
      const pw = document.querySelector("input[type=password]");
      if (!pw) return;
      // the Waiter opens on "staff code + PIN": switch it to username and password first
      if (pw.getAttribute("inputmode") === "numeric") {
        const other = document.querySelector('[data-act="signin-mode"]');
        if (other) { other.click(); return; }
      }
      const form = pw.closest("form");
      const user = (form || document).querySelector('input:not([type=password]):not([type=hidden]):not([type=checkbox]):not([type=radio]):not([type=search])');
      if (!user) return;
      tried = true;
      const c = await getCredentials();
      if (!c) return;
      setValue(user, c.username);
      setValue(pw, c.password);
      setTimeout(() => {
        const btn = (form || document).querySelector('button[type=submit], input[type=submit]');
        if (form && typeof form.requestSubmit === "function") form.requestSubmit(btn || undefined);
        else if (btn) btn.click();
      }, 60);
    };
    const start = () => { new MutationObserver(() => { void attempt(); }).observe(document.documentElement, { childList: true, subtree: true }); void attempt(); };
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start); else start();
  };
  // SEER_AUTOFILL_END
  autofill(getCreds);
}
