"""System Admin (systemadmin-main): store profile, branches, users, permissions matrix, receipt, price book, audit, exports."""
from __future__ import annotations

import csv
import io
from datetime import date, timedelta

from fastapi import APIRouter
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

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
    branchName: str | None = None          # the Admin form's display name → organization.trade_name


class UserIn(BaseModel):
    id: str | None = None                  # the Admin app may choose the id (so its undo works offline)
    fullName: str
    username: str
    role: str
    assignedBranchId: str
    phone: str | None = None
    isActive: bool = True
    password: str | None = Field(default=None, min_length=8)


class BranchIn(BaseModel):
    id: str | None = None
    name: str
    code: str
    address: str | None = None
    phone: str | None = None
    managerId: str | None = None
    isActive: bool = True


class ReceiptAllIn(BaseModel):
    paperWidthMm: int = 80
    headerMessage: str = ""
    footerMessage: str = ""
    showTinOnReceipt: bool = True
    showVatBreakdown: bool = True
    printerName: str | None = None
    connection: str | None = None
    printerIp: str | None = None


class ExportLogIn(BaseModel):
    what: str
    format: str
    rows: int


class PriceIn(BaseModel):
    basePrice: float
    overrides: dict[str, float] = {}


class ReceiptIn(BaseModel):
    paperWidthMm: int = 80
    headerMessage: str = ""
    footerMessage: str = ""
    showTinOnReceipt: bool = True
    showVatBreakdown: bool = True


# ---------- one call that fills the Admin app (same shapes as systemadmin types.ts) ----------

def _audit_kind(action: str) -> str | None:
    if action.startswith("auth."):
        return "LOGIN"
    if action.startswith("menu_item.price") or action.startswith("menu_item."):
        return "PRICE"
    if action.startswith("role_permission."):
        return "ROLE"
    if action.startswith(("app_user.", "employee.")):
        return "USER"
    if action.startswith(("settings.", "organization.", "receipt_config.")):
        return "SETTINGS"
    if action.startswith("branch."):
        return "BRANCH"
    if action.startswith("export."):
        return "EXPORT"
    if action.startswith(("branch_stock.", "stock_movement.", "inventory_item.")):
        return "INVENTORY"
    return None          # sales, kitchen, finance and HR activity live in their own apps


