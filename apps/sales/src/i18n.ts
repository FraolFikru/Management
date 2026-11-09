/* =========================================================
   Localization: English (source), Amharic, Afaan Oromoo.
   - UI strings: t("English text") — keys are the English text, so a
     missing translation falls back to readable English.
   - Catalog names: tk(nameKey) — resolved from a registry that the
     catalog (and user-added items) fill with LocalizedText.
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

/** Pick the current language from a LocalizedText, falling back to English. */
export const textOf = (text: LocalizedText): string => text[current] || text.en;

type Vars = Record<string, string | number>;

const fill = (s: string, vars?: Vars): string => {
  if (!vars) return s;
  let out = s;
  for (const [k, v] of Object.entries(vars)) out = out.split(`{${k}}`).join(String(v));
  return out;
};

/** Translate a UI string. */
export function t(key: string, vars?: Vars): string {
  const entry = UI_STRINGS[key];
  const s = current === "en" || !entry ? key : entry[current] || key;
  return fill(s, vars);
}

/* ---------- registry for catalog names ---------- */

const registry = new Map<string, LocalizedText>();

export function registerText(key: string, text: LocalizedText): void {
  registry.set(key, text);
}

/** Translate a catalog name key (item, sub-category, channel, unit…). */
export function tk(key: string): string {
  const text = registry.get(key);
  return text ? textOf(text) : key;
}

/** English name for a key, used so search works in every language. */
export function tkEnglish(key: string): string {
  return registry.get(key)?.en ?? key;
}

/** The full LocalizedText for a key (undefined for unknown keys). */
export const tkText = (key: string): LocalizedText | undefined => registry.get(key);

/** All names for a key, for multilingual search. */
export function tkAll(key: string): string[] {
  const text = registry.get(key);
  return text ? [text.en, text.am, text.om].filter(Boolean) : [key];
}

/* ---------- calendar ---------- */

const MONTHS: Record<SupportedLanguage, readonly string[]> = {
  en: ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"],
  am: ["ጃን", "ፌብ", "ማርች", "ኤፕሪ", "ሜይ", "ጁን", "ጁላይ", "ኦገስ", "ሴፕቴ", "ኦክቶ", "ኖቬም", "ዲሴም"],
  om: ["Ama", "Gur", "Bit", "Elb", "Caa", "Wax", "Ado", "Hag", "Ful", "Onk", "Sad", "Mud"],
};

// index 0 = Sunday
const WEEKDAYS: Record<SupportedLanguage, readonly string[]> = {
  en: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"],
  am: ["እሑድ", "ሰኞ", "ማክሰ", "ረቡዕ", "ሐሙስ", "ዓርብ", "ቅዳሜ"],
  om: ["Dil", "Wii", "Kib", "Rob", "Kam", "Jim", "San"],
};

export const monthName = (m: number): string => MONTHS[current][m] ?? "";
export const weekdayName = (d: number): string => WEEKDAYS[current][d] ?? "";
