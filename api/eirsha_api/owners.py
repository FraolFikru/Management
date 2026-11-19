"""Owners: who they are, and how the list changes.

Every Owner has full control, so changing who is an Owner needs a second
Owner's agreement:

  ADD             a new account, or an existing staff member, becomes an Owner
                  (also brings back a deactivated Owner)
  REMOVE          an Owner is deactivated and signed out (at least one stays)
  RESET_PASSWORD  an Owner who forgot their password gets a new one

The Owner who asks can't approve their own request; any other active Owner
can (the Owner being removed included, so a partner who is leaving can agree).
Any other Owner can reject it. If nobody decides within WAIT_DAYS, the Owner
who asked may apply it: a partner who has disappeared can't block the
business forever. With a single Owner, adding a co-owner happens at once
(there is no one else to ask).

Owner accounts are changed only here; the Admin app can't touch them.
"""
from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone
from typing import Any

from .db import Db, new_id, now_iso
from . import services as s

WAIT_DAYS = 7
KINDS = ("ADD", "REMOVE", "RESET_PASSWORD")


def hash_secret(secret: str) -> str:
    from .auth import hash_secret as h      # imported here: keeps this module free of the web framework
    return h(secret)


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _parse(ts: Any) -> datetime | None:
    if not ts:
        return None
    if isinstance(ts, datetime):
        return ts if ts.tzinfo else ts.replace(tzinfo=timezone.utc)
    t = datetime.fromisoformat(str(ts).replace("Z", "+00:00"))
    return t if t.tzinfo else t.replace(tzinfo=timezone.utc)


def _iso(ts: Any) -> str | None:
    t = _parse(ts)
    return t.isoformat().replace("+00:00", "Z") if t else None


def active_owners(db: Db, org: str) -> list[dict]:
    return db.all("""SELECT id, full_name FROM app_user WHERE org_id = ? AND role_code = 'OWNER' AND is_active AND deleted_at IS NULL
                     ORDER BY full_name""", (org,))


def _check_owner(db: Db, actor: s.Actor) -> None:
    if actor.role != "OWNER" or not db.scalar(
            "SELECT 1 FROM app_user WHERE id = ? AND role_code = 'OWNER' AND is_active AND deleted_at IS NULL", (actor.user_id,)):
        raise s.Forbidden("only an Owner can do this")


def _username_free(db: Db, org: str, username: str) -> None:
    if db.scalar("SELECT 1 FROM app_user WHERE org_id = ? AND lower(username) = lower(CAST(? AS text)) AND deleted_at IS NULL", (org, username)):
        raise s.Conflict("username already taken", username=username)
    for r in db.all("SELECT payload FROM owner_change WHERE org_id = ? AND status = 'PENDING' AND kind = 'ADD'", (org,)):
        if (json.loads(r["payload"] or "{}").get("username") or "").lower() == username.lower():
            raise s.Conflict("username already taken", username=username)


# ---------------------------------------------------------------- asking

def request_change(db: Db, actor: s.Actor, kind: str, *, target_user_id: str | None = None, full_name: str | None = None,
                   username: str | None = None, branch_id: str | None = None, phone: str | None = None,
                   password: str | None = None) -> dict:
    _check_owner(db, actor)
    org = actor.org_id
    if kind not in KINDS:
        raise s.Invalid("unknown change", kind=kind)
    payload: dict[str, Any] = {}
    target = None
    if target_user_id:
        target = db.one("SELECT * FROM app_user WHERE id = ? AND org_id = ? AND deleted_at IS NULL", (target_user_id, org))
        if not target:
            raise s.NotFound("account not found")

    if kind == "ADD":
        if target:
            if target["role_code"] == "OWNER" and target["is_active"]:
                raise s.Conflict("already an Owner")
            if target["role_code"] != "OWNER" and not target["is_active"]:
                raise s.Invalid("this account is deactivated")
            payload = {"fromRole": target["role_code"]}
            summary = f"Make {target['full_name']} an Owner"
        else:
            name = (full_name or "").strip()
            user = (username or "").strip().lower()
            if len(name) < 2:
                raise s.Invalid("enter their full name")
            if not user or not all(c.isalnum() or c in "._-" for c in user) or not 3 <= len(user) <= 40:
                raise s.Invalid("username: 3–40 letters, numbers, dots, dashes or underscores")
            if not password or len(password) < 8:
                raise s.Invalid("the password needs at least 8 characters")
            if not branch_id or not db.scalar("SELECT 1 FROM branch WHERE org_id = ? AND id = ?", (org, branch_id)):
                raise s.Invalid("choose a home branch")
            _username_free(db, org, user)
            payload = {"fullName": name, "username": user, "branchId": branch_id, "phone": (phone or "").strip() or None,
                       "passwordHash": hash_secret(password)}
            summary = f"Add {name} (@{user}) as an Owner"
    else:
        if not target or target["role_code"] != "OWNER" or not target["is_active"]:
            raise s.Invalid("choose an active Owner")
        if kind == "REMOVE":
            if len(active_owners(db, org)) < 2:
                raise s.Conflict("keep at least one active Owner")
            summary = f"Remove {target['full_name']} as an Owner"
        else:
            if target["id"] == actor.user_id:
                raise s.Invalid("change your own password with “Change my password”")
            if not password or len(password) < 8:
                raise s.Invalid("the password needs at least 8 characters")
            payload = {"passwordHash": hash_secret(password)}
            summary = f"Set a new password for {target['full_name']}"
    if target and db.scalar("SELECT 1 FROM owner_change WHERE org_id = ? AND target_user_id = ? AND kind = ? AND status = 'PENDING'",
                            (org, target["id"], kind)):
        raise s.Conflict("there is already a request waiting for this")

    cid = new_id("own")
    now = _now()
    db.insert("owner_change", {"id": cid, "org_id": org, "kind": kind, "target_user_id": target["id"] if target else None,
                               "payload": json.dumps(payload), "summary": summary, "requested_by": actor.user_id,
                               "requested_at": now_iso(), "status": "PENDING",
                               "wait_until": (now + timedelta(days=WAIT_DAYS)).isoformat().replace("+00:00", "Z")})
    s.audit(db, actor, "OWNER", "owner_change.request", "owner_change", cid, "Asked: {summary}", {"summary": summary, "kind": kind})
    others = [o for o in active_owners(db, org) if o["id"] != actor.user_id]
    if kind == "ADD" and not others:
        # a single Owner adding a co-owner: no one else to ask
        _apply(db, actor, cid, alone=True)
    return get_change(db, org, cid)


