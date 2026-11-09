import './style.css';
import {
  CATEGORIES, MENU, VAT_RATE, CASHIER_NAME, TABLE_COUNT, FIRST_CHECK_NO,
  findItem, formatMoney, round2, type CategoryId, type MenuItem,
} from './data';
import { t, getLang, setLang, langName, type Lang } from './i18n';
import { icon } from './icons';
import {
  isLive, currentUser, signIn, signOut, loadMenu, createOrder, payOrder, sendToKitchen, cancelOrder, cartSignature,
  ApiError, type PayMethod, type PendingOrder, type SaleInput,
} from './api';

// ───────────────────────── State (in-memory only) ─────────────────────────

type OrderType = 'dine-in' | 'takeaway';
type Theme = 'light' | 'dark';
type MobileView = 'menu' | 'order';

interface OrderLine {
  itemId: string;
  qty: number;
}

interface State {
  theme: Theme;
  category: CategoryId;
  query: string;
  lines: OrderLine[];
  orderType: OrderType;
  table: number;
  checkNo: number;
  clearArmed: boolean;
  mobileView: MobileView;
  /** item id to briefly highlight on next render (tap feedback) */
  flash: string | null;
  /** payment sheet; null = closed */
  pay: { method: PayMethod; reference: string; busy: boolean; error: string } | null;
  /** one-line message after a sale */
  notice: { text: string; ok: boolean } | null;
}

const state: State = {
  theme: document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light',
  category: 'mains',
  query: '',
  lines: [],
  orderType: 'dine-in',
  table: 4,
  checkNo: FIRST_CHECK_NO,
  clearArmed: false,
  mobileView: 'menu',
  flash: null,
  pay: null,
  notice: null,
};

let clearTimer: number | undefined;
/** Live mode: the order created for the current checkout, kept so a retry never makes a second one. */
let pending: PendingOrder | null = null;

/** Cancel a created-but-unpaid order (quietly: the cashier is moving on). */
function dropPending(): void {
  if (pending && !pending.paid) void cancelOrder(pending).catch(() => {});
  pending = null;
}

// ───────────────────────── Helpers ─────────────────────────

const $ = <T extends HTMLElement>(sel: string): T => document.querySelector(sel) as T;

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

const name = (item: MenuItem): string => item.name[getLang()];
const money = (n: number): string => t('money', { amount: formatMoney(n) });

function qtyOf(itemId: string): number {
  return state.lines.find((l) => l.itemId === itemId)?.qty ?? 0;
}

function itemCount(): number {
  return state.lines.reduce((sum, l) => sum + l.qty, 0);
}

/** Prices already include VAT: the VAT is the part of the total, not added on top. */
function totals(): { subtotal: number; vat: number; total: number } {
  const total = round2(
    state.lines.reduce((sum, l) => sum + (findItem(l.itemId)?.price ?? 0) * l.qty, 0),
  );
  const vat = round2((total * VAT_RATE) / (1 + VAT_RATE));
  return { subtotal: round2(total - vat), vat, total };
}

const cashierName = (): string => currentUser()?.name ?? CASHIER_NAME;

function visibleItems(): MenuItem[] {
  const q = state.query.trim().toLowerCase();
  if (!q) return MENU.filter((m) => m.category === state.category);
  return MENU.filter((m) => m.name.en.toLowerCase().includes(q) || m.name.am.includes(q));
}

function announce(msg: string): void {
  const live = $('#live');
  live.textContent = '';
  // next frame so screen readers pick up identical repeated messages
  requestAnimationFrame(() => (live.textContent = msg));
}

function itemsLabel(n: number): string {
  return n === 1 ? t('order.item') : t('order.items', { n });
}

// ───────────────────────── Actions ─────────────────────────

function addItem(id: string): void {
  const line = state.lines.find((l) => l.itemId === id);
  if (line) line.qty += 1;
  else state.lines.push({ itemId: id, qty: 1 });
  state.flash = id;
  disarmClear();
  const item = findItem(id);
  if (item) announce(t('order.added', { item: name(item), n: qtyOf(id) }));
}

