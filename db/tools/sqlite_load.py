#!/usr/bin/env python3
"""Apply SQL files to a SQLite database (no sqlite3 CLI needed).

    python3 db/tools/sqlite_load.py eirsha.db db/sqlite/001_schema.sql db/sqlite/002_views.sql [more.sql …]
"""
import sqlite3
import sys


def main() -> None:
    db, *files = sys.argv[1:]
    con = sqlite3.connect(db)
    con.execute("PRAGMA foreign_keys = ON")
    for f in files:
        with open(f, encoding="utf-8") as fh:
            con.executescript(fh.read())
        print(f"applied {f}")
    bad = con.execute("PRAGMA foreign_key_check").fetchall()
    if bad:
        raise SystemExit(f"foreign key violations: {bad[:5]}")
    con.commit()
    n = con.execute("SELECT count(*) FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").fetchone()[0]
    v = con.execute("SELECT count(*) FROM sqlite_master WHERE type='view'").fetchone()[0]
    print(f"ok: {n} tables, {v} views")


if __name__ == "__main__":
    main()