# ---------------------------------------------------------------- deciding

def _pending(db: Db, actor: s.Actor, cid: str) -> dict:
    _check_owner(db, actor)
    r = db.one("SELECT * FROM owner_change WHERE id = ? AND org_id = ?", (cid, actor.org_id))
    if not r:
        raise s.NotFound("request not found")
    if r["status"] != "PENDING":
        raise s.Conflict("this request is already closed", status=r["status"])
    return r


def approve(db: Db, actor: s.Actor, cid: str) -> dict:
    r = _pending(db, actor, cid)
    if r["requested_by"] == actor.user_id:
        raise s.Forbidden("another Owner has to approve your request")
    _apply(db, actor, cid)
    return get_change(db, actor.org_id, cid)


def reject(db: Db, actor: s.Actor, cid: str, reason: str | None = None) -> dict:
    r = _pending(db, actor, cid)
    if r["requested_by"] == actor.user_id:
        raise s.Forbidden("cancel your own request instead")
    db.update("owner_change", {"id": cid}, {"status": "REJECTED", "decided_by": actor.user_id, "decided_at": now_iso(),
                                            "reason": (reason or "").strip() or None})
    s.audit(db, actor, "OWNER", "owner_change.reject", "owner_change", cid, "Rejected: {summary}", {"summary": r["summary"], "reason": reason})
    return get_change(db, actor.org_id, cid)


def cancel(db: Db, actor: s.Actor, cid: str) -> dict:
    r = _pending(db, actor, cid)
    if r["requested_by"] != actor.user_id:
        raise s.Forbidden("only the Owner who asked can cancel it")
    db.update("owner_change", {"id": cid}, {"status": "CANCELLED", "decided_by": actor.user_id, "decided_at": now_iso()})
    s.audit(db, actor, "OWNER", "owner_change.cancel", "owner_change", cid, "Cancelled: {summary}", {"summary": r["summary"]})
    return get_change(db, actor.org_id, cid)


def apply_after_wait(db: Db, actor: s.Actor, cid: str) -> dict:
    r = _pending(db, actor, cid)
    if r["requested_by"] != actor.user_id:
        raise s.Forbidden("only the Owner who asked can apply it")
    until = _parse(r["wait_until"])
    if until and _now() < until:
        raise s.Conflict("the other Owners still have time to decide", waitUntil=_iso(until))
    _apply(db, actor, cid, waited=True)
    return get_change(db, actor.org_id, cid)


