"""Authentication & authorisation.

People sign in with username + password (back office) or staff code + PIN on a
registered device (POS, KDS, clock-in kiosk). Both get a short-lived JWT access
token plus a refresh session row (auth_session). Every request names the branch
it works on (`X-Branch-Id`); permissions are resolved per (user, branch) from
v_user_permission, which combines the user's primary role and any extra
user_branch_role rows, using the org's role_permission matrix (Admin → Access).
"""
from __future__ import annotations

import hashlib
import hmac
import os
import secrets
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Callable

import jwt
from fastapi import Depends, Header, HTTPException, Request

from .db import Db, new_id, now_iso
from .services import Actor

SECRET = os.environ.get("EIRSHA_JWT_SECRET", "dev-only-change-me")
ACCESS_TTL = timedelta(minutes=15)
REFRESH_TTL = timedelta(days=14)
DEVICE_PIN_TTL = timedelta(hours=12)       # a PIN session on a shared terminal


# ---------------------------------------------------------------- hashing (PHC strings)

def hash_secret(secret: str) -> str:
    salt = secrets.token_bytes(16)
    h = hashlib.scrypt(secret.encode(), salt=salt, n=2**14, r=8, p=1, dklen=32)
    return f"$scrypt$ln=14,r=8,p=1${salt.hex()}${h.hex()}"


def verify_secret(secret: str, phc: str | None) -> bool:
    if not phc or not phc.startswith("$scrypt$"):
        return False          # add argon2id here when argon2-cffi is installed
    _, _, params, salt, digest = phc.split("$")
    p = dict(kv.split("=") for kv in params.split(","))
    h = hashlib.scrypt(secret.encode(), salt=bytes.fromhex(salt), n=2 ** int(p["ln"]), r=int(p["r"]), p=int(p["p"]), dklen=32)
    return hmac.compare_digest(h.hex(), digest)


# ---------------------------------------------------------------- tokens

def issue_tokens(db: Db, user: dict, branch_id: str | None, device_id: str | None = None) -> dict:
    refresh = secrets.token_urlsafe(32)
    sid = new_id("ses")
    ttl = DEVICE_PIN_TTL if device_id else REFRESH_TTL
    db.insert("auth_session", {"id": sid, "user_id": user["id"], "device_id": device_id, "active_branch_id": branch_id,
                               "refresh_token_hash": hashlib.sha256(refresh.encode()).hexdigest(),
                               "expires_at": (datetime.now(timezone.utc) + ttl).isoformat()})
    now = datetime.now(timezone.utc)
    claims = {"sub": user["id"], "org": user["org_id"], "role": user["role_code"], "sid": sid, "br": branch_id,
              "dev": device_id, "iat": now, "exp": now + ACCESS_TTL}
    db.update("app_user", {"id": user["id"]}, {"last_login_at": now_iso(), "failed_logins": 0})
    return {"accessToken": jwt.encode(claims, SECRET, algorithm="HS256"), "refreshToken": refresh, "sessionId": sid,
            "user": {"id": user["id"], "name": user["full_name"], "role": user["role_code"], "branchId": branch_id,
                     "staffCode": user["staff_code"], "initials": user["initials"], "language": user["preferred_language"]}}


@dataclass
class Principal:
    actor: Actor
    session_id: str
    permissions: frozenset[str]


def get_db(request: Request) -> Db:          # replaced in main.py with a pooled, per-request connection
    return request.state.db


def current(db: Db = Depends(get_db), authorization: str = Header(...),
            x_branch_id: str | None = Header(default=None)) -> Principal:
    if not authorization.lower().startswith("bearer "):
        raise HTTPException(401, "missing bearer token")
    try:
        c = jwt.decode(authorization[7:], SECRET, algorithms=["HS256"])
    except jwt.PyJWTError as e:
        raise HTTPException(401, f"invalid token: {e}") from e
    if db.scalar("SELECT revoked_at FROM auth_session WHERE id = ?", (c["sid"],)):
        raise HTTPException(401, "session revoked")
    branch = x_branch_id or c.get("br")
    db.org_id = c["org"]                                  # row-level security tenant for this request
    perms = frozenset(r["permission_code"] for r in db.all(
        """SELECT permission_code FROM v_user_permission
           WHERE user_id = ? AND (branch_id = ? OR branch_id IS NULL OR (SELECT scope FROM role WHERE code = ?) = 'ORG')""",
        (c["sub"], branch, c["role"])))
    if branch and not perms:
        raise HTTPException(403, "no access to this branch")
    actor = Actor.load(db, c["sub"], branch, c.get("dev"))
    return Principal(actor, c["sid"], perms)


def require(*codes: str) -> Callable[[Principal], Principal]:
    """Route guard: `Depends(require("purchase.review"))`. Any one of the codes is enough."""
    def guard(p: Principal = Depends(current)) -> Principal:
        if not p.permissions.intersection(codes):
            raise HTTPException(403, f"needs one of: {', '.join(codes)}")
        return p
    return guard


OWNER = "OWNER"
PROTECTED_ROLES = frozenset({"OWNER", "ADMIN"})     # only the Owner creates or changes these accounts


def require_owner(*codes: str) -> Callable[[Principal], Principal]:
    """The Owner app is the Owner's alone. Checked on the role, not on permissions,
    so no permission change made in the Admin app can open it to anyone else."""
    def guard(p: Principal = Depends(current)) -> Principal:
        if p.actor.role != OWNER:
            raise HTTPException(403, "only the Owner can open this")
        if codes and not p.permissions.intersection(codes):
            raise HTTPException(403, f"needs one of: {', '.join(codes)}")
        return p
    return guard
