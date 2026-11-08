"""/auth — used by every frontend's sign-in screen (replaces the demo PIN lists in catalog.ts)."""
from __future__ import annotations

import hashlib

from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel

from ..auth import issue_tokens, verify_secret
from ..db import now_iso
from ..services import audit, Actor
from . import Db, Depends, Principal, current, get_db

router = APIRouter(prefix="/auth", tags=["auth"])


class PasswordLogin(BaseModel):
    username: str
    password: str
    branchId: str | None = None


class PinLogin(BaseModel):
    staffCode: str          # "SS-104" — what is printed on the badge
    pin: str


class Refresh(BaseModel):
    refreshToken: str


@router.post("/login")
def login(body: PasswordLogin, db: Db = Depends(get_db)):
    with db.tx():
        u = db.one("SELECT * FROM app_user WHERE lower(username) = lower(CAST(? AS text)) AND is_active AND deleted_at IS NULL", (body.username,))
        if not u or not verify_secret(body.password, u["password_hash"]):
            if u:
                db.update("app_user", {"id": u["id"]}, {"failed_logins": int(u["failed_logins"]) + 1})
            raise HTTPException(401, "wrong username or password")
        out = issue_tokens(db, u, body.branchId or u["home_branch_id"])
        audit(db, Actor.load(db, u["id"]), "AUTH", "auth.sign_in", "session", out["sessionId"], "Signed in")
        return out


@router.post("/pin")
def pin_login(body: PinLogin, db: Db = Depends(get_db), x_device_id: str = Header(...), x_device_secret: str = Header(...)):
    """Shared terminals (POS, KDS, kiosk): the device proves itself, then the person enters a PIN."""
    with db.tx():
        dev = db.one("SELECT * FROM device WHERE id = ? AND is_active", (x_device_id,))
        if not dev or not verify_secret(x_device_secret, dev["secret_hash"]):
            raise HTTPException(401, "unknown device")
        u = db.one("SELECT * FROM app_user WHERE org_id = ? AND staff_code = ? AND is_active AND deleted_at IS NULL",
                   (dev["org_id"], body.staffCode))
        if not u or not verify_secret(body.pin, u["pin_hash"]):
            raise HTTPException(401, "wrong staff code or PIN")
        out = issue_tokens(db, u, dev["branch_id"], device_id=dev["id"])
        audit(db, Actor.load(db, u["id"], dev["branch_id"], dev["id"]), "AUTH", "auth.sign_in", "session", out["sessionId"], "Signed in on {device}", {"device": dev["name"]})
        return out


@router.post("/refresh")
def refresh(body: Refresh, db: Db = Depends(get_db)):
    with db.tx():
        h = hashlib.sha256(body.refreshToken.encode()).hexdigest()
        ses = db.one("SELECT * FROM auth_session WHERE refresh_token_hash = ? AND revoked_at IS NULL", (h,))
        if not ses:
            raise HTTPException(401, "session expired")
        db.update("auth_session", {"id": ses["id"]}, {"revoked_at": now_iso()})
        u = db.one("SELECT * FROM app_user WHERE id = ? AND is_active", (ses["user_id"],))
        return issue_tokens(db, u, ses["active_branch_id"], ses["device_id"])


@router.post("/logout")
def logout(p: Principal = Depends(current), db: Db = Depends(get_db)):
    with db.tx():
        db.update("auth_session", {"id": p.session_id}, {"revoked_at": now_iso()})
        audit(db, p.actor, "AUTH", "auth.sign_out", "session", p.session_id, "Signed out")
    return {"ok": True}


@router.get("/me")
def me(p: Principal = Depends(current), db: Db = Depends(get_db)):
    branches = db.all("""SELECT b.id, b.code, b.name, b.name_key FROM branch b WHERE b.org_id = ? AND b.deleted_at IS NULL
                         AND (b.id = ? OR b.id IN (SELECT branch_id FROM user_branch_role WHERE user_id = ?)
                              OR (SELECT scope FROM role WHERE code = ?) = 'ORG')""",
                      (p.actor.org_id, p.actor.branch_id, p.actor.user_id, p.actor.role))
    return {"userId": p.actor.user_id, "name": p.actor.name, "role": p.actor.role, "branchId": p.actor.branch_id,
            "permissions": sorted(p.permissions), "branches": branches}
