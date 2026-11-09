/* =========================================================
   Localization: English (source), Amharic, Afaan Oromoo.
   - UI strings: t("English text"). Keys are the English text, so a
     missing translation falls back to readable English.
   - Catalog names: tk(key), resolved from a registry that the
     catalog fills with LocalizedText (dishes, modifiers, stations).
   Same pattern as the other Restaurant Owner OS modules.
   ========================================================= */

import type { LocalizedText, SupportedLanguage } from "./types";
import { UI_STRINGS } from "./locales";

export const LANGUAGES: readonly { code: SupportedLanguage; short: string; name: string }[] = [
  { code: "en", short: "EN", name: "English" },
  { code: "am", short: "አማ", name: "አማርኛ" },
  { code: "om", short: "OM", name: "Afaan Oromoo" },
];

let current: SupportedLanguage = "en";

export const getLanguage = (): SupportedLanguage => current;

export function setLanguage(lang: SupportedLanguage): void {
  current = lang;
  document.documentElement.lang = lang;
}

export const isLanguage = (v: unknown): v is SupportedLanguage => v === "en" || v === "am" || v === "om";

export const textOf = (text: LocalizedText): string => text[current] || text.en;

type Vars = Record<string, string | number>;

const fill = (s: string, vars?: Vars): string => {
  if (!vars) return s;
  let out = s;
  for (const [k, v] of Object.entries(vars)) out = out.split(`{${k}}`).join(String(v));
  return out;
};

export function t(key: string, vars?: Vars): string {
  const entry = UI_STRINGS[key];
  const s = current === "en" || !entry ? key : entry[current] || key;
  return fill(s, vars);
}

const registry = new Map<string, LocalizedText>();

export function registerText(key: string, text: LocalizedText): void {
  registry.set(key, text);
}

/** Translate a catalog key; returns undefined when unknown so callers can fall back. */
export function tkMaybe(key: string): string | undefined {
  const text = registry.get(key);
  return text ? textOf(text) : undefined;
}

export const tk = (key: string): string => tkMaybe(key) ?? key;
