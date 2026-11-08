"""Realtime fan-out: outbox_event → WebSocket subscribers.

PostgreSQL: LISTEN eirsha_outbox (the INSERT trigger NOTIFYs the new id), plus a
            1 s poll as a safety net for missed notifications.
SQLite:     poll only.

Delivery is at-least-once. Each subscriber says which topics it wants and for
which branch; on (re)connect the KDS gets a fresh snapshot, exactly what
kitchen-display/src/feed/live.ts expects:
    {"type":"snapshot","tickets":[…]}   then   {"type":"upsert",…} / {"type":"remove",…}
Other screens (Manager review queue, Finance) can subscribe to their topics and
simply refetch on any event.
"""
from __future__ import annotations

import asyncio
import json
from collections import defaultdict
from dataclasses import dataclass, field

from fastapi import WebSocket

from .db import Db, now_iso
from . import services as s


@dataclass(eq=False)
class Subscriber:
    ws: WebSocket
    org_id: str
    branch_id: str
    topics: set[str] = field(default_factory=set)


class Hub:
    def __init__(self) -> None:
        self.subs: dict[tuple[str, str], set[Subscriber]] = defaultdict(set)

    async def join(self, db: Db, sub: Subscriber) -> None:
        self.subs[(sub.org_id, sub.branch_id)].add(sub)
        if "kds.ticket" in sub.topics:
            await sub.ws.send_text(json.dumps(s.kds_snapshot(db, sub.branch_id), default=str))

    def leave(self, sub: Subscriber) -> None:
        self.subs[(sub.org_id, sub.branch_id)].discard(sub)

    async def publish(self, ev: dict) -> None:
        payload = ev["payload"] if isinstance(ev["payload"], dict) else json.loads(ev["payload"])
        msg = json.dumps(payload if ev["topic"] == "kds.ticket" else {"topic": ev["topic"], "event": ev["event_type"], **payload}, default=str)
        targets = self.subs.get((ev["org_id"], ev["branch_id"]), set()) | self.subs.get((ev["org_id"], "*"), set())
        for sub in list(targets):
            if ev["topic"] in sub.topics or "*" in sub.topics:
                try:
                    await sub.ws.send_text(msg)
                except Exception:  # noqa: BLE001 — a dead socket is dropped; the client reconnects and gets a snapshot
                    self.leave(sub)


hub = Hub()


async def relay(db: Db, stop: asyncio.Event, poll_seconds: float = 1.0) -> None:
    """Publish unpublished outbox rows in id order, then mark them published."""
    wake = asyncio.Event()
    if db.dialect == "postgres":
        asyncio.get_running_loop().create_task(_listen(wake, stop))
    while not stop.is_set():
        rows = db.all("SELECT * FROM outbox_event WHERE published_at IS NULL ORDER BY id LIMIT 500")
        for ev in rows:
            await hub.publish(ev)
            db.update("outbox_event", {"id": ev["id"]}, {"published_at": now_iso(), "attempts": int(ev["attempts"]) + 1})
        try:
            await asyncio.wait_for(wake.wait(), timeout=poll_seconds)
        except asyncio.TimeoutError:
            pass
        wake.clear()


async def _listen(wake: asyncio.Event, stop: asyncio.Event) -> None:
    import os

    import psycopg  # type: ignore[import-not-found]

    async with await psycopg.AsyncConnection.connect(os.environ["EIRSHA_DATABASE_URL"], autocommit=True) as conn:
        await conn.execute("LISTEN eirsha_outbox")
        async for _ in conn.notifies():
            wake.set()
            if stop.is_set():
                break
