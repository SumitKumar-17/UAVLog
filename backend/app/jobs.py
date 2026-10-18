"""Per-flight task queue (table flight_task): claim with SKIP LOCKED, finish, fail with retry, enqueue."""
CLAIM = """
UPDATE flight_task t SET status='running', attempts=attempts+1, claimed_at=now(), worker=%(worker)s
FROM (SELECT flight_id FROM flight_task
      WHERE stage=%(stage)s AND attempts < %(max)s
        AND (status='pending' OR (status='running' AND claimed_at < now() - make_interval(mins => %(lease)s)))
      ORDER BY created_at, flight_id LIMIT %(n)s FOR UPDATE SKIP LOCKED) c
WHERE t.flight_id = c.flight_id AND t.stage = %(stage)s
RETURNING t.flight_id"""


def enqueue(conn, stage: str) -> int:
    """Create a pending task for every flight that has none for this stage (safe to re-run; picks up new flights)."""
    cur = conn.execute("INSERT INTO flight_task (flight_id, stage) SELECT id, %s FROM flight ON CONFLICT DO NOTHING", (stage,))
    conn.commit()
    return cur.rowcount


def claim(conn, stage: str, worker: str, n: int, lease_min: int = 30, max_attempts: int = 3) -> list:
    rows = conn.execute(CLAIM, {"stage": stage, "worker": worker, "n": n, "lease": lease_min, "max": max_attempts}).fetchall()
    conn.commit()
    return [r[0] for r in rows]


def done(cur, flight_id, stage: str, result: dict | None = None) -> None:
    """Call inside the same transaction as the stage's writes so data and status commit together."""
    from psycopg.types.json import Jsonb
    cur.execute("UPDATE flight_task SET status='done', finished_at=now(), last_error=NULL, result=%s "
                "WHERE flight_id=%s AND stage=%s", (Jsonb(result or {}), flight_id, stage))


def fail(conn, flight_id, stage: str, err: str, max_attempts: int = 3) -> None:
    conn.execute("""UPDATE flight_task SET last_error=%s, finished_at=now(),
                    status = CASE WHEN attempts >= %s THEN 'failed' ELSE 'pending' END
                    WHERE flight_id=%s AND stage=%s""", (err[:2000], max_attempts, flight_id, stage))
    conn.commit()
