"""Fleet map, fleet statistics, the flight 'galaxy', cited investigation reports, the SQL workbench and the pipeline retry."""
import json
import os
import re

import numpy as np
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel, Field
from psycopg.types.json import Jsonb

from app.api.common import client_ip, flight_uuid, rows
from app.api.deps import llm, pool
from app.config import settings
from app.nlsql import execute, guard

router = APIRouter(prefix="/api")
WRITES_ENABLED = os.environ.get("ALLOW_WRITES", "1") == "1"


# ---------------------------------------------------------------------------------------------------------------------------- map
@router.get("/map")
def corpus_map(p=Depends(pool)):
    """Every flight that has a GPS fix, placed at the mean of its GPS latitude and longitude (from the precomputed signal summary)."""
    return rows(p, """
        SELECT f.id, f.source_ref, f.firmware, f.metadata->>'sys_hw' AS hw, f.started_at, f.duration_s,
               la.mean_value AS lat, lo.mean_value AS lon,
               (SELECT count(*) FROM event e WHERE e.flight_id = f.id) AS events,
               (SELECT count(*) FROM event e WHERE e.flight_id = f.id AND e.severity = 2) AS critical_events
        FROM flight f
        JOIN semantic.signal_summary la ON la.flight_id = f.id AND la.signal = 'gps.lat'
        JOIN semantic.signal_summary lo ON lo.flight_id = f.id AND lo.signal = 'gps.lon'
        WHERE la.mean_value BETWEEN -90 AND 90 AND lo.mean_value BETWEEN -180 AND 180 AND NOT (la.mean_value = 0 AND lo.mean_value = 0)
        ORDER BY f.started_at""")


# --------------------------------------------------------------------------------------------------------------------------- fleet
@router.get("/fleet")
def fleet(p=Depends(pool)):
    """Aggregates over the whole corpus: boards, firmware families, event kinds, flights per year, flight lengths."""
    return {
        "boards": rows(p, """
            SELECT coalesce(f.metadata->>'sys_hw', 'unknown') AS hw, count(*) AS flights, round((avg(f.duration_s) / 60.0)::numeric, 1) AS minutes,
                   round(sum(x.events)::numeric / count(*), 1) AS events_per_flight, round(sum(x.critical)::numeric / count(*), 2) AS critical_per_flight
            FROM flight f, LATERAL (SELECT count(*) AS events, count(*) FILTER (WHERE severity = 2) AS critical FROM event WHERE flight_id = f.id) x
            WHERE f.autopilot = 'px4' GROUP BY 1 ORDER BY count(*) DESC LIMIT 12"""),
        "firmware": rows(p, """
            SELECT coalesce(substring(f.firmware from '^v?[0-9]+\\.[0-9]+'), 'unknown') AS family, count(*) AS flights,
                   round(sum(x.critical)::numeric / count(*), 2) AS critical_per_flight, round(sum(x.warnings)::numeric / count(*), 2) AS warnings_per_flight
            FROM flight f, LATERAL (SELECT count(*) FILTER (WHERE severity = 2) AS critical, count(*) FILTER (WHERE severity = 1) AS warnings FROM event WHERE flight_id = f.id) x
            WHERE f.autopilot = 'px4' GROUP BY 1 HAVING count(*) >= 3 ORDER BY family"""),
        "kinds": rows(p, """
            SELECT c.key AS kind, c.label, count(*) AS events, count(DISTINCT e.flight_id) AS flights, count(*) FILTER (WHERE e.severity = 2) AS critical
            FROM event e JOIN concept c ON c.id = e.kind_id GROUP BY 1, 2 ORDER BY count(*) DESC"""),
        "years": rows(p, """
            SELECT extract(year FROM started_at)::int AS year, count(*) AS flights FROM flight
            WHERE started_at >= '2012-01-01' AND started_at < now() + interval '1 day' GROUP BY 1 ORDER BY 1"""),
        "durations": rows(p, """
            SELECT bucket, count(*) AS flights FROM (SELECT CASE WHEN duration_s < 60 THEN '< 1 min' WHEN duration_s < 300 THEN '1-5 min'
                   WHEN duration_s < 900 THEN '5-15 min' WHEN duration_s < 1800 THEN '15-30 min' ELSE '> 30 min' END AS bucket,
                   CASE WHEN duration_s < 60 THEN 1 WHEN duration_s < 300 THEN 2 WHEN duration_s < 900 THEN 3 WHEN duration_s < 1800 THEN 4 ELSE 5 END AS o
                   FROM flight WHERE duration_s IS NOT NULL AND duration_s < 86400) x GROUP BY bucket, o ORDER BY o"""),
        "totals": rows(p, """SELECT (SELECT count(*) FROM flight) AS flights, (SELECT count(*) FROM event) AS events,
                             (SELECT count(*) FROM event WHERE severity = 2) AS critical, (SELECT count(DISTINCT metadata->>'sys_hw') FROM flight) AS boards,
                             (SELECT round(sum(duration_s) / 3600.0) FROM flight WHERE duration_s < 86400) AS hours""")[0],
    }