function changeQty(id: string, delta: number): void {
  const line = state.lines.find((l) => l.itemId === id);
  if (!line) return;
  line.qty += delta;
  if (line.qty <= 0) removeLine(id);
  else state.flash = id;
}

function removeLine(id: string): void {
  state.lines = state.lines.filter((l) => l.itemId !== id);
  const item = findItem(id);
  if (item) announce(t('order.removed', { item: name(item) }));
}

function disarmClear(): void {
  state.clearArmed = false;
  window.clearTimeout(clearTimer);
}

/** Two-tap clear: first tap arms (no modal), second tap within 3s clears. */
function clearOrder(): void {
  if (!state.lines.length) return;
  if (!state.clearArmed) {
    state.clearArmed = true;
    clearTimer = window.setTimeout(() => {
      state.clearArmed = false;
      renderOrder();
    }, 3000);
    return;
  }
  disarmClear();
  state.lines = [];
  announce(t('order.cleared'));
}

function charge(): void {
  if (!state.lines.length) return;
  state.pay = { method: 'CASH', reference: '', busy: false, error: '' };
  renderSheet();
}

async function confirmPayment(): Promise<void> {
  const p = state.pay;
  if (!p || p.busy) return;
  if (p.method !== 'CASH' && isLive && !p.reference.trim()) {
    p.error = t('pay.needRef');
    renderSheet();
    return;
  }
  p.busy = true;
  p.error = '';
  renderSheet();
  try {
    let n = String(state.checkNo);
    if (isLive) {
      const sale: SaleInput = {
        lines: state.lines, orderType: state.orderType, table: state.table,
        method: p.method, reference: p.reference.trim() || undefined,
      };
      if (pending && pending.signature !== cartSignature(sale)) dropPending();
      if (!pending) pending = await createOrder(sale);       // 1. order (not in the kitchen yet)
      if (!pending.paid) {
        await payOrder(pending, sale);                       // 2. money first
        pending.paid = true;
      }
      await sendToKitchen(pending);                          // 3. then the kitchen
      n = pending.orderNumber;
      pending = null;
      state.notice = { text: t('pay.done', { n }), ok: true };
      state.checkNo = Number(n) + 1 || state.checkNo + 1;
    } else {
      state.notice = { text: t('pay.doneDemo', { n }), ok: true };
      state.checkNo += 1;
    }
    state.lines = [];
    state.pay = null;
    announce(state.notice.text);
    renderSheet();
    update();
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) {
      state.pay = null;
      renderSignIn();
      return;
    }
    p.busy = false;
    p.error = t('pay.failed', { error: err instanceof Error ? err.message : String(err) });
    renderSheet();
  }
}

function renderSheet(): void {
  document.getElementById('pay-sheet')?.remove();
  const p = state.pay;
  if (!p) return;
  const { total } = totals();
  const methods: PayMethod[] = ['CASH', 'TELEBIRR', 'CBE_BIRR'];
  const sheet = document.createElement('div');
  sheet.id = 'pay-sheet';
  sheet.className = 'sheet-backdrop';
  sheet.innerHTML = `
    <div class="sheet panel" role="dialog" aria-modal="true" aria-labelledby="pay-title">
      <h2 id="pay-title" class="sheet-title">${esc(t('pay.title'))} · <span class="mono">${esc(money(total))}</span></h2>
      <div class="segmented segmented-lg" role="group" aria-label="${esc(t('pay.method'))}">
        ${methods.map((m) => `<button data-action="pay-method" data-id="${m}" aria-pressed="${p.method === m}" ${p.busy ? 'disabled' : ''}>${esc(t(`pay.${m}`))}</button>`).join('')}
      </div>
      ${p.method !== 'CASH' ? `
        <label class="field">
          <span>${esc(t('pay.reference'))}</span>
          <input id="pay-ref" class="mono" autocomplete="off" value="${esc(p.reference)}" ${p.busy ? 'disabled' : ''} />
          <small>${esc(t('pay.referenceHint'))}</small>
        </label>` : ''}
      ${p.error ? `<p class="form-error" role="alert">${esc(p.error)}</p>` : ''}
      <div class="order-actions">
        <button class="btn btn-secondary" data-action="pay-cancel" ${p.busy ? 'disabled' : ''}>${esc(t('pay.cancel'))}</button>
        <button class="btn btn-primary" data-action="pay-confirm" ${p.busy ? 'disabled' : ''}>
          ${esc(p.busy ? t('pay.sending') : t('pay.confirm', { amount: money(total) }))}
        </button>
      </div>
    </div>`;
  document.body.append(sheet);
  (sheet.querySelector<HTMLInputElement>('#pay-ref') ?? sheet.querySelector<HTMLButtonElement>('[data-action="pay-confirm"]'))?.focus();
}

