"""Shared resources: DB connection pool and the LLM client (created once at startup)."""
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from psycopg_pool import ConnectionPool

from app.config import settings
from app.llm import LLMClient


@asynccontextmanager
async def lifespan(app: FastAPI):
    app.state.pool = ConnectionPool(settings.dsn, min_size=2, max_size=10, open=True,
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
