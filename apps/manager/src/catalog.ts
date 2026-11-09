/* =========================================================
   Reference data: menu (what is SOLD), stock catalog in the five
   COGS categories (what is BOUGHT), dispatch destinations, waste
   reasons, roles, staff directory and payment methods.
   Every display name is a LocalizedText registered for tk().
   ========================================================= */

import type {
  COGSCategory,
  Destination,
  ExpenseSource,
  InventoryItem,
  LocalizedText,
  MainCategory,
  MenuCategory,
  MenuItem,
  PaymentMethod,
  Shift,
  StaffAccount,
  UserRole,
  ViewId,
  WasteReason,
} from "./types";
import { registerText } from "./i18n";

const L = (en: string, am: string, om: string): LocalizedText => ({ en, am, om });

function reg<K extends string>(prefix: string, map: Record<K, LocalizedText>): Record<K, LocalizedText> {
  for (const [k, v] of Object.entries(map) as [K, LocalizedText][]) registerText(`${prefix}.${k}`, v);
  return map;
}

/* ---------- COGS categories ---------- */

export const COGS_CATEGORIES = reg<COGSCategory>("cogs", {
  RAW_INGREDIENTS: L("Raw Ingredients & Food Stock", "ጥሬ የምግብ ግብዓቶች", "Galtee Nyaataa Dheedhii"),
  BEVERAGE_BAR: L("Beverage & Bar Inventory", "የመጠጥ እና የባር ክምችት", "Kuusaa Dhugaatii fi Baarii"),
  PACKAGING_DISPOSABLES: L("Packaging & Takeout Disposables", "ማሸጊያ እና የመውሰጃ ዕቃዎች", "Qabiyyee fi Meeshaalee Fudhatamu"),
  KITCHEN_CONSUMABLES: L("Kitchen Consumables", "የወጥ ቤት ፍጆታ ዕቃዎች", "Meeshaalee Fayyadama Kushinaa"),
  CLEANING_SANITATION: L("Cleaning & Sanitation Supplies", "የጽዳት እና የንጽህና ዕቃዎች", "Meeshaalee Qulqullinaa"),
});
export const COGS_IDS = Object.keys(COGS_CATEGORIES) as COGSCategory[];
export const COGS_COLOR: Record<COGSCategory, string> = {
  RAW_INGREDIENTS: "#5bd18b",
  BEVERAGE_BAR: "#8fd3f4",
  PACKAGING_DISPOSABLES: "#f2c48d",
  KITCHEN_CONSUMABLES: "#c9a0f2",
  CLEANING_SANITATION: "#4fc6b7",
};

/* sub-groups inside each category */
reg("group", {
  PROTEINS: L("Proteins", "ፕሮቲኖች", "Pirootiinii"),
  PRODUCE: L("Produce", "አትክልትና ፍራፍሬ", "Kuduraa fi Muduraa"),
  SPICES: L("Spices & Condiments", "ቅመማ ቅመም", "Mi'eessituu"),
  DAIRY: L("Dairy & Eggs", "የወተት ተዋጽኦ እና እንቁላል", "Aannan fi Hanqaaquu"),
  DRY_GOODS: L("Dry Goods & Flour", "ደረቅ ምግብ እና ዱቄት", "Nyaata Gogaa fi Daakuu"),
  OILS: L("Oils & Fats", "ዘይት እና ቅባት", "Zayitaa fi Cooma"),
  SPECIALTY: L("Specialty Items", "ልዩ ዕቃዎች", "Meeshaalee Addaa"),
  ALCOHOL: L("Alcoholic Drinks", "የአልኮል መጠጦች", "Dhugaatii Alkoolii"),
  SOFT: L("Soft Drinks & Water", "ለስላሳ መጠጥ እና ውሃ", "Dhugaatii Laafaa fi Bishaan"),
  COFFEE_TEA: L("Coffee & Tea", "ቡና እና ሻይ", "Buna fi Shaayii"),
  MIXERS: L("Syrups, Mixers & Ice", "ሽሮፕ፣ ማደባለቂያ እና በረዶ", "Siiroppii, Makkaa fi Cabbii"),
  TAKEOUT: L("Takeout Containers", "የመውሰጃ ዕቃዎች", "Meeshaalee Fudhatamu"),
  SERVICEWARE: L("Cups, Lids & Cutlery", "ኩባያ፣ ክዳን እና ማንኪያ", "Kubbaayyaa, Qadaada fi Fal'aana"),
  WRAPS: L("Wraps & Films", "መጠቅለያዎች", "Maraa fi Haguuggii"),
  FOOD_CONTACT: L("Food-contact Chemicals", "ለምግብ ንክኪ ኬሚካሎች", "Keemikaala Nyaata Tuqan"),
  DETERGENTS: L("Detergents & Sanitizers", "ሳሙና እና ጸረ-ተህዋስ", "Saamunaa fi Qulqulleessituu"),
  TOOLS: L("Mops, Brooms & Liners", "መወልወያ፣ መጥረጊያ እና ከረጢት", "Mooppii, Haxaa'aa fi Korojoo"),
});

