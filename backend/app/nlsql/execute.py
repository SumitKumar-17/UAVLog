"""Run a guarded query as the read-only role: read-only transaction, statement timeout, and cost-based admission control
(the planner's own estimate is checked with EXPLAIN before the query is allowed to run)."""
import time
from dataclasses import dataclass
from decimal import Decimal

from psycopg_pool import ConnectionPool

from app.config import settings

from app.nlsql.guard import MAX_ROWS

ROLES = {"semantic": "uav_reader", "raw": "uav_reader_raw", "raw_docs": "uav_reader_raw"}  # fixed names; never taken from input
MAX_COST = 100_000
TIMEOUT_MS = 8_000


class ExecError(RuntimeError):
    """The query was valid but could not run (too expensive, timed out, or the database rejected it)."""


@dataclass
class Result:
    columns: list[str]
    rows: list[list]
    truncated: bool
    cost: float
    run_ms: float


_nl_pool: ConnectionPool | None = None


def _connection_source(pool, mode: str):
    """The restricted login role (uav_nlsql, no way back to a more privileged role) when NLSQL_DATABASE_URL is set; otherwise SET ROLE
    from the shared pool. Returns the pool and whether SET LOCAL ROLE is needed."""
    global _nl_pool
    if mode == "semantic" and settings.nlsql_database_url:
        if _nl_pool is None:
            _nl_pool = ConnectionPool(settings.nlsql_database_url, min_size=1, max_size=4, open=True, kwargs={"autocommit": True})
        return _nl_pool, False
    return pool, True


def _plain(v):
    if v is None or isinstance(v, (bool, int, float, str)):
        return v
    if isinstance(v, Decimal):
        return float(v)  # keep numbers numeric (JSON and result comparison); only the rest is stringified
    if isinstance(v, (list, tuple)):
        return [_plain(x) for x in v]
    return str(v)  # Decimal, datetime, UUID, ...


def run(pool, sql: str, mode: str = "semantic", max_cost: float = MAX_COST) -> Result:
    role = ROLES[mode]
    source, set_role = _connection_source(pool, mode)
    with source.connection() as c:
        try:
            with c.transaction():
                c.execute("SET TRANSACTION READ ONLY")
                if set_role:
                    c.execute(f"SET LOCAL ROLE {role}")
                c.execute(f"SET LOCAL statement_timeout = {TIMEOUT_MS}")
                c.execute("SET LOCAL idle_in_transaction_session_timeout = 10000")
                cost = float(c.execute("EXPLAIN (FORMAT JSON) " + sql).fetchone()[0][0]["Plan"]["Total Cost"])
                if cost > max_cost:
                    raise ExecError(f"The planner estimates this query is too expensive (cost {cost:,.0f}, limit {max_cost:,.0f}). "
                                    "Filter telemetry by flight_id and signal, or use signal_summary for comparisons across flights.")
                t0 = time.time()
                cur = c.execute(sql)
                fetched = cur.fetchmany(MAX_ROWS + 1)
                cols = [d.name for d in cur.description]
                run_ms = (time.time() - t0) * 1000
        except ExecError:
            raise
        except Exception as e:  # database error text is useful to the model for self-repair
            raise ExecError(f"{type(e).__name__}: {str(e).splitlines()[0]}") from e
    return Result(cols, [[_plain(v) for v in r] for r in fetched[:MAX_ROWS]], len(fetched) > MAX_ROWS, cost, run_ms)
