"""Eirsha Ops API — one backend for the seven frontends.

    pip install -r api/requirements.txt
    EIRSHA_DATABASE_URL=postgresql:///eirsha  uvicorn eirsha_api.main:app --app-dir api
    # or, for a laptop demo:  EIRSHA_SQLITE=eirsha.db uvicorn eirsha_api.main:app --app-dir api
"""
from __future__ import annotations

import asyncio
import os
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import JSONResponse

from . import realtime
from .db import Db
from .db_init import ensure_database
from .routes import admin, auth_routes, finance, hr, kds, manager, owner, pos, reference, sales
from .services import ServiceError


@asynccontextmanager
async def lifespan(app: FastAPI):
    ensure_database()                      # first start on an empty database: create schema + seed
    stop = asyncio.Event()
    task = asyncio.create_task(realtime.relay(Db.from_env(), stop))
    yield
    stop.set()
    task.cancel()


app = FastAPI(title="Eirsha Ops API", version="1.0.0", lifespan=lifespan)
# Which websites may call the API from a browser. Auth is a Bearer token, not cookies.
# Built in, so a hand-edited Render variable can't drop an app: the eight eirsha-* Vercel
# projects, every deployment of the team's Vercel account (…-f-27f3.vercel.app) and localhost.
# EIRSHA_CORS (exact addresses) and EIRSHA_CORS_REGEX can add more.
BUILT_IN_ORIGINS = (r"https://eirsha-(demo|cashier|kds|sales|manager|finance|hr|admin|owner)\.vercel\.app"
                    r"|https://[a-z0-9-]+-f-27f3\.vercel\.app"
                    r"|http://(localhost|127\.0\.0\.1):\d+")
_extra = os.environ.get("EIRSHA_CORS_REGEX", "").strip().lstrip("^").rstrip("$")
app.add_middleware(CORSMiddleware,
                   allow_origins=[o.strip() for o in os.environ.get("EIRSHA_CORS", "").split(",") if o.strip()],
                   allow_origin_regex=f"(?:{BUILT_IN_ORIGINS})" + (f"|(?:{_extra})" if _extra else ""),
                   allow_credentials=True, allow_methods=["*"], allow_headers=["*"])
app.add_middleware(GZipMiddleware, minimum_size=2000)   # the Manager/Finance bootstraps carry a month of records


@app.middleware("http")
async def db_per_request(request: Request, call_next):
    # One connection per request (use psycopg_pool.ConnectionPool in production).
    request.state.db = Db.from_env()
    try:
        return await call_next(request)
    finally:
        request.state.db.conn.close()


@app.get("/health")
def health():
    return {"ok": True}


@app.exception_handler(ServiceError)
async def service_error(_: Request, exc: ServiceError) -> JSONResponse:
    return JSONResponse(status_code=exc.status, content={"error": str(exc), **exc.detail})


for r in (auth_routes, reference, sales, manager, pos, kds, finance, hr, admin, owner):
    app.include_router(r.router)
