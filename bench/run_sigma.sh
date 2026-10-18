#!/bin/sh
# Controlled difficulty comparison: the same 50,000 vectors at the gentler noise level (the harder one, sigma 0.8, is already measured at 50,000).
# Run it after the engine comparison (bench/run_final.sh sequences them): both measure latency and must not overlap.
cd /app
echo "=== $(date -u +%FT%TZ) generate 50k, sigma 0.35";  python scripts/bench_vectors.py --n 50000 --sigma 0.35
echo "=== $(date -u +%FT%TZ) index benchmark";           python scripts/bench_ann.py --label sigma0.35
echo "=== $(date -u +%FT%TZ) SIGMA DONE"
