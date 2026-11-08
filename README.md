# Eirsha Ops

One shared database and API for the seven Bistro Addis frontends: Sales/Inventory Clerk, Branch Manager,
Finance, HR, System Admin, Kitchen Display, and the Owner dashboard (ffii-main). The schema includes POS
tables for the order-taking screen the KDS needs.

**Start with [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)**. It covers the schema by module, the ER
diagrams, the cross-module flows, the API surface, the migration plan and the auth model.
`db/seed/IMPORT_REPORT.md` lists every place where the seven demos disagreed and how each conflict was
resolved.

```
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
Terminal PINs: `1111`/`2222`/`3333` for the three sales-main accounts, and `1234` for everyone else.
These are for demos only; `020_demo.sql` must not go to production.

## Rebuilding the seed from the frontends

```bash
make seed FRONTENDS=/path/to/unzipped/modules   # needs Node 22+ and Python 3.10+
```

This runs each module's own `catalog.ts` / `seed.ts`, so the imported data has exactly the shapes the
local stores use today.
