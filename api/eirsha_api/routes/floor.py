"""Table service — the Waiter app (apps/waiter). The Cashier reads the same floor to take payment.

  GET  /floor                         tables with status, guests, time open, total, waiter
  GET  /floor/menu                    menu, categories and modifiers in three languages
  POST /floor/tables/{id}/open        {id, guests}            open a check on a free table
  GET  /floor/orders/{id}             the check, each item with its kitchen state
  POST /floor/orders/{id}/items       {lines, fire}           add items; fire = ALL | NONE | [courses]
  POST /floor/orders/{id}/fire        {course?, lineIds?}     send held items
  POST /floor/lines/{id}/remove       {reason?}               take off a held item / void a sent one
  POST /floor/orders/{id}/served      {lineIds?}              food reached the table
  POST /floor/orders/{id}/bill        {requested}             "ready for bill" (and back)
  PUT  /floor/orders/{id}             {guests?, note?}
  POST /floor/orders/{id}/transfer    {waiterId?, tableId?}
  POST /floor/orders/{id}/payments    [{method, amount, reference}]   waiters: Telebirr / CBE Birr only
  POST /floor/orders/{id}/close       {reason?}               free a table with nothing on its check
  POST /floor/tables                  {names, seats}          managers: add tables
  PUT  /floor/tables/{id}             {name?, seats?, active?}

Writes accept an Idempotency-Key header: a retry (poor network on the floor) returns the first answer.
"""
from __future__ import annotations

import hashlib
import json
from typing import Any, Callable, Literal

from fastapi import APIRouter, Header
from pydantic import BaseModel, Field

from .. import floor as f
from .. import services as s
from . import Db, Depends, Principal, branch_of, get_db, require
from .pos import ModifierIn, PaymentIn

router = APIRouter(prefix="/floor", tags=["floor"])
SELL = require("pos.sell")


def _once(db: Db, p: Principal, key: str | None, what: str, fn: Callable[[], Any]) -> Any:
    with db.tx():
        if key:
            prev = db.one("SELECT response_body FROM idempotency_key WHERE actor_id = ? AND key = ?", (p.actor.user_id, key))
            if prev:
                return db.json(prev["response_body"])
        out = fn()
        if key:
            db.insert("idempotency_key", {"key": key, "actor_id": p.actor.user_id, "method_path": what,
                                          "request_hash": hashlib.sha256(what.encode()).hexdigest(), "status_code": 200,
                                          "response_body": json.loads(json.dumps(out, default=str))})
        return out


class OpenIn(BaseModel):
    id: str | None = None
    guests: int = Field(default=2, ge=1, le=60)


class ItemIn(BaseModel):
    id: str | None = None
    menu_item_id: str
    quantity: float = Field(default=1, gt=0, le=99)
    modifiers: list[ModifierIn] = []
    note: str | None = None
    course: int = Field(default=1, ge=1, le=9)


class ItemsIn(BaseModel):
    lines: list[ItemIn] = Field(min_length=1)
    fire: Literal["ALL", "NONE"] | list[int] = "ALL"


class FireIn(BaseModel):
    course: int | None = None
    lineIds: list[str] | None = None


class RemoveIn(BaseModel):
    reason: str | None = None


class ServedIn(BaseModel):
    lineIds: list[str] | None = None


class BillIn(BaseModel):
    requested: bool = True


class CheckIn(BaseModel):
    guests: int | None = None
    note: str | None = None


class TransferIn(BaseModel):
    waiterId: str | None = None
    tableId: str | None = None


class TablesIn(BaseModel):
    names: list[str] = Field(min_length=1, max_length=80)
    seats: int = 4
    area: str | None = None


class TableEdit(BaseModel):
    name: str | None = None
    seats: int | None = None
    active: bool | None = None


@router.get("")
def floor(p: Principal = Depends(SELL), db: Db = Depends(get_db)):
    out = f.floor(db, p.actor, branch_of(p))
    out["me"] = {"id": p.actor.user_id, "name": p.actor.name, "role": p.actor.role, "canManage": f.MANAGE in p.permissions,
                 "canSetup": bool(p.permissions.intersection(f.SETUP)), "canCash": p.actor.role not in f.NO_CASH_ROLES}
    return out


