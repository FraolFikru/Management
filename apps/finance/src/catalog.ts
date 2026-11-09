/* =========================================================
   Reference data and Ethiopian tax rules.
   - VAT 15% (VAT Proclamation 1341/2024); monthly return due by
     the last day of the following month.
   - Withholding on supplier payments: 3% on goods ≥ ETB 20,000 and
     services ≥ ETB 10,000; 30% if the supplier has no TIN / licence.
   - Business income tax 30% (shown as an estimate on the P&L).
   ========================================================= */

import type { AccountId, COGSCategory, CostCategory, LocalizedText, OpexCategory, PaymentMethod } from "./types";
import { registerText } from "./i18n";

const L = (en: string, am: string, om: string): LocalizedText => ({ en, am, om });
function reg<K extends string>(prefix: string, map: Record<K, LocalizedText>): Record<K, LocalizedText> {
  for (const k of Object.keys(map) as K[]) registerText(`${prefix}.${k}`, map[k]);
  return map;
}

export const VAT_RATE = 0.15;
export const WHT_RATE = 0.03;
export const WHT_RATE_NO_TIN = 0.3;
export const WHT_THRESHOLD = { GOODS: 20000, SERVICES: 10000 } as const;
export const PROFIT_TAX_RATE = 0.3;
/** Bills due within this many days are flagged "due soon". */
export const DUE_SOON_DAYS = 7;
/** Reconciliation tolerance before a difference counts as a variance. */
export const RECON_TOLERANCE = 50;
/** Cash kept back in the safe each day for petty supplier payments; the rest is banked. */
export const DAILY_FLOAT = 2000;

export const COGS = reg<COGSCategory>("cogs", {
  RAW_INGREDIENTS: L("Raw ingredients & food stock", "ጥሬ እቃዎች እና የምግብ ክምችት", "Meeshaalee dheedhii fi kuusaa nyaataa"),
  BEVERAGE_BAR: L("Beverage & bar inventory", "የመጠጥ እና የባር ክምችት", "Kuusaa dhugaatii fi baarii"),
  PACKAGING_DISPOSABLES: L("Packaging & takeout disposables", "ማሸጊያ እና የሚጣሉ እቃዎች", "Qabiyyee fi meeshaalee darbataman"),
  KITCHEN_CONSUMABLES: L("Kitchen consumables", "የወጥ ቤት ፍጆታዎች", "Fayyadamoota kushinaa"),
  CLEANING_SANITATION: L("Cleaning & sanitation", "ጽዳት እና ንጽህና", "Qulqullina fi fayyaa"),
});
export const COGS_IDS = Object.keys(COGS) as COGSCategory[];

export const OPEX = reg<OpexCategory>("opex", {
  PAYROLL: L("Salaries & employer pension", "ደመወዝ እና የአሰሪ ጡረታ", "Mindaa fi soorama hojjechiisaa"),
  RENT: L("Rent", "ኪራይ", "Kiraa"),
  UTILITIES: L("Utilities (power, water, gas, internet)", "መገልገያዎች (መብራት፣ ውሃ፣ ጋዝ፣ ኢንተርኔት)", "Tajaajila (ibsaa, bishaan, gaazii, interneetii)"),
  MARKETING: L("Marketing", "ማስታወቂያ", "Beeksisa"),
  REPAIRS: L("Repairs & maintenance", "ጥገና", "Suphaa fi kunuunsa"),
  FEES: L("Bank & wallet fees", "የባንክ እና የዋሌት ክፍያዎች", "Kaffaltii baankii fi waalleetii"),
  OTHER_OPEX: L("Other operating costs", "ሌሎች የስራ ወጪዎች", "Baasii hojii biroo"),
});
export const OPEX_IDS = Object.keys(OPEX) as OpexCategory[];

export const isCogs = (c: CostCategory): c is COGSCategory => (COGS_IDS as string[]).includes(c);
export const catName = (c: CostCategory): string => (isCogs(c) ? `cogs.${c}` : `opex.${c}`);
export const COLORS = ["#5bd18b", "#8fd3f4", "#c9a0f2", "#f2c48d", "#f0857a", "#9fb4ff", "#4fc6b7"];

export const METHODS = reg<PaymentMethod>("pay", {
  CASH: L("Cash", "ጥሬ ገንዘብ", "Callaa"),
  TELEBIRR: L("Telebirr", "ቴሌብር", "Telebirr"),
  CBE_BIRR: L("CBE Birr", "ሲቢኢ ብር", "CBE Birr"),
});
export const METHOD_IDS = Object.keys(METHODS) as PaymentMethod[];
export const METHOD_COLOR: Record<PaymentMethod, string> = { CASH: "#5bd18b", TELEBIRR: "#8fd3f4", CBE_BIRR: "#c9a0f2" };
export const isMethod = (v: string): v is PaymentMethod => v in METHODS;

export const ACCOUNTS = reg<AccountId>("acct", {
  CASH: L("Cash on hand (safe)", "በእጅ ያለ ጥሬ ገንዘብ (ካዝና)", "Callaa harka jiru (saanduqa)"),
  BANK: L("CBE bank account", "የንግድ ባንክ ሂሳብ", "Herrega Baankii Daldalaa"),
  TELEBIRR: L("Telebirr merchant wallet", "የቴሌብር ነጋዴ ዋሌት", "Waalleetii daldalaa Telebirr"),
  CBE_BIRR: L("CBE Birr wallet", "የሲቢኢ ብር ዋሌት", "Waalleetii CBE Birr"),
});
export const ACCOUNT_IDS = Object.keys(ACCOUNTS) as AccountId[];
/** Which account a payment method draws from. */
export const METHOD_ACCOUNT: Record<PaymentMethod, AccountId> = { CASH: "CASH", TELEBIRR: "TELEBIRR", CBE_BIRR: "CBE_BIRR" };

/** Finance users (sign-off on payments, filings, reconciliations). */
export const USERS = [
  { id: "EMP-002", name: "Abebe Kebede", role: L("Finance admin", "የፋይናንስ አስተዳዳሪ", "Bulchaa faayinaansii") },
  { id: "EMP-001", name: "Hanna Tesfaye", role: L("Branch Manager", "የቅርንጫፍ ሥራ አስኪያጅ", "Hoji Gaggeessaa Damee") },
  { id: "EMP-020", name: "Mahlet Assefa", role: L("Accountant", "የሂሳብ ባለሙያ", "Ogeessa herregaa") },
] as const;
USERS.forEach((u) => registerText(`user.${u.id}`, u.role));
