export type Lang = 'en' | 'am';
export const LANGS: Lang[] = ['en', 'am'];

const en = {
  'app.name': 'SEER · Cashier',
  'app.role': 'Cashier',
  'banner.title': 'Demo mode',
  'banner.text': 'Payments are not processed',

  'top.cashier': 'Signed in as {name}',
  'top.langSwitch': 'Switch language to {lang}',
  'top.langShort': 'አማ',
  'top.themeToLight': 'Switch to light theme',
  'top.themeToDark': 'Switch to dark theme',

  'menu.label': 'Menu',
  'menu.search': 'Search menu',
  'menu.clearSearch': 'Clear search',
  'menu.categories': 'Menu categories',
  'menu.results': 'Results for “{q}”',
  'menu.noResults': 'No dishes match “{q}”',
  'menu.addItem': 'Add {item}, {price}',
  'menu.inOrder': '{n} in order',

  'cat.mains': 'Mains',
  'cat.breakfast': 'Breakfast',
  'cat.drinks': 'Drinks',
  'cat.sides': 'Sides',

  'order.label': 'Current order',
  'order.check': 'Check #{n}',
  'order.dineIn': 'Dine-in',
  'order.takeaway': 'Takeaway',
  'order.type': 'Order type',
  'order.table': 'Table',
  'order.tableN': 'Table {n}',
  'order.items': '{n} items',
  'order.item': '1 item',
  'order.emptyTitle': 'No items yet',
  'order.emptyHint': 'Tap a dish to start',
  'order.each': '@ {price}',
  'order.increase': 'Add one {item}',
  'order.decrease': 'Remove one {item}',
  'order.remove': 'Remove {item} from order',
  'order.qty': 'Quantity',
  'order.added': '{item} added, {n} in order',
  'order.removed': '{item} removed',
  'order.cleared': 'Order cleared',

  'totals.subtotal': 'Subtotal',
  'totals.vat': 'VAT (15%)',
  'totals.total': 'Total',

  'action.clear': 'Clear',
  'action.clearConfirm': 'Tap again to clear',
  'action.charge': 'Charge {amount}',

  'money': 'ETB {amount}',

  'mobile.menu': 'Menu',
  'mobile.order': 'Order ({n})',
  'pay.title': 'Payment',
  'pay.method': 'Payment method',
  'pay.CASH': 'Cash',
  'pay.TELEBIRR': 'Telebirr',
  'pay.CBE_BIRR': 'CBE Birr',
  'pay.reference': 'Transaction ID',
  'pay.referenceHint': 'From the customer’s confirmation SMS',
  'pay.confirm': 'Confirm {amount}',
  'pay.cancel': 'Cancel',
  'pay.sending': 'Sending…',
  'pay.done': 'Order #{n} paid and sent to the kitchen',
  'pay.doneDemo': 'Demo: order #{n} was not saved',
  'pay.failed': 'Could not complete the order: {error}',
  'pay.needRef': 'Enter the transaction ID',
  'signin.title': 'Sign in',
  'signin.username': 'Username',
  'signin.password': 'Password',
  'signin.submit': 'Sign in',
  'signin.wrong': 'Wrong username or password',
  'signin.offline': 'Cannot reach the server. It may be waking up — try again in a minute.',
  'top.signOut': 'Sign out',
  'menu.loading': 'Loading menu…',
  'totals.net': 'Before VAT',
  'totals.vatIncluded': 'VAT included (15%)',
  'bills.button': 'Table bills',
  'bills.title': 'Table bills',
  'bills.asked': 'Asked for the bill',
  'bills.open': 'Other open tables',
  'bills.none': 'No table is waiting to pay.',
  'bills.table': 'Table {name}',
  'bills.waiter': 'Waiter: {name}',
  'bills.minAgo': '{n} min ago',
  'bills.justNow': 'just now',
  'bills.back': 'All tables',
  'bills.close': 'Close',
  'bills.loading': 'Loading…',
  'bills.failed': 'Could not load the tables: {error}',
  'bills.notAsked': 'The waiter has not asked for this bill yet. You can still take payment.',
  'bills.paidAlready': 'Already paid',
  'bills.amountDue': 'Amount due',
  'bills.paid': 'Table {name} paid · receipt {receipt}',
  'bills.count': '{n} tables asked for the bill',
  'bills.newRequest': 'Table {name} asked for the bill',
  'pay.received': 'Cash received (optional)',
  'pay.change': 'Change: {amount}',
  'pay.short': 'That is less than the amount due',
  'signin.note': 'For cashiers, branch managers and system admins.',
  'signin.busy': 'Signing in…',
  'signin.language': 'Language',
} as const;

