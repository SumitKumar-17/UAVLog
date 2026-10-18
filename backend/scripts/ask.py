"""Ask a question from the command line: python scripts/ask.py "which boards had motor failures?" [--raw] [--explain]"""
import argparse

from psycopg_pool import ConnectionPool

from app.config import settings
from app.llm import LLMClient
from app.nlsql.generate import ask

p = argparse.ArgumentParser()
p.add_argument("question")
p.add_argument("--raw", action="store_true", help="baseline: raw tables, no semantic layer")
p.add_argument("--explain", action="store_true")
a = p.parse_args()
pool = ConnectionPool(settings.dsn, min_size=1, max_size=2, kwargs={"autocommit": True})
r = ask(pool, LLMClient(), a.question, "raw" if a.raw else "semantic", a.explain)
for i, at in enumerate(r.attempts, 1):
    print(f"-- attempt {i}{' FAILED: ' + at.error if at.error else ''}\n{at.sql}\n")
if r.cannot_answer: print("CANNOT ANSWER:", r.cannot_answer)
elif r.error: print("ERROR:", r.error)
else:
    print(f"guard: {r.notes or 'no changes'} | planner cost {r.cost:,.0f} | generate {r.generate_ms:.0f} ms, run {r.run_ms:.0f} ms")
    print(r.columns)
    for row in r.rows[:12]: print(row)
    if len(r.rows) > 12: print(f"... {len(r.rows)} rows")
    if r.explanation: print("\n" + r.explanation)
pool.close()
