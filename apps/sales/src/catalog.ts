/* =========================================================
   Reference data: menu (what is sold), inventory catalog in the
   five COGS categories (what is bought), waste reasons, expense
   tags, roles, staff accounts and payment methods.
   Every display name is a LocalizedText registered for tk().
   ========================================================= */

import type {
  COGSCategory,
  DispatchPlace,
  ExpensePaymentMethod,
  ExpenseTag,
  InventoryItem,
  LocalizedText,
  MainCategory,
  Role,
  StaffAccount,
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
  RAW_INGREDIENTS: "#8fa58a",
  BEVERAGE_BAR: "#8c96a3",
  PACKAGING_DISPOSABLES: "#c8b48a",
  KITCHEN_CONSUMABLES: "#a395a8",
  CLEANING_SANITATION: "#7fa39b",
};

/* sub-groups inside each category */
reg("group", {
  CEREMONY: L("Coffee ceremony supplies", "የቡና ሥነ ሥርዓት ዕቃዎች", "Meeshaalee sirna bunaa"),
  CONDIMENTS: L("Pastes & condiments", "ድልህ እና ማጣፈጫ", "Mi'eessituu jiidhaa"),
  FRUITS: L("Fruits", "ፍራፍሬ", "Muduraa"),
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

/* ---------- main categories (first step of the purchase picker) ---------- */

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
  VEGETABLES: "#8fa58a",
  MEAT_FISH: "#c0694e",
  DAIRY_EGGS: "#d2c79a",
  GRAINS_FLOUR: "#b89b70",
  OIL: "#c8b48a",
  SPICES: "#c98a5e",
  DRINKS: "#8c96a3",
  COFFEE_TEA: "#8a6a52",
  PACKAGING: "#a395a8",
  KITCHEN: "#7f8aa0",
  CLEANING: "#7fa39b",
};

const GROUP_MAIN: Record<string, MainCategory> = {
  PRODUCE: "VEGETABLES", PROTEINS: "MEAT_FISH", DAIRY: "DAIRY_EGGS", DRY_GOODS: "GRAINS_FLOUR", OILS: "OIL",
  SPICES: "SPICES", SPECIALTY: "SPICES", ALCOHOL: "DRINKS", SOFT: "DRINKS", MIXERS: "DRINKS", COFFEE_TEA: "COFFEE_TEA",
  TAKEOUT: "PACKAGING", SERVICEWARE: "PACKAGING", FOOD_CONTACT: "KITCHEN", DETERGENTS: "CLEANING", TOOLS: "CLEANING",
  FRUITS: "VEGETABLES", CONDIMENTS: "SPICES", CEREMONY: "COFFEE_TEA",
};

const inventory: InventoryItem[] = [];
function inv(id: string, category: COGSCategory, group: string, unit: string, unitCost: number, name: LocalizedText, aliases: string[] = []): void {
  const nameKey = `inv.${id}`;
  registerText(nameKey, name);
  const main: MainCategory = group === "WRAPS" ? (category === "PACKAGING_DISPOSABLES" ? "PACKAGING" : "KITCHEN") : GROUP_MAIN[group];
  inventory.push({ id, nameKey, category, main, groupKey: `group.${group}`, unit, unitCost, aliases });
}

// Raw ingredients (generated from api/eirsha_api/catalogue.py by seed/build_catalogue.py; edit there)
// Grains, flours & legumes
inv("teff", "RAW_INGREDIENTS", "DRY_GOODS", "kg", 145, L("White teff", "ነጭ ጤፍ", "Xaafii adii"), ["tef", "nech teff"]);
inv("mixed-teff", "RAW_INGREDIENTS", "DRY_GOODS", "kg", 125, L("Mixed teff", "ሰርገኛ ጤፍ", "Mixed teff"), ["sergegna", "teff"]);
inv("injera", "RAW_INGREDIENTS", "DRY_GOODS", "pcs", 15, L("Pre-made fermented flatbread (injera)", "እንጀራ", "Buddeena"), ["enjera"]);
inv("roasted-chickpea", "RAW_INGREDIENTS", "DRY_GOODS", "kg", 160, L("Roasted chickpea", "የተቆላ ሽምብራ", "Roasted chickpea"), ["shimbra", "kolo"]);
inv("shiro", "RAW_INGREDIENTS", "DRY_GOODS", "kg", 180, L("Pea flour (shiro)", "ሽሮ", "Shiroo"), ["shiro"]);
inv("lentils", "RAW_INGREDIENTS", "DRY_GOODS", "kg", 130, L("Split red lentils", "ቀይ ምስር", "Missira diimaa"), ["misir"]);
inv("yellow-split-peas", "RAW_INGREDIENTS", "DRY_GOODS", "kg", 120, L("Yellow split peas", "ክክ", "Yellow split peas"), ["kik"]);
inv("brown-lentils", "RAW_INGREDIENTS", "DRY_GOODS", "kg", 125, L("Whole brown lentils", "ሙሉ ምስር", "Whole brown lentils"), ["misir"]);
inv("green-lentils", "RAW_INGREDIENTS", "DRY_GOODS", "kg", 135, L("Green lentils", "አረንጓዴ ምስር", "Green lentils"), ["misir"]);
inv("fava-beans", "RAW_INGREDIENTS", "DRY_GOODS", "kg", 110, L("Fava beans", "ባቄላ", "Baaqelaa"), ["bakela", "ful"]);
inv("wheat-flour", "RAW_INGREDIENTS", "DRY_GOODS", "kg", 95, L("Wheat flour", "የስንዴ ዱቄት", "Daakuu qamadii"), ["duket"]);
inv("spaghetti", "RAW_INGREDIENTS", "DRY_GOODS", "kg", 120, L("Spaghetti", "ስፓጌቲ", "Ispaageettii"), ["pasta"]);
inv("macaroni", "RAW_INGREDIENTS", "DRY_GOODS", "kg", 120, L("Macaroni", "መኮረኒ", "Makaroonii"), ["pasta", "makoroni"]);
inv("rice", "RAW_INGREDIENTS", "DRY_GOODS", "kg", 110, L("Rice", "ሩዝ", "Ruuzii"), ["ruz"]);
inv("roasted-barley", "RAW_INGREDIENTS", "DRY_GOODS", "kg", 140, L("Roasted barley", "የተቆላ ገብስ", "Roasted barley"), ["gebs", "kolo", "besso"]);
// Meats, poultry & fish
inv("beef", "RAW_INGREDIENTS", "PROTEINS", "kg", 650, L("Beef", "የበሬ ሥጋ", "Foon loonii"), ["siga", "kitfo"]);
inv("lamb", "RAW_INGREDIENTS", "PROTEINS", "kg", 720, L("Lamb", "የበግ ሥጋ", "Foon hoolaa"), ["beg"]);
inv("goat", "RAW_INGREDIENTS", "PROTEINS", "kg", 700, L("Goat", "የፍየል ሥጋ", "Foon re'ee"), ["fiyel"]);
inv("chicken", "RAW_INGREDIENTS", "PROTEINS", "pcs", 550, L("Chicken", "ዶሮ", "Lukkuu"), ["doro"]);
inv("eggs", "RAW_INGREDIENTS", "DAIRY", "pcs", 12, L("Eggs", "እንቁላል", "Hanqaaquu"), ["enkulal"]);
inv("fish", "RAW_INGREDIENTS", "PROTEINS", "kg", 480, L("Fish", "አሳ", "Qurxummii"), ["asa", "tilapia"]);
// Fresh vegetables & aromatics
inv("onion", "RAW_INGREDIENTS", "PRODUCE", "kg", 45, L("Onions", "ሽንኩርት", "Shunkurtii"), ["shinkurt"]);
inv("garlic", "RAW_INGREDIENTS", "PRODUCE", "kg", 160, L("Garlic", "ነጭ ሽንኩርት", "Qullubbii adii"), ["nech shinkurt"]);
inv("ginger", "RAW_INGREDIENTS", "PRODUCE", "kg", 140, L("Ginger", "ዝንጅብል", "Jinjibila"), ["zinjibil"]);
inv("tomato", "RAW_INGREDIENTS", "PRODUCE", "kg", 38, L("Tomatoes", "ቲማቲም", "Timaatimii"), ["timatim"]);
inv("potato", "RAW_INGREDIENTS", "PRODUCE", "kg", 30, L("Potatoes", "ድንች", "Dinnicha"), ["dinch"]);
inv("collard", "RAW_INGREDIENTS", "PRODUCE", "kg", 35, L("Collard greens", "ጎመን", "Raafuu"), ["gomen"]);
inv("cabbage", "RAW_INGREDIENTS", "PRODUCE", "pcs", 25, L("Cabbage", "ጥቅል ጎመን", "Raafuu marame"), ["tikil gomen"]);
inv("green-pepper", "RAW_INGREDIENTS", "PRODUCE", "kg", 70, L("Green chili peppers", "ቃሪያ", "Barbaree magariisaa"), ["karia", "chili"]);
inv("carrot", "RAW_INGREDIENTS", "PRODUCE", "kg", 40, L("Carrots", "ካሮት", "Kaarotii"), ["karot"]);
inv("beetroot", "RAW_INGREDIENTS", "PRODUCE", "kg", 40, L("Beetroot", "ቀይ ሥር", "Beetroot"), ["key sir", "beet"]);
inv("lettuce", "RAW_INGREDIENTS", "PRODUCE", "kg", 60, L("Lettuce", "ሰላጣ", "Lettuce"), ["selata", "salad"]);
inv("cucumber", "RAW_INGREDIENTS", "PRODUCE", "kg", 50, L("Cucumbers", "ኪያር", "Cucumbers"), ["kiyar"]);
// Fruits
inv("avocado", "RAW_INGREDIENTS", "FRUITS", "kg", 60, L("Avocados", "አቮካዶ", "Avokaadoo"), ["abukado"]);
inv("mango", "RAW_INGREDIENTS", "FRUITS", "kg", 70, L("Mangoes", "ማንጎ", "Maangoo"));
inv("papaya", "RAW_INGREDIENTS", "FRUITS", "kg", 50, L("Papayas", "ፓፓያ", "Paappaayaa"));
inv("banana", "RAW_INGREDIENTS", "FRUITS", "kg", 40, L("Bananas", "ሙዝ", "Muuzii"), ["muz"]);
inv("orange", "RAW_INGREDIENTS", "FRUITS", "kg", 60, L("Oranges", "ብርቱካን", "Burtukaana"), ["birtukan"]);
inv("lemon", "RAW_INGREDIENTS", "FRUITS", "kg", 80, L("Lemons", "ሎሚ", "Loomii"), ["lomi"]);
inv("strawberry", "RAW_INGREDIENTS", "FRUITS", "kg", 250, L("Strawberries", "እንጆሪ", "Strawberries"), ["enjori"]);
// Spices, herbs & condiments
inv("berbere", "RAW_INGREDIENTS", "SPICES", "kg", 480, L("Chili (berbere)", "በርበሬ", "Barbaree"), ["berbere", "chili"]);
inv("mitmita", "RAW_INGREDIENTS", "SPICES", "kg", 600, L("Chili powder (mitmita)", "ሚጥሚጣ", "Mixmixaa"), ["mitmita"]);
inv("korerima", "RAW_INGREDIENTS", "SPECIALTY", "kg", 900, L("Ethiopian cardamom", "ኮረሪማ", "Korarimaa"), ["korerima"]);
inv("turmeric", "RAW_INGREDIENTS", "SPICES", "kg", 300, L("Turmeric", "እርድ", "Ird"), ["ird"]);
inv("black-pepper", "RAW_INGREDIENTS", "SPICES", "kg", 700, L("Black pepper", "ጥቁር በርበሬ", "Black pepper"), ["kundo berbere"]);
inv("cumin", "RAW_INGREDIENTS", "SPICES", "kg", 500, L("Cumin", "ከሙን", "Cumin"), ["kemun"]);
inv("fenugreek", "RAW_INGREDIENTS", "SPICES", "kg", 250, L("Fenugreek", "አብሽ", "Abishii"), ["abish"]);
inv("sacred-basil", "RAW_INGREDIENTS", "SPICES", "kg", 400, L("Dried sacred basil", "በሶ ብላ", "Dried sacred basil"), ["besobila"]);
inv("rue", "RAW_INGREDIENTS", "SPICES", "kg", 350, L("Rue", "ጤና አዳም", "Calaatama"), ["tena adam"]);
inv("lippia", "RAW_INGREDIENTS", "SPICES", "kg", 350, L("Lippia leaves", "ኮሰረት", "Lippia leaves"), ["koseret"]);
inv("salt", "RAW_INGREDIENTS", "SPICES", "kg", 25, L("Salt", "ጨው", "Soogidda"), ["chew"]);
inv("sugar", "RAW_INGREDIENTS", "SPICES", "kg", 90, L("Sugar", "ስኳር", "Shukkaara"), ["sukar"]);
inv("awaze", "RAW_INGREDIENTS", "CONDIMENTS", "kg", 400, L("Spiced chili paste (awaze)", "አዋዜ", "Spiced chili paste (awaze)"), ["awaze"]);
inv("datta", "RAW_INGREDIENTS", "CONDIMENTS", "kg", 300, L("Green herb-chili paste (datta)", "ዳጣ", "Green herb-chili paste (datta)"), ["data", "senafich"]);
inv("ketchup", "RAW_INGREDIENTS", "CONDIMENTS", "kg", 200, L("Ketchup", "ኬቻፕ", "Kecaappii"));
inv("mayonnaise", "RAW_INGREDIENTS", "CONDIMENTS", "kg", 260, L("Mayonnaise", "ማዮኔዝ", "Maayooneezii"), ["mayo"]);
inv("mustard", "RAW_INGREDIENTS", "CONDIMENTS", "kg", 280, L("Mustard", "ሰናፍጭ", "Sanaaficha"), ["senafich"]);
inv("vinegar", "RAW_INGREDIENTS", "CONDIMENTS", "liters", 90, L("Vinegar", "ኮምጣጤ", "Vinegar"), ["komtatie"]);
// Dairy, oils & fats
inv("kibbeh", "RAW_INGREDIENTS", "DAIRY", "kg", 900, L("Butter (kibbeh)", "ቅቤ", "Dhadhaa"), ["kibe", "butter"]);
inv("mozzarella", "RAW_INGREDIENTS", "DAIRY", "kg", 700, L("Mozzarella", "ሞዛሬላ", "Mozaareelaa"), ["cheese"]);
inv("ayib", "RAW_INGREDIENTS", "DAIRY", "kg", 220, L("Cheese (ayib)", "አይብ", "Baaduu"), ["cheese", "ayib"]);
inv("milk", "RAW_INGREDIENTS", "DAIRY", "liters", 60, L("Fresh milk", "ትኩስ ወተት", "Aannan"), ["wetet"]);
inv("yogurt", "RAW_INGREDIENTS", "DAIRY", "liters", 90, L("Yogurt", "እርጎ", "Itittuu"), ["ergo"]);
inv("oil", "RAW_INGREDIENTS", "OILS", "liters", 210, L("Vegetable / sunflower cooking oil", "የምግብ ዘይት", "Zayita nyaataa"), ["zeyt", "sunflower"]);
inv("olive-oil", "RAW_INGREDIENTS", "OILS", "liters", 650, L("Olive oil", "የወይራ ዘይት", "Zayita ejersaa"));
// Beverages & coffee supplies
inv("coffee", "BEVERAGE_BAR", "COFFEE_TEA", "kg", 520, L("Raw green coffee beans", "ጥሬ ቡና", "Buna dheedhii"), ["buna"]);
inv("espresso-beans", "BEVERAGE_BAR", "COFFEE_TEA", "kg", 900, L("Roasted espresso beans", "የተቆላ የኤስፕሬሶ ቡና", "Roasted espresso beans"), ["espresso", "buna"]);
inv("tea", "BEVERAGE_BAR", "COFFEE_TEA", "kg", 380, L("Black tea leaves", "የሻይ ቅጠል", "Baala shaayii"), ["shai"]);
inv("cloves", "BEVERAGE_BAR", "COFFEE_TEA", "kg", 900, L("Cloves", "ቅርንፉድ", "Cloves"), ["kirinfud"]);
inv("cinnamon", "BEVERAGE_BAR", "COFFEE_TEA", "kg", 700, L("Cinnamon", "ቀረፋ", "Cinnamon"), ["kerefa"]);
inv("water", "BEVERAGE_BAR", "SOFT", "boxes", 240, L("Bottled still water", "የታሸገ ውሃ", "Bishaan qabame"), ["wuha"]);
inv("mineral-water", "BEVERAGE_BAR", "SOFT", "crates", 480, L("Mineral water", "የማዕድን ውሃ", "Mineral water"), ["sparkling"]);
inv("wine", "BEVERAGE_BAR", "ALCOHOL", "bottles", 420, L("Wine", "ወይን ጠጅ", "Wayinii"));
inv("frankincense", "BEVERAGE_BAR", "CEREMONY", "kg", 300, L("Frankincense", "ዕጣን", "Ixaana"), ["etan"]);
inv("charcoal", "BEVERAGE_BAR", "CEREMONY", "bags", 350, L("Charcoal", "ከሰል", "Cilee"), ["kesel"]);
// Soft drinks (one item each)
inv("sd-coca-cola", "BEVERAGE_BAR", "SOFT", "crates", 700, L("Coca-Cola", "Coca-Cola", "Coca-Cola"), ["soda", "lislasa"]);
inv("sd-sprite", "BEVERAGE_BAR", "SOFT", "crates", 700, L("Sprite", "Sprite", "Sprite"), ["soda", "lislasa"]);
inv("sd-fanta-orange", "BEVERAGE_BAR", "SOFT", "crates", 700, L("Fanta Orange", "Fanta Orange", "Fanta Orange"), ["soda", "lislasa"]);
inv("sd-fanta-pineapple", "BEVERAGE_BAR", "SOFT", "crates", 700, L("Fanta Pineapple", "Fanta Pineapple", "Fanta Pineapple"), ["soda", "lislasa"]);
inv("sd-pepsi", "BEVERAGE_BAR", "SOFT", "crates", 700, L("Pepsi", "Pepsi", "Pepsi"), ["soda", "lislasa"]);
inv("sd-7up", "BEVERAGE_BAR", "SOFT", "crates", 700, L("7UP", "7UP", "7UP"), ["soda", "lislasa"]);
inv("sd-mirinda", "BEVERAGE_BAR", "SOFT", "crates", 700, L("Mirinda", "Mirinda", "Mirinda"), ["soda", "lislasa"]);
inv("sd-ambo", "BEVERAGE_BAR", "SOFT", "crates", 700, L("Ambo", "Ambo", "Ambo"), ["soda", "lislasa"]);
inv("sd-sofi-malt", "BEVERAGE_BAR", "SOFT", "crates", 700, L("Sofi Malt", "Sofi Malt", "Sofi Malt"), ["soda", "lislasa"]);
inv("sd-negus", "BEVERAGE_BAR", "SOFT", "crates", 700, L("Negus", "Negus", "Negus"), ["soda", "lislasa"]);
inv("sd-malta-guinness", "BEVERAGE_BAR", "SOFT", "crates", 700, L("Malta Guinness", "Malta Guinness", "Malta Guinness"), ["soda", "lislasa"]);
// Beers (one item each)
inv("beer-st-george", "BEVERAGE_BAR", "ALCOHOL", "crates", 1150, L("St. George", "St. George", "St. George"), ["beer", "bira"]);
inv("beer-heineken", "BEVERAGE_BAR", "ALCOHOL", "crates", 1150, L("Heineken", "Heineken", "Heineken"), ["beer", "bira"]);
inv("beer-walia", "BEVERAGE_BAR", "ALCOHOL", "crates", 1150, L("Walia", "Walia", "Walia"), ["beer", "bira"]);
inv("beer-bedele-regular", "BEVERAGE_BAR", "ALCOHOL", "crates", 1150, L("Bedele Regular", "Bedele Regular", "Bedele Regular"), ["beer", "bira"]);
inv("beer-bedele-special", "BEVERAGE_BAR", "ALCOHOL", "crates", 1150, L("Bedele Special", "Bedele Special", "Bedele Special"), ["beer", "bira"]);
inv("beer-harar", "BEVERAGE_BAR", "ALCOHOL", "crates", 1150, L("Harar", "Harar", "Harar"), ["beer", "bira"]);
inv("beer-desperados", "BEVERAGE_BAR", "ALCOHOL", "crates", 1150, L("Desperados", "Desperados", "Desperados"), ["beer", "bira"]);
inv("beer-dashen", "BEVERAGE_BAR", "ALCOHOL", "crates", 1150, L("Dashen", "Dashen", "Dashen"), ["beer", "bira"]);
inv("beer-habesha", "BEVERAGE_BAR", "ALCOHOL", "crates", 1150, L("Habesha", "Habesha", "Habesha"), ["beer", "bira"]);
inv("beer-arada-lime", "BEVERAGE_BAR", "ALCOHOL", "crates", 1150, L("Arada Lime", "Arada Lime", "Arada Lime"), ["beer", "bira"]);
inv("beer-arada-pineapple", "BEVERAGE_BAR", "ALCOHOL", "crates", 1150, L("Arada Pineapple", "Arada Pineapple", "Arada Pineapple"), ["beer", "bira"]);
inv("beer-arada-apple", "BEVERAGE_BAR", "ALCOHOL", "crates", 1150, L("Arada Apple", "Arada Apple", "Arada Apple"), ["beer", "bira"]);
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

/* ---------- dispatch destinations (places inside a branch) ---------- */

export const DISPATCH_PLACES = reg<DispatchPlace>("dest", {
  KITCHEN_LINE: L("Kitchen line", "የወጥ ቤት መስመር", "Sarara kushinaa"),
  BAR: L("Bar counter", "ባር ቆጣሪ", "Gabatee baarii"),
  TAKEAWAY_COUNTER: L("Takeaway counter", "የመውሰጃ ቆጣሪ", "Gabatee fudhatamu"),
  CATERING: L("Catering", "ካተሪንግ", "Keetarinii"),
  EVENT_HALL: L("Event hall", "የዝግጅት አዳራሽ", "Galma sagantaa"),
});
export const PLACE_IDS = Object.keys(DISPATCH_PLACES) as DispatchPlace[];

/* ---------- waste reasons ---------- */

export const WASTE_REASONS = reg<WasteReason>("waste", {
  PREP_WASTE: L("Prep waste", "የዝግጅት ብክነት", "Badiinsa qophii"),
  TRIM_LOSS: L("Trim loss (peeling / cutting)", "የመላጥ እና የመቁረጥ ብክነት", "Badiinsa haaduu fi muruu"),
  OVER_PORTIONING: L("Over-portioning", "ከመጠን በላይ ማቅረብ", "Hanga ol dhiyeessuu"),
  DROPPED_ITEMS: L("Dropped items", "የወደቁ ዕቃዎች", "Meeshaalee kufan"),
  SPOILAGE: L("Spoilage", "መበላሸት", "Badiinsa"),
  EXPIRED_STOCK: L("Expired stock", "ጊዜው ያለፈበት ዕቃ", "Meeshaa yeroon isaa darbe"),
  INVENTORY_THEFT: L("Inventory theft", "የዕቃ ስርቆት", "Hatuu kuusaa"),
  OTHER: L("Other", "ሌላ", "Kan biraa"),
});
export const WASTE_IDS = Object.keys(WASTE_REASONS) as WasteReason[];
/** reasons that need a written explanation */
export const NOTE_REQUIRED: ReadonlySet<WasteReason> = new Set<WasteReason>(["INVENTORY_THEFT", "OTHER"]);

/* ---------- custom expense tags ---------- */

export const EXPENSE_TAGS = reg<ExpenseTag>("tag", {
  MAINTENANCE: L("Repairs & maintenance", "ጥገና", "Suphaa fi kunuunsa"),
  TRANSPORT: L("Transport & delivery", "ትራንስፖርት", "Geejjiba"),
  UTILITIES: L("Utilities", "መገልገያዎች", "Tajaajila bu'uuraa"),
  STAFF_WELFARE: L("Staff welfare", "የሰራተኛ ደህንነት", "Fayyaa fi gargaarsa hojjettootaa"),
  MARKETING: L("Marketing", "ግብይት", "Gabaa"),
  OFFICE_ADMIN: L("Office & admin", "ቢሮ እና አስተዳደር", "Waajjira fi bulchiinsa"),
  LICENSES_FEES: L("Licenses & fees", "ፈቃድ እና ክፍያዎች", "Hayyama fi kaffaltii"),
  OTHER: L("Other", "ሌላ", "Kan biraa"),
});
export const TAG_IDS = Object.keys(EXPENSE_TAGS) as ExpenseTag[];

/* ---------- roles, permissions, staff ---------- */

export const ROLES = reg<Role>("role", {
  SALES_STAFF: L("Cashier", "ገንዘብ ተቀባይ", "Kaffaltii fudhataa"),
  INVENTORY_CLERK: L("Inventory clerk", "የክምችት ባለሙያ", "Ogeessa kuusaa"),
  MANAGER: L("Manager", "ሥራ አስኪያጅ", "Hoji gaggeessaa"),
  ADMIN: L("System Admin", "የሲስተም አስተዳዳሪ", "Bulchaa sirnaa"),
});

/** Which roles may open each screen. This app is for buying only; sales are not tracked here. */
export const VIEW_ACCESS: Record<ViewId, readonly Role[]> = {
  dashboard: ["INVENTORY_CLERK", "MANAGER", "ADMIN"],
  purchases: ["INVENTORY_CLERK", "MANAGER", "ADMIN"],
  dispatch: ["INVENTORY_CLERK", "MANAGER", "ADMIN"],
  waste: ["INVENTORY_CLERK", "MANAGER", "ADMIN"],
  expenses: ["INVENTORY_CLERK", "MANAGER", "ADMIN"],
  audit: ["MANAGER", "ADMIN"],
  help: ["SALES_STAFF", "INVENTORY_CLERK", "MANAGER", "ADMIN"],
};
export const CAN_APPROVE_WASTE: readonly Role[] = ["MANAGER", "ADMIN"];
/** Deleting a saved record needs a manager; staff can only undo right after saving. */
export const CAN_DELETE: readonly Role[] = ["MANAGER", "ADMIN"];

export const STAFF: readonly StaffAccount[] = [
  { userId: "u-abebe", name: "Abebe Kebede", role: "ADMIN", initials: "AK", pin: "1111" },
  { userId: "u-hanna", name: "Hanna Tesfaye", role: "MANAGER", initials: "HT", pin: "2222" },
  { userId: "u-dawit", name: "Dawit Alemu", role: "INVENTORY_CLERK", initials: "DA", pin: "3333" },
];

/* ---------- payment methods ---------- */

export const PAYMENT_METHODS = reg<ExpensePaymentMethod>("pay", {
  CASH: L("Cash", "ጥሬ ገንዘብ", "Callaa"),
  TELEBIRR: L("Telebirr", "ቴሌብር", "Telebirr"),
  CBE_BIRR: L("CBE", "ሲቢኢ", "CBE"),
});
/** Purchases and expenses are paid by Cash, Telebirr or CBE only. */
export const EXPENSE_METHODS: readonly ExpensePaymentMethod[] = ["CASH", "TELEBIRR", "CBE_BIRR"];

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
  portions: L("portions", "ሳህን", "qooda"),
});
export const UNIT_CODES = Object.keys(UNITS);

export const isMain = (v: string): v is MainCategory => v in MAIN_CATEGORIES;
export const isCogs = (v: string): v is COGSCategory => v in COGS_CATEGORIES;
export const isWasteReason = (v: string): v is WasteReason => v in WASTE_REASONS;
export const isTag = (v: string): v is ExpenseTag => v in EXPENSE_TAGS;
export const isExpenseMethod = (v: string): v is ExpensePaymentMethod => (EXPENSE_METHODS as readonly string[]).includes(v);
