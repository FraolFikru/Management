"""POS / order taking — the surface that feeds the KDS (no existing frontend yet; ffii-main is the owner dashboard)."""
from __future__ import annotations

from typing import Literal

from fastapi import APIRouter
from pydantic import BaseModel, Field

from .. import services as s
from . import Db, Depends, Principal, branch_of, get_db, require

router = APIRouter(tags=["pos"])


class ModifierIn(BaseModel):
    modifier_id: str | None = None
    name: str | None = None
    note: str | None = None


class LineIn(BaseModel):
    menu_item_id: str
    quantity: float = Field(default=1, gt=0)
    modifiers: list[ModifierIn] = []
    note: str | None = None
    course: int = 1


class OrderIn(BaseModel):
    orderType: Literal["DINE_IN", "TAKEOUT", "DELIVERY"]
    tableNumber: str | None = None
    customerName: str | None = None
    lines: list[LineIn]
    sendNow: bool = True
    clientRef: str | None = None


class PaymentIn(BaseModel):
    method: Literal["CASH", "TELEBIRR", "CBE_BIRR"]
    amount: float = Field(gt=0)
    tendered: float | None = None
    reference: str | None = None


class VoidIn(BaseModel):
    reason: str


class DayClose(BaseModel):
    date: str


@router.get("/pos/menu")
def menu(p: Principal = Depends(require("pos.sell")), db: Db = Depends(get_db)):
    return db.all("SELECT * FROM v_branch_menu WHERE branch_id = ? AND is_available ORDER BY category_code, menu_item_id", (branch_of(p),))


@router.post("/orders", status_code=201)
def create(body: OrderIn, p: Principal = Depends(require("pos.sell")), db: Db = Depends(get_db)):
    with db.tx():
        o = s.create_order(db, p.actor, branch_of(p), body.orderType, [l.model_dump() for l in body.lines],
                           body.tableNumber, body.customerName, body.clientRef)
        if body.sendNow and o["status"] == "OPEN":
            o["ticket"] = s.send_to_kitchen(db, p.actor, o["id"])
        return o


@router.post("/orders/{oid}/lines")
def add_lines(oid: str, lines: list[LineIn], p: Principal = Depends(require("pos.sell")), db: Db = Depends(get_db)):
    with db.tx():
        s.add_lines(db, p.actor, oid, [l.model_dump() for l in lines])
        return s.order_view(db, oid)


@router.post("/orders/{oid}/send")
def send(oid: str, p: Principal = Depends(require("pos.sell")), db: Db = Depends(get_db)):
    with db.tx():
        return s.send_to_kitchen(db, p.actor, oid)


@router.post("/orders/{oid}/payments")
def pay(oid: str, payments: list[PaymentIn], p: Principal = Depends(require("pos.sell")), db: Db = Depends(get_db)):
    with db.tx():
        return s.pay_order(db, p.actor, oid, [x.model_dump() for x in payments])


@router.post("/orders/{oid}/cancel")
def cancel(oid: str, p: Principal = Depends(require("pos.sell")), db: Db = Depends(get_db)):
    """Unpaid, unsent order abandoned at checkout."""
    with db.tx():
        return s.cancel_open_order(db, p.actor, oid)


@router.post("/order-lines/{lid}/void")
def void(lid: str, body: VoidIn, p: Principal = Depends(require("pos.void")), db: Db = Depends(get_db)):
    with db.tx():
        return s.void_line(db, p.actor, lid, body.reason)


@router.get("/orders")
def orders(date: str | None = None, status: str | None = None, p: Principal = Depends(require("pos.sell", "mgr.dashboard")), db: Db = Depends(get_db)):
    return db.all("""SELECT * FROM customer_order WHERE branch_id = ? AND business_date = coalesce(CAST(? AS text), business_date)
                     AND (CAST(? AS text) IS NULL OR status = ?) ORDER BY created_at DESC LIMIT 500""",
                  (branch_of(p), date, status, status))


@router.get("/orders/{oid}")
def order(oid: str, p: Principal = Depends(require("pos.sell", "mgr.dashboard")), db: Db = Depends(get_db)):
    return s.order_view(db, oid)


@router.post("/pos/day-close")
def day_close(body: DayClose, p: Principal = Depends(require("pos.day_close")), db: Db = Depends(get_db)):
    with db.tx():
        return s.close_day(db, p.actor, branch_of(p), body.date)