/* ---------- main families (Vegetables → Onion) ---------- */

export const MAIN_CATEGORIES = reg<MainCategory>("main", {
  VEGETABLES: L("Vegetables", "አትክልት", "Kuduraa"),
  MEAT_FISH: L("Meat & fish", "ሥጋ እና አሳ", "Foon fi qurxummii"),
  DAIRY_EGGS: L("Dairy & eggs", "የወተት ተዋጽኦ እና እንቁላል", "Aannan fi hanqaaquu"),
  GRAINS_FLOUR: L("Grains, flour & injera", "እህል፣ ዱቄት እና እንጀራ", "Midhaan, daakuu fi buddeena"),
  OIL: L("Cooking oil", "የምግብ ዘይት", "Zayita nyaataa"),
  SPICES: L("Spices", "ቅመማ ቅመም", "Mi'eessituu"),
  DRINKS: L("Drinks", "መጠጦች", "Dhugaatii"),
  COFFEE_TEA: L("Coffee & tea", "ቡና እና ሻይ", "Buna fi shaayii"),
  PACKAGING: L("Packaging & takeout", "ማሸጊያ እና መውሰጃ", "Qabiyyee fi fudhatamu"),
  KITCHEN: L("Kitchen supplies", "የወጥ ቤት ዕቃዎች", "Meeshaalee kushinaa"),
  CLEANING: L("Cleaning", "ጽዳት", "Qulqullina"),
});
export const MAIN_IDS = Object.keys(MAIN_CATEGORIES) as MainCategory[];
/** Each main category is booked under one COGS category for accounting. */
export const MAIN_TO_COGS: Record<MainCategory, COGSCategory> = {
  VEGETABLES: "RAW_INGREDIENTS",
  MEAT_FISH: "RAW_INGREDIENTS",
  DAIRY_EGGS: "RAW_INGREDIENTS",
  GRAINS_FLOUR: "RAW_INGREDIENTS",
  OIL: "RAW_INGREDIENTS",
  SPICES: "RAW_INGREDIENTS",
  DRINKS: "BEVERAGE_BAR",
  COFFEE_TEA: "BEVERAGE_BAR",
  PACKAGING: "PACKAGING_DISPOSABLES",
  KITCHEN: "KITCHEN_CONSUMABLES",
  CLEANING: "CLEANING_SANITATION",
};
export const MAIN_COLOR: Record<MainCategory, string> = {
  VEGETABLES: "#5bd18b",
  MEAT_FISH: "#f0857a",
  DAIRY_EGGS: "#f2e3a0",
  GRAINS_FLOUR: "#d9b27c",
  OIL: "#f2c48d",
  SPICES: "#ff9f6b",
  DRINKS: "#8fd3f4",
  COFFEE_TEA: "#b88b6a",
  PACKAGING: "#c9a0f2",
  KITCHEN: "#9fb4ff",
  CLEANING: "#4fc6b7",
};

