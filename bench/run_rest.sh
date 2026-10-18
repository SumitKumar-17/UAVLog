#!/bin/sh
# Remaining benchmark chain, run inside the backend container, one experiment after another (the machine must otherwise be idle).
# Order matters: the DiskANN filter run needs the 100k dataset, which the last step replaces with the harder 50k one.
cd /app
echo "=== $(date -u +%FT%TZ) diskann labels (filtered search)";  python scripts/bench_filter.py --only-diskann --label sigma0.35
echo "=== $(date -u +%FT%TZ) columnstore design";                 python scripts/bench_columnstore.py --flights 100
echo "=== $(date -u +%FT%TZ) timescaledb vs duckdb";              python scripts/bench_engines.py
echo "=== $(date -u +%FT%TZ) harder data: generate 50k, sigma 0.8"; python scripts/bench_vectors.py --n 50000 --sigma 0.8
echo "=== $(date -u +%FT%TZ) harder data: index benchmark";       python scripts/bench_ann.py --label sigma0.8
echo "=== $(date -u +%FT%TZ) CHAIN DONE"
