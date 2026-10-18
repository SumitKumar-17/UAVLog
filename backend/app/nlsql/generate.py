"""Question to SQL: prompt from the live catalog, guard, run, and up to two self-repair rounds on errors."""
import json
import re
import time
from dataclasses import dataclass, field

from app.config import settings
from app.llm import LLMClient
from app.nlsql import execute, guard
from app.nlsql.schema import RAW_SCHEMA, semantic_schema

RULES_SEMANTIC = """You answer questions about a corpus of UAV (drone) flight logs by writing ONE PostgreSQL SELECT query.
Use only the views below. Rules:
- Reply with only the SQL, in one ```sql block. No explanation.
- Use only the columns listed; never invent columns or tables.
- Times are seconds since the log started (start_s, t_s). Join views on flight_id.
- To compare or filter flights by a signal's level, use semantic.signal_summary (fast). semantic.telemetry has about 70 million rows: only query it with a flight_id AND signal filter.
- Event kinds are listed in the events.kind comment. Search free text in events.description with ILIKE.
- Prefer counting DISTINCT flight_id when asked how many flights.
- To count telemetry samples, use SUM(samples) from semantic.signal_summary (optionally WHERE signal = ...); never count rows of semantic.telemetry across flights.
- Only reply CANNOT_ANSWER if no view holds the information at all (for example weather or pilots). If a view can answer it, even indirectly, write the query. Use signal_summary whenever the question spans many flights.
- If the views cannot answer the question, reply with exactly: -- CANNOT_ANSWER: <short reason>"""

RULES_RAW = """You answer questions about a corpus of UAV (drone) flight logs by writing ONE PostgreSQL SELECT query.
Use only the tables below. Reply with only the SQL, in one ```sql block. Telemetry values are stored per vendor field; mapping
to canonical signals goes through field_mapping and concept (kind = 'signal'). If the tables cannot answer, reply with exactly:
-- CANNOT_ANSWER: <short reason>"""

EXAMPLES = [
    ("How many flights have at least one critical event?", "SELECT count(DISTINCT flight_id) FROM semantic.events WHERE severity = 2"),
    ("How many battery voltage samples were recorded across all flights?", "SELECT sum(samples) AS samples FROM semantic.signal_summary WHERE signal = 'battery.voltage'"),
    ("Which boards flew longest on average?", "SELECT board, round(avg(duration_s)::numeric, 1) AS avg_seconds FROM semantic.flights GROUP BY board ORDER BY avg_seconds DESC LIMIT 5"),
]


@dataclass
class Attempt:
    sql: str
    error: str | None = None


@dataclass
class Answer:
    question: str
    sql: str | None = None
    columns: list[str] = field(default_factory=list)
    rows: list[list] = field(default_factory=list)
    truncated: bool = False
    notes: list[str] = field(default_factory=list)
    attempts: list[Attempt] = field(default_factory=list)
    cannot_answer: str | None = None
    error: str | None = None
    cost: float | None = None
    generate_ms: float = 0
    run_ms: float = 0
    explanation: str | None = None


def extract_sql(text: str) -> str:
    m = re.search(r"```(?:sql)?\s*(.*?)```", text, re.S | re.I)
    return (m.group(1) if m else text).strip().rstrip(";")


def ask(pool, llm: LLMClient, question: str, mode: str = "semantic", explain: bool = False, max_repairs: int = 2) -> Answer:
    ans = Answer(question=question)
    policy = guard.Policy.semantic() if mode == "semantic" else guard.Policy.raw()
    with pool.connection() as c:
        schema = semantic_schema(c) if mode == "semantic" else RAW_SCHEMA
    system = (RULES_SEMANTIC if mode == "semantic" else RULES_RAW) + "\n\n" + schema
    messages = [{"role": "system", "content": system}]
    if mode == "semantic":
        for q, s in EXAMPLES:
            messages += [{"role": "user", "content": q}, {"role": "assistant", "content": f"```sql\n{s}\n```"}]
    messages.append({"role": "user", "content": question})

    for attempt in range(max_repairs + 1):
        t0 = time.time()
        reply = llm.chat(messages, temperature=0)
        ans.generate_ms += (time.time() - t0) * 1000
        if "CANNOT_ANSWER" in reply and "SELECT" not in reply.upper():
            ans.cannot_answer = reply.split("CANNOT_ANSWER:", 1)[-1].strip() or "The data cannot answer this question."
            return ans
        sql = extract_sql(reply)
        step = Attempt(sql=sql)
        ans.attempts.append(step)
        try:
            checked = guard.check(sql, policy)
            res = execute.run(pool, checked.sql, mode)
        except (guard.GuardError, execute.ExecError) as e:
            step.error = str(e)
            messages += [{"role": "assistant", "content": reply},
                         {"role": "user", "content": f"That query failed: {e}\nFix it and reply with only the corrected SQL."}]
            continue
        ans.sql, ans.columns, ans.rows, ans.truncated = checked.sql, res.columns, res.rows, res.truncated
        ans.notes, ans.cost, ans.run_ms = checked.notes, res.cost, res.run_ms
        break
    else:
        ans.error = ans.attempts[-1].error if ans.attempts else "No query was produced."
        return ans

    if explain:
        sample = json.dumps({"columns": ans.columns, "rows": ans.rows[:20], "truncated": ans.truncated}, default=str)
        ans.explanation = llm.chat([
            {"role": "system", "content": "Summarize a database result in one to three plain sentences. Use only numbers and names that appear in the rows. If the rows are empty, say no matching data was found. Do not speculate."},
            {"role": "user", "content": f"Question: {question}\nResult: {sample}"}], temperature=0)
    return ans