def _apply(db: Db, actor: s.Actor, cid: str, waited: bool = False, alone: bool = False) -> None:
    r = db.one("SELECT * FROM owner_change WHERE id = ?", (cid,))
    p = json.loads(r["payload"] or "{}")
    org = r["org_id"]
    tid = r["target_user_id"]
    if r["kind"] == "ADD":
        if tid:
            u = db.one("SELECT * FROM app_user WHERE id = ?", (tid,))
            if not u or u["deleted_at"]:
                raise s.Conflict("that account no longer exists")
            db.update("app_user", {"id": tid}, {"role_code": "OWNER", "is_active": True})
            db.execute("UPDATE auth_session SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL", (now_iso(), tid))
        else:
            if db.scalar("SELECT 1 FROM app_user WHERE org_id = ? AND lower(username) = lower(CAST(? AS text)) AND deleted_at IS NULL",
                         (org, p["username"])):
                raise s.Conflict("username already taken", username=p["username"])
            tid = new_id("usr")
            from .routes.admin import _staff_code
            db.insert("app_user", {"id": tid, "org_id": org, "full_name": p["fullName"], "username": p["username"], "role_code": "OWNER",
                                   "home_branch_id": p["branchId"], "phone": p.get("phone"), "is_active": True,
                                   "initials": "".join(w[0] for w in p["fullName"].split()[:2]).upper(),
                                   "staff_code": _staff_code(db, org, "OWNER"), "password_hash": p["passwordHash"]})
            db.update("owner_change", {"id": cid}, {"target_user_id": tid})
    elif r["kind"] == "REMOVE":
        if len(active_owners(db, org)) < 2:
            raise s.Conflict("keep at least one active Owner")
        db.update("app_user", {"id": tid}, {"is_active": False})
        db.execute("UPDATE auth_session SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL", (now_iso(), tid))
    else:
        db.update("app_user", {"id": tid}, {"password_hash": p["passwordHash"], "failed_logins": 0, "locked_until": None})
        db.execute("UPDATE auth_session SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL", (now_iso(), tid))
    # the password hash isn't kept once used
    db.update("owner_change", {"id": cid}, {"status": "APPLIED", "decided_by": actor.user_id, "decided_at": now_iso(),
                                            "payload": json.dumps({k: v for k, v in p.items() if k != "passwordHash"}),
                                            "reason": "applied after the waiting period" if waited else "only Owner" if alone else None})
    s.audit(db, actor, "OWNER", "owner_change.apply", "owner_change", cid, "Done: {summary}", {"summary": r["summary"], "waited": waited})


# ---------------------------------------------------------------- reading

def _shape(r: dict, names: dict[str, str]) -> dict:
    p = json.loads(r["payload"] or "{}")
    return {"id": r["id"], "kind": r["kind"], "summary": r["summary"], "status": r["status"],
            "targetUserId": r["target_user_id"], "targetName": names.get(r["target_user_id"] or "", p.get("fullName", "")),
            "username": p.get("username"),
            "requestedBy": r["requested_by"], "requestedByName": names.get(r["requested_by"], ""), "requestedAt": _iso(r["requested_at"]),
            "waitUntil": _iso(r["wait_until"]), "decidedBy": r["decided_by"], "decidedByName": names.get(r["decided_by"] or "", ""),
            "decidedAt": _iso(r["decided_at"]), "reason": r["reason"] or ""}


def get_change(db: Db, org: str, cid: str) -> dict:
    names = {u["id"]: u["full_name"] for u in db.all("SELECT id, full_name FROM app_user WHERE org_id = ?", (org,))}
    return _shape(db.one("SELECT * FROM owner_change WHERE id = ?", (cid,)), names)


def overview(db: Db, actor: s.Actor) -> dict:
    org = actor.org_id
    names = {u["id"]: u["full_name"] for u in db.all("SELECT id, full_name FROM app_user WHERE org_id = ?", (org,))}
    owners = db.all("""SELECT id, staff_code, full_name, username, home_branch_id, phone, is_active, last_login_at, created_at
                       FROM app_user WHERE org_id = ? AND role_code = 'OWNER' AND deleted_at IS NULL
                       ORDER BY is_active DESC, full_name""", (org,))
    since = (_now() - timedelta(days=60)).isoformat().replace("+00:00", "Z")
    requests = [_shape(r, names) for r in db.all(
        "SELECT * FROM owner_change WHERE org_id = ? AND (status = 'PENDING' OR requested_at >= ?) ORDER BY requested_at DESC", (org, since))]
    staff = db.all("""SELECT id, full_name, role_code FROM app_user WHERE org_id = ? AND role_code <> 'OWNER' AND is_active AND deleted_at IS NULL
                      ORDER BY full_name""", (org,))
    branches = db.all("SELECT id, name FROM branch WHERE org_id = ? ORDER BY name", (org,))
    return {"me": actor.user_id, "owners": owners, "requests": requests, "staff": staff, "branches": branches, "waitDays": WAIT_DAYS}


def waiting_for(db: Db, actor: s.Actor) -> int:
    """Requests another Owner made that this Owner can decide."""
    return int(db.scalar("SELECT count(*) FROM owner_change WHERE org_id = ? AND status = 'PENDING' AND requested_by <> ?",
                         (actor.org_id, actor.user_id)) or 0)