const GROUP_MAIN: Record<string, MainCategory> = {
  PRODUCE: "VEGETABLES", PROTEINS: "MEAT_FISH", DAIRY: "DAIRY_EGGS", DRY_GOODS: "GRAINS_FLOUR", OILS: "OIL",
  SPICES: "SPICES", SPECIALTY: "SPICES", ALCOHOL: "DRINKS", SOFT: "DRINKS", MIXERS: "DRINKS", COFFEE_TEA: "COFFEE_TEA",
  TAKEOUT: "PACKAGING", SERVICEWARE: "PACKAGING", FOOD_CONTACT: "KITCHEN", DETERGENTS: "CLEANING", TOOLS: "CLEANING",
};

const inventory: InventoryItem[] = [];
function inv(id: string, category: COGSCategory, group: string, unit: string, unitCost: number, name: LocalizedText, aliases: string[] = []): void {
  const nameKey = `inv.${id}`;
  registerText(nameKey, name);
  const main: MainCategory = group === "WRAPS" ? (category === "PACKAGING_DISPOSABLES" ? "PACKAGING" : "KITCHEN") : GROUP_MAIN[group];
  // reorder point: roughly two days of use, cheaper bulk items held deeper
  const reorderPoint = unitCost < 40 ? 60 : unitCost < 200 ? 20 : unitCost < 600 ? 8 : 4;
  inventory.push({ id, nameKey, category, main, groupKey: `group.${group}`, unit, unitCost, aliases, currentQuantity: 0, reorderPoint });
}