# -------------------------------------------------------------------------------------------------------------------------- galaxy
_galaxy: dict = {}


@router.get("/galaxy")
def galaxy(p=Depends(pool)):
    """Every flight as a point: the 32 dimension behavioural signature projected onto its two main directions (PCA), and an 'unusualness'
    score, the mean cosine distance to the flight's 5 nearest neighbours (large means no other flight behaved like it)."""
    n = rows(p, "SELECT count(*) AS n FROM flight_signature")[0]["n"]
    if _galaxy.get("n") == n:
        return _galaxy["data"]
    with p.connection() as c:
        data = c.execute("SELECT flight_id, signature::real[] FROM flight_signature ORDER BY flight_id").fetchall()
    if len(data) < 3:
        raise HTTPException(404, "no signatures yet; run scripts/build_signatures.py")
    ids = [str(r[0]) for r in data]
    X = np.array([r[1] for r in data], dtype=np.float64)
    C = X - X.mean(axis=0)
    _, _, vt = np.linalg.svd(C, full_matrices=False)
    xy = C @ vt[:2].T
    sim = X @ X.T / np.maximum(np.linalg.norm(X, axis=1)[:, None] * np.linalg.norm(X, axis=1)[None, :], 1e-9)
    dist = 1 - sim
    np.fill_diagonal(dist, np.inf)
    unusual = np.sort(dist, axis=1)[:, :5].mean(axis=1)
    meta = {str(r["id"]): r for r in rows(p, """
        SELECT f.id, f.source_ref, f.firmware, f.metadata->>'sys_hw' AS hw, f.duration_s, f.started_at,
               (SELECT count(*) FROM event e WHERE e.flight_id = f.id AND e.severity = 2) AS critical_events
        FROM flight f""")}
    pts = [{"id": ids[i], "x": float(xy[i, 0]), "y": float(xy[i, 1]), "unusual": float(unusual[i]), **{k: meta[ids[i]][k] for k in
           ("source_ref", "firmware", "hw", "duration_s", "critical_events") if ids[i] in meta}} for i in range(len(ids)) if ids[i] in meta]
    out = {"points": pts, "explained": float(np.sum((C @ vt[:2].T) ** 2) / np.sum(C ** 2))}
    _galaxy.update(n=n, data=out)
    return out


# ----------------------------------------------------------------------------------------------------------------------- investigation
class Report(BaseModel):
    headline: str
    findings: list[dict]
    probable_cause: dict
    next_checks: list[str]


INVESTIGATE_RULES = """You are a flight-data analyst. You receive numbered evidence items about one drone flight. Write an incident report that uses ONLY
those items. Every statement must cite the evidence ids it rests on, like "E3". Never invent numbers, times or causes that are not in the evidence;
if the evidence is not enough for a cause, say so and give confidence "low". Reply with JSON only:
{"headline": "one sentence", "findings": [{"text": "...", "cites": ["E1","E4"]}], "probable_cause": {"text": "...", "cites": ["E2"], "confidence": "low|medium|high"},
 "next_checks": ["a concrete check an engineer could do"]}
Give 3 to 6 findings, ordered by importance, and 2 to 4 next checks."""


def _clock(t: float) -> str:
    return f"{int(t // 60)}:{int(t % 60):02d}"


