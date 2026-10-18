"""Download manifest logs politely: rate-limited, atomic writes, retries, resumable."""
import argparse
import json
import os
import sys
import time
from pathlib import Path

import httpx

p = argparse.ArgumentParser()
p.add_argument("--manifest", default="/data/raw/manifest.jsonl")
p.add_argument("--out", default="/data/raw/ulg")
p.add_argument("--limit", type=int, default=0, help="0 = all")
p.add_argument("--delay", type=float, default=6.0, help="seconds between downloads")
p.add_argument("--tries", type=int, default=4)
a = p.parse_args()

out = Path(a.out)
out.mkdir(parents=True, exist_ok=True)
rows = [json.loads(line) for line in open(a.manifest)]
if a.limit:
    rows = rows[: a.limit]


def download(c: httpx.Client, url: str, dest: Path) -> int | None:
    for k in range(a.tries):
        try:
            resp = c.get(url)
            resp.raise_for_status()
            tmp = dest.with_suffix(".part")
            tmp.write_bytes(resp.content)
            os.replace(tmp, dest)  # atomic: a crash never leaves a truncated .ulg
            return len(resp.content)
        except httpx.HTTPError as e:
            print(f"  retry {k + 1}/{a.tries} for {dest.name}: {e}", flush=True)
            time.sleep(10 * (k + 1))
    return None


failed = []
with httpx.Client(follow_redirects=True, timeout=120) as c:
    for i, r in enumerate(rows, 1):
        dest = out / f"{r['log_id']}.ulg"
        if dest.exists():
            continue
        size = download(c, r["download_url"], dest)
        if size is None:
            failed.append(r["log_id"])
            continue
        print(f"[{i}/{len(rows)}] {dest.name} {size / 1e6:.1f} MB", flush=True)
        time.sleep(a.delay)

print(f"done, {len(failed)} failed: {failed}" if failed else "done, 0 failed")
sys.exit(1 if failed else 0)
