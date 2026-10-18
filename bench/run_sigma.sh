#!/bin/sh
# Controlled difficulty comparison: the same 50,000 vectors at the gentler noise level (the harder one, sigma 0.8, is already measured at 50,000).
# Waits for the engine comparison to finish first, because both measure latency and must not overlap.
cd /app
while ! grep -q 'wrote /bench/results/engines\|Traceback' /data/bench_engines.log; do sleep 20; done
echo "=== $(date -u +%FT%TZ) generate 50k, sigma 0.35";  python scripts/bench_vectors.py --n 50000 --sigma 0.35
echo "=== $(date -u +%FT%TZ) index benchmark";           python scripts/bench_ann.py --label sigma0.35
echo "=== $(date -u +%FT%TZ) SIGMA DONE"