@router.get("/bootstrap")
def bootstrap(days: int = 90, p: Principal = Depends(require("admin.access")), db: Db = Depends(get_db)):
    org = p.actor.org_id
    o = db.one("SELECT * FROM organization WHERE id = ?", (org,))
    profile = {"id": o["id"], "businessName": o["legal_name"], "branchName": o["trade_name"] or "", "tinNumber": o["tin_number"],
               "vatNumber": o["vat_number"] or "", "address": o["address"] or "", "phone": o["phone"] or "",
               "currency": o["currency_code"], "vatRate": float(o["vat_rate"]) * 100, "isVatEnabled": bool(o["is_vat_enabled"]),
               "licenseNumber": o["license_number"] or "", "currencySymbol": o["currency_symbol"]}
    branches = [{"id": b["id"], "name": b["name"], "code": b["code"], "address": b["address"] or "", "phone": b["phone"] or "",
                 "managerId": b["manager_user_id"] or "", "isActive": bool(b["is_active"]), "openedOn": str(b["opened_on"] or "")}
                for b in db.all("SELECT * FROM branch WHERE org_id = ? AND deleted_at IS NULL ORDER BY opened_on IS NULL, opened_on, id", (org,))]
    users = [{"id": u["id"], "fullName": u["full_name"], "username": u["username"] or "", "role": u["role_code"],
              "assignedBranchId": u["home_branch_id"] or "", "isActive": bool(u["is_active"]), "phone": u["phone"] or "",
              **({"lastLoginAt": str(u["last_login_at"])} if u["last_login_at"] else {})}
             for u in db.all("SELECT * FROM app_user WHERE org_id = ? AND deleted_at IS NULL ORDER BY id", (org,))]
    flag_code = {r["legacy_flag"]: r["code"] for r in db.all("SELECT code, legacy_flag FROM permission WHERE legacy_flag IS NOT NULL")}
    grants = {(r["role_code"], r["permission_code"]) for r in db.all("SELECT role_code, permission_code FROM role_permission WHERE org_id = ?", (org,))}
    roles = [r["code"] for r in db.all("SELECT code FROM role ORDER BY sort_order")]
    permissions = [{"role": r, **{f: (r, c) in grants for f, c in flag_code.items()}} for r in roles]
    rc = db.one("""SELECT r.*, d.name AS printer_name, d.connection, d.ip_address FROM receipt_config r
                   LEFT JOIN device d ON d.id = r.printer_device_id
                   JOIN branch b ON b.id = r.branch_id WHERE r.org_id = ? ORDER BY r.printer_device_id IS NULL, b.opened_on LIMIT 1""", (org,)) or {}
    receipt = {"paperWidthMm": rc.get("paper_width_mm", 80), "headerMessage": rc.get("header_message", ""), "footerMessage": rc.get("footer_message", ""),
               "showTinOnReceipt": bool(rc.get("show_tin", True)), "showVatBreakdown": bool(rc.get("show_vat_breakdown", True)),
               "printerName": rc.get("printer_name") or "", "connection": rc.get("connection") or "USB", "printerIp": rc.get("ip_address") or ""}
    names: dict[str, dict] = {}
    for r in db.all("SELECT key, lang, text FROM i18n_text WHERE key LIKE 'menu.%' AND (org_id IS NULL OR org_id = ?) ORDER BY org_id IS NOT NULL", (org,)):
        names.setdefault(r["key"], {})[r["lang"]] = r["text"]
    overrides: dict[str, dict] = {}
    for r in db.all("SELECT menu_item_id, branch_id, price FROM menu_item_branch_price WHERE org_id = ?", (org,)):
        overrides.setdefault(r["menu_item_id"], {})[r["branch_id"]] = float(r["price"])
    prices = [{"id": m["id"], "category": "DRINK" if m["revenue_class"] == "BEVERAGE" else "FOOD", "basePrice": float(m["base_price"]),
               "overrides": overrides.get(m["id"], {}),
               "name": {"en": names.get(m["name_key"], {}).get("en", m["id"]), "am": names.get(m["name_key"], {}).get("am", ""),
                        "om": names.get(m["name_key"], {}).get("om", "")}}
              for m in db.all("""SELECT mi.id, mi.name_key, mi.base_price, mc.revenue_class FROM menu_item mi
                                 JOIN menu_category mc ON mc.code = mi.category_code
                                 WHERE mi.org_id = ? AND mi.deleted_at IS NULL AND mi.is_active ORDER BY mi.sort_order""", (org,))]
    audit = []
    for a in db.all("SELECT * FROM audit_log WHERE org_id = ? ORDER BY occurred_at DESC LIMIT 2000", (org,)):
        kind = _audit_kind(a["action"])
        if kind and len(audit) < 500:
            vars_ = db.json(a["vars"]) or {}
            audit.append({"id": str(a["id"]), "at": str(a["occurred_at"]), "userId": a["actor_user_id"] or "", "branchId": a["branch_id"] or "",
                          "kind": kind, "text": a["summary_template"],
                          "vars": {k: (v if isinstance(v, (int, float)) else str(v)) for k, v in vars_.items() if v is not None and not isinstance(v, (dict, list))}})
    since = (date.today() - timedelta(days=days)).isoformat()
    tx = [{"id": r["id"], "receiptNo": r["receipt_no"] or r["order_number"], "at": str(r["paid_at"] or r["created_at"]), "branchId": r["branch_id"],
           "cashierId": r["opened_by"], "method": r["method"] or "CASH", "items": int(r["items"] or 0), "subtotal": float(r["total_net"]),
           "vat": float(r["vat_amount"]), "total": float(r["total_gross"])}
          for r in db.all("""SELECT o.*, (SELECT payment_method_code FROM order_payment WHERE order_id = o.id AND status = 'CAPTURED' ORDER BY amount DESC LIMIT 1) AS method,
                                    (SELECT sum(quantity) FROM order_line WHERE order_id = o.id AND status = 'ACTIVE') AS items
                             FROM customer_order o WHERE o.org_id = ? AND o.status = 'PAID' AND o.business_date >= ? ORDER BY o.paid_at DESC""", (org, since))]
    return {"profile": profile, "branches": branches, "users": users, "permissions": permissions, "flagCodes": flag_code,
            "receipt": receipt, "prices": prices, "audit": audit, "transactions": tx}


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
                                                           "currency_symbol": body.currencySymbol,
                                                           **({"trade_name": body.branchName} if body.branchName else {})})
        s.audit(db, p.actor, "ADMIN", "settings.change", "organization", p.actor.org_id, "Store profile updated", before=before,
                after={"legal_name": body.businessName, "tin_number": body.tinNumber, "vat_rate": body.vatRate / 100})
        return db.one("SELECT * FROM organization WHERE id = ?", (p.actor.org_id,))


@router.get("/branches")
def branches(p: Principal = Depends(require("admin.access", "owner.dashboard")), db: Db = Depends(get_db)):
    return db.all("SELECT * FROM branch WHERE org_id = ? AND deleted_at IS NULL ORDER BY opened_on", (p.actor.org_id,))


