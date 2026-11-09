# Bistro Addis — HR & Staff Management

TypeScript (strict) + Vite, vanilla DOM. Pure black dark theme with neutral greys; the dark-blue glow
`rgba(30, 58, 138, 0.4)` appears only when hovering interactive cards, table rows and buttons.
English / Amharic / Afaan Oromoo switch in the header. No "Upgrade to Pro", no gold.

```bash
npm install
npm run dev      # http://localhost:5173
npm run build
```

## Screens

| Screen | What it does |
|---|---|
| **Today** | On shift now, late / not in yet, absent, gross pay this month; a banner when people are late and not clocked in; the live clock board; latest incidents. |
| **Staff directory** | Search, filter by role and status, add / edit (full name, phone, email, role, branch, hourly wage or monthly salary, hire date, status), view profile, deactivate / reactivate (future shifts removed). |
| **Shift planner** | Weekly grid, staff × days. Drag Morning / Day / Evening from the palette onto a cell, drag a planned shift to move it, drop it on "Remove", or click a cell to pick from a menu (touch and keyboard). Copy last week. Weekly hours with a warning above 48 h, coverage per shift against targets. Past days are locked. |
| **Attendance** | Clock in, start / end break, clock out, mark absent (optional reason → incident entry). Lateness after a 5-minute grace period, breaks, hours worked (updates live every 30 s), overtime and its multiplier. Browse past days. |
| **Payroll** | Per month: base pay (salary, or hourly rate × regular hours) + overtime × multiplier − PAYE income tax − 7% pension. Each row expands to show the working. Employer 11% pension and total labour cost. Approve / reopen with a stamp. |
| **Performance & incidents** | Scorecards (on-time %, latest rating, incidents, praise over 30 days). Log reviews (1–5), commendations, void / cancellation incidents (linked from the Branch Manager Dashboard with ticket number), lateness, disciplinary warnings, general incidents. |

## Payroll rules used (Ethiopia)

- **PAYE (monthly)**, after Income Tax Amendment Proclamation No. 1395/2025, applied from July 2025:
  0–2,000 → 0% · 2,001–4,000 → 15% − 300 · 4,001–7,000 → 20% − 500 · 7,001–10,000 → 25% − 850 ·
  10,001–14,000 → 30% − 1,350 · above 14,000 → 35% − 2,050.
- **Pension**: employee 7%, employer 11%, on base pay.
- **Overtime** (Labour Proclamation 1156/2019): over 8 h in a day ×1.5; ending after 22:00 ×1.75;
  weekly rest day (Sunday) ×2. Salaried staff's hourly rate = salary ÷ 208 h.
- Month-to-date: salaries are prorated by days elapsed; PAYE is applied on the pay scaled to a full month.
  Salaried staff are paid from their hire date.

All rules live in `src/catalog.ts` so they can be updated in one place. Check them with your accountant
before running real payroll.

## Code map

```
src/
  types.ts        spec interfaces (Employee, ShiftRecord; TipDistribution removed with tip pooling) + documented extensions
  catalog.ts      roles, branches, shift templates, coverage targets, PAYE brackets, pension, overtime, log types
  seed.ts         deterministic sample data relative to today (staff, 6-week schedule, attendance, logs)
  store.ts        state + every write (schedule, clock actions, payroll calc, logs), stamped with the user
  i18n.ts         t("English text") / tk(key); locales.ts holds Amharic and Afaan Oromoo
  ui/             shell, shared widgets, toast, modal-bus (breaks an import cycle)
  views/          today, staff, schedule, attendance, payroll, performance, modals
```

Data is in memory (sample data regenerates on reload); language, theme and user are remembered in
`localStorage`. To connect a backend, replace the `db` arrays in `store.ts` with API calls — every write
already goes through its functions.
