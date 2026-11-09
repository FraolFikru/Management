# Finance & Accounting — Bistro Addis

Vanilla TypeScript + Vite UI for restaurant finance in Ethiopia. Demo data is generated in the browser (no backend).

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # type-check + production build to dist/
```

## Pages
- **Profit & loss** – net revenue, total COGS, operating expenses, net profit; month to date / last month / last 3 months / fiscal year (starts 8 July). Statement vs previous period, six-month trend, prime cost.
- **Accounts payable** – supplier bills, due dates, aging, supplier balances, settlement history. Pay by Cash, Telebirr or CBE Birr; withholding applied automatically.
- **Tax & VAT** – output VAT on sales, deductible input VAT (VAT-registered supplier + receipt), blocked VAT, net payable, withholding; mark monthly returns filed.
- **Cash & reconciliation** – safe, CBE bank, Telebirr and CBE Birr balances; cash flow; daily match of register vs cash counted, bank deposit and wallet receipts.

Every save is stamped with the signed-in user and can be undone from the toast. Languages: English, Amharic, Afaan Oromoo. Pure black dark theme with blue glow on hover; light theme available.

## Rules used (check with your accountant)
- VAT 15%; monthly return due by the end of the following month.
- Withholding 3% on goods ≥ ETB 20,000 and services ≥ ETB 10,000; 30% when the supplier has no TIN.
- Business income tax 30% (estimate shown on the P&L).

## Structure
```
src/
  main.ts          entry, event delegation
  types.ts         data types
  catalog.ts       rates, categories, payment methods, accounts, users
  seed.ts          demo suppliers, sales, bills, payroll, filings, reconciliations
  store.ts         state + all calculations (P&L, VAT, aging, balances)
  i18n.ts, locales.ts   translations
  ui/              shell, shared widgets, toast, modal bus
  views/           pnl, payables, tax, cash, modals
```
