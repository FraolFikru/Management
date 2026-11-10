# Eirsha · Waiter

Phone-first table service for floor staff. Same backend as every other Eirsha app.

## Screens

| Screen | What it is for |
|---|---|
| Sign in | Staff code + PIN (floor roles), or username + password |
| Floor (home) | Every table: status, guests, time open, total, waiter. Filters: My tables · All · Free · Bill. Search by table or order number |
| Check → Menu | Categories, search, fasting filter, course picker; tap a dish to add it |
| Check → Check | Items grouped: New · Sending · Ready to serve · Held · In kitchen · Served · Voided, with totals |
| Sheets | Guests, item options (quantity, course, options, kitchen note), send choices, void reason, transfer, move table, table note, payment, manage tables, profile |

## Who does what

- **Waiter** owns the table: opens it, orders, sends courses, marks served, asks for the bill. May take Telebirr / CBE Birr at the table, never cash.
- **Cashier** (Sales staff) signs in to the same app, opens the **Bill** filter and takes the payment, cash included. They cannot change the order.
- **Manager / Admin** sees every table and can act on any of them; sets up and renames tables.

## Table status (worked out by the backend, most urgent first)

`BILL` bill asked for → `READY` food waiting in the kitchen → `IN_KITCHEN` → `SERVED` → `SEATED` → `FREE`

Item state: `HELD` (on the check, not fired) → `SENT` → `PREPARING` → `READY` → `SERVED`, or `VOIDED`.

## Poor network

Dishes are picked on the phone first, so taking an order never waits. Every write goes through a queue kept on
the phone and is retried with the same Idempotency key until the server answers; the menu and the last floor are
cached. The floor updates live over the backend's WebSocket (`/ws?topics=floor`) with polling underneath.

## API (all under `/floor`, see `api/eirsha_api/routes/floor.py`)

`GET /floor` · `GET /floor/menu` · `POST /floor/tables/{id}/open` · `GET /floor/orders/{id}` ·
`POST /floor/orders/{id}/items|fire|served|bill|transfer|payments|close` · `PUT /floor/orders/{id}` ·
`POST /floor/lines/{id}/remove` · `POST /floor/tables` · `PUT /floor/tables/{id}` · `POST /auth/staff-pin`

## Run

    cp .env.example .env      # VITE_API_URL=https://eirsha-api.onrender.com
    npm install && npm run dev

Deploy on Vercel as `eirsha-waiter`, root directory `apps/waiter`.
