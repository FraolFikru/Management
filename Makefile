# Eirsha Ops — build & check the database artefacts.
FRONTENDS ?= apps                  # the frontends in this repo (apps/sales, apps/manager, …)
PG        ?= postgresql:///eirsha  # psql connection string
SQLITE_DB ?= eirsha.db

.PHONY: sqlite-schema seed-export seed-build seed pg-load sqlite-load test test-pg

sqlite-schema:            ## regenerate SQLite DDL + views from the PostgreSQL source
	python3 db/tools/pg_to_sqlite.py db/postgres/001_schema.sql > db/sqlite/001_schema.sql
	python3 db/tools/pg_to_sqlite.py --views db/postgres/002_views.sql > db/sqlite/002_views.sql

seed-export:              ## run every frontend's own seed generator → seed/data/*.json
	node --no-warnings --import ./seed/node/register.mjs seed/node/export-frontends.mjs $(FRONTENDS) seed/data

seed-build:               ## JSON → portable INSERTs + IMPORT_REPORT.md
	python3 -I seed/build_seed.py seed/data db/seed

seed: seed-export seed-build

pg-load:                  ## fresh load into PostgreSQL
	for f in db/postgres/001_schema.sql db/postgres/002_views.sql db/seed/postgres/010_reference.sql db/seed/postgres/020_demo.sql; do \
	  psql "$(PG)" -v ON_ERROR_STOP=1 -q -f $$f || exit 1; done

sqlite-load:              ## fresh load into SQLite
	rm -f $(SQLITE_DB)
	python3 db/tools/sqlite_load.py $(SQLITE_DB) db/sqlite/001_schema.sql db/sqlite/002_views.sql db/seed/sqlite/010_reference.sql db/seed/sqlite/020_demo.sql

test:                     ## cross-module flow tests (SQLite); PostgreSQL behaviour checks need a loaded PG
	python3 -I tests/test_flows.py

test-pg: pg-load          ## flow tests on PostgreSQL (psycopg) + trigger/RLS/NOTIFY checks
	EIRSHA_TEST_PG="$(PG)" python3 tests/test_flows.py
	$(MAKE) pg-load
	psql "$(PG)" -v ON_ERROR_STOP=1 -f tests/pg_checks.sql
