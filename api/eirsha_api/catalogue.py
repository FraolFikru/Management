"""The stock item list the Purchases team buys from (food, drinks, coffee-ceremony supplies).

One source of truth for three places:
  * migrate.ingredient_catalogue()  puts it in the database (items, names, aliases, starter minimums)
  * seed/build_catalogue.py         writes the same list into apps/sales and apps/manager catalog.ts
  * migrate.starter_recipes()       uses STARTER_RECIPES for the kitchen's "Ingredients used" step

Items that keep an existing id keep their stock, purchases and history; only the name changes.
Packaging, kitchen supplies and cleaning items are not ingredients and are left as they are.

Each row: id, COGS category, group, unit, standard unit cost (ETB), English, Amharic, Oromo (None =
English until a native speaker adds it), aliases (what people type when searching), starter minimum.
"""
from __future__ import annotations

RAW, BAR = "RAW_INGREDIENTS", "BEVERAGE_BAR"

#      id                    cat  group         unit       cost   en                                         am                       om                         aliases                         min
ITEMS: list[tuple] = [
    # ---- Grains, flours & legumes
    ("teff",               RAW, "DRY_GOODS",  "kg",      145, "White teff",                             "ነጭ ጤፍ",                "Xaafii adii",             ["tef", "nech teff"],           5),
    ("mixed-teff",         RAW, "DRY_GOODS",  "kg",      125, "Mixed teff",                             "ሰርገኛ ጤፍ",              None,                      ["sergegna", "teff"],           5),
    ("injera",             RAW, "DRY_GOODS",  "pcs",      15, "Pre-made fermented flatbread (injera)",  "እንጀራ",                 "Buddeena",                ["enjera"],                     20),
    ("roasted-chickpea",   RAW, "DRY_GOODS",  "kg",      160, "Roasted chickpea",                       "የተቆላ ሽምብራ",           None,                      ["shimbra", "kolo"],            2),
    ("shiro",              RAW, "DRY_GOODS",  "kg",      180, "Pea flour (shiro)",                      "ሽሮ",                   "Shiroo",                  ["shiro"],                      3),
    ("lentils",            RAW, "DRY_GOODS",  "kg",      130, "Split red lentils",                      "ቀይ ምስር",               "Missira diimaa",          ["misir"],                      3),
    ("yellow-split-peas",  RAW, "DRY_GOODS",  "kg",      120, "Yellow split peas",                      "ክክ",                   None,                      ["kik"],                        3),
    ("brown-lentils",      RAW, "DRY_GOODS",  "kg",      125, "Whole brown lentils",                    "ሙሉ ምስር",               None,                      ["misir"],                      2),
    ("green-lentils",      RAW, "DRY_GOODS",  "kg",      135, "Green lentils",                          "አረንጓዴ ምስር",            None,                      ["misir"],                      2),
    ("fava-beans",         RAW, "DRY_GOODS",  "kg",      110, "Fava beans",                             "ባቄላ",                  "Baaqelaa",                ["bakela", "ful"],              2),
    ("wheat-flour",        RAW, "DRY_GOODS",  "kg",       95, "Wheat flour",                            "የስንዴ ዱቄት",             "Daakuu qamadii",          ["duket"],                      5),
    ("spaghetti",          RAW, "DRY_GOODS",  "kg",      120, "Spaghetti",                              "ስፓጌቲ",                 "Ispaageettii",            ["pasta"],                      2),
    ("macaroni",           RAW, "DRY_GOODS",  "kg",      120, "Macaroni",                               "መኮረኒ",                 "Makaroonii",              ["pasta", "makoroni"],          2),
    ("rice",               RAW, "DRY_GOODS",  "kg",      110, "Rice",                                   "ሩዝ",                   "Ruuzii",                  ["ruz"],                        3),
    ("roasted-barley",     RAW, "DRY_GOODS",  "kg",      140, "Roasted barley",                         "የተቆላ ገብስ",             None,                      ["gebs", "kolo", "besso"],      1),
    # ---- Meats, poultry & fish
    ("beef",               RAW, "PROTEINS",   "kg",      650, "Beef",                                   "የበሬ ሥጋ",               "Foon loonii",             ["siga", "kitfo"],              3),
    ("lamb",               RAW, "PROTEINS",   "kg",      720, "Lamb",                                   "የበግ ሥጋ",               "Foon hoolaa",             ["beg"],                        2),
    ("goat",               RAW, "PROTEINS",   "kg",      700, "Goat",                                   "የፍየል ሥጋ",              "Foon re'ee",              ["fiyel"],                      2),
    ("chicken",            RAW, "PROTEINS",   "pcs",     550, "Chicken",                                "ዶሮ",                   "Lukkuu",                  ["doro"],                       2),
    ("eggs",               RAW, "DAIRY",      "pcs",      12, "Eggs",                                   "እንቁላል",                "Hanqaaquu",               ["enkulal"],                    30),
    ("fish",               RAW, "PROTEINS",   "kg",      480, "Fish",                                   "አሳ",                   "Qurxummii",               ["asa", "tilapia"],             2),
    # ---- Fresh vegetables & aromatics
    ("onion",              RAW, "PRODUCE",    "kg",       45, "Onions",                                 "ሽንኩርት",               "Shunkurtii",              ["shinkurt"],                   10),
    ("garlic",             RAW, "PRODUCE",    "kg",      160, "Garlic",                                 "ነጭ ሽንኩርት",             "Qullubbii adii",          ["nech shinkurt"],              2),
    ("ginger",             RAW, "PRODUCE",    "kg",      140, "Ginger",                                 "ዝንጅብል",                "Jinjibila",               ["zinjibil"],                   2),
    ("tomato",             RAW, "PRODUCE",    "kg",       38, "Tomatoes",                               "ቲማቲም",                 "Timaatimii",              ["timatim"],                    10),
    ("potato",             RAW, "PRODUCE",    "kg",       30, "Potatoes",                               "ድንች",                  "Dinnicha",                ["dinch"],                      10),
    ("collard",            RAW, "PRODUCE",    "kg",       35, "Collard greens",                         "ጎመን",                  "Raafuu",                  ["gomen"],                      5),
    ("cabbage",            RAW, "PRODUCE",    "pcs",      25, "Cabbage",                                "ጥቅል ጎመን",              "Raafuu marame",           ["tikil gomen"],                10),
    ("green-pepper",       RAW, "PRODUCE",    "kg",       70, "Green chili peppers",                    "ቃሪያ",                  "Barbaree magariisaa",     ["karia", "chili"],             3),
    ("carrot",             RAW, "PRODUCE",    "kg",       40, "Carrots",                                "ካሮት",                  "Kaarotii",                ["karot"],                      5),
    ("beetroot",           RAW, "PRODUCE",    "kg",       40, "Beetroot",                               "ቀይ ሥር",                None,                      ["key sir", "beet"],            3),
    ("lettuce",            RAW, "PRODUCE",    "kg",       60, "Lettuce",                                "ሰላጣ",                  None,                      ["selata", "salad"],            2),
    ("cucumber",           RAW, "PRODUCE",    "kg",       50, "Cucumbers",                              "ኪያር",                  None,                      ["kiyar"],                      2),
    # ---- Fruits
    ("avocado",            RAW, "FRUITS",     "kg",       60, "Avocados",                               "አቮካዶ",                 "Avokaadoo",               ["abukado"],                    3),
    ("mango",              RAW, "FRUITS",     "kg",       70, "Mangoes",                                "ማንጎ",                  "Maangoo",                 [],                             3),
    ("papaya",             RAW, "FRUITS",     "kg",       50, "Papayas",                                "ፓፓያ",                  "Paappaayaa",              [],                             3),
    ("banana",             RAW, "FRUITS",     "kg",       40, "Bananas",                                "ሙዝ",                   "Muuzii",                  ["muz"],                        3),
    ("orange",             RAW, "FRUITS",     "kg",       60, "Oranges",                                "ብርቱካን",               "Burtukaana",              ["birtukan"],                   3),
    ("lemon",              RAW, "FRUITS",     "kg",       80, "Lemons",                                 "ሎሚ",                   "Loomii",                  ["lomi"],                       1),
    ("strawberry",         RAW, "FRUITS",     "kg",      250, "Strawberries",                           "እንጆሪ",                 None,                      ["enjori"],                     1),
    # ---- Spices, herbs & condiments
    ("berbere",            RAW, "SPICES",     "kg",      480, "Chili (berbere)",                        "በርበሬ",                 "Barbaree",                ["berbere", "chili"],           2),
    ("mitmita",            RAW, "SPICES",     "kg",      600, "Chili powder (mitmita)",                 "ሚጥሚጣ",                 "Mixmixaa",                ["mitmita"],                    1),
    ("korerima",           RAW, "SPECIALTY",  "kg",      900, "Ethiopian cardamom",                     "ኮረሪማ",                 "Korarimaa",               ["korerima"],                   0.5),
    ("turmeric",           RAW, "SPICES",     "kg",      300, "Turmeric",                               "እርድ",                  "Ird",                     ["ird"],                        0.5),
    ("black-pepper",       RAW, "SPICES",     "kg",      700, "Black pepper",                           "ጥቁር በርበሬ",             None,                      ["kundo berbere"],              0.5),
    ("cumin",              RAW, "SPICES",     "kg",      500, "Cumin",                                  "ከሙን",                  None,                      ["kemun"],                      0.5),
    ("fenugreek",          RAW, "SPICES",     "kg",      250, "Fenugreek",                              "አብሽ",                  "Abishii",                 ["abish"],                      0.5),
    ("sacred-basil",       RAW, "SPICES",     "kg",      400, "Dried sacred basil",                     "በሶ ብላ",                None,                      ["besobila"],                   0.2),
    ("rue",                RAW, "SPICES",     "kg",      350, "Rue",                                    "ጤና አዳም",               "Calaatama",               ["tena adam"],                  0.2),
    ("lippia",             RAW, "SPICES",     "kg",      350, "Lippia leaves",                          "ኮሰረት",                 None,                      ["koseret"],                    0.2),
    ("salt",               RAW, "SPICES",     "kg",       25, "Salt",                                   "ጨው",                   "Soogidda",                ["chew"],                       2),
    ("sugar",              RAW, "SPICES",     "kg",       90, "Sugar",                                  "ስኳር",                  "Shukkaara",               ["sukar"],                      3),
    ("awaze",              RAW, "CONDIMENTS", "kg",      400, "Spiced chili paste (awaze)",             "አዋዜ",                  None,                      ["awaze"],                      1),
    ("datta",              RAW, "CONDIMENTS", "kg",      300, "Green herb-chili paste (datta)",         "ዳጣ",                   None,                      ["data", "senafich"],           0.5),
    ("ketchup",            RAW, "CONDIMENTS", "kg",      200, "Ketchup",                                "ኬቻፕ",                  "Kecaappii",               [],                             1),
    ("mayonnaise",         RAW, "CONDIMENTS", "kg",      260, "Mayonnaise",                             "ማዮኔዝ",                 "Maayooneezii",            ["mayo"],                       1),
    ("mustard",            RAW, "CONDIMENTS", "kg",      280, "Mustard",                                "ሰናፍጭ",                 "Sanaaficha",              ["senafich"],                   0.5),
    ("vinegar",            RAW, "CONDIMENTS", "liters",   90, "Vinegar",                                "ኮምጣጤ",                 None,                      ["komtatie"],                   1),
    # ---- Dairy, oils & fats
    ("kibbeh",             RAW, "DAIRY",      "kg",      900, "Butter (kibbeh)",                        "ቅቤ",                   "Dhadhaa",                 ["kibe", "butter"],             1),
    ("mozzarella",         RAW, "DAIRY",      "kg",      700, "Mozzarella",                             "ሞዛሬላ",                 "Mozaareelaa",             ["cheese"],                     1),
    ("ayib",               RAW, "DAIRY",      "kg",      220, "Cheese (ayib)",                          "አይብ",                  "Baaduu",                  ["cheese", "ayib"],             2),
    ("milk",               RAW, "DAIRY",      "liters",   60, "Fresh milk",                             "ትኩስ ወተት",              "Aannan",                  ["wetet"],                      5),
    ("yogurt",             RAW, "DAIRY",      "liters",   90, "Yogurt",                                 "እርጎ",                  "Itittuu",                 ["ergo"],                       2),
    ("oil",                RAW, "OILS",       "liters",  210, "Vegetable / sunflower cooking oil",      "የምግብ ዘይት",             "Zayita nyaataa",          ["zeyt", "sunflower"],          1),
    ("olive-oil",          RAW, "OILS",       "liters",  650, "Olive oil",                              "የወይራ ዘይት",             "Zayita ejersaa",          [],                             1),
    # ---- Beverages & coffee supplies
    ("coffee",             BAR, "COFFEE_TEA", "kg",      520, "Raw green coffee beans",                 "ጥሬ ቡና",                "Buna dheedhii",           ["buna"],                       2),
    ("espresso-beans",     BAR, "COFFEE_TEA", "kg",      900, "Roasted espresso beans",                 "የተቆላ የኤስፕሬሶ ቡና",       None,                      ["espresso", "buna"],           1),
    ("tea",                BAR, "COFFEE_TEA", "kg",      380, "Black tea leaves",                       "የሻይ ቅጠል",              "Baala shaayii",           ["shai"],                       1),
    ("cloves",             BAR, "COFFEE_TEA", "kg",      900, "Cloves",                                 "ቅርንፉድ",                None,                      ["kirinfud"],                   0.2),
    ("cinnamon",           BAR, "COFFEE_TEA", "kg",      700, "Cinnamon",                               "ቀረፋ",                  None,                      ["kerefa"],                     0.2),
    ("water",              BAR, "SOFT",       "boxes",   240, "Bottled still water",                    "የታሸገ ውሃ",              "Bishaan qabame",          ["wuha"],                       2),
    ("mineral-water",      BAR, "SOFT",       "crates",  480, "Mineral water",                          "የማዕድን ውሃ",             None,                      ["sparkling"],                  2),
    ("wine",               BAR, "ALCOHOL",    "bottles", 420, "Wine",                                   "ወይን ጠጅ",               "Wayinii",                 [],                             3),
    ("frankincense",       BAR, "CEREMONY",   "kg",      300, "Frankincense",                           "ዕጣን",                  "Ixaana",                  ["etan"],                       0.2),
    ("charcoal",           BAR, "CEREMONY",   "bags",    350, "Charcoal",                               "ከሰል",                  "Cilee",                   ["kesel"],                      2),
]

