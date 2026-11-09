# Bistro Ledger v3

Sales & COGS/inventory management for an Ethiopian restaurant (Bistro Addis).
Vite + strict TypeScript, no UI framework, no runtime dependencies.

## Run

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # type-check + production build into dist/
```

Sign in with one of the sample staff (demo PINs are shown on the PIN screen):

| Staff | Role | PIN | Can open |
|---|---|---|---|
| Abebe Kebede | Admin | 1111 | everything |
| Hanna Tesfaye | Manager | 2222 | everything, approves waste |
| Dawit Alemu | Inventory clerk | 3333 | Dashboard, Purchases, Waste, Other expenses |
| Meron Girma | Sales staff | 4444 | Dashboard, Sales, Waste |
| Chaltu Bekele | Sales staff | 5555 | Dashboard, Sales, Waste |

PINs are a UI stand-in. Real authentication must happen on a server.

## Modules

- **Sales** (sales only): build a ticket from the menu, change quantity or the final selling price per line,
  pick Cash / Telebirr / CBE Birr / M-Pesa / Card, complete the sale. Never touches stock purchases.
- **Purchases (COGS)**: stock items in the five COGS categories (Raw Ingredients, Beverage & Bar, Packaging &
  Disposables, Kitchen Consumables, Cleaning & Sanitation), multilingual auto-complete, quantity × unit cost
  with a two-way total, vendor and payment source.
- **Waste & shrinkage**: 8 reasons (prep waste, trim loss, over-portioning, dropped, spoilage, expired, theft, other),
  item, quantity lost, estimated loss value (auto from last purchase cost), notes (required for theft/other).
  Staff reports wait for manager approval; managers approve or reject.
- **Other expenses**: free-text reason (with suggestions from past reasons), category tag, cost, payment source.
- **Audit trail**: every sign-in, sale, purchase, waste report, approval and deletion, with the person, role and time.
  Each record also carries `loggedBy` / `reportedBy`.

The header shows "Logged in as [name] · [role]"; tap it to switch user. Language (EN · አማ · OM) and theme
(dark `#0b0f19` by default, light) switch from the header.

## Structure

```
src/
  types.ts        spec interfaces (unchanged) + extensions
  catalog.ts      menu, stock catalog, waste reasons, expense tags, roles & permissions, staff, payment methods, units
  i18n.ts         t() for UI text, tk() for catalog names
  locales.ts      Amharic + Afaan Oromoo UI strings
  store.ts        state, session, permissions, record*/log() (every write is stamped and audited), totals
  seed.ts         8 weeks of sample history
  format.ts       dates, ETB money, parsing
  ui/             shell (header, nav, sign-in), shared widgets, combobox, toast, dom helpers
  views/          dashboard, sales, purchases, waste, expenses, audit
  main.ts         routing + delegated events
  style.css       design tokens and layout
```

## Data

Records are kept in memory and regenerate on reload. Replace `db` in `store.ts` with an API-backed
repository to persist; all writes already go through `recordSale / recordPurchase / recordWaste /
recordExpense / decideWaste / removeRecord`, which stamp the user and write the audit entry.

## Translations

Every label, category, menu item, stock item, reason, tag and role is in English, Amharic and Afaan Oromoo.
Have a native speaker review them before going live.
