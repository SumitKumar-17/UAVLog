"""HTTP API: flights, events, telemetry (server-side min/max envelopes), ontology, hybrid search."""
import uuid

from fastapi import Depends, FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from psycopg.rows import dict_row

from app.api.deps import lifespan, llm, pool
from app.search import MODES, search

app = FastAPI(title="Semantic Log Analytics [UAV Log]", version="0.1.0", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=["http://localhost:3000"], allow_methods=["GET"], allow_headers=["*"])


def rows(p, sql: str, params=None) -> list[dict]:
    with p.connection() as c, c.cursor(row_factory=dict_row) as cur:
        cur.execute(sql, params or {})
        return cur.fetchall()


def flight_uuid(value: str) -> str:
    try:
        return str(uuid.UUID(value))
    except ValueError:
        raise HTTPException(404, "unknown flight")


@app.get("/health")
def health(p=Depends(pool)):
    return {"ok": True, "flights": rows(p, "SELECT count(*) AS n FROM flight")[0]["n"]}


@app.get("/api/stats")
def stats(p=Depends(pool)):
    return rows(p, """SELECT (SELECT count(*) FROM flight) AS flights, (SELECT count(*) FROM event) AS events,
        (SELECT count(*) FROM telemetry) AS telemetry_rows, (SELECT count(*) FROM concept) AS concepts,
        pg_database_size(current_database()) AS db_bytes""")[0]


@app.get("/api/flights")
def flights(p=Depends(pool), hw: str | None = None, label: str | None = None, limit: int = Query(50, le=500), offset: int = 0):
    return rows(p, """
        SELECT f.id, f.source_ref, f.started_at, f.duration_s, f.firmware, f.metadata->>'sys_hw' AS hw,
               f.metadata->>'rating' AS rating, f.metadata->'error_labels' AS error_labels,
               left(f.metadata->>'feedback', 200) AS feedback,
               (SELECT count(*) FROM event e WHERE e.flight_id = f.id) AS events,
               (SELECT count(*) FROM event e WHERE e.flight_id = f.id AND e.severity = 2) AS critical_events
        FROM flight f
        WHERE (%(hw)s::text IS NULL OR f.metadata->>'sys_hw' = %(hw)s)
          AND (%(label)s::text IS NULL OR f.metadata->>'stratum' = %(label)s)
        ORDER BY f.started_at DESC LIMIT %(limit)s OFFSET %(offset)s""",
        {"hw": hw, "label": label, "limit": limit, "offset": offset})


@app.get("/api/flights/{flight_id}")
def flight(flight_id: str, p=Depends(pool)):
    fid = flight_uuid(flight_id)
    f = rows(p, "SELECT id, source, source_ref, autopilot, firmware, vehicle_type, started_at, duration_s, metadata FROM flight WHERE id = %s", (fid,))
    if not f:
        raise HTTPException(404, "unknown flight")
    events = rows(p, """SELECT e.id, c.key AS kind, e.severity, e.source, e.description, e.attrs,
                               extract(epoch FROM e.ts_start - f.started_at) AS t_start, extract(epoch FROM e.ts_end - f.started_at) AS t_end
                        FROM event e JOIN concept c ON c.id = e.kind_id JOIN flight f ON f.id = e.flight_id
                        WHERE e.flight_id = %s ORDER BY e.ts_start""", (fid,))
    signals = rows(p, """SELECT c.key AS signal, c.unit, c.label, count(*) AS samples
                         FROM telemetry t JOIN field_mapping m ON m.vendor_field_id = t.vendor_field_id
                         JOIN concept c ON c.id = m.concept_id AND c.kind = 'signal'
                         WHERE t.flight_id = %s GROUP BY 1, 2, 3 ORDER BY 1""", (fid,))
    return {**f[0], "events": events, "signals": signals}


@app.get("/api/flights/{flight_id}/signals/{signal}")
def signal(flight_id: str, signal: str, p=Depends(pool), from_s: float = 0, to_s: float | None = None,
           buckets: int = Query(800, ge=10, le=5000)):
    """Min/max/mean envelope per time bucket, computed in the database. Envelopes (not decimation) so spikes
    in safety signals are never dropped."""
    fid = flight_uuid(flight_id)
    dur = rows(p, "SELECT duration_s FROM flight WHERE id = %s", (fid,))
    if not dur:
        raise HTTPException(404, "unknown flight")
    end = to_s if to_s is not None else dur[0]["duration_s"]
    width = max((end - from_s) / buckets, 0.01)
    out = rows(p, """
        WITH f AS (SELECT started_at FROM flight WHERE id = %(fid)s)
        SELECT extract(epoch FROM x.b - f.started_at) AS t, x.lo, x.hi, x.mean, x.n FROM f, LATERAL (
            SELECT time_bucket(make_interval(secs => %(w)s), ts) AS b, min(value) AS lo, max(value) AS hi, avg(value) AS mean, count(*) AS n
            FROM canonical_telemetry
            WHERE flight_id = %(fid)s AND signal = %(sig)s
              AND ts >= f.started_at + make_interval(secs => %(a)s) AND ts <= f.started_at + make_interval(secs => %(b)s)
            GROUP BY 1) x ORDER BY 1""", {"fid": fid, "sig": signal, "w": width, "a": from_s, "b": end})
    if not out:
        raise HTTPException(404, "no data for this signal in this flight")
    return {"signal": signal, "from_s": from_s, "to_s": end, "bucket_s": width, "points": out}


@app.get("/api/search")
def search_events(q: str, p=Depends(pool), client=Depends(llm), k: int = Query(10, ge=1, le=100),
                  kind: list[str] | None = Query(None), min_severity: int = Query(0, ge=0, le=2), hw: str | None = None,
                  mode: str = "hybrid"):
    if mode not in MODES:
        raise HTTPException(400, f"mode must be one of {sorted(MODES)}")
    with p.connection() as c:
        res = search(c, client, q, k=k, kinds=kind, min_severity=min_severity, hw=hw, mode=mode)
    for r in res:
        r["t"] = r["t"].total_seconds()
        r["flight_id"] = r.pop("flight")  # source_ref
    return {"query": q, "mode": mode, "results": res}


@app.get("/api/ontology")
def ontology(p=Depends(pool)):
    return {
        "concepts": rows(p, "SELECT key, kind, label, unit, description FROM concept ORDER BY kind, key"),
        "relations": rows(p, """SELECT s.key AS src, d.key AS dst, r.rel FROM concept_relation r
                                JOIN concept s ON s.id = r.src_id JOIN concept d ON d.id = r.dst_id ORDER BY 1, 2"""),
    }
