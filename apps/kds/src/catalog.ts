/* =========================================================
   Reference data: stations, dishes (with their station),
   modifiers and staff. In production the dish list and stations
   come from System Admin's price book and staff from HR; this file
   holds the same shape so the demo feed and the names work offline.
   ========================================================= */

import type { KitchenStation, LocalizedText } from "./types";
import { registerText } from "./i18n";

const L = (en: string, am: string, om: string): LocalizedText => ({ en, am, om });

/* ---------- timing rules ---------- */

/** Urgency thresholds in minutes: green below WARN, yellow below LATE, red/flashing from LATE. */
export const URGENCY_MINUTES = { WARN: 10, LATE: 20 } as const;

/** How long a just-arrived ticket keeps its NEW badge and glow. */
export const NEW_BADGE_MS = 12_000;

/** How many picked-up tickets can be recalled. */
export const RECALL_LIMIT = 10;

/* ---------- stations ---------- */

export const STATIONS: readonly KitchenStation[] = ["GRILL", "HOT_KITCHEN", "SALAD", "BAR"];

const STATION_NAMES: Record<KitchenStation, LocalizedText> = {
  GRILL: L("Grill", "ጥብስ", "Waaddii"),
  HOT_KITCHEN: L("Hot Kitchen", "ወጥ ቤት", "Kushinaa Ho'aa"),
  SALAD: L("Salad", "ሰላጣ", "Salaaxaa"),
  BAR: L("Bar", "ባር", "Baarii"),
};
for (const s of STATIONS) registerText(`station.${s}`, STATION_NAMES[s]);

/* ---------- dishes ---------- */

export interface MenuEntry {
  id: string;
  station: KitchenStation;
  name: LocalizedText;
}

export const MENU: readonly MenuEntry[] = [
  { id: "doro-wat", station: "HOT_KITCHEN", name: L("Doro Wat", "ዶሮ ወጥ", "Ittoo Lukkuu") },
  { id: "shiro", station: "HOT_KITCHEN", name: L("Shiro Wat", "ሽሮ ወጥ", "Ittoo Shiroo") },
  { id: "misir", station: "HOT_KITCHEN", name: L("Misir Wat", "ምስር ወጥ", "Ittoo Misira") },
  { id: "beyaynetu", station: "HOT_KITCHEN", name: L("Beyaynetu (fasting platter)", "በያይነቱ", "Bayyaynatuu") },
  { id: "firfir", station: "HOT_KITCHEN", name: L("Firfir", "ፍርፍር", "Firfir") },
  { id: "beef-tibs", station: "GRILL", name: L("Beef Tibs", "የበሬ ጥብስ", "Tibsii Sangaa") },
  { id: "lamb-tibs", station: "GRILL", name: L("Lamb Tibs", "የበግ ጥብስ", "Tibsii Hoolaa") },
  { id: "kitfo", station: "GRILL", name: L("Kitfo", "ክትፎ", "Kitfoo") },
  { id: "timatim", station: "SALAD", name: L("Timatim Salad", "ቲማቲም ሰላጣ", "Salaaxaa Timaatimii") },
  { id: "azifa", station: "SALAD", name: L("Azifa (lentil salad)", "አዚፋ", "Aziifaa") },
  { id: "macchiato", station: "BAR", name: L("Macchiato", "ማኪያቶ", "Makiyaatoo") },
  { id: "jebena", station: "BAR", name: L("Jebena Buna", "ጀበና ቡና", "Buna Jabanaa") },
  { id: "juice", station: "BAR", name: L("Fresh Juice", "ጭማቂ", "Cuunfaa Fuduraa") },
  { id: "tej", station: "BAR", name: L("Tej (glass)", "ጠጅ (ብርጭቆ)", "Daadhii (burcuqqoo)") },
];
for (const m of MENU) registerText(`menu.${m.id}`, m.name);
export const menuById = (id: string): MenuEntry | undefined => MENU.find((m) => m.id === id);

/* ---------- modifiers ---------- */

/** Known modifiers are translated; anything else is shown exactly as typed at the counter. */
export const MODIFIERS: Record<string, LocalizedText> = {
  "no-onion": L("No onion", "ሽንኩርት የለበትም", "Qullubbii malee"),
  "extra-berbere": L("Extra berbere", "ተጨማሪ በርበሬ", "Barbaree dabalataa"),
  "mild": L("Mild, no berbere", "ያለ በርበሬ", "Barbaree malee"),
  "leb-leb": L("Leb leb (lightly cooked)", "ለብለብ", "Lab lab"),
  "tere": L("Tere (raw)", "ጥሬ", "Dheedhii"),
  "well-done": L("Well done", "በደንብ የበሰለ", "Sirriitti bilchaate"),
  "mitmita": L("With mitmita", "ከሚጥሚጣ ጋር", "Miixmixaa waliin"),
  "fasting": L("Fasting (no butter)", "የጾም (ቅቤ የሌለው)", "Soomaa (dhadhaa malee)"),
  "extra-injera": L("Extra injera", "ተጨማሪ እንጀራ", "Biddeena dabalataa"),
  "no-sugar": L("No sugar", "ያለ ስኳር", "Sukkaara malee"),
  "no-ice": L("No ice", "ያለ በረዶ", "Cabbii malee"),
  "allergy": L("Allergy", "አለርጂ", "Alarjii"),
};
for (const [id, text] of Object.entries(MODIFIERS)) registerText(`mod.${id}`, text);

/* ---------- staff (from HR in production) ---------- */

export const STAFF: Record<string, { name: string; initials: string }> = {
  "EMP-004": { name: "Meron Girma", initials: "MG" },
  "EMP-005": { name: "Chaltu Bekele", initials: "CB" },
  "EMP-006": { name: "Yonas Tadesse", initials: "YT" },
  "EMP-007": { name: "Selam Hailu", initials: "SH" },
  "EMP-008": { name: "Lensa Tola", initials: "LT" },
};

/** Who is signed in on this screen. Comes from the real sign-in in production. */
export const KDS_OPERATOR = "KDS-BOLE-01";
