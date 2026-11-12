/* =========================================================
   Localization — English (source), Amharic, Afaan Oromoo.
   Keys are the English strings, so a missing entry simply
   falls back to English instead of breaking the UI.
   ========================================================= */

export type Lang = "en" | "am" | "om";

export const LANGS: { code: Lang; short: string; name: string }[] = [
  { code: "en", short: "EN", name: "English" },
  { code: "am", short: "አማ", name: "አማርኛ" },
  { code: "om", short: "OM", name: "Afaan Oromoo" },
];

type Entry = { am: string; om: string };

const dict: Record<string, Entry> = {
  /* live mode (SEER backend) */
  "Sign in": { am: "ግባ", om: "Seeni" },
  "Sign out": { am: "ውጣ", om: "Ba'i" },
  "Username": { am: "የተጠቃሚ ስም", om: "Maqaa fayyadamaa" },
  "Password": { am: "የይለፍ ቃል", om: "Jecha icciitii" },
  "Signing in…": { am: "በመግባት ላይ…", om: "Seenaa jira…" },
  "Enter your username and password.": { am: "የተጠቃሚ ስምዎን እና የይለፍ ቃልዎን ያስገቡ።", om: "Maqaa fayyadamaa fi jecha icciitii galchi." },
  "Wrong username or password.": { am: "የተጠቃሚ ስም ወይም የይለፍ ቃል ትክክል አይደለም።", om: "Maqaan fayyadamaa ykn jechi icciitii dogoggora." },
  "This account can't open the owner dashboard.": { am: "ይህ መለያ የባለቤት ዳሽቦርዱን መክፈት አይችልም።", om: "Herregni kun daashboordii abbaa qabeenyaa banuu hin danda'u." },
  "Cannot reach the server. It may be waking up — try again in a minute.": { am: "ከሰርቨሩ ጋር መገናኘት አልተቻለም። እየተነሳ ሊሆን ይችላል — ከአንድ ደቂቃ በኋላ እንደገና ይሞክሩ።", om: "Sarvarii qaqqabuu hin dandeenye. Ka'aa jiraachuu danda'a — daqiiqaa booda irra deebi'ii yaali." },
  "Owner and admin accounts only.": { am: "ለባለቤት እና ለአስተዳዳሪ መለያዎች ብቻ።", om: "Herrega abbaa qabeenyaa fi bulchaa qofa." },
  "Not saved: {reason}": { am: "አልተቀመጠም፦ {reason}", om: "Hin olkaa'amne: {reason}" },
  "last month": { am: "ባለፈው ወር", om: "ji'a darbe" },
  "Investment plans aren't tracked in the system yet.": { am: "የኢንቨስትመንት ዕቅዶች ገና በሲስተሙ ውስጥ አልተመዘገቡም።", om: "Karoorri invastimantii ammaaf sirna keessatti hin galmoofne." },

  /* navigation & shell */
  Dashboard: { am: "ዳሽቦርድ", om: "Daashboordii" },
  Analytics: { am: "ትንታኔ", om: "Xiinxala" },
  Transactions: { am: "ግብይቶች", om: "Sochii Maallaqaa" },
  Budgets: { am: "በጀቶች", om: "Baajata" },
  Investments: { am: "ኢንቨስትመንቶች", om: "Invastimantii" },
  Goals: { am: "ግቦች", om: "Kaayyoo" },
  Reports: { am: "ሪፖርቶች", om: "Gabaasa" },
  Settings: { am: "ቅንብሮች", om: "Qindaa'ina" },
  "Help & Support": { am: "እገዛ እና ድጋፍ", om: "Gargaarsa fi Deeggarsa" },
  "Main menu": { am: "ዋና ምናሌ", om: "Baafata Ijoo" },
  Support: { am: "ድጋፍ", om: "Deeggarsa" },
  "Open menu": { am: "ምናሌ ክፈት", om: "Baafata bani" },
  Search: { am: "ፈልግ", om: "Barbaadi" },
  "Search transactions": { am: "ግብይቶችን ፈልግ", om: "Sochii maallaqaa barbaadi" },
  Language: { am: "ቋንቋ", om: "Afaan" },
  Notifications: { am: "ማሳወቂያዎች", om: "Beeksisa" },
  Theme: { am: "ገጽታ", om: "Bifa" },
  Dark: { am: "ጨለማ", om: "Dukkana" },
  Light: { am: "ብርሃን", om: "Ifa" },
  System: { am: "ሲስተም", om: "Sirna" },
  More: { am: "ተጨማሪ", om: "Dabalata" },

  /* alert */
  "Alert:": { am: "ማሳሰቢያ፦", om: "Akeekkachiisa:" },
  "Food cost is running 1.2% above target this week.": {
    am: "የምግብ ወጪ በዚህ ሳምንት ከዒላማው በ1.2% ብልጧል።",
    om: "Baasiin nyaataa torban kana galma irra 1.2%n ol ka'eera.",
  },
  "Review budgets": { am: "በጀቶችን ይገምግሙ", om: "Baajata ilaali" },

  /* metric cards */
  "Total Balance": { am: "ጠቅላላ ቀሪ ሂሳብ", om: "Haftee Waliigalaa" },
  "Total Revenue": { am: "ጠቅላላ ገቢ", om: "Galii Waliigalaa" },
  "Total Expense": { am: "ጠቅላላ ወጪ", om: "Baasii Waliigalaa" },
  "Profit Margin": { am: "የትርፍ ህዳግ", om: "Dhibbeentaa Bu'aa" },
  "across 3 accounts": { am: "በ3 ሂሳቦች", om: "herrega 3 irratti" },
  "this month": { am: "በዚህ ወር", om: "ji'a kana" },
  "target ≥ 35%": { am: "ዒላማ ≥ 35%", om: "galma ≥ 35%" },

  /* chart */
  "Revenue vs Expenses": { am: "ገቢ ከወጪ ጋር", om: "Galii fi Baasii" },
  Daily: { am: "ዕለታዊ", om: "Guyyaa" },
  Weekly: { am: "ሳምንታዊ", om: "Torban" },
  Monthly: { am: "ወርሃዊ", om: "Ji'a" },
  Revenue: { am: "ገቢ", om: "Galii" },
  Expenses: { am: "ወጪ", om: "Baasii" },
  Net: { am: "የተጣራ", om: "Qulqulluu" },
  W: { am: "ሳ", om: "T" },
  "Week of {x}": { am: "የ{x} ሳምንት", om: "Torban {x}" },
  "Cash flow chart": { am: "የገንዘብ ፍሰት ሰንጠረዥ", om: "Chaartii sochii maallaqaa" },

  /* payment methods */
  "Payment Methods": { am: "የክፍያ ዘዴዎች", om: "Malaa Kaffaltii" },
  Cash: { am: "ጥሬ ገንዘብ", om: "Callaa" },
  Drawer: { am: "መሳቢያ", om: "Saanduqa" },
  "Available Balance": { am: "ያለ ቀሪ ሂሳብ", om: "Haftee Jiru" },
  "This month": { am: "በዚህ ወር", om: "Ji'a kana" },
  "Money in": { am: "የገባ ገንዘብ", om: "Maallaqa Gale" },
  "Money out": { am: "የወጣ ገንዘብ", om: "Maallaqa Ba'e" },
  "Latest activity (ETB)": { am: "የቅርብ ጊዜ እንቅስቃሴ (ብር)", om: "Sochii Dhiyoo (ETB)" },
  Today: { am: "ዛሬ", om: "Har'a" },
  Yesterday: { am: "ትናንት", om: "Kaleessa" },
  Birr: { am: "ብር", om: "Birrii" },

  /* tables */
  "Recent Transactions": { am: "የቅርብ ጊዜ ግብይቶች", om: "Sochii Maallaqaa Dhiyoo" },
  "View all": { am: "ሁሉንም ይመልከቱ", om: "Hunda ilaali" },
  ID: { am: "መለያ", om: "ID" },
  "Transaction ID": { am: "የግብይት መለያ", om: "ID Sochii" },
  Description: { am: "መግለጫ", om: "Ibsa" },
  Category: { am: "ምድብ", om: "Ramaddii" },
  Date: { am: "ቀን", om: "Guyyaa" },
  Amount: { am: "መጠን", om: "Hanga" },
  Status: { am: "ሁኔታ", om: "Haala" },
  "All Transactions": { am: "ሁሉም ግብይቶች", om: "Sochii Maallaqaa Hunda" },
  Filter: { am: "አጣራ", om: "Calali" },
  All: { am: "ሁሉም", om: "Hunda" },
  "Select all": { am: "ሁሉንም ምረጥ", om: "Hunda filadhu" },
  "Showing {x} of {y}": { am: "ከ{y} ውስጥ {x} እየታየ ነው", om: "{y} keessaa {x} agarsiifamaa jira" },
  "Page {x} of {y}": { am: "ገጽ {x} ከ{y}", om: "Fuula {x}/{y}" },
  "Previous page": { am: "ቀዳሚ ገጽ", om: "Fuula duraa" },
  "Next page": { am: "ቀጣይ ገጽ", om: "Fuula itti aanu" },
  "No transactions match.": { am: "የሚዛመድ ግብይት የለም።", om: "Sochiin walsimu hin jiru." },

  /* statuses */
  Success: { am: "ተሳክቷል", om: "Milkaa'e" },
  Pending: { am: "በመጠባበቅ ላይ", om: "Eeggachaa" },
  Failed: { am: "አልተሳካም", om: "Fashale" },

  /* categories */
  "Food Cost": { am: "የምግብ ወጪ", om: "Baasii Nyaataa" },
  Labor: { am: "የሰራተኛ ወጪ", om: "Hojjettoota" },
  Utilities: { am: "መገልገያዎች", om: "Tajaajila" },
  Rent: { am: "ኪራይ", om: "Kiraa" },
  Marketing: { am: "ማስታወቂያ", om: "Beeksisa" },
  Supplies: { am: "አቅርቦቶች", om: "Meeshaalee" },

  /* transaction & activity descriptions */
  "Fresh Produce Supplier": { am: "ትኩስ ምርት አቅራቢ", om: "Dhiyeessaa Oomisha Haaraa" },
  "Staff Payroll - Week 44": { am: "የሰራተኞች ደመወዝ - ሳምንት 44", om: "Mindaa Hojjettootaa - Torban 44" },
  "Electricity - Ethio Telecom": { am: "ኤሌክትሪክ - ኢትዮ ቴሌኮም", om: "Ibsaa - Ethio Telecom" },
  "Monthly Rent - Bole": { am: "ወርሃዊ ኪራይ - ቦሌ", om: "Kiraa Ji'aa - Boolee" },
  "Facebook Ads Campaign": { am: "የፌስቡክ ማስታወቂያ ዘመቻ", om: "Duula Beeksisa Facebook" },
  "Kitchen Supplies - Restock": { am: "የወጥ ቤት ዕቃዎች - መሙላት", om: "Meeshaalee Kushinaa - Guutuu" },
  "Meat & Poultry Vendor": { am: "የስጋ እና ዶሮ አቅራቢ", om: "Gurgurtaa Foonii fi Lukkuu" },
  "Part-time Waiters": { am: "የትርፍ ሰዓት አስተናጋጆች", om: "Tajaajiltoota Yeroo Muraasaa" },
  "Water Bill": { am: "የውሃ ክፍያ", om: "Kaffaltii Bishaanii" },
  "Menu Printing": { am: "የምናሌ ህትመት", om: "Maxxansa Menyuu" },
  "Dinner service payments": { am: "የእራት አገልግሎት ክፍያዎች", om: "Kaffaltii Tajaajila Irbaataa" },
  "Lunch service cash": { am: "የምሳ አገልግሎት ጥሬ ገንዘብ", om: "Callaa Tajaajila Laaqanaa" },
  "Daily sales deposit": { am: "የዕለት ሽያጭ ተቀማጭ", om: "Kuusaa Gurgurtaa Guyyaa" },

  /* analytics */
  "Top Selling Dishes": { am: "በብዛት የተሸጡ ምግቦች", om: "Nyaata Baay'ee Gurguramaa" },
  sold: { am: "ተሸጧል", om: "gurgurame" },
  "Peak Hours (Orders)": { am: "ከፍተኛ ሰዓታት (ትዕዛዞች)", om: "Sa'aatii Ol'aanaa (Ajaja)" },
  "Dinner service (19–20) is your strongest window. Consider staffing accordingly.": {
    am: "የእራት አገልግሎት (19–20) በጣም ጠንካራው ሰዓትዎ ነው። ሰራተኞችን በዚሁ መሰረት ያደራጁ።",
    om: "Tajaajilli irbaataa (19–20) yeroo keessan isa cimaa dha. Hojjettoota haaluma kanaan qindeessaa.",
  },
  "Quick Insights": { am: "ፈጣን ግንዛቤዎች", om: "Hubannoo Saffisaa" },
  "Average Order Value": { am: "አማካይ የትዕዛዝ ዋጋ", om: "Gatii Ajajaa Giddugaleessaa" },
  "+8% vs last month": { am: "ካለፈው ወር +8%", om: "Ji'a darbe irra +8%" },
  "Table Turnover": { am: "የጠረጴዛ ዝውውር", om: "Jijjiirraa Minjaalaa" },
  "Per table during dinner": { am: "በእራት ጊዜ በአንድ ጠረጴዛ", om: "Minjaala tokkoon yeroo irbaataa" },
  "Waste Rate": { am: "የብክነት መጠን", om: "Sadarkaa Badiinsaa" },
  "Target: under 3%": { am: "ዒላማ፦ ከ3% በታች", om: "Galma: 3% gadi" },
  "Kitfo Special": { am: "ክትፎ ስፔሻል", om: "Kitfoo Addaa" },
  "Doro Wat": { am: "ዶሮ ወጥ", om: "Ittoo Lukkuu" },
  "Tibs Mix": { am: "ጥብስ ድብልቅ", om: "Tibsii Makaa" },
  Shiro: { am: "ሽሮ", om: "Shiroo" },
  Firfir: { am: "ፍርፍር", om: "Firfir" },

  /* budgets */
  "of {x} allocated": { am: "ከተመደበው {x}", om: "{x} ramadame keessaa" },

  /* budgets screen */
  "Day {d} of {n}": { am: "ቀን {d} ከ{n}", om: "Guyyaa {d}/{n}" },
  "{x} days left": { am: "{x} ቀናት ቀርተዋል", om: "Guyyaa {x} hafe" },
  "Biggest problem": { am: "ትልቁ ችግር", om: "Rakkoo Guddaa" },
  "{x} is on pace to finish {y} over budget ({z}).": {
    am: "{x} በዚህ ፍጥነት ከቀጠለ በወሩ መጨረሻ ከበጀት በ{y} ({z}) ይበልጣል።",
    om: "{x} akkuma kanaan yoo itti fufe dhuma ji'aatti baajata irra {y} ({z}) ni darba.",
  },
  "{x} is already {y} over budget.": { am: "{x} አስቀድሞ ከበጀት በ{y} በልጧል።", om: "{x} duraan baajata irra {y}n darbeera." },
  "Spending is {x} ahead of plan for day {d}.": {
    am: "ወጪው ለቀን {d} ከታቀደው በ{x} ቀድሟል።",
    om: "Baasiin guyyaa {d}f karoora irra {x}n dursee jira.",
  },
  "Next step:": { am: "ቀጣይ እርምጃ፦", om: "Tarkaanfii itti aanu:" },
  "Review produce and meat purchases this week.": {
    am: "በዚህ ሳምንት የአትክልት እና የስጋ ግዢዎችን ይገምግሙ።",
    om: "Torban kana bittaa kuduraa fi foonii ilaalaa.",
  },
  "Check overtime and shift cover before next week's rota.": {
    am: "የሚቀጥለውን ሳምንት የፈረቃ ድልድል ከማውጣትዎ በፊት የትርፍ ሰዓት ስራን ይፈትሹ።",
    om: "Karoora hojii torban itti aanuu dura hojii yeroo dabalataa ilaalaa.",
  },
  "Check for equipment left running after closing.": {
    am: "ከተዘጋ በኋላ ሳይጠፉ የሚቀሩ መሳሪያዎችን ይፈትሹ።",
    om: "Meeshaalee erga cufamee booda hojii irra turan ilaalaa.",
  },
  "Pause the lowest-performing ad campaign.": {
    am: "ዝቅተኛ ውጤት ያለውን የማስታወቂያ ዘመቻ ለጊዜው ያቁሙ።",
    om: "Duula beeksisaa bu'aa gadi aanaa qabu yeroof dhaabaa.",
  },
  "Delay non-essential restocking until next month.": {
    am: "አስፈላጊ ያልሆኑ ግዢዎችን እስከሚቀጥለው ወር ያዘግዩ።",
    om: "Bittaa barbaachisaa hin taane hanga ji'a itti aanuutti tursiisaa.",
  },
  "Rent is fixed. Plan the difference into next month's budget.": {
    am: "ኪራይ ቋሚ ወጪ ነው። ልዩነቱን በሚቀጥለው ወር በጀት ውስጥ ያካትቱ።",
    om: "Kiraan baasii dhaabbataa dha. Garaagarummaa isaa baajata ji'a itti aanuu keessatti karoorfadhaa.",
  },
  "Review {x} transactions": { am: "የ{x} ግብይቶችን ይገምግሙ", om: "Sochii maallaqaa {x} ilaali" },
  "Adjust budget": { am: "በጀት አስተካክል", om: "Baajata sirreessi" },
  "All budgets on track": { am: "ሁሉም በጀቶች በዕቅድ ላይ ናቸው", om: "Baajanni hundi karoora irra jira" },
  "Projected to finish {x} under budget this month.": {
    am: "በዚህ ወር ከበጀት በ{x} በታች እንደሚጠናቀቅ ይገመታል።",
    om: "Ji'a kana baajata gadi {x}n akka xumuramu tilmaamama.",
  },
  "Total budget": { am: "ጠቅላላ በጀት", om: "Baajata Waliigalaa" },
  "Spent so far": { am: "እስካሁን የወጣ", om: "Hanga ammaatti kan ba'e" },
  "Projected month-end": { am: "የወር መጨረሻ ግምት", om: "Tilmaama dhuma ji'aa" },
  "Needs attention": { am: "ትኩረት የሚሹ", om: "Xiyyeeffannaa barbaadu" },
  "Last month: {x}": { am: "ያለፈው ወር፦ {x}", om: "Ji'a darbe: {x}" },
  "Plan by today: {x}": { am: "እስከ ዛሬ የታቀደ፦ {x}", om: "Karoora hanga har'aa: {x}" },
  "{x} over": { am: "{x} በላይ", om: "{x} irra" },
  "{x} under": { am: "{x} በታች", om: "{x} gadi" },
  "{x} of {y} categories": { am: "ከ{y} ምድቦች {x}", om: "Ramaddii {y} keessaa {x}" },
  "{x} over · {y} at risk": { am: "{x} ከበጀት በላይ · {y} ስጋት ላይ", om: "{x} darbe · {y} balaa irra" },
  "On track": { am: "በዕቅድ ላይ", om: "Karoora irra" },
  "At risk": { am: "ስጋት ላይ", om: "Balaa irra" },
  "Over budget": { am: "ከበጀት በላይ", om: "Baajata darbe" },
  "By category": { am: "በምድብ", om: "Ramaddiidhaan" },
  Sort: { am: "ደርድር", om: "Tartiibessi" },
  "Worst first": { am: "መጥፎው መጀመሪያ", om: "Hamaan dursa" },
  Largest: { am: "ትልቁ", om: "Guddaa" },
  "A–Z": { am: "ሀ–ፐ", om: "A–Z" },
  Budget: { am: "በጀት", om: "Baajata" },
  Spent: { am: "የወጣ", om: "Kan ba'e" },
  Projected: { am: "ግምት", om: "Tilmaama" },
  Variance: { am: "ልዩነት", om: "Garaagarummaa" },
  "{x} used · plan {y}": { am: "{x} ወጥቷል · ዕቅድ {y}", om: "{x} ba'e · karoora {y}" },
  "vs last month {x}": { am: "ካለፈው ወር {x}", om: "ji'a darbe irra {x}" },
  Fixed: { am: "ቋሚ", om: "Dhaabbataa" },
  "Paid {x}": { am: "{x} ተከፍሏል", om: "{x} kaffalame" },
  "Due this month": { am: "በዚህ ወር የሚከፈል", om: "Ji'a kana kaffalama" },
  "Today's planned spend": { am: "የዛሬ የታቀደ ወጪ", om: "Baasii hanga har'aatti karoorfame" },
  Edit: { am: "አስተካክል", om: "Sirreessi" },
  "Edit budget for {x}": { am: "የ{x} በጀት አስተካክል", om: "Baajata {x} sirreessi" },
  "Budget amount for {x}": { am: "የ{x} የበጀት መጠን", om: "Hanga baajata {x}" },
  "Match projection ({x})": { am: "ከግምቱ ጋር አዛምድ ({x})", om: "Tilmaama waliin walsimsiisi ({x})" },
  Save: { am: "አስቀምጥ", om: "Olkaa'i" },
  Cancel: { am: "ሰርዝ", om: "Dhiisi" },
  Undo: { am: "ቀልብስ", om: "Deebisi" },
  "Enter an amount between 1 and 10,000,000.": {
    am: "ከ1 እስከ 10,000,000 ያለ መጠን ያስገቡ።",
    om: "Hanga 1 fi 10,000,000 gidduu jiru galchaa.",
  },
  "{x} budget saved: {y}": { am: "የ{x} በጀት ተቀምጧል፦ {y}", om: "Baajanni {x} kuufame: {y}" },
  "Budget changes are kept until you reload the page.": {
    am: "የበጀት ለውጦች ገጹን እስኪያድሱ ድረስ ይቆያሉ።",
    om: "Jijjiiramni baajataa hanga fuula haaromsitanitti tura.",
  },

  /* investments */
  Equipment: { am: "መሳሪያዎች", om: "Meeshaalee" },
  "New Industrial Oven": { am: "አዲስ የኢንዱስትሪ ምድጃ", om: "Oovanii Industirii Haaraa" },
  "Planned Q1 2027 · Est. ETB 185,000": { am: "ለ2027 ሩብ 1 የታቀደ · ግምት ETB 185,000", om: "Kurmaana 1 2027 karoorfame · Tilmaama ETB 185,000" },
  "35% funded from reserves": { am: "35% ከመጠባበቂያ ተሸፍኗል", om: "35% kuusaa irraa kaffalame" },
  "POS Terminal Upgrade": { am: "የPOS ተርሚናል ማሻሻያ", om: "Fooyya'iinsa Terminaala POS" },
  "3 new terminals · ETB 42,000": { am: "3 አዲስ ተርሚናሎች · ETB 42,000", om: "Terminaala haaraa 3 · ETB 42,000" },
  "Almost ready": { am: "ሊጠናቀቅ ተቃርቧል", om: "Xumuramuuf dhihaateera" },
  Expansion: { am: "መስፋፋት", om: "Babal'ina" },
  "Second Branch – CMC": { am: "ሁለተኛ ቅርንጫፍ – ሲኤምሲ", om: "Damee Lammaffaa – CMC" },
  "Feasibility study complete. Target open date: mid-2027.": {
    am: "የአዋጭነት ጥናት ተጠናቋል። የመክፈቻ ዒላማ፦ 2027 አጋማሽ።",
    om: "Qorannoon danda'amummaa xumurameera. Guyyaa banamuu: walakkaa 2027.",
  },
  "ETB 1.2M projected": { am: "ETB 1.2M ይጠበቃል", om: "ETB 1.2M eegama" },
  "Delivery Fleet": { am: "የማድረሻ ተሽከርካሪዎች", om: "Konkolaattota Geejjibaa" },
  "2 motorcycles + branded boxes": { am: "2 ሞተር ሳይክሎች + የምርት ስም ያላቸው ሳጥኖች", om: "Motora 2 + saanduqa mallattoo qabu" },

  /* goals */
  "Monthly Revenue Target": { am: "ወርሃዊ የገቢ ዒላማ", om: "Galma Galii Ji'aa" },
  "Food Cost under 30%": { am: "የምግብ ወጪ ከ30% በታች", om: "Baasii Nyaataa 30% gadi" },
  "Customer Reviews (4.5+)": { am: "የደንበኞች ግምገማ (4.5+)", om: "Madaallii Maamiltootaa (4.5+)" },
  "Due {x}": { am: "የመጨረሻ ቀን {x}", om: "Yeroo {x}" },
  Ongoing: { am: "ቀጣይ", om: "Itti fufaa" },

  /* reports */
  "Daily Sales Report": { am: "የዕለት ሽያጭ ሪፖርት", om: "Gabaasa Gurgurtaa Guyyaa" },
  "Revenue, orders, average ticket, payment mix for any day.": {
    am: "ለማንኛውም ቀን ገቢ፣ ትዕዛዞች፣ አማካይ ሂሳብ እና የክፍያ አይነቶች።",
    om: "Galii, ajaja, kaffaltii giddugaleessaa fi akaakuu kaffaltii guyyaa kamiyyuu.",
  },
  "Weekly P&L": { am: "ሳምንታዊ ትርፍ እና ኪሳራ", om: "Bu'aa fi Kisaaraa Torbanii" },
  "Profit & loss with food cost, labor and overhead breakdown.": {
    am: "ትርፍ እና ኪሳራ ከምግብ፣ ከሰራተኛ እና ከሌሎች ወጪዎች ዝርዝር ጋር።",
    om: "Bu'aa fi kisaaraa baasii nyaataa, hojjettootaa fi kan biroo waliin.",
  },
  "Monthly Tax Summary": { am: "ወርሃዊ የግብር ማጠቃለያ", om: "Cuunfaa Gibiraa Ji'aa" },
  "VAT, withholding and income tax ready for accountant.": {
    am: "ተ.እ.ታ፣ ተቀናሽ እና የገቢ ግብር ለሂሳብ ባለሙያ ዝግጁ።",
    om: "VAT, gibira qabamuu fi gibira galii herregaaf qophaa'e.",
  },
  "Inventory Valuation": { am: "የክምችት ዋጋ ግምት", om: "Madaallii Kuusaa Meeshaa" },
  "Current stock value and variance vs last count.": {
    am: "የአሁኑ ክምችት ዋጋ እና ከመጨረሻው ቆጠራ ያለው ልዩነት።",
    om: "Gatii kuusaa ammaa fi garaagarummaa lakkoofsa darbe waliin.",
  },
  "Staff Hours & Cost": { am: "የሰራተኞች ሰዓት እና ወጪ", om: "Sa'aatii fi Baasii Hojjettootaa" },
  "Hours worked, overtime and labor cost % of sales.": {
    am: "የተሰሩ ሰዓታት፣ ትርፍ ሰዓት እና የሰራተኛ ወጪ ከሽያጭ በ%።",
    om: "Sa'aatii hojjetame, yeroo dabalataa fi baasii hojjettootaa % gurgurtaa.",
  },
  "Menu Performance": { am: "የምናሌ አፈጻጸም", om: "Raawwii Menyuu" },
  "Contribution margin and popularity of every dish.": {
    am: "የእያንዳንዱ ምግብ የትርፍ አስተዋጽኦ እና ተወዳጅነት።",
    om: "Bu'aa fi jaallatamummaa nyaata hundaa.",
  },
  Generate: { am: "አዘጋጅ", om: "Qopheessi" },

  /* settings */
  "Personalize SEER for how you run your restaurant.": {
    am: "SEERን ምግብ ቤትዎን በሚያስተዳድሩበት መንገድ ያብጁ።",
    om: "SEER akkaataa mana nyaataa keessan itti bulchitaniin qindeessaa.",
  },
  Appearance: { am: "ገጽታ", om: "Bifa" },
  "Cursor glow": { am: "የጠቋሚ ብርሃን", om: "Ifa maawusii" },
  "A soft light that follows your cursor near cards and buttons.": {
    am: "በካርዶች እና በአዝራሮች አጠገብ ጠቋሚዎን የሚከተል ቀላል ብርሃን።",
    om: "Ifa laafaa kaardii fi qabduu bira maawusii keessan hordofu.",
  },
  "Reduce motion": { am: "እንቅስቃሴን ቀንስ", om: "Sochii hir'isi" },
  "Turn off number and chart animations.": { am: "የቁጥር እና የሰንጠረዥ እነማዎችን ያጥፉ።", om: "Sochii lakkoofsaa fi chaartii dhaamsi." },
  "Language & region": { am: "ቋንቋ እና ክልል", om: "Afaanii fi Naannoo" },
  "Applies to menus, labels, dates and reports.": {
    am: "ለምናሌዎች፣ መለያዎች፣ ቀናት እና ሪፖርቶች ይሠራል።",
    om: "Baafata, mallattoo, guyyaa fi gabaasa irratti hojjeta.",
  },
  "Currency format": { am: "የገንዘብ አጻጻፍ", om: "Bifa maallaqaa" },
  "Default chart range": { am: "ነባሪ የሰንጠረዥ ጊዜ", om: "Yeroo chaartii durtii" },
  "Default payment method": { am: "ነባሪ የክፍያ ዘዴ", om: "Mala kaffaltii durtii" },
  "Show alert banner": { am: "የማሳሰቢያ ሰንደቅ አሳይ", om: "Beeksisa akeekkachiisaa agarsiisi" },
  "Shows cost warnings at the top of the Dashboard.": {
    am: "በዳሽቦርዱ አናት ላይ የወጪ ማስጠንቀቂያዎችን ያሳያል።",
    om: "Akeekkachiisa baasii gubbaa Daashboordii irratti agarsiisa.",
  },
  Alerts: { am: "ማንቂያዎች", om: "Akeekkachiisa" },
  "Failed payment alerts": { am: "ያልተሳኩ ክፍያዎች ማንቂያ", om: "Akeekkachiisa kaffaltii fashale" },
  "Show a dot on the bell when a payment fails.": {
    am: "ክፍያ ሲከሽፍ በደወሉ ላይ ነጥብ አሳይ።",
    om: "Yeroo kaffaltiin fashalu bilbila irratti tuqaa agarsiisi.",
  },
  "Budget warning level": { am: "የበጀት ማስጠንቀቂያ ደረጃ", om: "Sadarkaa akeekkachiisa baajataa" },
  "Flag a category when spending reaches this share of its budget.": {
    am: "ወጪ ከበጀቱ ይህን ያህል ሲደርስ ምድቡን ምልክት አድርግ።",
    om: "Baasiin baajata isaa irraa hanga kana yoo ga'e ramaddii mallatteessi.",
  },
  "Reset to defaults": { am: "ወደ ነባሪ መልስ", om: "Gara durtii deebisi" },
  "Settings are saved on this device.": { am: "ቅንብሮች በዚህ መሣሪያ ላይ ይቀመጣሉ።", om: "Qindaa'inni meeshaa kana irratti kuufama." },

  /* help */
  "How to use SEER": { am: "SEERን እንዴት መጠቀም እንደሚቻል", om: "Akkaataa SEER itti fayyadamtan" },
  "Six habits that keep your numbers accurate and your restaurant profitable.": {
    am: "ቁጥሮችዎ ትክክል እንዲሆኑ እና ምግብ ቤትዎ ትርፋማ እንዲሆን የሚረዱ ስድስት ልማዶች።",
    om: "Amaloota ja'a lakkoofsota keessan sirrii, mana nyaataa keessan immoo bu'aa qabeessa taasisan.",
  },
  "Check your day at a glance": { am: "ቀንዎን በአንድ እይታ ይመልከቱ", om: "Haala guyyaa keessanii yeroo tokkoon ilaalaa" },
  "Open the Dashboard each morning. The four cards show your Total Balance across Telebirr, Cash and CBE, this month's revenue and expenses, and your profit margin against the 35% target.": {
    am: "በየጠዋቱ ዳሽቦርዱን ይክፈቱ። አራቱ ካርዶች በቴሌብር፣ በጥሬ ገንዘብ እና በCBE ያለውን ጠቅላላ ቀሪ ሂሳብ፣ የዚህን ወር ገቢ እና ወጪ እንዲሁም የትርፍ ህዳግዎን ከ35% ዒላማ ጋር ያሳያሉ።",
    om: "Ganama hunda Daashboordii banaa. Kaardiiwwan afran haftee waliigalaa Telebirr, Callaa fi CBE irratti, galii fi baasii ji'a kanaa, akkasumas dhibbeentaa bu'aa galma 35% waliin agarsiisu.",
  },
  "Read the revenue chart": { am: "የገቢ ሰንጠረዡን ያንብቡ", om: "Chaartii galii dubbisaa" },
  "Switch between Daily, Weekly and Monthly. Hover over the chart to see revenue, expenses and net for any point. The green line is revenue, the red dashed line is expenses; the gap between them is your profit.": {
    am: "በዕለታዊ፣ ሳምንታዊ እና ወርሃዊ መካከል ይቀያይሩ። ለማንኛውም ነጥብ ገቢ፣ ወጪ እና የተጣራ ትርፍ ለማየት ጠቋሚውን በሰንጠረዡ ላይ ያንቀሳቅሱ። አረንጓዴው መስመር ገቢ፣ ቀዩ ነጠብጣብ መስመር ወጪ ሲሆን በመካከላቸው ያለው ክፍተት ትርፍዎ ነው።",
    om: "Guyyaa, Torban fi Ji'a gidduu jijjiiraa. Galii, baasii fi bu'aa qulqulluu qabxii kamiyyuu ilaaluuf maawusii chaartii irra oofaa. Sararri magariisaa galii, sararri diimaan qoqqoodame baasii dha; garaagarummaan isaan gidduu jiru bu'aa keessan.",
  },
  "Reconcile payments at closing": { am: "በመዝጊያ ሰዓት ክፍያዎችን ያስታርቁ", om: "Yeroo cufamuu kaffaltii walsimsiisaa" },
  "In Payment Methods, pick Telebirr, Cash or CBE and compare the balance with the Telebirr app, the cash drawer count and your bank statement. Find any difference the same day.": {
    am: "በክፍያ ዘዴዎች ውስጥ ቴሌብር፣ ጥሬ ገንዘብ ወይም CBE ይምረጡ እና ቀሪ ሂሳቡን ከቴሌብር መተግበሪያ፣ ከመሳቢያው ቆጠራ እና ከባንክ መግለጫዎ ጋር ያወዳድሩ። ማንኛውንም ልዩነት በዚያው ቀን ያግኙ።",
    om: "Malaa Kaffaltii keessatti Telebirr, Callaa ykn CBE filadhaa, haftee isaa appii Telebirr, lakkoofsa saanduqaa fi ibsa baankii keessan waliin wal bira qabaa. Garaagarummaa kamiyyuu guyyuma sana barbaadaa.",
  },
  "Follow up on transactions": { am: "ግብይቶችን ይከታተሉ", om: "Sochii maallaqaa hordofaa" },
  "On Transactions, search by ID, supplier or category and filter by status. Check Pending and Failed payments daily so suppliers and staff are paid on time.": {
    am: "በግብይቶች ገጽ በመለያ፣ በአቅራቢ ወይም በምድብ ይፈልጉ እና በሁኔታ ያጣሩ። አቅራቢዎች እና ሰራተኞች በወቅቱ እንዲከፈላቸው በመጠባበቅ ላይ ያሉ እና ያልተሳኩ ክፍያዎችን በየቀኑ ያረጋግጡ።",
    om: "Fuula Sochii Maallaqaa irratti ID, dhiyeessaa ykn ramaddiin barbaadaa, haalaan calalaa. Dhiyeessitoonni fi hojjettoonni yeroon akka kaffalamaniif kaffaltii eeggachaa fi fashale guyyaa guyyaan mirkaneessaa.",
  },
  "Keep costs inside budget": { am: "ወጪዎችን በበጀት ውስጥ ያቆዩ", om: "Baasii baajata keessatti eegaa" },
  "Budgets ranks categories worst first and projects month-end spend from today's pace. Orange means on pace to go over (or past your warning level in Settings); red means already over. Tap the pencil to change a budget.": {
    am: "የበጀቶች ገጽ ምድቦችን ከመጥፎው ጀምሮ ይደረድራል እና በዛሬው የወጪ ፍጥነት የወሩን መጨረሻ ወጪ ይገምታል። ብርቱካናማ ከበጀት ሊያልፍ መሆኑን (ወይም በቅንብሮች ያስቀመጡትን የማስጠንቀቂያ ደረጃ ማለፉን)፣ ቀይ ደግሞ አስቀድሞ ማለፉን ያሳያል። በጀት ለመቀየር የእርሳስ ምልክቱን ይጫኑ።",
    om: "Fuulli Baajataa ramaddiiwwan hamaa irraa jalqabee tartiibessa, saffisa baasii har'aatiin baasii dhuma ji'aa tilmaama. Burtukaanaan baajata darbuuf akka jiru (ykn sadarkaa akeekkachiisaa Qindaa'ina keessatti kaa'ame darbuu) agarsiisa; diimni immoo duraan darbuu isaa agarsiisa. Baajata jijjiiruuf mallattoo qalamaa tuqaa.",
  },
  "Plan with Goals and Reports": { am: "በግቦች እና በሪፖርቶች ያቅዱ", om: "Kaayyoo fi Gabaasaan karoorfadhaa" },
  "Track monthly targets on Goals. Generate the Weekly P&L every Monday and the Monthly Tax Summary at month end for your accountant.": {
    am: "ወርሃዊ ዒላማዎችን በግቦች ገጽ ይከታተሉ። ሳምንታዊውን የትርፍ እና ኪሳራ ሪፖርት በየሰኞው፣ ወርሃዊውን የግብር ማጠቃለያ ደግሞ በወሩ መጨረሻ ለሂሳብ ባለሙያዎ ያዘጋጁ።",
    om: "Galma ji'aa fuula Kaayyoo irratti hordofaa. Gabaasa Bu'aa fi Kisaaraa Torbanii Wiixata hunda, Cuunfaa Gibiraa Ji'aa immoo dhuma ji'aatti herregaa keessaniif qopheessaa.",
  },
  "Keyboard shortcuts": { am: "የቁልፍ ሰሌዳ አቋራጮች", om: "Gabaabsa kiiboordii" },
  "Close menus": { am: "ምናሌዎችን ዝጋ", om: "Baafata cufi" },
  "Language, theme and dashboard defaults can be changed in Settings.": {
    am: "ቋንቋ፣ ገጽታ እና የዳሽቦርድ ነባሪዎችን በቅንብሮች ውስጥ መቀየር ይችላሉ።",
    om: "Afaan, bifa fi filannoo durtii daashboordii Qindaa'ina keessatti jijjiiruu dandeessu.",
  },
  "Open Settings": { am: "ቅንብሮችን ክፈት", om: "Qindaa'ina bani" },
};

