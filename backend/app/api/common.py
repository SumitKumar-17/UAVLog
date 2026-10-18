"""Helpers shared by the API routers."""
import ipaddress
import uuid

from fastapi import HTTPException, Request
from psycopg.rows import dict_row

from app.events.ulog_events import NAV_STATE


def rows(p, sql: str, params=None) -> list[dict]:
    with p.connection() as c, c.cursor(row_factory=dict_row) as cur:
        cur.execute(sql, params or {})
        return cur.fetchall()


def flight_uuid(value: str) -> str:
    try:
        return str(uuid.UUID(value))
    except ValueError:
        raise HTTPException(404, "unknown flight")


def mode_segments(p, flight_ids: list[str]) -> dict[str, list[dict]]:
    """Flight-mode ribbon per flight (seconds from log start), as runs of the nav_state signal."""
    segs: dict[str, list[dict]] = {}
    for r in rows(p, """
        WITH s AS (SELECT t.flight_id, t.ts, t.value::int AS v FROM telemetry t
                   JOIN vendor_field vf ON vf.id = t.vendor_field_id AND vf.topic = 'vehicle_status' AND vf.field = 'nav_state'
                   WHERE t.flight_id = ANY(%(ids)s::uuid[])),
        g AS (SELECT *, row_number() OVER (PARTITION BY flight_id ORDER BY ts)
                      - row_number() OVER (PARTITION BY flight_id, v ORDER BY ts) AS grp FROM s)
        SELECT g.flight_id::text AS fid, g.v, extract(epoch FROM min(g.ts) - f.started_at) AS t0
        FROM g JOIN flight f ON f.id = g.flight_id GROUP BY g.flight_id, g.v, g.grp, f.started_at ORDER BY 1, 3""", {"ids": flight_ids}):
        segs.setdefault(r["fid"], []).append({"t0": max(r["t0"], 0.0), "mode": NAV_STATE.get(r["v"], f"mode {r['v']}")})
    return segs


def with_strips(p, items: list[dict]) -> list[dict]:
    """Attach `modes` (t0, t1, mode) and `marks` (warning/critical events) so a flight can be drawn as a strip."""
    ids = [str(i["id"]) for i in items]
    segs = mode_segments(p, ids) if ids else {}
    marks: dict[str, list[dict]] = {}
    for r in rows(p, """SELECT e.flight_id::text AS fid, c.key AS kind, e.severity, e.description,
                               extract(epoch FROM e.ts_start - f.started_at) AS t
                        FROM event e JOIN concept c ON c.id = e.kind_id JOIN flight f ON f.id = e.flight_id
                        WHERE e.flight_id = ANY(%s::uuid[]) AND e.severity >= 1 ORDER BY e.ts_start""", (ids,)) if ids else []:
        marks.setdefault(r["fid"], []).append({k: r[k] for k in ("t", "severity", "kind", "description")})
    for i in items:
        fid, dur = str(i["id"]), i["duration_s"] or 0.0
        runs = segs.get(fid, [])
        i["modes"] = [{"t0": r["t0"], "t1": runs[n + 1]["t0"] if n + 1 < len(runs) else dur, "mode": r["mode"]} for n, r in enumerate(runs)]
        i["marks"] = marks.get(fid, [])
    return items


def client_ip(request: Request) -> str:
    """The caller's address. Behind the web proxy every request comes from the proxy's private address, so the first X-Forwarded-For
    entry is trusted only when the immediate peer is private or loopback (otherwise the header could be spoofed)."""
    peer = request.client.host if request.client else "unknown"
    try:
        private = ipaddress.ip_address(peer).is_private
    except ValueError:
        private = False
    fwd = request.headers.get("x-forwarded-for", "")
    return fwd.split(",")[0].strip() if private and fwd else peer