@router.get("/menu")
def menu(p: Principal = Depends(SELL), db: Db = Depends(get_db)):
    return f.menu(db, p.actor, branch_of(p))


@router.post("/tables/{tid}/open")
def open_table(tid: str, body: OpenIn, p: Principal = Depends(SELL), db: Db = Depends(get_db)):
    with db.tx():
        return f.open_table(db, p.actor, branch_of(p), tid, body.guests, body.id)


@router.get("/orders/{oid}")
def order(oid: str, p: Principal = Depends(SELL), db: Db = Depends(get_db)):
    s._get(db, "customer_order", oid, p.actor.org_id)
    return f.order_view(db, oid)


@router.post("/orders/{oid}/items")
def add_items(oid: str, body: ItemsIn, p: Principal = Depends(SELL), db: Db = Depends(get_db)):
    with db.tx():                                     # idempotent by line id
        return f.add_items(db, p.actor, p.permissions, oid, [x.model_dump() for x in body.lines], body.fire)


@router.post("/orders/{oid}/fire")
def fire(oid: str, body: FireIn, p: Principal = Depends(SELL), db: Db = Depends(get_db), idempotency_key: str | None = Header(default=None)):
    return _once(db, p, idempotency_key, "fire", lambda: f.fire(db, p.actor, p.permissions, oid, body.course, body.lineIds))


@router.post("/lines/{lid}/remove")
def remove_line(lid: str, body: RemoveIn, p: Principal = Depends(SELL), db: Db = Depends(get_db), idempotency_key: str | None = Header(default=None)):
    return _once(db, p, idempotency_key, "remove", lambda: f.remove_line(db, p.actor, p.permissions, lid, body.reason))


@router.post("/orders/{oid}/served")
def served(oid: str, body: ServedIn, p: Principal = Depends(SELL), db: Db = Depends(get_db)):
    with db.tx():
        return f.mark_served(db, p.actor, p.permissions, oid, body.lineIds)


@router.post("/orders/{oid}/bill")
def bill(oid: str, body: BillIn, p: Principal = Depends(SELL), db: Db = Depends(get_db)):
    with db.tx():
        return f.request_bill(db, p.actor, p.permissions, oid, body.requested)


@router.put("/orders/{oid}")
def update_check(oid: str, body: CheckIn, p: Principal = Depends(SELL), db: Db = Depends(get_db)):
    with db.tx():
        return f.update_check(db, p.actor, p.permissions, oid, body.guests, body.note)


@router.post("/orders/{oid}/transfer")
def transfer(oid: str, body: TransferIn, p: Principal = Depends(SELL), db: Db = Depends(get_db)):
    with db.tx():
        return f.transfer(db, p.actor, p.permissions, oid, body.waiterId, body.tableId)


@router.post("/orders/{oid}/payments")
def pay(oid: str, payments: list[PaymentIn], p: Principal = Depends(SELL), db: Db = Depends(get_db), idempotency_key: str | None = Header(default=None)):
    return _once(db, p, idempotency_key, "pay", lambda: f.pay(db, p.actor, p.permissions, oid, [x.model_dump() for x in payments]))


@router.post("/orders/{oid}/close")
def close_empty(oid: str, body: RemoveIn, p: Principal = Depends(SELL), db: Db = Depends(get_db)):
    with db.tx():
        return f.close_empty(db, p.actor, p.permissions, oid, body.reason)


@router.post("/tables")
def add_tables(body: TablesIn, p: Principal = Depends(require(*f.SETUP)), db: Db = Depends(get_db)):
    with db.tx():
        return f.add_tables(db, p.actor, branch_of(p), body.names, body.seats, body.area)


@router.put("/tables/{tid}")
def edit_table(tid: str, body: TableEdit, p: Principal = Depends(require(*f.SETUP)), db: Db = Depends(get_db)):
    with db.tx():
        return f.edit_table(db, p.actor, tid, body.name, body.seats, body.active)
