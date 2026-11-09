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
# Browsers may call the API from the listed sites, plus any address matching EIRSHA_CORS_REGEX
# (e.g. every Vercel deployment of this team). Auth is a Bearer token, not cookies.
app.add_middleware(CORSMiddleware, allow_origins=os.environ.get("EIRSHA_CORS", "http://localhost:5173").split(","),
                   allow_origin_regex=os.environ.get("EIRSHA_CORS_REGEX") or None,
                   allow_credentials=True, allow_methods=["*"], allow_headers=["*"])


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
