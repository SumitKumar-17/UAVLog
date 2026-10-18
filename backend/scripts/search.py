"""CLI for hybrid event search: python scripts/search.py "battery sagging under load" --k 8 --kind battery_low"""
import argparse

import psycopg

from app.config import settings
from app.llm import LLMClient
from app.search import search

p = argparse.ArgumentParser()
p.add_argument("query")
p.add_argument("--k", type=int, default=8)
p.add_argument("--kind", action="append")
p.add_argument("--min-severity", type=int, default=0)
p.add_argument("--hw")
a = p.parse_args()

with psycopg.connect(settings.dsn, autocommit=True) as conn:
    rows = search(conn, LLMClient(conn), a.query, a.k, a.kind, a.min_severity, a.hw)
    print(f'query: "{a.query}"')
    for r in rows:
        t = int(r["t"].total_seconds())
        print(f"  {r['score']:.4f} v{r['vec_rank'] or '-':>3} f{r['fts_rank'] or '-':>3}  {r['kind']:<22} sev{r['severity']} "
              f"{r['flight'][:8]}@{t // 60:02d}:{t % 60:02d}  {r['description'][:80]}")
