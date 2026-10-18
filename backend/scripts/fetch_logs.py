"""Download manifest logs politely (rate-limited, resumable)."""
import argparse
import json
import time
from pathlib import Path

import httpx

p = argparse.ArgumentParser()
p.add_argument("--manifest", default="/data/raw/manifest.jsonl")
p.add_argument("--out", default="/data/raw/ulg")
p.add_argument("--limit", type=int, default=0, help="0 = all")
p.add_argument("--delay", type=float, default=6.0, help="seconds between downloads")
a = p.parse_args()

out = Path(a.out)
out.mkdir(parents=True, exist_ok=True)
rows = [json.loads(line) for line in open(a.manifest)]
if a.limit:
    rows = rows[: a.limit]

with httpx.Client(follow_redirects=True, timeout=120) as c:
    for i, r in enumerate(rows, 1):
        dest = out / f"{r['log_id']}.ulg"
        if dest.exists():
            continue
        resp = c.get(r["download_url"])
        resp.raise_for_status()
        dest.write_bytes(resp.content)
        print(f"[{i}/{len(rows)}] {dest.name} {len(resp.content)/1e6:.1f} MB", flush=True)
        time.sleep(a.delay)
