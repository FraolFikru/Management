import type { Lang } from './i18n';

export type CategoryId = 'mains' | 'breakfast' | 'drinks' | 'sides';

export interface Category {
  id: CategoryId;
  /** i18n key for the tab label */
  labelKey: 'cat.mains' | 'cat.breakfast' | 'cat.drinks' | 'cat.sides';
}

export interface MenuItem {
  id: string;
  category: CategoryId;
  /** Dish names are menu data, so they live here per language rather than in i18n.ts */
  name: Record<Lang, string>;
  /** Price in ETB, VAT included (what the customer pays) */
  price: number;
}

export const VAT_RATE = 0.15;
export const CASHIER_NAME = 'Selam Tesfaye';
export const TABLE_COUNT = 20;
export const FIRST_CHECK_NO = 16;

export const CATEGORIES: Category[] = [
  { id: 'mains', labelKey: 'cat.mains' },
  { id: 'breakfast', labelKey: 'cat.breakfast' },
  { id: 'drinks', labelKey: 'cat.drinks' },
  { id: 'sides', labelKey: 'cat.sides' },
];

/** Demo menu; in live mode it is replaced by the branch menu from the backend. */
export const MENU: MenuItem[] = [
  // Mains
  { id: 'kitfo', category: 'mains', name: { en: 'Kitfo Special', am: 'ክትፎ ስፔሻል', om: 'Kitfoo Addaa' }, price: 750 },
  { id: 'doro', category: 'mains', name: { en: 'Doro Wat', am: 'ዶሮ ወጥ', om: 'Ittoo Lukkuu' }, price: 830 },
  { id: 'tibs', category: 'mains', name: { en: 'Tibs Mix', am: 'ጥብስ ሚክስ', om: 'Tibsii Makaa' }, price: 670 },
  { id: 'shiro', category: 'mains', name: { en: 'Shiro', am: 'ሽሮ', om: 'Shiroo' }, price: 320 },
  // Breakfast
  { id: 'firfir', category: 'breakfast', name: { en: 'Firfir', am: 'ፍርፍር', om: 'Firfir' }, price: 250 },
  { id: 'ful', category: 'breakfast', name: { en: 'Ful', am: 'ፉል', om: 'Fuul' }, price: 230 },
  { id: 'chechebsa', category: 'breakfast', name: { en: 'Chechebsa', am: 'ጨጨብሳ', om: 'Caccabsaa' }, price: 280 },
  // Drinks
  { id: 'buna', category: 'drinks', name: { en: 'Buna (Coffee)', am: 'ቡና', om: 'Buna' }, price: 70 },
  { id: 'shai', category: 'drinks', name: { en: 'Shai (Tea)', am: 'ሻይ', om: 'Shaayii' }, price: 45 },
  { id: 'spris', category: 'drinks', name: { en: 'Spris Juice', am: 'ስፕሪስ ጭማቂ', om: 'Cuunfaa Ispiriis' }, price: 140 },
  // Sides
  { id: 'injera', category: 'sides', name: { en: 'Extra Injera', am: 'ተጨማሪ እንጀራ', om: 'Biddeena dabalataa' }, price: 35 },
  { id: 'ayib', category: 'sides', name: { en: 'Ayib', am: 'አይብ', om: 'Itittuu (Ayib)' }, price: 105 },
];

export function findItem(id: string): MenuItem | undefined {
  return MENU.find((m) => m.id === id);
}

const moneyFmt = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** 1234.5 -> "1,234.50" (Western digits are standard on Ethiopian receipts) */
export function formatMoney(n: number): string {
  return moneyFmt.format(n);
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