@router.post("/branches", status_code=201)
def add_branch(body: BranchIn, p: Principal = Depends(require("admin.branches_manage")), db: Db = Depends(get_db)):
    with db.tx():
        bid = body.id or new_id("br")
        if db.scalar("SELECT 1 FROM branch WHERE org_id = ? AND upper(code) = upper(?)", (p.actor.org_id, body.code)):
            raise s.Conflict("branch code already used", code=body.code)
        db.insert("branch", {"id": bid, "org_id": p.actor.org_id, "code": body.code.upper(), "name": body.name, "address": body.address,
                             "phone": body.phone, "is_active": body.isActive, "opened_on": s.business_date(),
                             "manager_user_id": body.managerId or None})
        for c in ("STORE_ROOM", "BAR", "KITCHEN_LINE", "TAKEAWAY_COUNTER", "CATERING", "EVENT_HALL"):
            db.insert("stock_location", {"id": f"LOC-{body.code.upper()}-{c}", "org_id": p.actor.org_id, "branch_id": bid, "code": c,
                                         "name_key": f"dest.{c}", "is_store_room": c == "STORE_ROOM"})
        for kind, label in (("CASH_DRAWER", "cash drawer"), ("PETTY_CASH", "petty cash")):
            db.insert("money_account", {"id": f"ACC-{body.code.upper()}-{'DRAWER' if kind == 'CASH_DRAWER' else 'PETTY'}", "org_id": p.actor.org_id,
                                        "branch_id": bid, "kind": kind, "name": f"{body.name} {label}"})
        tmpl = db.one("SELECT * FROM receipt_config WHERE org_id = ? LIMIT 1", (p.actor.org_id,)) or {}
        db.insert("receipt_config", {"org_id": p.actor.org_id, "branch_id": bid, "paper_width_mm": tmpl.get("paper_width_mm", 80),
                                     "header_message": tmpl.get("header_message", ""), "footer_message": tmpl.get("footer_message", ""),
                                     "show_tin": tmpl.get("show_tin", True), "show_vat_breakdown": tmpl.get("show_vat_breakdown", True)})
        s.audit(db, p.actor, "ADMIN", "branch.create", "branch", bid, "Added branch {name}", {"name": body.name}, branch_id=bid)
        return db.one("SELECT * FROM branch WHERE id = ?", (bid,))


@router.put("/branches/{bid}")
def edit_branch(bid: str, body: BranchIn, p: Principal = Depends(require("admin.branches_manage")), db: Db = Depends(get_db)):
    with db.tx():
        before = db.one("SELECT name, code, address, phone, manager_user_id, is_active FROM branch WHERE id = ? AND org_id = ?", (bid, p.actor.org_id))
        if not before:
            raise s.NotFound("branch not found")
        after = {"name": body.name, "code": body.code.upper(), "address": body.address, "phone": body.phone,
                 "manager_user_id": body.managerId or None, "is_active": body.isActive}
        db.update("branch", {"id": bid}, after)
        s.audit(db, p.actor, "ADMIN", "branch.update", "branch", bid, "Edited branch {name}", {"name": body.name},
                before=before, after=after, branch_id=bid)
        return db.one("SELECT * FROM branch WHERE id = ?", (bid,))


@router.get("/users")
def users(p: Principal = Depends(require("admin.users_manage", "admin.access")), db: Db = Depends(get_db)):
    return db.all("""SELECT id, staff_code, full_name, username, role_code, home_branch_id, is_active, phone, last_login_at
                     FROM app_user WHERE org_id = ? AND deleted_at IS NULL ORDER BY full_name""", (p.actor.org_id,))


@router.post("/users", status_code=201)
def add_user(body: UserIn, p: Principal = Depends(require("admin.users_manage")), db: Db = Depends(get_db)):
    with db.tx():
        uid = body.id or new_id("usr")
        _check_username(db, p.actor.org_id, body.username, uid)
        db.insert("app_user", {"id": uid, "org_id": p.actor.org_id, "full_name": body.fullName, "username": body.username.lower(), "role_code": body.role,
                               "home_branch_id": body.assignedBranchId, "phone": body.phone, "is_active": body.isActive,
                               "initials": "".join(w[0] for w in body.fullName.split()[:2]).upper(),
                               "password_hash": hash_secret(body.password) if body.password else None})
        s.audit(db, p.actor, "ADMIN", "app_user.create", "app_user", uid, "User {name} created as {role}", {"name": body.fullName, "role": body.role})
        return db.one("SELECT id, full_name, username, role_code, home_branch_id, is_active FROM app_user WHERE id = ?", (uid,))