def gather_evidence(p, fid: str) -> list[dict]:
    """Facts for one flight, numbered E1.. so a report can cite them. All numbers come from SQL, none from the model."""
    ev: list[dict] = []

    def add(kind: str, text: str, t: float | None = None):
        ev.append({"id": f"E{len(ev) + 1}", "kind": kind, "text": text, "t": t})

    f = rows(p, """SELECT source_ref, firmware, metadata->>'sys_hw' AS hw, duration_s, started_at, metadata->'error_labels' AS labels,
                          metadata->>'rating' AS rating, metadata->>'feedback' AS feedback FROM flight WHERE id = %s""", (fid,))[0]
    add("flight", f"Board {f['hw'] or 'unknown'}, firmware {f['firmware'] or 'unknown'}, flown {_clock(f['duration_s'] or 0)} on {f['started_at']:%Y-%m-%d}.")
    if f["labels"] or (f["rating"] and f["rating"] != "none") or (f["feedback"] and f["feedback"].strip().lower() not in ("", "none given")):
        add("pilot", f"Pilot report: labels {f['labels'] or 'none'}, rating {f['rating'] or 'none'}, comment {f['feedback']!r}.")
    for e in rows(p, """
        SELECT extract(epoch FROM e.ts_start - f.started_at) AS t, c.label, e.severity, e.description, count(*) OVER (PARTITION BY e.kind_id) AS same
        FROM event e JOIN flight f ON f.id = e.flight_id JOIN concept c ON c.id = e.kind_id
        WHERE e.flight_id = %s AND e.severity >= 1 ORDER BY e.severity DESC, e.ts_start LIMIT 18""", (fid,)):
        sev, at = ("critical" if e["severity"] == 2 else "warning"), max(float(e["t"]), 0.0)
        add("event", f"At {_clock(at)} a {sev} {e['label'].lower()} event: {e['description'][:200]} ({e['same']} events of this kind in the flight).", at)
    for s in rows(p, """
        WITH fleet AS (SELECT signal, percentile_cont(0.5) WITHIN GROUP (ORDER BY max_value) AS med_max, percentile_cont(0.95) WITHIN GROUP (ORDER BY max_value) AS p95_max,
                              percentile_cont(0.05) WITHIN GROUP (ORDER BY min_value) AS p05_min, percentile_cont(0.5) WITHIN GROUP (ORDER BY min_value) AS med_min
                       FROM semantic.signal_summary GROUP BY signal HAVING count(*) >= 30)
        SELECT s.signal, k.label, k.unit, s.min_value, s.max_value, fl.med_max, fl.p95_max, fl.p05_min, fl.med_min,
               greatest((s.max_value - fl.p95_max) / nullif(abs(fl.p95_max - fl.med_max), 0), (fl.p05_min - s.min_value) / nullif(abs(fl.med_min - fl.p05_min), 0)) AS excess
        FROM semantic.signal_summary s JOIN fleet fl ON fl.signal = s.signal JOIN concept k ON k.key = s.signal AND k.kind = 'signal'
        WHERE s.flight_id = %s AND s.signal NOT LIKE 'mode.%%' AND s.signal NOT LIKE 'gps.l%%' AND s.signal NOT LIKE 'position.%%'
        ORDER BY excess DESC NULLS LAST LIMIT 4""", (fid,)):
        if s["excess"] is not None and s["excess"] > 0:
            u = f" {s['unit']}" if s["unit"] else ""
            add("signal", f"{s['label']}: this flight ranged {s['min_value']:.3g} to {s['max_value']:.3g}{u}; across the corpus the median maximum is "
                          f"{s['med_max']:.3g} and the 95th percentile {s['p95_max']:.3g} (5th percentile of minimums {s['p05_min']:.3g}).")
    sim = rows(p, """
        SELECT f.source_ref, (SELECT count(*) FROM event e WHERE e.flight_id = f.id AND e.severity = 2) AS critical
        FROM flight_signature s JOIN flight f ON f.id = s.flight_id, (SELECT signature FROM flight_signature WHERE flight_id = %(f)s) q
        WHERE s.flight_id <> %(f)s ORDER BY s.signature <=> q.signature LIMIT 5""", {"f": fid})
    if sim:
        add("similar", f"The 5 flights that behaved most like this one have {', '.join(str(s['critical']) for s in sim)} critical events respectively.")
    return ev


class InvestigateBody(BaseModel):
    refresh: bool = False


@router.get("/flights/{flight_id}/investigation")
def get_investigation(flight_id: str, p=Depends(pool)):
    r = rows(p, "SELECT model, evidence, report, created_at FROM investigation WHERE flight_id = %s", (flight_uuid(flight_id),))
    if not r:
        raise HTTPException(404, "no report yet")
    return r[0]


_inv_recent: dict[str, list] = {}


