# Bistro Addis — Branch Manager Dashboard

TypeScript (strict) + Vite, vanilla DOM. Pure black dark theme (`#000000`, neutral greys); the dark-blue glow
`rgba(30, 58, 138, 0.4)` appears only when hovering interactive cards, table rows and buttons.
English / Amharic / Afaan Oromoo switch in the header. No "Upgrade to Pro", no gold.

```bash
npm install
npm run dev      # http://localhost:5173
npm run build
```

## Screens

| Screen | What the manager does |
|---|---|
| **Overview** | Three live cards: Today's Total Sales · Pending Dispatches · Total Spoilage/Loss Value. A banner links to the Dispatch page when requests are waiting. **Low stock warning** widget. Payment reconciliation (Cash, Telebirr, CBE Birr) by shift, COGS today, latest activity. |
| **Sales** | Pure sales only. Itemized table (Item Name, Category, Units Sold, Selling Price, Total Revenue) — sortable, filter by category, search. Payment reconciliation in exactly three channels: Cash, Telebirr, CBE Birr. |
| **Dispatch** | The single page for all dispatch management. Today's summary (waiting, approved, rejected, blocked by stock); pending requests oldest first with item, requested quantity, destination, timestamp, sales staff ID, waiting time and stock impact (before → after, reorder point, "will go low" warning). **Approve Dispatch** lowers inventory immediately (blocked if stock is short); **Reject with Reason** opens a dialog. Decision history on the same page (filter Approved / Rejected). |
| **COGS purchases** | Low-stock widget on top (restock from here). Purchases in the 5 COGS categories; Approve (stock goes up) or Flag with a reason. |
| **Waste & shrinkage** | "Log waste" dialog: item selector, quantity lost, loss value (auto from cost, editable), 8 reasons (theft / other need a note), reporting staff ID. |
| **Branch expenses** | Fast form for petty-cash runs and misc costs with a custom reason. |
| **Audit trail** | Every approval, rejection, purchase review, waste log, expense, undo and user switch with staff ID and time. |

## Low-stock detection

`store.ts` → `isLowStock(item)` is the single rule: **`currentQuantity <= reorderPoint`**.
`lowStock()` recomputes from live quantities on every render, so the warning updates the moment
a dispatch is approved, a purchase is approved or waste is logged. Levels: **Out of stock** (0),
**Critical** (≤ half the reorder point), **Low** (≤ reorder point). Each item shows a suggested
order (back to 2× the reorder point). The header shows an always-visible "N low stock" chip that
jumps to the widget.

## Accountability

Header badge: `Logged in as: Hanna Tesfaye (Branch Manager)` plus staff ID. Every write goes through
`store.ts`, which stamps `loggedBy` / `approvedBy` (staff ID) and time and adds an audit entry. Every
decision has an Undo right after.

Demo users (switch from the badge): **BM-001** Hanna Tesfaye (Branch Manager), **AD-001** Abebe Kebede (Admin).
Staff referenced in records: IC-201 Dawit Alemu (Inventory Clerk), SS-104 Meron Girma, SS-117 Chaltu Bekele,
SS-122 Yonas Tadesse (Sales Staff).

## Code map

```
src/
  types.ts        spec interfaces unchanged (UserSession, DispatchRequest, WasteReportRecord, PaymentSummary …) + documented extensions
  catalog.ts      menu (sold), stock catalog in 5 COGS categories (bought), destinations, reasons, roles, staff, payment methods
  seed.ts         deterministic 30-day sample data relative to today
  store.ts        state, totals, PaymentSummary, and every write (approve/reject/flag/log) with stamping + audit
  i18n.ts         t("English text") / tk(key); locales.ts holds Amharic and Afaan Oromoo
  ui/             shell (header, nav), shared widgets, combobox, toast
  views/          overview, sales, dispatch, cogs, waste, expenses, audit, modals
```

Data is in memory (sample data regenerates on reload); language, theme and user are remembered in
`localStorage`. To connect a backend, replace the `db` arrays in `store.ts` with API calls — all writes
already go through its functions.