export function translate(key: string, lang: Lang, vars?: Record<string, string | number>): string {
  let s = lang === "en" ? key : (dict[key]?.[lang] ?? key);
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.split(`{${k}}`).join(String(v));
  return s;
}

/** Exposed for a dev-time completeness check. */
export const hasTranslation = (key: string): boolean => key in dict;

/* ---------- calendar names (Gregorian calendar, as used in the data) ---------- */

const MONTHS: Record<Lang, string[]> = {
  en: ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"],
  am: ["ጃን", "ፌብ", "ማርች", "ኤፕሪ", "ሜይ", "ጁን", "ጁላይ", "ኦገስ", "ሴፕቴ", "ኦክቶ", "ኖቬም", "ዲሴም"],
  om: ["Ama", "Gur", "Bit", "Elb", "Caa", "Wax", "Ado", "Hag", "Ful", "Onk", "Sad", "Mud"],
};

// index 0 = Sunday, matching Date.getDay()
const DAYS_SHORT: Record<Lang, string[]> = {
  en: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"],
  am: ["እሑድ", "ሰኞ", "ማክሰ", "ረቡዕ", "ሐሙስ", "ዓርብ", "ቅዳሜ"],
  om: ["Dil", "Wii", "Kib", "Rob", "Kam", "Jim", "San"],
};

const DAYS_LONG: Record<Lang, string[]> = {
  en: ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"],
  am: ["እሑድ", "ሰኞ", "ማክሰኞ", "ረቡዕ", "ሐሙስ", "ዓርብ", "ቅዳሜ"],
  om: ["Dilbata", "Wiixata", "Kibxata", "Roobii", "Kamiisa", "Jimaata", "Sanbata"],
};

export const monthShort = (l: Lang): string[] => MONTHS[l];
export const dayShort = (l: Lang): string[] => DAYS_SHORT[l];
export const dayLong = (l: Lang): string[] => DAYS_LONG[l];