# Soft drinks and beers: one stock item each, bought by the crate.
SOFT_DRINKS = ["Coca-Cola", "Sprite", "Fanta Orange", "Fanta Pineapple", "Pepsi", "7UP", "Mirinda", "Ambo", "Sofi Malt",
               "Negus", "Malta Guinness"]
BEERS = ["St. George", "Heineken", "Walia", "Bedele Regular", "Bedele Special", "Harar", "Desperados", "Dashen", "Habesha",
         "Arada Lime", "Arada Pineapple", "Arada Apple"]


def _slug(name: str) -> str:
    out = "".join(c.lower() if c.isalnum() else "-" for c in name)
    while "--" in out:
        out = out.replace("--", "-")
    return out.strip("-")


for _n in SOFT_DRINKS:
    ITEMS.append((f"sd-{_slug(_n)}", BAR, "SOFT", "crates", 700, _n, _n, _n, ["soda", "lislasa"], 1))
for _n in BEERS:
    ITEMS.append((f"beer-{_slug(_n)}", BAR, "ALCOHOL", "crates", 1150, _n, _n, _n, ["beer", "bira"], 1))

# Old food/drink items with no place in the new list: hidden from pickers (history and stock records stay).
RETIRED = ["beer", "tej", "soft-drinks", "syrup", "ice"]