// ───────────────────────── Sign-in (live mode) ─────────────────────────

function renderSignIn(message = ''): void {
  $('#app').innerHTML = `
    <main class="signin">
      <form class="panel signin-card" id="signin-form">
        <h1 class="sheet-title">${esc(t('signin.title'))}</h1>
        <label class="field"><span>${esc(t('signin.username'))}</span>
          <input name="username" autocomplete="username" autocapitalize="none" required /></label>
        <label class="field"><span>${esc(t('signin.password'))}</span>
          <input name="password" type="password" autocomplete="current-password" required /></label>
        ${message ? `<p class="form-error" role="alert">${esc(message)}</p>` : ''}
        <button class="btn btn-primary" type="submit">${esc(t('signin.submit'))}</button>
      </form>
    </main>`;
  $<HTMLInputElement>('#signin-form input[name="username"]').focus();
}

async function startLive(): Promise<void> {
  $('#app').innerHTML = `<main class="signin"><p class="panel signin-card">${esc(t('menu.loading'))}</p></main>`;
  try {
    const items = await loadMenu();
    MENU.splice(0, MENU.length, ...items);
    renderShell();
  } catch (err) {
    renderSignIn(err instanceof ApiError && err.status === 401 ? '' : t('signin.offline'));
  }
}

document.addEventListener('submit', async (e) => {
  const form = e.target as HTMLFormElement;
  if (form.id !== 'signin-form') return;
  e.preventDefault();
  const data = new FormData(form);
  const btn = form.querySelector<HTMLButtonElement>('button[type="submit"]')!;
  btn.disabled = true;
  try {
    await signIn(String(data.get('username')), String(data.get('password')));
    await startLive();
  } catch (err) {
    renderSignIn(err instanceof ApiError && err.status === 401 ? t('signin.wrong') : t('signin.offline'));
  }
});

// ───────────────────────── Render ─────────────────────────

function renderShell(): void {
  const app = $('#app');
  app.innerHTML = `
    <header class="topbar" id="topbar"></header>
    ${isLive ? '' : `<div class="test-banner" role="note">
      ${icon('alert', 20)}
      <strong>${esc(t('banner.title'))}</strong>
      <span>${esc(t('banner.text'))}</span>
    </div>`}
    <main class="cashier" data-view="${state.mobileView}">
      <section class="menu" aria-label="${esc(t('menu.label'))}">
        <div class="search">
          <span class="search-icon">${icon('search')}</span>
          <input id="search" type="search" inputmode="search" autocomplete="off"
            placeholder="${esc(t('menu.search'))}" aria-label="${esc(t('menu.search'))}"
            value="${esc(state.query)}" />
          <button class="btn-icon search-clear" data-action="clear-search"
            aria-label="${esc(t('menu.clearSearch'))}" ${state.query ? '' : 'hidden'}>${icon('close')}</button>
        </div>
        <div class="cat-tabs" id="cat-tabs" role="tablist" aria-label="${esc(t('menu.categories'))}"></div>
        <div class="grid-wrap">
          <p class="grid-caption" id="grid-caption" aria-live="polite"></p>
          <div class="item-grid" id="item-grid"></div>
        </div>
      </section>
      <aside class="panel order" id="order" aria-label="${esc(t('order.label'))}"></aside>
    </main>
    <nav class="mobile-switch" id="mobile-switch"></nav>
    <div id="live" class="sr-only" aria-live="polite"></div>
  `;
  renderTopbar();
  renderMenu();
  renderOrder();
}

