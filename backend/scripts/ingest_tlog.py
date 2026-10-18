"""Load one ArduPilot MAVLink telemetry log: proves the ontology maps a second autopilot's dialect onto the same canonical signals.

  python scripts/ingest_tlog.py /data/raw/mavlink/vtol.tlog
"""
import argparse

import psycopg

from app.config import settings
from app.ingest.load import load
from app.ingest.mavlink import parse

p = argparse.ArgumentParser()
p.add_argument("path")
p.add_argument("--source-url", default="https://github.com/ArduPilot/UAVLogViewer/blob/master/src/assets/vtol.tlog")
a = p.parse_args()

r = parse(a.path, a.source_url)
with psycopg.connect(settings.dsn, autocommit=True, options="-c timezone=UTC") as conn:
    vf = {(t, f): i for i, t, f in conn.execute("SELECT id, topic, field FROM vendor_field WHERE autopilot = 'ardupilot'")}
    missing = [(t, f) for t, f, *_ in r["hot"] if (t, f) not in vf]
    if missing:
        raise SystemExit(f"run scripts/seed_ontology.py first; unmapped fields: {missing}")
    n = load(conn, vf, r)
    if n == 0:
        print("already loaded (same file content)")
    else:
        print(f"loaded {n:,} telemetry rows from {len(r['hot'])} series, {r['duration_s']:.0f} s flight starting {r['t0']:%Y-%m-%d %H:%M} UTC")
        for t, f, ts, v in sorted(r["hot"], key=lambda x: -len(x[3]))[:20]:
            print(f"  {t}.{f}: {len(v)} samples")
