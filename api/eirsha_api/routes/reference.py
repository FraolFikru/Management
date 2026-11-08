"""/ref — one bootstrap call replaces every frontend's catalog.ts reference lists."""
from __future__ import annotations

from fastapi import APIRouter

from . import Db, Depends, Principal, current, get_db

router = APIRouter(prefix="/ref", tags=["reference"])


@router.get("/bootstrap")
def bootstrap(p: Principal = Depends(current), db: Db = Depends(get_db)):
    q = lambda sql, *a: db.all(sql, a)
    org = p.actor.org_id
    return {
        "organization": db.one("SELECT id, legal_name, trade_name, currency_code, currency_symbol, vat_rate, is_vat_enabled, timezone FROM organization WHERE id = ?", (org,)),
        "languages": q("SELECT code, name_native FROM language WHERE is_active"),
        "paymentMethods": q("SELECT code, name_key, requires_reference FROM payment_method WHERE is_active ORDER BY sort_order"),
        "costCategories": q("SELECT code, kind, name_key, owner_group FROM cost_category ORDER BY sort_order"),
        "mainCategories": q("SELECT code, cost_category_code, name_key FROM inventory_main_category ORDER BY sort_order"),
        "expenseTags": q("SELECT code, cost_category_code, name_key FROM expense_tag"),
        "wasteReasons": q("SELECT code, name_key, requires_note FROM waste_reason"),
        "units": q("SELECT code, name_key, dimension FROM unit"),
        "stations": q("SELECT code, name_key FROM kitchen_station ORDER BY sort_order"),
        "menuCategories": q("SELECT code, name_key, revenue_class FROM menu_category ORDER BY sort_order"),
        "shiftTemplates": q("SELECT code, name_key, start_time, end_time, paid_hours, coverage_target FROM shift_template WHERE org_id = ? AND is_active", org),
        "roles": q("SELECT code, name_key, scope FROM role ORDER BY sort_order"),
        "stockLocations": q("SELECT code, name_key FROM stock_location WHERE branch_id = ?", p.actor.branch_id),
    }


@router.get("/i18n/{lang}")
def i18n(lang: str, p: Principal = Depends(current), db: Db = Depends(get_db)):
    """{key: text} for one language; org overrides win over platform text. Frontends feed it to registerText()."""
    rows = db.all("""SELECT key, text, org_id FROM i18n_text WHERE lang = ? AND (org_id IS NULL OR org_id = ?)
                     ORDER BY org_id IS NOT NULL""", (lang, p.actor.org_id))
    return {r["key"]: r["text"] for r in rows}