function renderTopbar(): void {
  const next: Lang = getLang() === 'en' ? 'am' : 'en';
  const now = new Intl.DateTimeFormat(getLang() === 'am' ? 'am-ET' : 'en-US', {
    hour: 'numeric', minute: '2-digit',
  }).format(new Date());
  $('#topbar').innerHTML = `
    <div class="brand">
      <span class="brand-name">${esc(t('app.name'))}</span>
      <span class="badge badge-role">${esc(t('app.role'))}</span>
    </div>
    <div class="top-right">
      <span class="cashier-name" title="${esc(t('top.cashier', { name: cashierName() }))}">
        ${icon('user', 20)}<span>${esc(cashierName())}</span>
      </span>
      ${isLive ? `<button class="btn btn-ghost" data-action="signout">${esc(t('top.signOut'))}</button>` : ''}
      <time class="clock mono" id="clock">${esc(now)}</time>
      <button class="btn btn-ghost btn-lang" data-action="lang"
        aria-label="${esc(t('top.langSwitch', { lang: langName(next) }))}">${esc(t('top.langShort'))}</button>
      <button class="btn-icon" data-action="theme"
        aria-label="${esc(t(state.theme === 'dark' ? 'top.themeToLight' : 'top.themeToDark'))}">
        ${icon(state.theme === 'dark' ? 'sun' : 'moon')}
      </button>
    </div>
  `;
}

function renderMenu(): void {
  const searching = state.query.trim().length > 0;

  $('#cat-tabs').innerHTML = CATEGORIES.map((c) => {
    const selected = !searching && c.id === state.category;
    return `<button class="cat-tab" role="tab" data-action="category" data-id="${c.id}"
      style="--cat: var(--cat-${c.id})" aria-selected="${selected}">${esc(t(c.labelKey))}</button>`;
  }).join('');

  const items = visibleItems();
  const caption = $('#grid-caption');
  caption.textContent = searching
    ? items.length ? t('menu.results', { q: state.query.trim() }) : t('menu.noResults', { q: state.query.trim() })
    : '';
  caption.hidden = !searching;

  $('#item-grid').innerHTML = items.map((item) => {
    const qty = qtyOf(item.id);
    const label = t('menu.addItem', { item: name(item), price: money(item.price) })
      + (qty ? `, ${t('menu.inOrder', { n: qty })}` : '');
    return `
      <button class="item-tile${state.flash === item.id ? ' is-flash' : ''}" data-action="add" data-id="${item.id}"
        style="--cat: var(--cat-${item.category})" aria-label="${esc(label)}">
        <span class="item-name">${esc(name(item))}</span>
        <span class="item-price mono">${formatMoney(item.price)}</span>
        ${qty ? `<span class="badge badge-count" aria-hidden="true">${qty}</span>` : ''}
      </button>`;
  }).join('');
}

