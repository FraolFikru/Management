import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
export async function resolve(spec, ctx, next) {
  if ((spec.startsWith("./") || spec.startsWith("../")) && !/\.[cm]?[jt]s$/.test(spec)) {
    const base = new URL(spec, ctx.parentURL);
    for (const ext of [".ts", "/index.ts"]) {
      const u = new URL(base.href + ext);
      if (existsSync(fileURLToPath(u))) return next(u.href, ctx);
    }
  }
  if (spec.endsWith(".css")) return { url: "data:text/javascript,export default {}", shortCircuit: true };
  return next(spec, ctx);
}