def _check_username(db: Db, org: str, username: str, uid: str) -> None:
    if db.scalar("SELECT 1 FROM app_user WHERE org_id = ? AND lower(username) = lower(CAST(? AS text)) AND id <> ? AND deleted_at IS NULL",
                 (org, username, uid)):
        raise s.Conflict("username already taken", username=username)


@router.put("/users/{uid}")
def edit_user(uid: str, body: UserIn, p: Principal = Depends(require("admin.users_manage")), db: Db = Depends(get_db)):
    """Edit an account; also used to deactivate/reactivate and to set a new password."""
    with db.tx():
        u = db.one("SELECT * FROM app_user WHERE id = ? AND org_id = ? AND deleted_at IS NULL", (uid, p.actor.org_id))
        if not u:
            raise s.NotFound("user not found")
        _check_username(db, p.actor.org_id, body.username, uid)
        losing_admin = u["role_code"] == "ADMIN" and u["is_active"] and (body.role != "ADMIN" or not body.isActive)
        if losing_admin and uid == p.actor.user_id:
            raise s.Conflict("you can't remove your own Admin access")
        if losing_admin and int(db.scalar("SELECT count(*) FROM app_user WHERE org_id = ? AND role_code = 'ADMIN' AND is_active AND deleted_at IS NULL",
                                          (p.actor.org_id,))) <= 1:
            raise s.Conflict("keep at least one active Admin")
        changes = {"full_name": body.fullName, "username": body.username.lower(), "role_code": body.role, "home_branch_id": body.assignedBranchId,
                   "phone": body.phone, "is_active": body.isActive}
        if body.password:
            changes["password_hash"] = hash_secret(body.password)
            changes["failed_logins"] = 0
        db.update("app_user", {"id": uid}, changes)
        if not body.isActive or body.password:      # sign them out everywhere
            db.execute("UPDATE auth_session SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL", (now_iso(), uid))
        what = ("app_user.password_reset" if body.password else
                "app_user.role_change" if body.role != u["role_code"] else
                "app_user.deactivate" if u["is_active"] and not body.isActive else
                "app_user.reactivate" if not u["is_active"] and body.isActive else "app_user.update")
        text = {"app_user.password_reset": "Set a new password for {name}", "app_user.role_change": "Changed {name}'s role: {from} → {to}",
                "app_user.deactivate": "Deactivated {name}", "app_user.reactivate": "Reactivated {name}"}.get(what, "Edited account {name}")
        s.audit(db, p.actor, "ADMIN", what, "app_user", uid, text,
                {"name": body.fullName, "from": f"role.{u['role_code']}", "to": f"role.{body.role}"}, branch_id=body.assignedBranchId,
                before={"role": u["role_code"], "active": bool(u["is_active"])}, after={"role": body.role, "active": body.isActive})
        return {"ok": True}


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


@router.put("/receipt")
def receipt_all(body: ReceiptAllIn, p: Principal = Depends(require("admin.settings")), db: Db = Depends(get_db)):
    """The Admin app has one receipt layout for the whole business: apply it to every branch."""
    with db.tx():
        db.execute("""UPDATE receipt_config SET paper_width_mm = ?, header_message = ?, footer_message = ?, show_tin = ?,
                      show_vat_breakdown = ?, updated_by = ?, updated_at = ? WHERE org_id = ?""",
                   (body.paperWidthMm, body.headerMessage, body.footerMessage, body.showTinOnReceipt, body.showVatBreakdown,
                    p.actor.user_id, now_iso(), p.actor.org_id))
        if body.printerName is not None:
            db.execute("""UPDATE device SET name = ?, connection = ?, ip_address = ? WHERE kind = 'PRINTER' AND org_id = ?
                          AND id IN (SELECT printer_device_id FROM receipt_config WHERE org_id = ?)""",
                       (body.printerName, body.connection, body.printerIp or None, p.actor.org_id, p.actor.org_id))
        s.audit(db, p.actor, "ADMIN", "settings.receipt", "receipt_config", None, "Updated receipt layout")
    return {"ok": True}


@router.post("/exports/log")
def export_log(body: ExportLogIn, p: Principal = Depends(require("export.run")), db: Db = Depends(get_db)):
    """The Admin app builds CSV/JSON exports in the browser; this records who exported what."""
    with db.tx():
        s.audit(db, p.actor, "ADMIN", "export.run", "export", None, "Exported {what} ({format}, {n} rows)",
                {"what": body.what, "format": body.format, "n": body.rows})
    return {"ok": True}


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