@router.post("/flights/{flight_id}/investigate")
def investigate(flight_id: str, body: InvestigateBody, request: Request, p=Depends(pool), client=Depends(llm)):
    """A cited incident report: facts from SQL (numbered evidence), prose from the model, every citation checked against the evidence."""
    import time
    fid = flight_uuid(flight_id)
    if not rows(p, "SELECT 1 FROM flight WHERE id = %s", (fid,)):
        raise HTTPException(404, "unknown flight")
    cached = rows(p, "SELECT model, evidence, report, created_at FROM investigation WHERE flight_id = %s", (fid,))
    if cached and not body.refresh:
        return cached[0]
    now, q = time.time(), _inv_recent.setdefault(client_ip(request), [])
    q[:] = [t for t in q if now - t < 60]
    if len(q) >= 6:
        raise HTTPException(429, "Too many reports; wait a minute.")
    q.append(now)
    evidence = gather_evidence(p, fid)
    text = "\n".join(f"{e['id']} [{e['kind']}] {e['text']}" for e in evidence)
    reply = client.chat([{"role": "system", "content": INVESTIGATE_RULES}, {"role": "user", "content": f"Evidence:\n{text}"}],
                        temperature=0, response_format={"type": "json_object"})
    try:
        rep = json.loads(reply)
        Report(**rep)
    except Exception as e:
        raise HTTPException(502, f"the model did not return a usable report ({e})")
    valid = {e["id"] for e in evidence}
    dropped = 0
    for item in [*rep["findings"], rep["probable_cause"]]:
        keep = [c for c in item.get("cites", []) if c in valid]
        dropped += len(item.get("cites", [])) - len(keep)
        item["cites"] = keep
    rep["findings"] = [f for f in rep["findings"] if f.get("text") and f["cites"]]  # a finding with no valid citation is not shown
    rep["dropped_citations"] = dropped
    model = settings.llm_model
    with p.connection() as c:
        c.execute("""INSERT INTO investigation (flight_id, model, evidence, report) VALUES (%s, %s, %s, %s)
                     ON CONFLICT (flight_id) DO UPDATE SET model = EXCLUDED.model, evidence = EXCLUDED.evidence, report = EXCLUDED.report, created_at = now()""",
                  (fid, model, Jsonb(evidence), Jsonb(rep)))
    return rows(p, "SELECT model, evidence, report, created_at FROM investigation WHERE flight_id = %s", (fid,))[0]


# ----------------------------------------------------------------------------------------------------------------------- workbench
class SqlBody(BaseModel):
    sql: str = Field(min_length=1, max_length=4000)


@router.get("/workbench/schema")
def workbench_schema(p=Depends(pool)):
    """The views the workbench may query, with every column and its documentation."""
    cols = rows(p, """
        SELECT c.relname AS view, a.attname AS column, format_type(a.atttypid, a.atttypmod) AS type, col_description(c.oid, a.attnum) AS doc,
               obj_description(c.oid, 'pg_class') AS view_doc
        FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
        WHERE n.nspname = 'semantic' AND c.relkind IN ('v', 'm') ORDER BY c.relname, a.attnum""")
    out: dict = {}
    for r in cols:
        v = out.setdefault(r["view"], {"view": r["view"], "doc": r["view_doc"], "columns": []})
        v["columns"].append({"name": r["column"], "type": r["type"], "doc": r["doc"]})
    return list(out.values())


@router.post("/workbench/run")
def workbench_run(body: SqlBody, request: Request, p=Depends(pool)):
    """Run a query exactly as the Ask page does: guard, restricted role, read-only transaction, timeout, cost admission. No model involved."""
    try:
        checked = guard.check(body.sql, guard.Policy.semantic())
        res = execute.run(p, checked.sql, "semantic")
    except (guard.GuardError, execute.ExecError) as e:
        raise HTTPException(400, str(e))
    return {"sql": checked.sql, "columns": res.columns, "rows": res.rows[:500], "truncated": res.truncated or len(res.rows) > 500,
            "cost": res.cost, "run_ms": res.run_ms, "notes": checked.notes, "tables": checked.tables, "functions": checked.functions}


@router.get("/workbench/saved")
def saved_list(p=Depends(pool)):
    return rows(p, "SELECT id, title, sql, created_at FROM saved_query ORDER BY id DESC LIMIT 100")


class SavedBody(BaseModel):
    title: str = Field(min_length=1, max_length=80)
    sql: str = Field(min_length=1, max_length=4000)


