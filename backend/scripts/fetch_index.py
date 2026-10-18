"""Download the Flight Review public log index (metadata for every public log). Atomic and idempotent."""
import argparse
import os
from pathlib import Path

import httpx

p = argparse.ArgumentParser()
p.add_argument("--out", default="/data/raw/dbinfo.json.gz")
p.add_argument("--refresh", action="store_true")
a = p.parse_args()

dest = Path(a.out)
if dest.exists() and not a.refresh:
    print(f"index present ({dest.stat().st_size / 1e6:.0f} MB), skipping")
else:
    dest.parent.mkdir(parents=True, exist_ok=True)
    with httpx.Client(follow_redirects=True, timeout=300) as c:
        r = c.get("https://review.px4.io/dbinfo")
        r.raise_for_status()
    tmp = dest.with_suffix(".part")
    tmp.write_bytes(r.content)
    os.replace(tmp, dest)
    print(f"downloaded index {len(r.content) / 1e6:.0f} MB")
