"""System Admin (systemadmin-main): store profile, branches, users, permissions matrix, receipt, price book, audit, exports."""
from __future__ import annotations

import csv
import io

from fastapi import APIRouter
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from .. import services as s
from ..auth import hash_secret
from ..db import new_id, now_iso
from . import Db, Depends, Principal, get_db, require

router = APIRouter(prefix="/admin", tags=["admin"])

# Admin's RolePermissions booleans ↔ permission codes (permission.legacy_flag holds the same mapping).
FLAGS = ["canViewReports", "canApproveDispatch", "canEditPrices", "canLogWaste", "canAccessAdmin",
         "canMakeSales", "canRequestDispatch", "canLogExpenses", "canOverrideInventory"]


class ProfileIn(BaseModel):
    businessName: str
    tinNumber: str
    vatNumber: str | None = None
    licenseNumber: str | None = None
    address: str | None = None
    phone: str | None = None
    vatRate: float = 15
    isVatEnabled: bool = True
    currencySymbol: str = "ETB"


class UserIn(BaseModel):
    fullName: str
    username: str
    role: str
    assignedBranchId: str
    phone: str | None = None
    isActive: bool = True
    password: str | None = None


class PriceIn(BaseModel):
    basePrice: float
    overrides: dict[str, float] = {}


class ReceiptIn(BaseModel):
    paperWidthMm: int = 80
    headerMessage: str = ""
    footerMessage: str = ""
    showTinOnReceipt: bool = True
    showVatBreakdown: bool = True


@router.get("/store-profile")
def profile(p: Principal = Depends(require("admin.access")), db: Db = Depends(get_db)):
    return db.one("SELECT * FROM organization WHERE id = ?", (p.actor.org_id,))


@router.put("/store-profile")
def save_profile(body: ProfileIn, p: Principal = Depends(require("admin.settings")), db: Db = Depends(get_db)):
    with db.tx():
        before = db.one("SELECT legal_name, tin_number, vat_rate, is_vat_enabled FROM organization WHERE id = ?", (p.actor.org_id,))
        db.update("organization", {"id": p.actor.org_id}, {"legal_name": body.businessName, "tin_number": body.tinNumber, "vat_number": body.vatNumber,
                                                           "license_number": body.licenseNumber, "address": body.address, "phone": body.phone,
                                                           "vat_rate": body.vatRate / 100, "is_vat_enabled": body.isVatEnabled,
                                                           "currency_symbol": body.currencySymbol})
        s.audit(db, p.actor, "ADMIN", "settings.change", "organization", p.actor.org_id, "Store profile updated", before=before,
                after={"legal_name": body.businessName, "tin_number": body.tinNumber, "vat_rate": body.vatRate / 100})
        return db.one("SELECT * FROM organization WHERE id = ?", (p.actor.org_id,))


@router.get("/branches")
def branches(p: Principal = Depends(require("admin.access", "owner.dashboard")), db: Db = Depends(get_db)):
    return db.all("SELECT * FROM branch WHERE org_id = ? AND deleted_at IS NULL ORDER BY opened_on", (p.actor.org_id,))


@router.get("/users")
def users(p: Principal = Depends(require("admin.users_manage", "admin.access")), db: Db = Depends(get_db)):
    return db.all("""SELECT id, staff_code, full_name, username, role_code, home_branch_id, is_active, phone, last_login_at
                     FROM app_user WHERE org_id = ? AND deleted_at IS NULL ORDER BY full_name""", (p.actor.org_id,))


@router.post("/users", status_code=201)
def add_user(body: UserIn, p: Principal = Depends(require("admin.users_manage")), db: Db = Depends(get_db)):
    with db.tx():
        uid = new_id("usr")
        db.insert("app_user", {"id": uid, "org_id": p.actor.org_id, "full_name": body.fullName, "username": body.username, "role_code": body.role,
                               "home_branch_id": body.assignedBranchId, "phone": body.phone, "is_active": body.isActive,
                               "password_hash": hash_secret(body.password) if body.password else None})
        s.audit(db, p.actor, "ADMIN", "app_user.create", "app_user", uid, "User {name} created as {role}", {"name": body.fullName, "role": body.role})
        return db.one("SELECT id, full_name, username, role_code, home_branch_id, is_active FROM app_user WHERE id = ?", (uid,))


@router.get("/permissions")
def permissions(p: Principal = Depends(require("admin.access")), db: Db = Depends(get_db)):
    """Admin RolePermissions[] (the nine booleans) + the full code list for finer control."""
    grants = {(r["role_code"], r["permission_code"]) for r in db.all("SELECT role_code, permission_code FROM role_permission WHERE org_id = ?", (p.actor.org_id,))}
    flag_code = {r["legacy_flag"]: r["code"] for r in db.all("SELECT code, legacy_flag FROM permission WHERE legacy_flag IS NOT NULL")}
    roles = [r["code"] for r in db.all("SELECT code FROM role ORDER BY sort_order")]
    return {"matrix": [{"role": r, **{f: (r, flag_code[f]) in grants for f in FLAGS}} for r in roles],
            "grants": sorted(f"{r}:{c}" for r, c in grants)}