function renderOrder(): void {
  const { subtotal, vat, total } = totals();
  const count = itemCount();
  const empty = state.lines.length === 0;
  const where = state.orderType === 'dine-in' ? t('order.tableN', { n: state.table }) : t('order.takeaway');

  const tableOptions = Array.from({ length: TABLE_COUNT }, (_, i) => i + 1)
    .map((n) => `<option value="${n}"${n === state.table ? ' selected' : ''}>${n}</option>`)
    .join('');

  const lines = state.lines.map((line) => {
    const item = findItem(line.itemId);
    if (!item) return '';
    const n = esc(name(item));
    return `
      <li class="line${state.flash === item.id ? ' is-flash' : ''}">
        <div class="line-top">
          <span class="line-name">${n}</span>
          <span class="line-total mono">${formatMoney(item.price * line.qty)}</span>
        </div>
        <div class="line-bottom">
          <span class="line-each mono">${esc(t('order.each', { price: formatMoney(item.price) }))}</span>
          <div class="stepper" role="group" aria-label="${esc(t('order.qty'))} · ${n}">
            <button class="btn-icon" data-action="dec" data-id="${item.id}"
              aria-label="${esc(t('order.decrease', { item: name(item) }))}">${icon('minus')}</button>
            <output class="qty mono" aria-live="polite">${line.qty}</output>
            <button class="btn-icon" data-action="inc" data-id="${item.id}"
              aria-label="${esc(t('order.increase', { item: name(item) }))}">${icon('plus')}</button>
          </div>
          <button class="btn-icon btn-remove" data-action="remove" data-id="${item.id}"
            aria-label="${esc(t('order.remove', { item: name(item) }))}">${icon('trash', 22)}</button>
        </div>
      </li>`;
  }).join('');

  $('#order').innerHTML = `
    <header class="order-head">
      <div class="order-title">
        <span class="check-no mono" aria-label="${esc(t('order.check', { n: state.checkNo }))}">#${state.checkNo}</span>
        <span class="order-where">${icon(state.orderType === 'dine-in' ? 'table' : 'bag', 20)}${esc(where)}</span>
        <span class="order-count">${esc(itemsLabel(count))}</span>
      </div>
      <div class="order-controls">
        <div class="segmented" role="group" aria-label="${esc(t('order.type'))}">
          <button data-action="type" data-id="dine-in" aria-pressed="${state.orderType === 'dine-in'}">${esc(t('order.dineIn'))}</button>
          <button data-action="type" data-id="takeaway" aria-pressed="${state.orderType === 'takeaway'}">${esc(t('order.takeaway'))}</button>
        </div>
        ${state.orderType === 'dine-in' ? `
          <label class="table-pick">
            <span>${esc(t('order.table'))}</span>
            <select id="table-select" class="mono">${tableOptions}</select>
          </label>` : ''}
      </div>
    </header>

    ${state.notice ? `<p class="notice${state.notice.ok ? '' : ' is-error'}" role="status">${esc(state.notice.text)}</p>` : ''}
    <div class="order-body">
      ${empty ? `
        <div class="empty">
          <span class="empty-icon">${icon('receipt', 40)}</span>
          <p class="empty-title">${esc(t('order.emptyTitle'))}</p>
          <p class="empty-hint">${esc(t('order.emptyHint'))}</p>
        </div>` : `<ul class="lines">${lines}</ul>`}
    </div>

    <dl class="totals">
      <div class="totals-row"><dt>${esc(t('totals.net'))}</dt><dd class="mono">${formatMoney(subtotal)}</dd></div>
      <div class="totals-row"><dt>${esc(t('totals.vatIncluded'))}</dt><dd class="mono">${formatMoney(vat)}</dd></div>
      <div class="totals-row totals-total"><dt>${esc(t('totals.total'))}</dt><dd class="mono">${esc(money(total))}</dd></div>
    </dl>

    <div class="order-actions">
      <button class="btn btn-secondary${state.clearArmed ? ' is-armed' : ''}" data-action="clear" ${empty ? 'disabled' : ''}>
        ${esc(state.clearArmed ? t('action.clearConfirm') : t('action.clear'))}
      </button>
      <button class="btn btn-primary btn-charge" data-action="charge" ${empty ? 'disabled' : ''}>
        ${esc(t('action.charge', { amount: money(total) }))}
      </button>
    </div>
  `;

  $('#mobile-switch').innerHTML = `
    <div class="segmented segmented-lg">
      <button data-action="view" data-id="menu" aria-pressed="${state.mobileView === 'menu'}">${esc(t('mobile.menu'))}</button>
      <button data-action="view" data-id="order" aria-pressed="${state.mobileView === 'order'}">
        ${esc(t('mobile.order', { n: count }))}
      </button>
    </div>`;
  $('.cashier').dataset.view = state.mobileView;
}