// Raw ingredients
inv("onion", "RAW_INGREDIENTS", "PRODUCE", "kg", 45, L("Onion", "ሽንኩርት", "Shunkurtii"), ["shinkurt"]);
inv("tomato", "RAW_INGREDIENTS", "PRODUCE", "kg", 38, L("Tomato", "ቲማቲም", "Timaatimii"), ["timatim"]);
inv("garlic", "RAW_INGREDIENTS", "PRODUCE", "kg", 160, L("Garlic", "ነጭ ሽንኩርት", "Qullubbii Adii"), ["nech shinkurt"]);
inv("ginger", "RAW_INGREDIENTS", "PRODUCE", "kg", 140, L("Ginger", "ዝንጅብል", "Jinjibila"), ["zinjibil"]);
inv("green-pepper", "RAW_INGREDIENTS", "PRODUCE", "kg", 70, L("Green Pepper", "ቃሪያ", "Barbaree Magariisaa"), ["karia", "chili"]);
inv("potato", "RAW_INGREDIENTS", "PRODUCE", "kg", 30, L("Potato", "ድንች", "Dinnicha"), ["dinch"]);
inv("cabbage", "RAW_INGREDIENTS", "PRODUCE", "pcs", 25, L("Cabbage", "ጥቅል ጎመን", "Raafuu Marame"), ["tikil gomen"]);
inv("collard", "RAW_INGREDIENTS", "PRODUCE", "kg", 35, L("Collard Greens", "ጎመን", "Raafuu"), ["gomen"]);
inv("beef", "RAW_INGREDIENTS", "PROTEINS", "kg", 650, L("Beef", "የበሬ ሥጋ", "Foon Loonii"), ["siga", "kitfo"]);
inv("lamb", "RAW_INGREDIENTS", "PROTEINS", "kg", 720, L("Lamb", "የበግ ሥጋ", "Foon Hoolaa"), ["beg"]);
inv("chicken", "RAW_INGREDIENTS", "PROTEINS", "pcs", 550, L("Chicken", "ዶሮ", "Lukkuu"), ["doro"]);
inv("fish", "RAW_INGREDIENTS", "PROTEINS", "kg", 480, L("Fish (tilapia)", "አሳ", "Qurxummii"), ["asa"]);
inv("eggs", "RAW_INGREDIENTS", "DAIRY", "pcs", 12, L("Eggs", "እንቁላል", "Hanqaaquu"), ["enkulal"]);
inv("kibbeh", "RAW_INGREDIENTS", "DAIRY", "kg", 900, L("Niter Kibbeh (spiced butter)", "ንጥር ቅቤ", "Dhadhaa Qulqulluu"), ["kibe", "butter"]);
inv("ayib", "RAW_INGREDIENTS", "DAIRY", "kg", 220, L("Ayib (cottage cheese)", "አይብ", "Baaduu"), ["cheese"]);
inv("milk", "RAW_INGREDIENTS", "DAIRY", "liters", 60, L("Milk", "ወተት", "Aannan"), ["wetet"]);
inv("teff", "RAW_INGREDIENTS", "DRY_GOODS", "kg", 145, L("Teff Flour", "የጤፍ ዱቄት", "Daakuu Xaafii"), ["tef"]);
inv("injera", "RAW_INGREDIENTS", "DRY_GOODS", "pcs", 15, L("Injera", "እንጀራ", "Buddeena"), ["enjera"]);
inv("wheat-flour", "RAW_INGREDIENTS", "DRY_GOODS", "kg", 95, L("Wheat Flour", "የስንዴ ዱቄት", "Daakuu Qamadii"), ["duket"]);
inv("lentils", "RAW_INGREDIENTS", "DRY_GOODS", "kg", 130, L("Red Lentils", "ምስር", "Missira"), ["misir"]);
inv("shiro", "RAW_INGREDIENTS", "DRY_GOODS", "kg", 180, L("Shiro Powder", "ሽሮ", "Shiroo"));
inv("rice", "RAW_INGREDIENTS", "DRY_GOODS", "kg", 110, L("Rice", "ሩዝ", "Ruuzii"));
inv("oil", "RAW_INGREDIENTS", "OILS", "liters", 210, L("Cooking Oil", "የምግብ ዘይት", "Zayita Nyaataa"), ["zeyt"]);
inv("olive-oil", "RAW_INGREDIENTS", "OILS", "liters", 650, L("Olive Oil", "የወይራ ዘይት", "Zayita Ejersaa"));
inv("berbere", "RAW_INGREDIENTS", "SPICES", "kg", 480, L("Berbere", "በርበሬ", "Barbaree"));
inv("mitmita", "RAW_INGREDIENTS", "SPICES", "kg", 600, L("Mitmita", "ሚጥሚጣ", "Mixmixaa"));
inv("salt", "RAW_INGREDIENTS", "SPICES", "kg", 25, L("Salt", "ጨው", "Soogidda"), ["chew"]);
inv("korerima", "RAW_INGREDIENTS", "SPECIALTY", "kg", 900, L("Korerima (Ethiopian cardamom)", "ኮረሪማ", "Korarimaa"));
// Beverage & bar
inv("beer", "BEVERAGE_BAR", "ALCOHOL", "crates", 1150, L("Beer", "ቢራ", "Biiraa"), ["bira"]);
inv("tej", "BEVERAGE_BAR", "ALCOHOL", "liters", 180, L("Tej (honey wine)", "ጠጅ", "Daadhii"));
inv("wine", "BEVERAGE_BAR", "ALCOHOL", "bottles", 420, L("Wine", "ወይን ጠጅ", "Wayinii"));
inv("soft-drinks", "BEVERAGE_BAR", "SOFT", "crates", 700, L("Soft Drinks", "ለስላሳ መጠጦች", "Dhugaatii Laafaa"), ["cola", "sprite", "fanta", "ambo"]);
inv("water", "BEVERAGE_BAR", "SOFT", "boxes", 240, L("Bottled Water", "የታሸገ ውሃ", "Bishaan Qabame"), ["wuha"]);
inv("coffee", "BEVERAGE_BAR", "COFFEE_TEA", "kg", 520, L("Coffee Beans", "የቡና ፍሬ", "Firii Bunaa"), ["buna"]);
inv("tea", "BEVERAGE_BAR", "COFFEE_TEA", "kg", 380, L("Tea Leaves", "የሻይ ቅጠል", "Baala Shaayii"), ["shai"]);
inv("syrup", "BEVERAGE_BAR", "MIXERS", "liters", 300, L("Syrups & Mixers", "ሽሮፕ እና ማደባለቂያ", "Siiroppii fi Makkaa"));
inv("ice", "BEVERAGE_BAR", "MIXERS", "bags", 80, L("Ice", "በረዶ", "Cabbii"));
// Packaging & takeout
inv("takeout-box", "PACKAGING_DISPOSABLES", "TAKEOUT", "packs", 350, L("Takeout Boxes", "የምግብ መውሰጃ ሳጥኖች", "Saanduqa Nyaata Fudhatamu"));
inv("foil-sheets", "PACKAGING_DISPOSABLES", "WRAPS", "packs", 220, L("Foil Sheets", "የፎይል ወረቀቶች", "Waraqaa Fooyilii"));
inv("parchment", "PACKAGING_DISPOSABLES", "WRAPS", "rolls", 180, L("Parchment Paper", "የመጋገሪያ ወረቀት", "Waraqaa Tolchaa"));
inv("wrappers", "PACKAGING_DISPOSABLES", "WRAPS", "packs", 150, L("Sandwich Wrappers", "የሳንድዊች መጠቅለያ", "Maraa Saandiwichii"));
inv("bags", "PACKAGING_DISPOSABLES", "TAKEOUT", "packs", 150, L("Carry Bags", "መያዣ ፌስታሎች", "Korojoo Baattuu"), ["festal"]);
inv("cups-lids", "PACKAGING_DISPOSABLES", "SERVICEWARE", "packs", 420, L("Paper Cups & Lids", "የወረቀት ኩባያ እና ክዳን", "Kubbaayyaa Waraqaa fi Qadaada"));
inv("straws", "PACKAGING_DISPOSABLES", "SERVICEWARE", "packs", 90, L("Straws", "መምጠጫዎች", "Ujummoo Dhugaatii"));
inv("napkins", "PACKAGING_DISPOSABLES", "SERVICEWARE", "packs", 180, L("Napkins", "የእጅ መጥረጊያ ወረቀት", "Waraqaa Harkaa"), ["soft"]);
inv("cutlery", "PACKAGING_DISPOSABLES", "SERVICEWARE", "packs", 160, L("Disposable Cutlery", "የሚጣሉ ማንኪያ እና ሹካ", "Fal'aana Gatamu"));
// Kitchen consumables
inv("plastic-wrap", "KITCHEN_CONSUMABLES", "WRAPS", "rolls", 260, L("Plastic Wrap", "የፕላስቲክ መጠቅለያ", "Maraa Pilaastikii"));
inv("foil-roll", "KITCHEN_CONSUMABLES", "WRAPS", "rolls", 340, L("Aluminum Foil Roll", "አሉሚኒየም ፎይል", "Fooyilii Aluminiyeemii"));
inv("food-sanitizer", "KITCHEN_CONSUMABLES", "FOOD_CONTACT", "liters", 280, L("Food-contact Sanitizer", "ለምግብ ንክኪ ጸረ-ተህዋስ", "Qulqulleessaa Nyaata Tuqu"));
inv("food-lube", "KITCHEN_CONSUMABLES", "FOOD_CONTACT", "pcs", 450, L("Food-grade Lubricant", "ለምግብ የሚሆን ቅባት", "Cooma Nyaataaf Mijatu"));
// Cleaning & sanitation
inv("detergent", "CLEANING_SANITATION", "DETERGENTS", "kg", 160, L("Laundry Detergent", "የልብስ ሳሙና", "Saamunaa Uffataa"), ["omo"]);
inv("degreaser", "CLEANING_SANITATION", "DETERGENTS", "liters", 220, L("Floor Degreaser", "የወለል ቅባት ማስለቀቂያ", "Qulqulleessaa Cooma Lafaa"));
inv("surface-sanitizer", "CLEANING_SANITATION", "DETERGENTS", "liters", 190, L("Surface Sanitizer", "የወለል ጸረ-ተህዋስ", "Qulqulleessaa Gubbaa"), ["bleach", "berekina"]);
inv("dish-soap", "CLEANING_SANITATION", "DETERGENTS", "liters", 120, L("Dishwashing Liquid", "የሳህን ማጠቢያ ሳሙና", "Saamunaa Miciirraa Saahinii"), ["samuna"]);
inv("mops", "CLEANING_SANITATION", "TOOLS", "pcs", 250, L("Mops & Brooms", "መወልወያ እና መጥረጊያ", "Mooppii fi Haxaa'aa"));
inv("trash-liners", "CLEANING_SANITATION", "TOOLS", "rolls", 90, L("Trash Liners", "የቆሻሻ ከረጢቶች", "Korojoo Kosii"));
inv("paper-towels", "CLEANING_SANITATION", "TOOLS", "rolls", 70, L("Paper Towels", "የወረቀት ፎጣ", "Fooxaa Waraqaa"));

