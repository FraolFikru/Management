# SEER

One shared database and API for the SEER restaurant apps: Cashier, Waiter, Kitchen Display, Purchasing &
inventory, Branch Manager, Finance, HR, System Admin and the Owner dashboard.

**Who can do what.** Access runs in one chain: the **Owner** creates the **System Admins** (Owner app →
System Admins), and the System Admins create everyone else (Admin app → Users & roles). The Owner app is
the Owner's alone; System Admins can't open it, and can't create or change Owner or System Admin accounts.
The server enforces this on the role itself, so no permission change can work around it. Every app has a
Help & support page written for its role (`apps/shared/support.ts` is the master copy of the engine).

**Start with [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)**. It covers the schema by module, the ER
diagrams, the cross-module flows, the API surface, the migration plan and the auth model.
`db/seed/IMPORT_REPORT.md` lists every place where the seven demos disagreed and how each conflict was
resolved.

```
apps/                           the 9 frontends: cashier, waiter, kds, sales, manager, finance, hr, admin, owner
db/postgres/001_schema.sql      66 tables (source of truth; ownership notes on every table)
db/postgres/002_views.sql       12 read models (P&L, bill status, manager queue, permissions…)
db/sqlite/                      generated SQLite build (make sqlite-schema)
db/seed/{postgres,sqlite}/      010_reference.sql (every install) · 020_demo.sql (demo history)
db/seed/IMPORT_REPORT.md        identity merges, conflicts, missing translations
db/tools/                       pg_to_sqlite.py, sqlite_load.py
seed/node/export-frontends.mjs  runs each frontend's own generateSeed() → JSON
seed/build_seed.py              JSON → unified SQL + report
api/eirsha_api/services.py      the connection points (POS→KDS→Finance, Sales→Manager→Finance, HR→Finance)
api/eirsha_api/routes/          one router per frontend (84 endpoints)
tests/test_flows.py             end-to-end flow tests (SQLite; PostgreSQL with EIRSHA_TEST_PG)
tests/pg_checks.sql             triggers, append-only audit, RLS, NOTIFY
```

## Quick start

```bash
# SQLite demo database, no server needed
make sqlite-load                 # → eirsha.db with schema, views, reference + demo data
make test                        # 5 cross-module flow tests

# PostgreSQL
createdb eirsha
make pg-load PG=postgresql:///eirsha
make test-pg PG=postgresql:///eirsha      # needs: pip install "psycopg[binary]"

# API
pip install -r api/requirements.txt
EIRSHA_SQLITE=eirsha.db EIRSHA_JWT_SECRET=$(openssl rand -hex 32) uvicorn eirsha_api.main:app --app-dir api --reload
# or EIRSHA_DATABASE_URL=postgresql:///eirsha …   then open http://localhost:8000/docs
```

Demo sign-in: any seeded username (for example `hanna.t` or `selam.g`) with password `eirsha-demo`.
Replace these in the Admin app (Users & roles → Edit → New password) before real use; anyone can also
change their own with `POST /auth/password`.
Terminal PINs: `1111`/`2222`/`3333` for the three sales-main accounts, and `1234` for everyone else.
These are for demos only; `020_demo.sql` must not go to production.

## Connecting an app to the backend

| App | Vercel environment variables | Status |
|---|---|---|
| `apps/cashier` | `VITE_API_URL=https://eirsha-api.onrender.com` | live: sign-in, branch menu, pay (Cash / Telebirr / CBE Birr) → kitchen |
| `apps/kds` | `VITE_KDS_WS_URL=wss://eirsha-api.onrender.com/ws` · `VITE_KDS_API_URL=https://eirsha-api.onrender.com` | live: orders pushed in real time, Start / Ready / Picked up saved |
| `apps/admin` | `VITE_API_URL=https://eirsha-api.onrender.com` | live: sign-in (Admins only), store profile, branches, prices, users & passwords, permissions, receipt, activity log, exports |
| the other five | — | still on their built-in demo data |

Vite reads these at build time, so redeploy after changing them. Leave them empty to keep the demo mode.
Checkout order: the cashier creates the order, takes the payment, and only then sends it to the kitchen;
a failed payment is retried on the same order, and an abandoned one is cancelled.

## Rebuilding the seed from the frontends

```bash
make seed                       # reads apps/*; needs Node 22+ and Python 3.10+
```

This runs each module's own `catalog.ts` / `seed.ts`, so the imported data has exactly the shapes the
local stores use today.
