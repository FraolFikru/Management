# System Admin & Configuration — Bistro Addis

Vanilla TypeScript + Vite admin UI for Ethiopian restaurant operations. Demo data lives in the browser (no backend).

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # type-check + production build to dist/
```

## Pages
- **Store & tax** – legal name, main branch, licence number, address, phone; TIN (10 digits), VAT registration number, 15% VAT auto-calculation switch; amounts shown as ETB or Br. Changes stay in a draft with a save bar.
- **Branches & prices** – branch directory (Bole, Kazanchis, Piassa; add/edit, open/closed). Master price book: change a price for one branch or all, or apply a % update to every branch.
- **Users & roles** – user accounts (ADMIN, BRANCH_MANAGER, SALES_STAFF, KITCHEN_STAFF, INVENTORY_CLERK) and a role × module permission matrix. Locked by policy: Sales Staff only make sales and request dispatch; reports, custom expenses, price edits and stock overrides are for Branch Managers and Admins; System admin is Admins only.
- **Receipt & printer** – 80 mm / 58 mm paper, header and footer text, TIN/VAT on receipt, VAT breakdown, USB or LAN printer (IP), live print preview at the real characters-per-line.
- **Activity & backup** – activity log (sign-ins, price, role and account changes, stock overrides, settings, exports) with filters and search; export transactions, the log or users to CSV or JSON.

Header: "Logged in as" badge with user switch, global branch switch (Admins), English / Amharic / Afaan Oromoo, dark (pure black, blue glow on hover) and light themes. Non-admin users see a no-access page listing what their role can do. Every change is logged and can be undone from the toast.

## Structure
```
src/
  main.ts        entry, event delegation, access check
  types.ts       StoreProfile, RolePermissions, ReceiptConfig, UserAccount (+ Branch, MenuPrice, AuditEntry, Transaction)
  catalog.ts     roles, permissions and lock rules, menu, payment methods
  seed.ts        demo data
  store.ts       state and all writes (logged)
  i18n.ts, locales.ts
  ui/            shell, shared widgets, toast, modal bus
  views/         store, branches, access, receipt, audit, modals
```

Note: Amharic / Afaan Oromoo text for this module's new labels is not filled in yet; untranslated labels fall back to English.
