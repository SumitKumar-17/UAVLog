"""Upload a PX4 log and watch it go through the pipeline: ingest, events, embeddings, signal windows, summaries.

The body is the raw file (not a multipart form), so no extra dependency is needed. The file is checked (ULog magic bytes, size limit, not already in the database),
saved next to the downloaded logs and queued in `ingest_job` like any other log; then the same stage scripts the batch pipeline uses run one after another in a background
thread. Only one upload is processed at a time.
"""
import hashlib
import json
import os
import subprocess
import sys
import threading
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Query, Request

from app.api.common import client_ip, rows
from app.api.deps import pool
from app.config import settings

router = APIRouter(prefix="/api")
WRITES_ENABLED = os.environ.get("ALLOW_WRITES", "1") == "1"
MAGIC = b"ULog\x01\x12\x35"
MAX_BYTES = 60 * 1024 * 1024
STAGES = [
    ("Upload", None, 0),
    ("Parse and load telemetry", ["scripts/ingest.py", "--limit", "1", "--workers", "1"], 900),
    ("Extract events", ["scripts/events.py", "--workers", "1"], 300),
    ("Embed events", ["scripts/embed_events.py"], 300),
    ("Embed signal windows", ["scripts/build_windows.py", "--workers", "2"], 300),
    ("Refresh summaries", ["scripts/refresh_semantic.py"], 300),
]
JOBS: dict[str, dict] = {}
LOCK = threading.Lock()
_recent: dict[str, list] = {}


def _run(job_id: str) -> None:
    job = JOBS[job_id]
    try:
        for i, (name, cmd, timeout) in enumerate(STAGES):
            st = job["stages"][i]
            if cmd is None:
                continue
            st["status"], t0 = "running", time.time()
            p = subprocess.run([sys.executable, *cmd], capture_output=True, text=True, timeout=timeout, cwd="/app", env=os.environ.copy())
            st["seconds"] = round(time.time() - t0, 1)
            if p.returncode != 0:
                st["status"] = "failed"
                raise RuntimeError((p.stderr or p.stdout).strip().splitlines()[-1][:300] if (p.stderr or p.stdout).strip() else f"{name} failed")
            if i == 1:  # the ingest job carries the real result
                with __import__("psycopg").connect(settings.dsn) as c:
                    r = c.execute("SELECT status, last_error FROM ingest_job WHERE log_id = %s", (job["log_id"],)).fetchone()
                    if not r or r[0] != "done":
                        st["status"] = "failed"
                        raise RuntimeError((r[1] if r and r[1] else "the log could not be parsed")[:300])
                    fid, dur = c.execute("SELECT id, coalesce(duration_s, 0) FROM flight WHERE source_ref = %s", (job["log_id"],)).fetchone()
                    n = c.execute("SELECT count(*) FROM telemetry WHERE flight_id = %s", (fid,)).fetchone()[0]
                    if n < 100 or dur < 5:  # a file with a valid header but no flight in it: remove what was just created
                        c.execute("DELETE FROM flight WHERE id = %s", (fid,))
                        c.execute("DELETE FROM ingest_job WHERE log_id = %s", (job["log_id"],))
                        c.commit()
                        (Path(settings.data_dir) / "raw" / "ulg" / f"{job['log_id']}.ulg").unlink(missing_ok=True)
                        st["status"] = "failed"
                        raise RuntimeError("The file has a valid header but contains no usable flight data (under 5 seconds or no telemetry).")
                    job["flight_id"] = str(fid)
            st["status"] = "done"
        job["status"] = "done"
    except Exception as e:  # noqa: BLE001
        job["status"], job["error"] = "failed", f"{type(e).__name__}: {e}"
    finally:
        job["finished"] = time.time()
        LOCK.release()


@router.post("/uploads")
async def upload(request: Request, name: str = Query("log.ulg", max_length=120), p=Depends(pool)):
    if not WRITES_ENABLED:
        raise HTTPException(403, "this deployment is read-only")
    who, now = client_ip(request), time.time()
    q = _recent.setdefault(who, [])
    q[:] = [t for t in q if now - t < 3600]
    if len(q) >= 10:
        raise HTTPException(429, "Too many uploads this hour.")
    if not LOCK.acquire(blocking=False):
        raise HTTPException(409, "Another log is being processed; try again in a minute.")
    started = False
    try:
        log_id = str(uuid.uuid4())
        dest = Path(settings.data_dir) / "raw" / "ulg" / f"{log_id}.ulg"
        dest.parent.mkdir(parents=True, exist_ok=True)
        sha, total = hashlib.sha256(), 0
        with open(dest, "wb") as f:
            async for chunk in request.stream():
                if total == 0 and not chunk.startswith(MAGIC[: min(len(chunk), len(MAGIC))]):
                    raise HTTPException(400, "This is not a PX4 ULog file (the header does not match).")
                total += len(chunk)
                if total > MAX_BYTES:
                    raise HTTPException(413, f"The file is larger than {MAX_BYTES // 1048576} MB.")
                sha.update(chunk)
                f.write(chunk)
        if total < 64 or not dest.read_bytes()[:7] == MAGIC:
            raise HTTPException(400, "This is not a PX4 ULog file (the header does not match).")
        known = rows(p, "SELECT id FROM flight WHERE log_sha256 = %s", (sha.hexdigest(),))
        if known:
            dest.unlink(missing_ok=True)
            raise HTTPException(409, f"This log is already in the database (flight {str(known[0]['id'])[:8]}).")
        rec = {"log_id": log_id, "log_date": datetime.now(timezone.utc).date().isoformat(), "description": Path(name).name}
        with p.connection() as c:
            c.execute("INSERT INTO ingest_job (log_id, source, payload) VALUES (%s, 'upload', %s)", (log_id, json.dumps(rec)))
        q.append(now)
        job_id = log_id[:12]
        JOBS[job_id] = {"id": job_id, "log_id": log_id, "name": Path(name).name, "bytes": total, "status": "running", "flight_id": None, "error": None, "started": now,
                        "stages": [{"name": n, "status": "done" if i == 0 else "pending", "seconds": None} for i, (n, _, _) in enumerate(STAGES)]}
        threading.Thread(target=_run, args=(job_id,), daemon=True).start()
        started = True
        return JOBS[job_id]
    except Exception:
        if not started:
            LOCK.release()
        raise


@router.get("/uploads/{job_id}")
def upload_status(job_id: str):
    job = JOBS.get(job_id)
    if not job:
        raise HTTPException(404, "unknown upload")
    return job
