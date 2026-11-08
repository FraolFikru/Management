#!/usr/bin/env python3
"""Generate the SQLite schema from the PostgreSQL source of truth.

    python3 db/tools/pg_to_sqlite.py db/postgres/001_schema.sql > db/sqlite/001_schema.sql

Rules (kept deliberately small so the output stays readable):
  * drops  -- @pg-begin … -- @pg-end  blocks
  * unwraps /* @sqlite-begin … @sqlite-end */ blocks
  * maps types: timestamptz/date/time/jsonb → TEXT, boolean → INTEGER,
    numeric(p,s) → NUMERIC, bigint identity PK → INTEGER PRIMARY KEY AUTOINCREMENT
  * maps defaults: now() → ISO-8601 UTC text, gen_random_uuid()::text → random hex
  * rewrites extract(day from x) = 1 → strftime('%d', x) = '01'
"""
import re
import sys

HEADER = """-- =====================================================================
--  Eirsha Ops — SQLite build (GENERATED from db/postgres/001_schema.sql).
--  Do not edit by hand: run  python3 db/tools/pg_to_sqlite.py
--  Use for local development, demos and offline branch caches.
--  Run with:  PRAGMA foreign_keys = ON;  (per connection)
--  Differences from PostgreSQL: no RLS, no LISTEN/NOTIFY (poll outbox_event),
--  updated_at is set by the API, money is NUMERIC affinity (use Decimal in code).
-- =====================================================================
PRAGMA foreign_keys = ON;
"""

SUBS = [
    (r"bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY", "INTEGER PRIMARY KEY AUTOINCREMENT"),
    (r"DEFAULT gen_random_uuid\(\)::text", "DEFAULT (lower(hex(randomblob(16))))"),
    (r"DEFAULT now\(\)", "DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))"),
    (r"extract\(day from (\w+)\) = 1", r"strftime('%d', \1) = '01'"),
    (r"\btimestamptz\b", "TEXT"),
    (r"\bjsonb\b", "TEXT"),
    (r"\bdate\b(?=\s+(NOT NULL|PRIMARY|CHECK|,|DEFAULT|$))", "TEXT"),
    (r"\btime\b(?=\s+(NOT NULL|,))", "TEXT"),
    (r"\bboolean\b", "INTEGER"),
    (r"\bnumeric\(\d+,\d+\)", "NUMERIC"),
    (r"\bbigint\b", "INTEGER"),
]


def convert(src: str) -> str:
    src = re.sub(r"-- @pg-begin.*?-- @pg-end\n?", "", src, flags=re.S)
    src = re.sub(r"/\* @sqlite-begin\n(.*?)@sqlite-end \*/", r"\1", src, flags=re.S)
    out = []
    for line in src.splitlines():
        code, sep, comment = line.partition("--")
        for pat, rep in SUBS:
            code = re.sub(pat, rep, code)
        out.append(code + sep + comment)
    body = "\n".join(out)
    # The original file header describes PostgreSQL; replace it.
    body = re.sub(r"\A(--[^\n]*\n)+\n?", "", body)
    return HEADER + "\n" + body.strip() + "\n"


VIEW_SUBS = [
    (r"SET search_path[^;]*;\n", ""),
    (r"CREATE OR REPLACE VIEW (\w+)", r"DROP VIEW IF EXISTS \1;\nCREATE VIEW \1"),
    (r"date_trunc\('month', ([\w.]+)\)(::date)?", r"strftime('%Y-%m-01', \1)"),
    (r"CURRENT_DATE \+ (\d+)", r"date('now', '+\1 days')"),
    (r"CURRENT_DATE", "date('now')"),
    (r"'(\w+)'::text", r"'\1'"),
]


def convert_views(src: str) -> str:
    for pat, rep in VIEW_SUBS:
        src = re.sub(pat, rep, src)
    src = re.sub(r"\A(--[^\n]*\n)+\n?", "", src)
    return ("-- Eirsha Ops — SQLite views (GENERATED from db/postgres/002_views.sql).\n"
            "-- Do not edit by hand: run  python3 db/tools/pg_to_sqlite.py --views\n\n" + src)


if __name__ == "__main__":
    args = sys.argv[1:]
    if args and args[0] == "--views":
        path = args[1] if len(args) > 1 else "db/postgres/002_views.sql"
        sys.stdout.write(convert_views(open(path, encoding="utf-8").read()))
    else:
        path = args[0] if args else "db/postgres/001_schema.sql"
        sys.stdout.write(convert(open(path, encoding="utf-8").read()))
