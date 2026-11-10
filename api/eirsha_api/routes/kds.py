"""Kitchen Display — exactly the contract in kitchen-display/src/feed/live.ts.

  WS   {wsUrl}?branch=BR-BOLE&token=…          → snapshot, then upsert / remove events
  POST {api}/kds/tickets/{id}/status  {status, at, by}
  POST {api}/kds/tickets/{id}/item    {itemId, isCompleted, at, by}
  POST {api}/kds/tickets/{id}/bump    {at, by}
  POST {api}/kds/tickets/{id}/recall  {at, by}
  Headers: Idempotency-Key, X-Branch-Id.  4xx = rejected (UI rolls back), 5xx = retried.
"""
from __future__ import annotations

import hashlib
import json
from typing import Any

from fastapi import APIRouter, Header, Query, WebSocket, WebSocketDisconnect

from .. import realtime
from .. import services as s
from ..auth import SECRET
from . import Db, Depends, Principal, branch_of, get_db, require

router = APIRouter(tags=["kds"])


@router.get("/kds/tickets")
def snapshot(p: Principal = Depends(require("kds.view")), db: Db = Depends(get_db)):
    return s.kds_snapshot(db, branch_of(p))


@router.post("/kds/tickets/{ticket_id}/{cmd}")
def command(ticket_id: str, cmd: str, body: dict[str, Any], p: Principal = Depends(require("kds.update")),
            db: Db = Depends(get_db), idempotency_key: str | None = Header(default=None)):
    if cmd not in ("status", "item", "bump", "recall"):
        raise s.Invalid("unknown command", cmd=cmd)
    with db.tx():
        if idempotency_key:      # a retried request returns the first answer instead of applying twice
            prev = db.one("SELECT response_body FROM idempotency_key WHERE actor_id = ? AND key = ?", (p.actor.user_id, idempotency_key))
            if prev:
                return db.json(prev["response_body"])
        out = s.kds_command(db, p.actor, ticket_id, cmd, body)
        if idempotency_key:
            db.insert("idempotency_key", {"key": idempotency_key, "actor_id": p.actor.user_id, "method_path": f"POST /kds/tickets/{{id}}/{cmd}",
                                          "request_hash": hashlib.sha256(json.dumps(body, sort_keys=True).encode()).hexdigest(),
                                          "status_code": 200, "response_body": out})
        return out


@router.websocket("/ws")
async def ws(websocket: WebSocket, branch: str = Query(...), token: str = Query(...), topics: str = Query("kds.ticket")):
    """Browsers cannot set headers on a WebSocket, so the access token comes as a query parameter (wss only)."""
    import jwt

    try:
        claims = jwt.decode(token, SECRET, algorithms=["HS256"])
    except jwt.PyJWTError:
        await websocket.close(code=4401)
        return
    db = Db.from_env()
    allowed = db.scalar("""SELECT 1 FROM v_user_permission WHERE user_id = ? AND permission_code IN ('kds.view', 'pos.sell')
                           AND (branch_id = ? OR (SELECT scope FROM role WHERE code = ?) = 'ORG')""", (claims["sub"], branch, claims["role"]))
    if not allowed:
        db.conn.close()
        await websocket.close(code=4403)
        return
    await websocket.accept()
    sub = realtime.Subscriber(websocket, claims["org"], branch, set(topics.split(",")))
    await realtime.hub.join(db, sub)
    try:
        while True:
            await websocket.receive_text()        # client pings; nothing else is expected
    except WebSocketDisconnect:
        realtime.hub.leave(sub)
    finally:
        db.conn.close()
