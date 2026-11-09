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
  /** Price in ETB, VAT exclusive */
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

export const MENU: MenuItem[] = [
  // Mains
  { id: 'kitfo', category: 'mains', name: { en: 'Kitfo Special', am: 'ክትፎ ስፔሻል' }, price: 650 },
  { id: 'doro', category: 'mains', name: { en: 'Doro Wat', am: 'ዶሮ ወጥ' }, price: 720 },
  { id: 'tibs', category: 'mains', name: { en: 'Tibs Mix', am: 'ጥብስ ሚክስ' }, price: 580 },
  { id: 'shiro', category: 'mains', name: { en: 'Shiro', am: 'ሽሮ' }, price: 280 },
  // Breakfast
  { id: 'firfir', category: 'breakfast', name: { en: 'Firfir', am: 'ፍርፍር' }, price: 220 },
  { id: 'ful', category: 'breakfast', name: { en: 'Ful', am: 'ፉል' }, price: 200 },
  { id: 'chechebsa', category: 'breakfast', name: { en: 'Chechebsa', am: 'ጨጨብሳ' }, price: 240 },
  // Drinks
  { id: 'buna', category: 'drinks', name: { en: 'Buna (Coffee)', am: 'ቡና' }, price: 60 },
  { id: 'shai', category: 'drinks', name: { en: 'Shai (Tea)', am: 'ሻይ' }, price: 40 },
  { id: 'spris', category: 'drinks', name: { en: 'Spris Juice', am: 'ስፕሪስ ጭማቂ' }, price: 120 },
  // Sides
  { id: 'injera', category: 'sides', name: { en: 'Extra Injera', am: 'ተጨማሪ እንጀራ' }, price: 30 },
  { id: 'ayib', category: 'sides', name: { en: 'Ayib', am: 'አይብ' }, price: 90 },
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