/** Re-render the parts that depend on the order, then drop the one-shot flash. */
function update(): void {
  renderMenu();
  renderOrder();
  state.flash = null;
}

// ───────────────────────── Events (delegated) ─────────────────────────

document.addEventListener('click', (e) => {
  const el = (e.target as HTMLElement).closest<HTMLElement>('[data-action]');
  if (!el || (el as HTMLButtonElement).disabled) return;
  const id = el.dataset.id ?? '';

  switch (el.dataset.action) {
    case 'add': addItem(id); state.notice = null; break;
    case 'inc': changeQty(id, 1); break;
    case 'dec': changeQty(id, -1); break;
    case 'remove': removeLine(id); break;
    case 'clear': clearOrder(); break;
    case 'charge': charge(); return;
    case 'pay-method':
      if (state.pay) { state.pay.method = id as PayMethod; state.pay.error = ''; renderSheet(); }
      return;
    case 'pay-cancel': dropPending(); state.pay = null; renderSheet(); return;
    case 'pay-confirm': void confirmPayment(); return;
    case 'signout':
      void signOut().then(() => renderSignIn());
      return;
    case 'category':
      state.category = id as CategoryId;
      state.query = '';
      $<HTMLInputElement>('#search').value = '';
      $('.search-clear').hidden = true;
      break;
    case 'clear-search':
      state.query = '';
      $<HTMLInputElement>('#search').value = '';
      $('.search-clear').hidden = true;
      $<HTMLInputElement>('#search').focus();
      break;
    case 'type': state.orderType = id as OrderType; break;
    case 'view': state.mobileView = id as MobileView; break;
    case 'theme':
      state.theme = state.theme === 'dark' ? 'light' : 'dark';
      document.documentElement.dataset.theme = state.theme;
      renderTopbar();
      return;
    case 'lang':
      setLang(getLang() === 'en' ? 'am' : 'en');
      renderShell();
      return;
    default: return;
  }
  update();
});

document.addEventListener('input', (e) => {
  const target = e.target as HTMLElement;
  if (target.id === 'pay-ref' && state.pay) {
    state.pay.reference = (target as HTMLInputElement).value;
    state.pay.error = '';
    document.querySelector('#pay-sheet .form-error')?.remove();
    return;
  }
  if (target.id !== 'search') return;
  state.query = (target as HTMLInputElement).value;
  $('.search-clear').hidden = !state.query;
  renderMenu(); // only the grid, so the input keeps focus
});

document.addEventListener('keydown', (e) => {
  if (state.pay && !state.pay.busy) {
    if (e.key === 'Escape') { dropPending(); state.pay = null; renderSheet(); return; }
    if (e.key === 'Enter' && (e.target as HTMLElement).id === 'pay-ref') { void confirmPayment(); return; }
  }
  if (e.key === 'Escape' && (e.target as HTMLElement).id === 'search' && state.query) {
    state.query = '';
    (e.target as HTMLInputElement).value = '';
    $('.search-clear').hidden = true;
    renderMenu();
  }
});

document.addEventListener('change', (e) => {
  const target = e.target as HTMLElement;
  if (target.id === 'table-select') {
    state.table = Number((target as HTMLSelectElement).value);
    renderOrder();
    $<HTMLSelectElement>('#table-select').focus();
  }
});

// Clock: update text only
window.setInterval(() => {
  const clock = document.getElementById('clock');
  if (clock) {
    clock.textContent = new Intl.DateTimeFormat(getLang() === 'am' ? 'am-ET' : 'en-US', {
      hour: 'numeric', minute: '2-digit',
    }).format(new Date());
  }
}, 15_000);

if (!isLive) renderShell();
else if (currentUser()) void startLive();
else renderSignIn();
