"""Serves benchmark result files (JSON) to the Benchmarks page. Names are validated against a strict pattern and a prefix
whitelist, and the resolved path must stay inside the results directory."""
import json
import os
import re
from pathlib import Path

from fastapi import APIRouter, HTTPException

router = APIRouter(prefix="/api/bench")
# /bench/results inside the Docker image; bench/results in the repository (Vercel); BENCH_DIR overrides both
RESULTS = Path(os.environ.get("BENCH_DIR") or ("/bench/results" if Path("/bench/results").is_dir() else Path(__file__).resolve().parents[3] / "bench" / "results"))
PREFIXES = ("ann_", "filter_", "columnstore_", "engines_", "nlsql_eval_", "eval_search_", "injection_", "signature_", "moments_")
NAME = re.compile(r"^[A-Za-z0-9_.\-]+\.json$")


@router.get("")
def list_results():
    if not RESULTS.is_dir():
        return {"files": []}
    return {"files": sorted(f.name for f in RESULTS.glob("*.json") if f.name.startswith(PREFIXES))}


@router.get("/{name}")
def get_result(name: str):
    if not NAME.match(name) or not name.startswith(PREFIXES):
        raise HTTPException(404, "unknown result file")
    path = (RESULTS / name).resolve()
    if RESULTS.resolve() not in path.parents or not path.is_file():
        raise HTTPException(404, "unknown result file")
    return json.loads(path.read_text())
