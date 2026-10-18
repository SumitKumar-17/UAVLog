"""Per-client rate limits for the whole API: generous for reads, strict for anything that writes. In memory and per process, which is
enough for a single server; put a real gateway in front for anything public."""
import time
from collections import defaultdict, deque

from fastapi import Request
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware

from app.api.common import client_ip

LIMITS = {"read": (300, 60), "write": (30, 60)}  # requests, per seconds


class RateLimit(BaseHTTPMiddleware):
    def __init__(self, app):
        super().__init__(app)
        self.seen: dict[tuple[str, str], deque] = defaultdict(deque)

    async def dispatch(self, request: Request, call_next):
        if request.url.path == "/health" or request.method == "OPTIONS":
            return await call_next(request)
        kind = "read" if request.method in ("GET", "HEAD") else "write"
        limit, window = LIMITS[kind]
        q, now = self.seen[(client_ip(request), kind)], time.time()
        while q and now - q[0] > window:
            q.popleft()
        if len(q) >= limit:
            return JSONResponse({"detail": f"Too many {kind} requests; wait a minute."}, status_code=429, headers={"Retry-After": str(window)})
        q.append(now)
        return await call_next(request)