# Group → main category (first step of the purchase picker). FRUITS, CONDIMENTS and CEREMONY are new groups.
GROUP_MAIN = {"PRODUCE": "VEGETABLES", "FRUITS": "VEGETABLES", "PROTEINS": "MEAT_FISH", "DAIRY": "DAIRY_EGGS",
              "DRY_GOODS": "GRAINS_FLOUR", "OILS": "OIL", "SPICES": "SPICES", "SPECIALTY": "SPICES", "CONDIMENTS": "SPICES",
              "ALCOHOL": "DRINKS", "SOFT": "DRINKS", "MIXERS": "DRINKS", "COFFEE_TEA": "COFFEE_TEA", "CEREMONY": "COFFEE_TEA"}
NEW_GROUPS = {"FRUITS": ("Fruits", "ፍራፍሬ", "Muduraa"),
              "CONDIMENTS": ("Pastes & condiments", "ድልህ እና ማጣፈጫ", "Mi'eessituu jiidhaa"),
              "CEREMONY": ("Coffee ceremony supplies", "የቡና ሥነ ሥርዓት ዕቃዎች", "Meeshaalee sirna bunaa")}

# Starter recipes (per portion, in the recipe's unit) for the demo menu. The kitchen confirms the real amounts each time;
# the owner or manager changes these with PUT /manager/recipes/{menu_item_id}.
STARTER_RECIPES: dict[str, list[tuple[str, float, str]]] = {
    "kitfo":        [("beef", 0.25, "kg"), ("kibbeh", 0.05, "kg"), ("mitmita", 0.005, "kg"), ("ayib", 0.05, "kg"), ("collard", 0.05, "kg"), ("injera", 1, "pcs")],
    "doro-wat":     [("chicken", 0.25, "pcs"), ("onion", 0.3, "kg"), ("berbere", 0.03, "kg"), ("kibbeh", 0.04, "kg"), ("eggs", 1, "pcs"),
                     ("garlic", 0.01, "kg"), ("ginger", 0.01, "kg"), ("injera", 2, "pcs")],
    "beef-tibs":    [("beef", 0.25, "kg"), ("onion", 0.05, "kg"), ("tomato", 0.05, "kg"), ("green-pepper", 0.02, "kg"), ("oil", 0.03, "liters"), ("injera", 1, "pcs")],
    "lamb-tibs":    [("lamb", 0.25, "kg"), ("onion", 0.05, "kg"), ("green-pepper", 0.02, "kg"), ("kibbeh", 0.02, "kg"), ("injera", 1, "pcs")],
    "special-tibs": [("beef", 0.3, "kg"), ("onion", 0.06, "kg"), ("tomato", 0.05, "kg"), ("green-pepper", 0.02, "kg"), ("kibbeh", 0.03, "kg"), ("injera", 1, "pcs")],
    "fish-goulash": [("fish", 0.3, "kg"), ("onion", 0.08, "kg"), ("tomato", 0.1, "kg"), ("garlic", 0.01, "kg"), ("berbere", 0.01, "kg"), ("oil", 0.03, "liters")],
    "beyaynetu":    [("shiro", 0.05, "kg"), ("lentils", 0.08, "kg"), ("yellow-split-peas", 0.06, "kg"), ("collard", 0.1, "kg"), ("potato", 0.1, "kg"),
                     ("carrot", 0.05, "kg"), ("oil", 0.05, "liters"), ("injera", 2, "pcs")],
    "shiro":        [("shiro", 0.1, "kg"), ("onion", 0.05, "kg"), ("garlic", 0.01, "kg"), ("oil", 0.04, "liters"), ("injera", 1, "pcs")],
    "misir":        [("lentils", 0.12, "kg"), ("onion", 0.06, "kg"), ("berbere", 0.015, "kg"), ("oil", 0.03, "liters"), ("injera", 1, "pcs")],
    "firfir":       [("injera", 2, "pcs"), ("onion", 0.03, "kg"), ("berbere", 0.01, "kg"), ("kibbeh", 0.02, "kg")],
    "chechebsa":    [("wheat-flour", 0.15, "kg"), ("kibbeh", 0.03, "kg"), ("berbere", 0.01, "kg")],
    "egg-firfir":   [("eggs", 3, "pcs"), ("onion", 0.03, "kg"), ("tomato", 0.05, "kg"), ("green-pepper", 0.01, "kg"), ("oil", 0.02, "liters")],
    "buna":         [("coffee", 0.02, "kg")],
    "jebena":       [("coffee", 0.015, "kg")],
    "macchiato":    [("espresso-beans", 0.018, "kg"), ("milk", 0.1, "liters")],
    "spiced-tea":   [("tea", 0.005, "kg"), ("cloves", 0.001, "kg"), ("cinnamon", 0.001, "kg"), ("sugar", 0.01, "kg")],
    "juice":        [("avocado", 0.1, "kg"), ("mango", 0.1, "kg"), ("papaya", 0.1, "kg"), ("sugar", 0.01, "kg")],
}

FIELDS = ("id", "category", "group", "unit", "cost", "en", "am", "om", "aliases", "minimum")


def rows() -> list[dict]:
    return [dict(zip(FIELDS, r)) for r in ITEMS]
