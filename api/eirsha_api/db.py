"""Thin database access shared by the services.

One code path for PostgreSQL (psycopg 3) and SQLite (stdlib). SQL is written
with `?` placeholders; they are rewritten to `%s` for PostgreSQL.
Rows come back as dicts. Money comes back as Decimal on PostgreSQL and as
int/float on SQLite, so services always wrap amounts in D().
"""
from __future__ import annotations

import os
import re
import secrets
import sqlite3
import time
from contextlib import contextmanager
from datetime import datetime, timezone
from decimal import ROUND_HALF_UP, Decimal
from typing import Any, Iterator

_CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"


def new_id(prefix: str) -> str:
    """Sortable, URL-safe ID: '<prefix>_' + 26-char ULID."""
    ms = int(time.time() * 1000)
    rnd = int.from_bytes(secrets.token_bytes(10), "big")
    n = (ms << 80) | rnd
    s = "".join(_CROCKFORD[(n >> (5 * i)) & 31] for i in reversed(range(26)))
    return f"{prefix}_{s}"


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def D(x: Any) -> Decimal:
    return Decimal("0") if x is None else Decimal(str(x))


def money(x: Any) -> Decimal:
    return D(x).quantize(Decimal("0.01"), ROUND_HALF_UP)


class Db:
    """A connection plus a dialect flag. Use `with db.tx():` for each unit of work."""

    def __init__(self, conn: Any, dialect: str) -> None:
        self.conn, self.dialect = conn, dialect

    # ---- construction ----
    @classmethod
    def sqlite(cls, path: str = ":memory:") -> "Db":
        conn = sqlite3.connect(path, isolation_level=None, check_same_thread=False)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA foreign_keys = ON")
        return cls(conn, "sqlite")

    @classmethod
    def postgres(cls, dsn: str | None = None, org_id: str | None = None) -> "Db":
        import psycopg  # type: ignore[import-not-found]
        from psycopg.rows import dict_row  # type: ignore[import-not-found]

        conn = psycopg.connect(dsn or os.environ["EIRSHA_DATABASE_URL"], row_factory=dict_row, autocommit=True)
        conn.execute("SET search_path = eirsha, public")
        db = cls(conn, "postgres")
        db.org_id = org_id
        return db

    org_id: str | None = None

    @classmethod
    def from_env(cls) -> "Db":
        """PostgreSQL when EIRSHA_DATABASE_URL is set, otherwise the SQLite file in EIRSHA_SQLITE."""
        if os.environ.get("EIRSHA_DATABASE_URL"):
            return cls.postgres()
        return cls.sqlite(os.environ.get("EIRSHA_SQLITE", "eirsha.db"))

    # ---- execution ----
    def _sql(self, sql: str) -> str:
        if self.dialect == "postgres":
            return re.sub(r"\?", "%s", sql)
        return sql

    def execute(self, sql: str, params: tuple | list = ()) -> Any:
        return self.conn.execute(self._sql(sql), tuple(params))

    def all(self, sql: str, params: tuple | list = ()) -> list[dict]:
        return [dict(r) for r in self.execute(sql, params).fetchall()]

    def one(self, sql: str, params: tuple | list = ()) -> dict | None:
        r = self.execute(sql, params).fetchone()
        return dict(r) if r is not None else None

    def scalar(self, sql: str, params: tuple | list = ()) -> Any:
        r = self.execute(sql, params).fetchone()
        return None if r is None else (r[0] if not isinstance(r, dict) else next(iter(r.values())))

    def insert(self, table: str, row: dict) -> dict:
        cols = [k for k, v in row.items() if v is not None]
        self.execute(f"INSERT INTO {table} ({', '.join(cols)}) VALUES ({', '.join('?' for _ in cols)})",
                     [_param(row[c]) for c in cols])
        return row

    def update(self, table: str, key: dict, changes: dict) -> int:
        sets = ", ".join(f"{c} = ?" for c in changes)
        where = " AND ".join(f"{c} = ?" for c in key)
        if self.dialect == "sqlite" and "updated_at" not in changes and table in _HAS_UPDATED_AT:
            sets += ", updated_at = ?"
            changes = {**changes, "updated_at": now_iso()}
        cur = self.execute(f"UPDATE {table} SET {sets} WHERE {where}",
                           [_param(v) for v in changes.values()] + list(key.values()))
        return cur.rowcount

    @contextmanager
    def tx(self) -> Iterator["Db"]:
        """One transaction. On PostgreSQL also pins the tenant for row-level security."""
        if self.dialect == "postgres":
            with self.conn.transaction():
                if self.org_id:
                    self.execute("SELECT set_config('eirsha.org_id', ?, true)", (self.org_id,))
                yield self
        else:
            self.conn.execute("BEGIN IMMEDIATE")
            try:
                yield self
            except BaseException:
                self.conn.execute("ROLLBACK")
                raise
            self.conn.execute("COMMIT")

    def json(self, v: Any) -> Any:
        """JSON columns come back parsed on PostgreSQL, as text on SQLite."""
        import json
        return json.loads(v) if isinstance(v, str) else v


def _param(v: Any) -> Any:
    import json
    if isinstance(v, (dict, list)):
        return json.dumps(v, ensure_ascii=False, default=str)
    if isinstance(v, Decimal):
        return str(v)
    return v


# Tables whose updated_at PostgreSQL maintains by trigger; on SQLite the API sets it.
_HAS_UPDATED_AT = {
    "organization", "branch", "app_user", "device", "money_account", "vendor", "menu_item", "inventory_item",
    "branch_stock", "purchase", "waste_report", "dispatch_request", "expense", "customer_order", "kds_ticket",
    "bill", "employee", "attendance_record", "payroll_run", "menu_item_branch_price", "budget_line", "receipt_config",
}
