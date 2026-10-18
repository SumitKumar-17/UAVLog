"""Shared client for any OpenAI-compatible API (key and base URL come from the environment).

Embeddings are batched and retried with backoff. Every call can be logged to `llm_call` (tokens, latency)."""
import threading
import time
from collections import OrderedDict

import httpx

from app.config import settings

RETRY_STATUS = {408, 409, 429, 500, 502, 503, 504}


def _model(name: str) -> str:
    return name.split("/", 1)[1] if name.startswith("openai/") else name  # tolerate provider-prefixed names


class LLMError(RuntimeError):
    pass


class LLMClient:
    def __init__(self, conn=None, timeout: float = 120.0, max_retries: int = 6, pool=None):
        if not settings.openai_api_key:
            raise LLMError("OPENAI_API_KEY is not set")
        base = settings.openai_api_base.rstrip("/")
        self.http = httpx.Client(base_url=base, timeout=timeout,
                                 headers={"Authorization": f"Bearer {settings.openai_api_key}"})
        self.conn, self.pool, self.max_retries = conn, pool, max_retries
        self._cache: OrderedDict = OrderedDict()  # recent query embeddings: the API round trip (about 1.4 s) dominates search latency
        self._lock = threading.Lock()

    def _post(self, path: str, body: dict) -> tuple[dict, int]:
        for attempt in range(self.max_retries + 1):
            t0 = time.time()
            try:
                r = self.http.post(path, json=body)
            except httpx.TransportError as e:
                if attempt == self.max_retries:
                    raise LLMError(f"network error: {e}") from e
            else:
                if r.status_code == 200:
                    return r.json(), int((time.time() - t0) * 1000)
                if r.status_code not in RETRY_STATUS or attempt == self.max_retries:
                    raise LLMError(f"{path} -> HTTP {r.status_code}: {r.text[:300]}")
            time.sleep(min(2 ** attempt, 30))
        raise LLMError("unreachable")

    def _log(self, kind: str, model: str, usage: dict, latency_ms: int, n_items: int) -> None:
        if self.conn is None and self.pool is None:
            return
        if self.conn is None:
            with self.pool.connection() as c:  # API path: log through the shared pool
                c.execute(
                    "INSERT INTO llm_call (kind, model, prompt_tokens, completion_tokens, latency_ms, n_items) VALUES (%s,%s,%s,%s,%s,%s)",
                    (kind, model, usage.get("prompt_tokens", 0), usage.get("completion_tokens", 0), latency_ms, n_items))
            return
        self.conn.execute(
            "INSERT INTO llm_call (kind, model, prompt_tokens, completion_tokens, latency_ms, n_items) "
            "VALUES (%s,%s,%s,%s,%s,%s)",
            (kind, model, usage.get("prompt_tokens", 0), usage.get("completion_tokens", 0), latency_ms, n_items))

    def embed(self, texts: list[str], batch: int = 256) -> list[list[float]]:
        model, out = _model(settings.embed_model), []
        for i in range(0, len(texts), batch):
            chunk = texts[i:i + batch]
            data, ms = self._post("/embeddings", {"model": model, "input": chunk, "dimensions": settings.embed_dims})
            out += [d["embedding"] for d in sorted(data["data"], key=lambda d: d["index"])]
            self._log("embedding", model, data.get("usage", {}), ms, len(chunk))
        return out

    def embed_cached(self, text: str, size: int = 1024) -> list[float]:
        """Embedding of one query with a small LRU cache (a repeated or example query costs no API call)."""
        key = (settings.embed_model, settings.embed_dims, " ".join(text.lower().split()))
        with self._lock:
            if key in self._cache:
                self._cache.move_to_end(key)
                return self._cache[key]
        vec = self.embed([text])[0]
        with self._lock:
            self._cache[key] = vec
            while len(self._cache) > size:
                self._cache.popitem(last=False)
        return vec

    def chat(self, messages: list[dict], model: str | None = None, **params) -> str:
        model = _model(model or settings.llm_model)
        data, ms = self._post("/chat/completions", {"model": model, "messages": messages, **params})
        self._log("chat", model, data.get("usage", {}), ms, 1)
        return data["choices"][0]["message"]["content"]
