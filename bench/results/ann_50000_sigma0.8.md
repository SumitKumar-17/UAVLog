# Vector index benchmark, 50,000 vectors of 1536 dimensions

200 held-out queries, top-10, exact ground truth by sequential scan (245 ms p50 per query). Single connection, warm cache, 3 measured passes. {'timescaledb': '2.30.2', 'vector': '0.8.7', 'vectorscale': '0.9.1'}; shared_buffers 3968MB. Data: noise sigma 0.8, median relative contrast RC10 2.0 (the real 20.48; lower is harder).

| index | build time | size |
|---|---|---|
| HNSW m=16, ef_construction=64 | 45.4 s | 410 MB |
| HNSW m=32, ef_construction=128 | 110.3 s | 410 MB |
| IVFFlat lists=224 (sqrt N) | 7.7 s | 411 MB |
| IVFFlat lists=50 (N/1000) | 4.7 s | 410 MB |
| DiskANN (pgvectorscale), defaults | 79.4 s | 34 MB |

Fastest setting (lowest p50) that reaches a recall target:

| index | recall ≥ 0.90 | recall ≥ 0.95 | recall ≥ 0.99 |
|---|---|---|---|
| HNSW m=16, ef_construction=64 | 1.27 ms (ef_search=40) | 1.49 ms (ef_search=80) | 3.05 ms (ef_search=320) |
| HNSW m=32, ef_construction=128 | 1.50 ms (ef_search=40) | 1.50 ms (ef_search=40) | 2.57 ms (ef_search=160) |
| IVFFlat lists=224 (sqrt N) | 2.47 ms (probes=5) | 2.47 ms (probes=5) | 3.76 ms (probes=10) |
| IVFFlat lists=50 (N/1000) | 3.96 ms (probes=2) | 7.06 ms (probes=5) | 11.28 ms (probes=10) |
| DiskANN (pgvectorscale), defaults | not reached | not reached | not reached |

All settings:

| index | setting | recall@10 | p50 ms | p95 ms | queries/s | rows returned |
|---|---|---|---|---|---|---|
| exact (sequential scan) | none | 1.000 | 244.82 | 281.54 | 4 | 10.0 |
| HNSW m=16, ef_construction=64 | ef_search=10 | 0.720 | 0.90 | 1.17 | 1083 | 10.0 |
| HNSW m=16, ef_construction=64 | ef_search=20 | 0.818 | 1.09 | 1.55 | 881 | 10.0 |
| HNSW m=16, ef_construction=64 | ef_search=40 | 0.902 | 1.27 | 1.97 | 737 | 10.0 |
| HNSW m=16, ef_construction=64 | ef_search=80 | 0.950 | 1.49 | 2.76 | 577 | 10.0 |
| HNSW m=16, ef_construction=64 | ef_search=160 | 0.977 | 1.87 | 3.86 | 438 | 10.0 |
| HNSW m=16, ef_construction=64 | ef_search=320 | 0.994 | 3.05 | 7.32 | 270 | 10.0 |
| HNSW m=32, ef_construction=128 | ef_search=10 | 0.824 | 1.11 | 1.74 | 840 | 10.0 |
| HNSW m=32, ef_construction=128 | ef_search=20 | 0.899 | 1.28 | 2.22 | 703 | 10.0 |
| HNSW m=32, ef_construction=128 | ef_search=40 | 0.958 | 1.50 | 3.04 | 549 | 10.0 |
| HNSW m=32, ef_construction=128 | ef_search=80 | 0.984 | 1.85 | 4.35 | 415 | 10.0 |
| HNSW m=32, ef_construction=128 | ef_search=160 | 0.995 | 2.57 | 7.12 | 301 | 10.0 |
| HNSW m=32, ef_construction=128 | ef_search=320 | 1.000 | 3.23 | 6.77 | 251 | 10.0 |
| IVFFlat lists=224 (sqrt N) | probes=1 | 0.739 | 1.13 | 3.18 | 728 | 10.0 |
| IVFFlat lists=224 (sqrt N) | probes=2 | 0.867 | 1.47 | 3.63 | 566 | 10.0 |
| IVFFlat lists=224 (sqrt N) | probes=5 | 0.955 | 2.47 | 4.62 | 355 | 10.0 |
| IVFFlat lists=224 (sqrt N) | probes=10 | 0.998 | 3.76 | 5.35 | 253 | 10.0 |
| IVFFlat lists=224 (sqrt N) | probes=20 | 1.000 | 6.05 | 8.29 | 161 | 10.0 |
| IVFFlat lists=224 (sqrt N) | probes=50 | 1.000 | 13.82 | 15.87 | 72 | 10.0 |
| IVFFlat lists=224 (sqrt N) | probes=100 | 1.000 | 27.24 | 31.58 | 36 | 10.0 |
| IVFFlat lists=50 (N/1000) | probes=1 | 0.865 | 2.25 | 3.49 | 434 | 10.0 |
| IVFFlat lists=50 (N/1000) | probes=2 | 0.947 | 3.96 | 5.62 | 265 | 10.0 |
| IVFFlat lists=50 (N/1000) | probes=5 | 0.986 | 7.06 | 11.95 | 135 | 10.0 |
| IVFFlat lists=50 (N/1000) | probes=10 | 1.000 | 11.28 | 19.13 | 77 | 10.0 |
| IVFFlat lists=50 (N/1000) | probes=20 | 1.000 | 22.57 | 30.20 | 43 | 10.0 |
| IVFFlat lists=50 (N/1000) | probes=50 | 1.000 | 55.38 | 65.42 | 18 | 10.0 |
| DiskANN (pgvectorscale), defaults | search_list=20, rescore=50 | 0.541 | 2.36 | 3.52 | 389 | 10.0 |
| DiskANN (pgvectorscale), defaults | search_list=50, rescore=50 | 0.550 | 2.55 | 3.96 | 355 | 10.0 |
| DiskANN (pgvectorscale), defaults | search_list=100, rescore=50 | 0.548 | 2.81 | 4.29 | 324 | 10.0 |
| DiskANN (pgvectorscale), defaults | search_list=200, rescore=50 | 0.550 | 3.43 | 5.42 | 266 | 10.0 |
| DiskANN (pgvectorscale), defaults | search_list=400, rescore=50 | 0.550 | 5.24 | 8.63 | 184 | 10.0 |
| DiskANN (pgvectorscale), defaults | search_list=100, rescore=200 | 0.798 | 5.14 | 6.67 | 187 | 10.0 |
| DiskANN (pgvectorscale), defaults | search_list=200, rescore=200 | 0.798 | 5.75 | 7.12 | 170 | 10.0 |
| DiskANN (pgvectorscale), defaults | search_list=400, rescore=400 | 0.889 | 9.88 | 11.70 | 102 | 10.0 |
