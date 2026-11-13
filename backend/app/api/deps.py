"""Shared resources: DB connection pool and the LLM client (created once at startup)."""
import os
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from psycopg_pool import ConnectionPool

from app.config import settings
from app.llm import LLMClient


@asynccontextmanager
async def lifespan(app: FastAPI):
    # A small managed database runs out of memory when many columnstore queries decompress at once, so on Vercel the pool is small
    # and extra requests queue for a connection instead of piling onto the database; DB_POOL_MAX overrides either default.
    big = int(os.environ.get("DB_POOL_MAX", "3" if os.environ.get("VERCEL") else "10"))
    app.state.pool = ConnectionPool(settings.dsn, min_size=1, max_size=big, timeout=60, open=True,
                                    kwargs={"autocommit": True, "options": "-c timezone=UTC"})
    app.state.llm = LLMClient(pool=app.state.pool) if settings.openai_api_key else None
    yield
    app.state.pool.close()


def pool(request: Request) -> ConnectionPool:
    return request.app.state.pool


def llm(request: Request) -> LLMClient:
    if request.app.state.llm is None:
        from fastapi import HTTPException
        raise HTTPException(503, "OPENAI_API_KEY is not configured")
    return request.app.state.llm