export const BASE_INVENTORY: readonly InventoryItem[] = inventory;

/* ---------- menu (what is SOLD — never mixed with stock) ---------- */

export const MENU_CATEGORIES = reg<MenuCategory>("menucat", {
  MAINS: L("Mains", "ዋና ምግቦች", "Nyaata ijoo"),
  FASTING: L("Fasting dishes", "የጾም ምግቦች", "Nyaata soomaa"),
  BREAKFAST: L("Breakfast", "ቁርስ", "Ciree"),
  HOT_DRINKS: L("Hot drinks", "ትኩስ መጠጦች", "Dhugaatii ho'aa"),
  COLD_DRINKS: L("Cold drinks", "ቀዝቃዛ መጠጦች", "Dhugaatii qabbanaa'aa"),
  BAR: L("Bar", "ባር", "Baarii"),
});
export const MENU_CAT_IDS = Object.keys(MENU_CATEGORIES) as MenuCategory[];

const menu: MenuItem[] = [];
function dish(id: string, category: MenuCategory, price: number, name: LocalizedText): void {
  const nameKey = `menu.${id}`;
  registerText(nameKey, name);
  menu.push({ id, nameKey, category, price });
}
dish("kitfo", "MAINS", 650, L("Kitfo Special", "ልዩ ክትፎ", "Kitfoo Addaa"));
dish("doro-wat", "MAINS", 580, L("Doro Wat", "ዶሮ ወጥ", "Ittoo Lukkuu"));
dish("beef-tibs", "MAINS", 520, L("Beef Tibs", "የበሬ ጥብስ", "Tibsii Foon Loonii"));
dish("lamb-tibs", "MAINS", 600, L("Lamb Tibs", "የበግ ጥብስ", "Tibsii Foon Hoolaa"));
dish("fish-goulash", "MAINS", 480, L("Fish Goulash", "የአሳ ጉላሽ", "Gulaashii Qurxummii"));
dish("beyaynetu", "FASTING", 320, L("Beyaynetu (fasting platter)", "በያይነቱ", "Bayyaynatuu"));
dish("shiro", "FASTING", 220, L("Shiro Wat", "ሽሮ ወጥ", "Ittoo Shiroo"));
dish("misir", "FASTING", 240, L("Misir Wat (lentils)", "ምስር ወጥ", "Ittoo Missiraa"));
dish("firfir", "BREAKFAST", 260, L("Firfir", "ፍርፍር", "Firfir"));
dish("chechebsa", "BREAKFAST", 240, L("Chechebsa", "ጨጨብሳ", "Caccabsaa"));
dish("egg-firfir", "BREAKFAST", 210, L("Egg Firfir", "የእንቁላል ፍርፍር", "Firfir Hanqaaquu"));
dish("buna", "HOT_DRINKS", 60, L("Traditional Coffee", "ባህላዊ ቡና", "Buna Aadaa"));
dish("macchiato", "HOT_DRINKS", 70, L("Macchiato", "ማኪያቶ", "Makiyaatoo"));
dish("spiced-tea", "HOT_DRINKS", 50, L("Spiced Tea", "የቅመም ሻይ", "Shaayii Mi'aawaa"));
dish("soft-drink", "COLD_DRINKS", 60, L("Soft Drink", "ለስላሳ መጠጥ", "Dhugaatii Laafaa"));
dish("water", "COLD_DRINKS", 40, L("Bottled Water", "የታሸገ ውሃ", "Bishaan Qabame"));
dish("juice", "COLD_DRINKS", 120, L("Fresh Juice", "ትኩስ ጭማቂ", "Cuunfaa Haaraa"));
dish("beer", "BAR", 110, L("Beer", "ቢራ", "Biiraa"));
dish("tej", "BAR", 150, L("Tej (glass)", "ጠጅ (ብርጭቆ)", "Daadhii (burcuqqoo)"));
export const MENU: readonly MenuItem[] = menu;

