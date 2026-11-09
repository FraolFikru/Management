/* Export every frontend's catalogue + seed data, unchanged, as JSON.

     node --no-warnings --import ./seed/node/register.mjs seed/node/export-frontends.mjs <frontends-root> <out-dir>

   <frontends-root> is the apps/ folder of this repo (sales/, manager/, …).
   Each module's own generateSeed() runs, so the JSON is exactly the shape its
   local store uses today. i18n texts are captured from registerText() calls.  */
import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const [, , rootArg, outArg = "seed/data"] = process.argv;
if (!rootArg) { console.error("usage: export-frontends.mjs <frontends-root> [out-dir]"); process.exit(2); }
const root = resolve(rootArg), out = resolve(outArg);
mkdirSync(out, { recursive: true });

globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };

// Capture LocalizedText registrations: every i18n.ts keeps them in a Map.
let captured = null;
const origSet = Map.prototype.set;
Map.prototype.set = function (k, v) {
  if (captured && typeof k === "string" && v && typeof v === "object" && "en" in v && "am" in v && "om" in v) captured[k] = v;
  return origSet.call(this, k, v);
};

const MODULES = {   // folders under apps/ in this repo
  sales:   { dir: "sales/src",   files: ["catalog.ts", "seed.ts"] },
  manager: { dir: "manager/src", files: ["catalog.ts", "seed.ts"] },
  finance: { dir: "finance/src", files: ["catalog.ts", "seed.ts"] },
  hr:      { dir: "hr/src",      files: ["catalog.ts", "seed.ts"] },
  admin:   { dir: "admin/src",   files: ["catalog.ts", "seed.ts"] },
  kds:     { dir: "kds/src",     files: ["catalog.ts", "feed/demo.ts"] },
  owner:   { dir: "owner/src",   files: ["data.ts"] },
};

const runGenerators = async (mod, data) => {
  for (const [k, fn] of Object.entries(mod)) {
    if (typeof fn === "function" && /^generate[A-Z]/.test(k) && fn.length === 0) data[k === "generateSeed" ? "generated" : k] = plain(fn());
  }
};
const plain = (v) => JSON.parse(JSON.stringify(v, (_k, x) => (x instanceof Set ? [...x] : x instanceof Map ? Object.fromEntries(x) : x)));

for (const [name, m] of Object.entries(MODULES)) {
  const base = join(root, m.dir);
  if (!existsSync(base)) { console.warn(`skip ${name}: ${base} not found`); continue; }
  captured = {};
  const data = { module: name, exportedAt: new Date().toISOString(), i18n: captured };
  for (const f of m.files) {
    const mod = await import(pathToFileURL(join(base, f)).href);
    for (const [k, v] of Object.entries(mod)) {
      if (typeof v !== "function") data[k] = plain(v);
    }
    await runGenerators(mod, data);
  }
  writeFileSync(join(out, `${name}.json`), JSON.stringify(data, null, 1));
  console.log(`${name}: ${Object.keys(data).length - 3} exports, ${Object.keys(captured).length} i18n keys${data.generated ? ", generated seed" : ""}`);
  captured = null;
}
