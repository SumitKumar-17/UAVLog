# Vector index benchmark, 50,000 vectors of 1536 dimensions

200 held-out queries, top-10, exact ground truth by sequential scan (243 ms p50 per query). Single connection, warm cache, 3 measured passes. {'timescaledb': '2.30.2', 'vector': '0.8.7', 'vectorscale': '0.9.1'}; shared_buffers 3968MB. Data: noise sigma 0.35, median relative contrast RC10 6.0 (the real 20.48; lower is harder).

| index | build time | size |
|---|---|---|
| HNSW m=16, ef_construction=64 | 44.6 s | 410 MB |
| HNSW m=32, ef_construction=128 | 107.6 s | 410 MB |
| IVFFlat lists=224 (sqrt N) | 6.9 s | 411 MB |
| IVFFlat lists=50 (N/1000) | 3.9 s | 410 MB |
| DiskANN (pgvectorscale), defaults | 68.9 s | 34 MB |

Fastest setting (lowest p50) that reaches a recall target:

| index | recall ≥ 0.90 | recall ≥ 0.95 | recall ≥ 0.99 |
|---|---|---|---|
| HNSW m=16, ef_construction=64 | 1.32 ms (ef_search=80) | 1.60 ms (ef_search=160) | 2.09 ms (ef_search=320) |
| HNSW m=32, ef_construction=128 | 1.23 ms (ef_search=40) | 1.47 ms (ef_search=80) | 1.85 ms (ef_search=160) |
| IVFFlat lists=224 (sqrt N) | 2.70 ms (probes=5) | 3.93 ms (probes=10) | 3.93 ms (probes=10) |
| IVFFlat lists=50 (N/1000) | 2.10 ms (probes=1) | 3.32 ms (probes=2) | 7.26 ms (probes=5) |
| DiskANN (pgvectorscale), defaults | not reached | not reached | not reached |

All settings:

| index | setting | recall@10 | p50 ms | p95 ms | queries/s | rows returned |
|---|---|---|---|---|---|---|
| exact (sequential scan) | none | 1.000 | 243.08 | 274.57 | 4 | 10.0 |
| HNSW m=16, ef_construction=64 | ef_search=10 | 0.705 | 0.88 | 1.22 | 1109 | 10.0 |
| HNSW m=16, ef_construction=64 | ef_search=20 | 0.784 | 0.88 | 1.46 | 1055 | 10.0 |
| HNSW m=16, ef_construction=64 | ef_search=40 | 0.863 | 1.06 | 2.06 | 815 | 10.0 |
| HNSW m=16, ef_construction=64 | ef_search=80 | 0.920 | 1.32 | 2.93 | 617 | 10.0 |
| HNSW m=16, ef_construction=64 | ef_search=160 | 0.965 | 1.60 | 4.15 | 464 | 10.0 |
| HNSW m=16, ef_construction=64 | ef_search=320 | 0.990 | 2.09 | 5.53 | 347 | 10.0 |
| HNSW m=32, ef_construction=128 | ef_search=10 | 0.818 | 1.03 | 1.73 | 888 | 10.0 |
| HNSW m=32, ef_construction=128 | ef_search=20 | 0.889 | 1.13 | 2.33 | 741 | 10.0 |
| HNSW m=32, ef_construction=128 | ef_search=40 | 0.943 | 1.23 | 3.18 | 614 | 10.0 |
| HNSW m=32, ef_construction=128 | ef_search=80 | 0.979 | 1.47 | 4.37 | 473 | 10.0 |
| HNSW m=32, ef_construction=128 | ef_search=160 | 0.996 | 1.85 | 5.66 | 372 | 10.0 |
| HNSW m=32, ef_construction=128 | ef_search=320 | 1.000 | 2.55 | 6.91 | 282 | 10.0 |
| IVFFlat lists=224 (sqrt N) | probes=1 | 0.796 | 1.20 | 2.28 | 754 | 10.0 |
| IVFFlat lists=224 (sqrt N) | probes=2 | 0.857 | 1.66 | 3.11 | 555 | 10.0 |
| IVFFlat lists=224 (sqrt N) | probes=5 | 0.948 | 2.70 | 4.44 | 350 | 10.0 |
| IVFFlat lists=224 (sqrt N) | probes=10 | 0.993 | 3.93 | 5.70 | 244 | 10.0 |
| IVFFlat lists=224 (sqrt N) | probes=20 | 1.000 | 7.06 | 10.02 | 141 | 10.0 |
| IVFFlat lists=224 (sqrt N) | probes=50 | 1.000 | 16.17 | 20.17 | 67 | 10.0 |
| IVFFlat lists=224 (sqrt N) | probes=100 | 1.000 | 28.89 | 32.96 | 38 | 10.0 |
| IVFFlat lists=50 (N/1000) | probes=1 | 0.946 | 2.10 | 5.01 | 402 | 10.0 |
| IVFFlat lists=50 (N/1000) | probes=2 | 0.967 | 3.32 | 6.39 | 269 | 10.0 |
| IVFFlat lists=50 (N/1000) | probes=5 | 1.000 | 7.26 | 11.57 | 135 | 10.0 |
| IVFFlat lists=50 (N/1000) | probes=10 | 1.000 | 12.42 | 19.13 | 78 | 10.0 |
| IVFFlat lists=50 (N/1000) | probes=20 | 1.000 | 23.12 | 31.86 | 42 | 10.0 |
| IVFFlat lists=50 (N/1000) | probes=50 | 1.000 | 56.47 | 62.56 | 17 | 10.0 |
| DiskANN (pgvectorscale), defaults | search_list=20, rescore=50 | 0.545 | 2.07 | 3.45 | 427 | 10.0 |
| DiskANN (pgvectorscale), defaults | search_list=50, rescore=50 | 0.546 | 2.25 | 3.81 | 392 | 10.0 |
| DiskANN (pgvectorscale), defaults | search_list=100, rescore=50 | 0.547 | 2.46 | 4.31 | 355 | 10.0 |
| DiskANN (pgvectorscale), defaults | search_list=200, rescore=50 | 0.548 | 2.87 | 5.00 | 305 | 10.0 |
| DiskANN (pgvectorscale), defaults | search_list=400, rescore=50 | 0.548 | 3.72 | 5.97 | 240 | 10.0 |
| DiskANN (pgvectorscale), defaults | search_list=100, rescore=200 | 0.771 | 4.57 | 6.74 | 199 | 10.0 |
| DiskANN (pgvectorscale), defaults | search_list=200, rescore=200 | 0.771 | 4.99 | 7.27 | 183 | 10.0 |
| DiskANN (pgvectorscale), defaults | search_list=400, rescore=400 | 0.845 | 8.60 | 10.70 | 111 | 10.0 |