@router.post("/workbench/saved", status_code=201)
def saved_add(body: SavedBody, p=Depends(pool)):
    if not WRITES_ENABLED:
        raise HTTPException(403, "this deployment is read-only")
    try:
        guard.check(body.sql, guard.Policy.semantic())  # only queries the guard accepts can be saved
    except guard.GuardError as e:
        raise HTTPException(400, str(e))
    if rows(p, "SELECT count(*) AS n FROM saved_query")[0]["n"] >= 100:
        raise HTTPException(409, "100 saved queries is the limit")
    return rows(p, "INSERT INTO saved_query (title, sql) VALUES (%s, %s) RETURNING id, title, sql, created_at", (body.title.strip(), body.sql.strip()))[0]


@router.delete("/workbench/saved/{qid}", status_code=204)
def saved_delete(qid: int, p=Depends(pool)):
    if not WRITES_ENABLED:
        raise HTTPException(403, "this deployment is read-only")
    with p.connection() as c:
        if c.execute("DELETE FROM saved_query WHERE id = %s", (qid,)).rowcount == 0:
            raise HTTPException(404, "unknown saved query")


# ------------------------------------------------------------------------------------------------------------------------- pipeline
class RetryBody(BaseModel):
    stage: str | None = Field(None, max_length=40, pattern=r"^[a-z_]+$")


@router.post("/pipeline/retry")
def pipeline_retry(body: RetryBody, p=Depends(pool)):
    """Put failed items back in the queue (attempts reset); the workers pick them up on their next run."""
    if not WRITES_ENABLED:
        raise HTTPException(403, "this deployment is read-only")
    with p.connection() as c:
        a = c.execute("UPDATE ingest_job SET status = 'pending', attempts = 0 WHERE status = 'failed' AND (%(s)s::text IS NULL OR %(s)s = 'ingest')", {"s": body.stage}).rowcount
        b = c.execute("UPDATE flight_task SET status = 'pending', attempts = 0 WHERE status = 'failed' AND (%(s)s::text IS NULL OR stage = %(s)s)", {"s": body.stage}).rowcount
    return {"requeued": a + b}


# ------------------------------------------------------------------------------------------------------------------------ incidents
@router.get("/incidents")
def incidents(p=Depends(pool), min_severity: int = Query(2, ge=1, le=2), kind: str | None = Query(None, max_length=60, pattern=r"^[a-z_]+$"),
              hw: str | None = Query(None, max_length=60), q: str | None = Query(None, max_length=80), limit: int = Query(30, ge=1, le=100), offset: int = Query(0, ge=0, le=5000)):
    """Warnings and critical events across every flight, newest flights first, with the filters' counts."""
    prm = {"sev": min_severity, "kind": kind, "hw": hw, "q": f"%{q}%" if q else None}
    where = """e.severity >= %(sev)s AND (%(kind)s::text IS NULL OR c.key = %(kind)s) AND (%(hw)s::text IS NULL OR f.metadata->>'sys_hw' = %(hw)s)
               AND (%(q)s::text IS NULL OR e.description ILIKE %(q)s)"""
    base = "FROM event e JOIN flight f ON f.id = e.flight_id JOIN concept c ON c.id = e.kind_id"
    items = rows(p, f"""SELECT e.id, f.id AS flight_id, f.source_ref, f.metadata->>'sys_hw' AS hw, f.firmware, f.started_at, c.key AS kind, c.label, e.severity, e.description,
                              greatest(extract(epoch FROM e.ts_start - f.started_at), 0)::float AS t
                       {base} WHERE {where} ORDER BY f.started_at DESC, e.ts_start LIMIT %(limit)s OFFSET %(offset)s""", {**prm, "limit": limit, "offset": offset})
    total = rows(p, f"SELECT count(*) AS n {base} WHERE {where}", prm)[0]["n"]
    kinds = rows(p, f"SELECT c.key AS kind, c.label, count(*) AS n {base} WHERE e.severity >= %(sev)s AND (%(hw)s::text IS NULL OR f.metadata->>'sys_hw' = %(hw)s) GROUP BY 1, 2 ORDER BY n DESC", prm)
    boards = rows(p, f"SELECT f.metadata->>'sys_hw' AS hw, count(*) AS n {base} WHERE e.severity >= %(sev)s AND (%(kind)s::text IS NULL OR c.key = %(kind)s) GROUP BY 1 ORDER BY n DESC LIMIT 15", prm)
    return {"total": total, "items": items, "kinds": kinds, "boards": boards}