/* ---------- dispatch destinations ---------- */

export const DESTINATIONS = reg<Destination>("dest", {
  BAR: L("Bar counter", "ባር ቆጣሪ", "Gabatee baarii"),
  KITCHEN_LINE: L("Kitchen line", "የወጥ ቤት መስመር", "Sarara kushinaa"),
  TAKEAWAY_COUNTER: L("Takeaway counter", "የመውሰጃ ቆጣሪ", "Gabatee fudhatamu"),
  CATERING: L("Catering order · Bole office", "የካተሪንግ ትዕዛዝ · ቦሌ ቢሮ", "Ajaja keetarinii · Waajjira Boolee"),
  BRANCH_PIASSA: L("Piassa branch", "ፒያሳ ቅርንጫፍ", "Damee Piyaassaa"),
  EVENT_HALL: L("Event hall", "የዝግጅት አዳራሽ", "Galma sagantaa"),
});

/** Reasons offered when rejecting a dispatch (free text is also allowed). */
export const REJECT_REASONS: readonly string[] = [
  "Not enough stock",
  "Quantity too high for this destination",
  "Duplicate request",
  "Not approved for this branch",
];

/* ---------- waste reasons ---------- */

export const WASTE_REASONS = reg<WasteReason>("waste", {
  PREP_WASTE: L("Prep waste", "የዝግጅት ብክነት", "Badiinsa qophii"),
  TRIM_LOSS: L("Trim loss (peeling / cutting)", "የመላጥ እና የመቁረጥ ብክነት", "Badiinsa haaduu fi muruu"),
  OVER_PORTIONING: L("Over-portioning", "ከመጠን በላይ ማቅረብ", "Hanga ol dhiyeessuu"),
  DROPPED_ITEMS: L("Dropped items", "የወደቁ ዕቃዎች", "Meeshaalee kufan"),
  SPOILAGE: L("Spoilage", "መበላሸት", "Badiinsa"),
  EXPIRED_STOCK: L("Expired stock", "ጊዜው ያለፈበት ዕቃ", "Meeshaa yeroon isaa darbe"),
  INVENTORY_THEFT: L("Inventory theft", "የዕቃ ስርቆት", "Hatuu kuusaa"),
  OTHER: L("Custom / other", "ሌላ", "Kan biraa"),
});
export const WASTE_IDS = Object.keys(WASTE_REASONS) as WasteReason[];
export const WASTE_COLOR: Record<WasteReason, string> = {
  PREP_WASTE: "#9fb4ff", TRIM_LOSS: "#8fd3f4", OVER_PORTIONING: "#c9a0f2", DROPPED_ITEMS: "#f2c48d",
  SPOILAGE: "#5bd18b", EXPIRED_STOCK: "#f2e3a0", INVENTORY_THEFT: "#f0857a", OTHER: "#a4acc4",
};
/** reasons that need a written explanation */
export const NOTE_REQUIRED: ReadonlySet<WasteReason> = new Set<WasteReason>(["INVENTORY_THEFT", "OTHER"]);

