"""Similar flights, GPS track, investigation notes and the pipeline monitor."""
import os

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field

from app.api.common import flight_uuid, mode_segments, rows
from app.api.deps import pool

router = APIRouter(prefix="/api")
WRITES_ENABLED = os.environ.get("ALLOW_WRITES", "1") == "1"  # set ALLOW_WRITES=0 for a read-only deployment


@router.get("/flights/{flight_id}/similar")
def similar(flight_id: str, p=Depends(pool), k: int = Query(6, ge=1, le=20)):
    """Flights that behaved most like this one (cosine distance between behavioural signatures, see scripts/build_signatures.py)."""
    fid = flight_uuid(flight_id)
    if not rows(p, "SELECT 1 FROM flight_signature WHERE flight_id = %s", (fid,)):
        raise HTTPException(404, "no signature for this flight yet; run scripts/build_signatures.py")
    return rows(p, """
        SELECT f.id, f.source_ref, f.metadata->>'sys_hw' AS hw, f.duration_s, s.signature <=> q.signature AS distance,
               (SELECT count(*) FROM event e WHERE e.flight_id = f.id AND e.severity = 2) AS critical_events
        FROM flight_signature s JOIN flight f ON f.id = s.flight_id,
             (SELECT signature FROM flight_signature WHERE flight_id = %(f)s) q
        WHERE s.flight_id <> %(f)s ORDER BY s.signature <=> q.signature LIMIT %(k)s""", {"f": fid, "k": k})


@router.get("/flights/{flight_id}/track")
def track(flight_id: str, p=Depends(pool)):
    """Ground track in local metres (north x, east y, down z), one point per second, plus the flight-mode segments to colour it."""
    fid = flight_uuid(flight_id)
    pts = rows(p, """
        SELECT extract(epoch FROM time_bucket('1 second', t.ts) - f.started_at) AS t,
               avg(t.value) FILTER (WHERE vf.field = 'x') AS x, avg(t.value) FILTER (WHERE vf.field = 'y') AS y, avg(t.value) FILTER (WHERE vf.field = 'z') AS z
        FROM telemetry t JOIN vendor_field vf ON vf.id = t.vendor_field_id AND vf.topic = 'vehicle_local_position' AND vf.field IN ('x', 'y', 'z')
        JOIN flight f ON f.id = t.flight_id WHERE t.flight_id = %s GROUP BY 1 ORDER BY 1""", (fid,))
    pts = [r for r in pts if r["x"] is not None and r["y"] is not None]
    if not pts:
        raise HTTPException(404, "this flight has no local position data")
    return {"points": pts, "modes": [{"t0": m["t0"], "mode": m["mode"]} for m in mode_segments(p, [fid]).get(fid, [])]}


class NoteBody(BaseModel):
    t_s: float = Field(ge=0, le=86400)
    body: str = Field(min_length=1, max_length=500)


@router.get("/flights/{flight_id}/notes")
def list_notes(flight_id: str, p=Depends(pool)):
    return rows(p, "SELECT id, t_s, body, created_at FROM note WHERE flight_id = %s ORDER BY t_s, id", (flight_uuid(flight_id),))


@router.post("/flights/{flight_id}/notes", status_code=201)
def add_note(flight_id: str, note: NoteBody, p=Depends(pool)):
    if not WRITES_ENABLED:
        raise HTTPException(403, "this deployment is read-only")
    fid = flight_uuid(flight_id)
    if not rows(p, "SELECT 1 FROM flight WHERE id = %s", (fid,)):
        raise HTTPException(404, "unknown flight")
    if rows(p, "SELECT count(*) AS n FROM note WHERE flight_id = %s", (fid,))[0]["n"] >= 200:
        raise HTTPException(409, "this flight already has 200 notes")
    return rows(p, "INSERT INTO note (flight_id, t_s, body) VALUES (%s, %s, %s) RETURNING id, t_s, body, created_at", (fid, note.t_s, note.body.strip()))[0]


@router.delete("/notes/{note_id}", status_code=204)
def delete_note(note_id: int, p=Depends(pool)):
    if not WRITES_ENABLED:
        raise HTTPException(403, "this deployment is read-only")
    with p.connection() as c:
        if c.execute("DELETE FROM note WHERE id = %s", (note_id,)).rowcount == 0:
            raise HTTPException(404, "unknown note")


@router.get("/pipeline")
def pipeline(p=Depends(pool)):
    """State of every batch stage: queue counts, recent failures with their errors, and how fresh the derived tables are."""
    return {
        "stages": rows(p, """SELECT 'ingest' AS stage, status, count(*) AS n, max(finished_at) AS last_finished FROM ingest_job GROUP BY status
                             UNION ALL SELECT stage, status, count(*), max(finished_at) FROM flight_task GROUP BY stage, status ORDER BY 1, 2"""),
        "failures": rows(p, """SELECT 'ingest' AS stage, log_id AS item, status, attempts, left(last_error, 200) AS error, finished_at FROM ingest_job WHERE status IN ('failed', 'missing')
                               UNION ALL SELECT t.stage, f.source_ref, t.status, t.attempts, left(t.last_error, 200), t.finished_at
                               FROM flight_task t JOIN flight f ON f.id = t.flight_id WHERE t.status = 'failed' ORDER BY finished_at DESC NULLS LAST LIMIT 20"""),
        "ingest_seconds": rows(p, "SELECT round(avg(elapsed_s)::numeric, 2) AS avg_s, round(max(elapsed_s)::numeric, 1) AS max_s, round(sum(rows_loaded)::numeric) AS rows FROM ingest_job WHERE status = 'done'")[0],
        "derived": rows(p, """SELECT (SELECT count(*) FROM semantic.signal_summary) AS signal_summary_rows,
                                     (SELECT count(*) FROM flight_signature) AS signatures,
                                     (SELECT count(*) FROM flight) AS flights,
                                     (SELECT count(*) FROM event WHERE embedding IS NULL) AS events_without_embedding,
                                     (SELECT count(*) FROM note) AS notes""")[0],
    }
