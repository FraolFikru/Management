"""One router per frontend module. Each replaces that frontend's in-memory store.ts."""
from __future__ import annotations

from datetime import date, timedelta

from fastapi import Depends

from ..auth import Principal, current, get_db, require  # noqa: F401  (re-exported for the routers)
from ..db import Db  # noqa: F401


def period_range(period: str) -> tuple[str, str]:
    """The frontends' PeriodId ("today" | "7d" | "30d") → inclusive date range."""
    today = date.today()
    days = {"today": 0, "7d": 6, "30d": 29}.get(period, 0)
    return (today - timedelta(days=days)).isoformat(), today.isoformat()


def branch_of(p: Principal) -> str:
    if not p.actor.branch_id:
        from fastapi import HTTPException
        raise HTTPException(400, "X-Branch-Id header required")
    return p.actor.branch_id


__all__ = ["Depends", "Principal", "current", "get_db", "require", "Db", "period_range", "branch_of"]