/* ---------- roles & staff directory ---------- */

export const ROLES = reg<UserRole>("role", {
  BRANCH_MANAGER: L("Branch Manager", "የቅርንጫፍ ሥራ አስኪያጅ", "Hoji Gaggeessaa Damee"),
  SALES_STAFF: L("Sales Staff", "የሽያጭ ሰራተኛ", "Hojjetaa Gurgurtaa"),
  INVENTORY_CLERK: L("Inventory Clerk", "የክምችት ባለሙያ", "Ogeessa Kuusaa"),
  ADMIN: L("Admin", "አስተዳዳሪ", "Bulchaa"),
});

export const BRANCH = { id: "BR-BOLE-01", name: L("Bole Branch", "ቦሌ ቅርንጫፍ", "Damee Boolee") };
registerText("branch.name", BRANCH.name);

/** Staff IDs are what the audit trail prints. */
export const STAFF: readonly StaffAccount[] = [
  { userId: "BM-001", name: "Hanna Tesfaye", role: "BRANCH_MANAGER", branchId: BRANCH.id, initials: "HT" },
  { userId: "AD-001", name: "Abebe Kebede", role: "ADMIN", branchId: BRANCH.id, initials: "AK" },
  { userId: "IC-201", name: "Dawit Alemu", role: "INVENTORY_CLERK", branchId: BRANCH.id, initials: "DA" },
  { userId: "SS-104", name: "Meron Girma", role: "SALES_STAFF", branchId: BRANCH.id, initials: "MG" },
  { userId: "SS-117", name: "Chaltu Bekele", role: "SALES_STAFF", branchId: BRANCH.id, initials: "CB" },
  { userId: "SS-122", name: "Yonas Tadesse", role: "SALES_STAFF", branchId: BRANCH.id, initials: "YT" },
];
/** Only these roles can open this dashboard and approve or reject. */
export const DASHBOARD_ROLES: readonly UserRole[] = ["BRANCH_MANAGER", "ADMIN"];
export const staffById = (id: string): StaffAccount | undefined => STAFF.find((s) => s.userId === id);