export type Key = keyof typeof en;

const am: Record<Key, string> = {
  'app.name': 'SEER · Cashier',
  'app.role': 'ገንዘብ ተቀባይ',
  'banner.title': 'የሙከራ ሁነታ',
  'banner.text': 'ክፍያዎች አይፈጸሙም',

  'top.cashier': 'የገባው፦ {name}',
  'top.langSwitch': 'ቋንቋውን ወደ {lang} ቀይር',
  'top.langShort': 'EN',
  'top.themeToLight': 'ወደ ብሩህ ገጽታ ቀይር',
  'top.themeToDark': 'ወደ ጨለማ ገጽታ ቀይር',

  'menu.label': 'ምናሌ',
  'menu.search': 'ምግብ ይፈልጉ',
  'menu.clearSearch': 'ፍለጋውን አጽዳ',
  'menu.categories': 'የምናሌ ምድቦች',
  'menu.results': 'የ“{q}” ውጤቶች',
  'menu.noResults': '“{q}” የሚመስል ምግብ የለም',
  'menu.addItem': '{item} ጨምር፣ {price}',
  'menu.inOrder': 'በትዕዛዙ ውስጥ {n}',

  'cat.mains': 'ዋና ምግቦች',
  'cat.breakfast': 'ቁርስ',
  'cat.drinks': 'መጠጦች',
  'cat.sides': 'ተጨማሪዎች',

  'order.label': 'የአሁኑ ትዕዛዝ',
  'order.check': 'ቼክ #{n}',
  'order.dineIn': 'እዚሁ',
  'order.takeaway': 'ለመውሰድ',
  'order.type': 'የትዕዛዝ ዓይነት',
  'order.table': 'ጠረጴዛ',
  'order.tableN': 'ጠረጴዛ {n}',
  'order.items': '{n} እቃዎች',
  'order.item': '1 እቃ',
  'order.emptyTitle': 'እስካሁን ምንም የለም',
  'order.emptyHint': 'ለመጀመር ምግብ ይንኩ',
  'order.each': '@ {price}',
  'order.increase': 'አንድ {item} ጨምር',
  'order.decrease': 'አንድ {item} ቀንስ',
  'order.remove': '{item}ን ከትዕዛዙ አስወግድ',
  'order.qty': 'ብዛት',
  'order.added': '{item} ታክሏል፣ በትዕዛዙ ውስጥ {n}',
  'order.removed': '{item} ተወግዷል',
  'order.cleared': 'ትዕዛዙ ጸድቷል',

  'totals.subtotal': 'ንዑስ ድምር',
  'totals.vat': 'ተ.እ.ታ (15%)',
  'totals.total': 'ጠቅላላ',

  'action.clear': 'አጽዳ',
  'action.clearConfirm': 'ለማጽዳት እንደገና ይንኩ',
  'action.charge': '{amount} አስከፍል',

  'money': '{amount} ብር',

  'mobile.menu': 'ምናሌ',
  'mobile.order': 'ትዕዛዝ ({n})',
  'pay.title': 'ክፍያ',
  'pay.method': 'የክፍያ ዘዴ',
  'pay.CASH': 'ጥሬ ገንዘብ',
  'pay.TELEBIRR': 'ቴሌብር',
  'pay.CBE_BIRR': 'ሲቢኢ ብር',
  'pay.reference': 'የግብይት መለያ ቁጥር',
  'pay.referenceHint': 'ከደንበኛው የማረጋገጫ መልዕክት',
  'pay.confirm': '{amount} አረጋግጥ',
  'pay.cancel': 'ሰርዝ',
  'pay.sending': 'በመላክ ላይ…',
  'pay.done': 'ትዕዛዝ #{n} ተከፍሏል፤ ወደ ኩሽና ተልኳል',
  'pay.doneDemo': 'ሙከራ፦ ትዕዛዝ #{n} አልተቀመጠም',
  'pay.failed': 'ትዕዛዙን ማጠናቀቅ አልተቻለም፦ {error}',
  'pay.needRef': 'የግብይት መለያ ቁጥሩን ያስገቡ',
  'signin.title': 'ይግቡ',
  'signin.username': 'የተጠቃሚ ስም',
  'signin.password': 'የይለፍ ቃል',
  'signin.submit': 'ግባ',
  'signin.wrong': 'የተጠቃሚ ስም ወይም የይለፍ ቃል ተሳስቷል',
  'signin.offline': 'አገልጋዩን ማግኘት አልተቻለም። ከአንድ ደቂቃ በኋላ እንደገና ይሞክሩ።',
  'top.signOut': 'ውጣ',
  'menu.loading': 'ምናሌ በመጫን ላይ…',
  'totals.net': 'ከተ.እ.ታ በፊት',
  'totals.vatIncluded': 'የተካተተ ተ.እ.ታ (15%)',
  'bills.button': 'የጠረጴዛ ሂሳቦች',
  'bills.title': 'የጠረጴዛ ሂሳቦች',
  'bills.asked': 'ሂሳብ የጠየቁ',
  'bills.open': 'ሌሎች ክፍት ጠረጴዛዎች',
  'bills.none': 'የሚከፍል ጠረጴዛ የለም።',
  'bills.table': 'ጠረጴዛ {name}',
  'bills.waiter': 'አስተናጋጅ፦ {name}',
  'bills.minAgo': 'ከ{n} ደቂቃ በፊት',
  'bills.justNow': 'አሁን',
  'bills.back': 'ሁሉም ጠረጴዛዎች',
  'bills.close': 'ዝጋ',
  'bills.loading': 'በመጫን ላይ…',
  'bills.failed': 'ጠረጴዛዎቹን መጫን አልተቻለም፦ {error}',
  'bills.notAsked': 'አስተናጋጁ ገና ሂሳብ አልጠየቀም። አሁንም ክፍያ መቀበል ይችላሉ።',
  'bills.paidAlready': 'ቀድሞ የተከፈለ',
  'bills.amountDue': 'የሚከፈል መጠን',
  'bills.paid': 'ጠረጴዛ {name} ተከፍሏል · ደረሰኝ {receipt}',
  'bills.count': '{n} ጠረጴዛዎች ሂሳብ ጠይቀዋል',
  'bills.newRequest': 'ጠረጴዛ {name} ሂሳብ ጠይቋል',
  'pay.received': 'የተቀበሉት ጥሬ ገንዘብ (አማራጭ)',
  'pay.change': 'መልስ፦ {amount}',
  'pay.short': 'ከሚከፈለው መጠን ያነሰ ነው',
  'signin.note': 'ለገንዘብ ተቀባዮች፣ ለቅርንጫፍ ሥራ አስኪያጆች እና ለሲስተም አስተዳዳሪዎች።',
  'signin.busy': 'በመግባት ላይ…',
  'signin.language': 'ቋንቋ',
};

const dict: Record<Lang, Record<Key, string>> = { en, am };
const LANG_NAMES: Record<Lang, string> = { en: 'English', am: 'አማርኛ' };

const LANG_KEY = 'seer.cashier.lang';
function savedLang(): Lang {
  try {
    return localStorage.getItem(LANG_KEY) === 'am' ? 'am' : 'en';
  } catch {
    return 'en';
  }
}

let current: Lang = savedLang();
document.documentElement.lang = current;

export function getLang(): Lang {
  return current;
}

export function setLang(lang: Lang): void {
  current = lang;
  document.documentElement.lang = lang;
  try {
    localStorage.setItem(LANG_KEY, lang);
  } catch {
    /* private mode: this visit only */
  }
}

export function langName(lang: Lang): string {
  return LANG_NAMES[lang];
}

export function t(key: Key, vars?: Record<string, string | number>): string {
  let s: string = dict[current][key] ?? en[key];
  if (vars) {
    for (const [k, v] of Object.entries(vars)) s = s.split(`{${k}}`).join(String(v));
  }
  return s;
}