@router.put("/permissions/{role}/{code}")
def set_permission(role: str, code: str, granted: bool, p: Principal = Depends(require("admin.roles_manage")), db: Db = Depends(get_db)):
    with db.tx():
        if granted:
            if not db.scalar("SELECT 1 FROM role_permission WHERE org_id = ? AND role_code = ? AND permission_code = ?", (p.actor.org_id, role, code)):
                db.insert("role_permission", {"org_id": p.actor.org_id, "role_code": role, "permission_code": code, "granted_by": p.actor.user_id})
        else:
            if role == "ADMIN" and code == "admin.access":
                raise s.Conflict("ADMIN must keep admin.access")
            db.execute("DELETE FROM role_permission WHERE org_id = ? AND role_code = ? AND permission_code = ?", (p.actor.org_id, role, code))
        s.audit(db, p.actor, "ADMIN", "role_permission.change", "role_permission", f"{role}:{code}", "{role}: {code} {state}",
                {"role": role, "code": code, "state": "granted" if granted else "revoked"})
    return {"ok": True}


@router.put("/menu-prices/{item_id}")
def set_price(item_id: str, body: PriceIn, p: Principal = Depends(require("menu.price_edit")), db: Db = Depends(get_db)):
    with db.tx():
        before = db.scalar("SELECT base_price FROM menu_item WHERE id = ? AND org_id = ?", (item_id, p.actor.org_id))
        db.update("menu_item", {"id": item_id}, {"base_price": body.basePrice})
        db.execute("DELETE FROM menu_item_branch_price WHERE menu_item_id = ?", (item_id,))
        for br, price in body.overrides.items():
            db.insert("menu_item_branch_price", {"org_id": p.actor.org_id, "menu_item_id": item_id, "branch_id": br, "price": price, "updated_by": p.actor.user_id})
        s.audit(db, p.actor, "ADMIN", "menu_item.price_change", "menu_item", item_id, "Price of {item} changed {from} → {to}",
                {"item": item_id, "from": str(before), "to": body.basePrice, "overrides": body.overrides})
        return db.all("SELECT * FROM v_branch_menu WHERE menu_item_id = ?", (item_id,))


@router.put("/receipt/{branch}")
def receipt(branch: str, body: ReceiptIn, p: Principal = Depends(require("admin.settings")), db: Db = Depends(get_db)):
    with db.tx():
        db.update("receipt_config", {"branch_id": branch}, {"paper_width_mm": body.paperWidthMm, "header_message": body.headerMessage,
                                                            "footer_message": body.footerMessage, "show_tin": body.showTinOnReceipt,
                                                            "show_vat_breakdown": body.showVatBreakdown, "updated_by": p.actor.user_id})
        s.audit(db, p.actor, "ADMIN", "settings.change", "receipt_config", branch, "Receipt layout updated", branch_id=branch)
        return db.one("SELECT * FROM receipt_config WHERE branch_id = ?", (branch,))


@router.get("/audit")
def audit_log(module: str | None = None, entity_type: str | None = None, entity_id: str | None = None, limit: int = 300,
              p: Principal = Depends(require("audit.view")), db: Db = Depends(get_db)):
    return db.all("""SELECT * FROM audit_log WHERE org_id = ? AND (CAST(? AS text) IS NULL OR module = ?)
                     AND (CAST(? AS text) IS NULL OR entity_type = ?) AND (CAST(? AS text) IS NULL OR entity_id = ?)
                     ORDER BY occurred_at DESC LIMIT ?""",
                  (p.actor.org_id, module, module, entity_type, entity_type, entity_id, entity_id, min(limit, 2000)))


@router.get("/exports/transactions.csv")
def export_transactions(frm: str, to: str, p: Principal = Depends(require("export.run")), db: Db = Depends(get_db)):
    """Admin's Transaction export, now computed from real POS orders."""
    rows = db.all("""SELECT o.id, o.receipt_no, o.paid_at, o.branch_id, o.opened_by AS cashier_id,
                     (SELECT payment_method_code FROM order_payment WHERE order_id = o.id ORDER BY amount DESC LIMIT 1) AS method,
                     (SELECT count(*) FROM order_line WHERE order_id = o.id AND status = 'ACTIVE') AS items,
                     o.total_net AS subtotal, o.vat_amount AS vat, o.total_gross AS total
                     FROM customer_order o WHERE o.org_id = ? AND o.status = 'PAID' AND o.business_date BETWEEN ? AND ?
                     ORDER BY o.paid_at""", (p.actor.org_id, frm, to))
    with db.tx():
        s.audit(db, p.actor, "ADMIN", "export.run", "export", None, "Exported {n} transactions", {"n": len(rows), "from": frm, "to": to})
    buf = io.StringIO()
    w = csv.DictWriter(buf, fieldnames=list(rows[0]) if rows else ["id"])
    w.writeheader()
    w.writerows(rows)
    return StreamingResponse(iter([buf.getvalue()]), media_type="text/csv",
                             headers={"Content-Disposition": f'attachment; filename="transactions_{frm}_{to}.csv"'})