export const VIEW_ORDER: readonly ViewId[] = ["overview", "sales", "dispatch", "cogs", "waste", "expenses", "audit"];

/* ---------- payment methods & shifts ---------- */

export const PAYMENT_METHODS = reg<PaymentMethod>("pay", {
  CASH: L("Cash", "ጥሬ ገንዘብ", "Callaa"),
  TELEBIRR: L("Telebirr", "ቴሌብር", "Telebirr"),
  CBE_BIRR: L("CBE Birr", "ሲቢኢ ብር", "CBE Birr"),
});
export const PAY_IDS = Object.keys(PAYMENT_METHODS) as PaymentMethod[];
export const PAY_COLOR: Record<PaymentMethod, string> = {
  CASH: "#5bd18b", TELEBIRR: "#8fd3f4", CBE_BIRR: "#c9a0f2",
};

export const EXPENSE_SOURCES = reg<ExpenseSource>("src", {
  PETTY_CASH: L("Petty cash", "የጥቃቅን ወጪ ገንዘብ", "Maallaqa xixiqqaa"),
  CASH: L("Cash", "ጥሬ ገንዘብ", "Callaa"),
  TELEBIRR: L("Telebirr", "ቴሌብር", "Telebirr"),
  CBE_BIRR: L("CBE Birr", "ሲቢኢ ብር", "CBE Birr"),
});
export const SOURCE_IDS = Object.keys(EXPENSE_SOURCES) as ExpenseSource[];

export const SHIFTS = reg<Shift>("shift", {
  MORNING: L("Morning shift", "የጠዋት ፈረቃ", "Shiftii ganama"),
  EVENING: L("Evening shift", "የምሽት ፈረቃ", "Shiftii galgala"),
});
/** Morning shift runs until 15:00, evening after. */
export const shiftOf = (iso: string): Shift => (new Date(iso).getHours() < 15 ? "MORNING" : "EVENING");

/** Quick reasons for petty-cash runs (one tap fills the reason field). */
export const QUICK_EXPENSES: readonly string[] = [
  "Gas cylinder refill",
  "Generator fuel",
  "Taxi / ride for delivery",
  "Plumber call-out",
  "Emergency market run",
];

/* ---------- units ---------- */

export const UNITS = reg("unit", {
  kg: L("kg", "ኪ.ግ", "kg"),
  g: L("g", "ግራም", "giraamii"),
  liters: L("liters", "ሊትር", "litira"),
  pcs: L("pcs", "ፍሬ", "lakk."),
  boxes: L("boxes", "ሳጥን", "saanduqa"),
  packs: L("packs", "ፓኬት", "paakeejii"),
  crates: L("crates", "ክሬት", "kireetii"),
  bottles: L("bottles", "ጠርሙስ", "qaruuraa"),
  bags: L("bags", "ከረጢት", "korojoo"),
  rolls: L("rolls", "ጥቅል", "maraa"),
});

export const isCogs = (v: string): v is COGSCategory => v in COGS_CATEGORIES;
export const isWasteReason = (v: string): v is WasteReason => v in WASTE_REASONS;
export const isSource = (v: string): v is ExpenseSource => v in EXPENSE_SOURCES;
export const isMenuCat = (v: string): v is MenuCategory => v in MENU_CATEGORIES;
export const isPeriod = (v: string): v is "today" | "7d" | "30d" => v === "today" || v === "7d" || v === "30d";
