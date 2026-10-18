# Vector index benchmark, 100,000 vectors of 1536 dimensions

200 held-out queries, top-10, exact ground truth by sequential scan (362 ms p50 per query). Single connection, warm cache, 3 measured passes. {'timescaledb': '2.30.2', 'vector': '0.8.7', 'vectorscale': '0.9.1'}; shared_buffers 3968MB. Data: noise sigma 0.35, median relative contrast RC10 6.2 (the real 20.48; lower is harder).

| index | build time | size |
|---|---|---|
| HNSW m=16, ef_construction=64 | 56.2 s | 819 MB |
| HNSW m=32, ef_construction=128 | 148.8 s | 819 MB |
| IVFFlat lists=316 (sqrt N) | 17.0 s | 822 MB |
| IVFFlat lists=100 (N/1000) | 8.5 s | 820 MB |
| DiskANN (pgvectorscale), defaults | 268.3 s | 68 MB |

Fastest setting (lowest p50) that reaches a recall target:

| index | recall ≥ 0.90 | recall ≥ 0.95 | recall ≥ 0.99 |
|---|---|---|---|
| HNSW m=16, ef_construction=64 | 2.06 ms (ef_search=160) | 2.66 ms (ef_search=320) | not reached |
| HNSW m=32, ef_construction=128 | 2.03 ms (ef_search=80) | 2.40 ms (ef_search=160) | 3.19 ms (ef_search=320) |
| IVFFlat lists=316 (sqrt N) | 3.52 ms (probes=5) | 5.52 ms (probes=10) | 9.32 ms (probes=20) |
| IVFFlat lists=100 (N/1000) | 4.21 ms (probes=2) | 8.36 ms (probes=5) | 14.75 ms (probes=10) |
| DiskANN (pgvectorscale), defaults | not reached | not reached | not reached |

All settings:

| index | setting | recall@10 | p50 ms | p95 ms | queries/s | rows returned |
|---|---|---|---|---|---|---|
| exact (sequential scan) | none | 1.000 | 362.15 | 626.79 | 3 | 10.0 |
| HNSW m=16, ef_construction=64 | ef_search=10 | 0.590 | 0.99 | 1.32 | 1010 | 10.0 |
| HNSW m=16, ef_construction=64 | ef_search=20 | 0.701 | 1.25 | 1.76 | 798 | 10.0 |
| HNSW m=16, ef_construction=64 | ef_search=40 | 0.788 | 1.52 | 2.42 | 638 | 10.0 |
| HNSW m=16, ef_construction=64 | ef_search=80 | 0.860 | 1.76 | 3.43 | 493 | 10.0 |
| HNSW m=16, ef_construction=64 | ef_search=160 | 0.924 | 2.06 | 5.19 | 367 | 10.0 |
| HNSW m=16, ef_construction=64 | ef_search=320 | 0.964 | 2.66 | 7.58 | 261 | 10.0 |
| HNSW m=32, ef_construction=128 | ef_search=10 | 0.691 | 1.31 | 2.13 | 731 | 10.0 |
| HNSW m=32, ef_construction=128 | ef_search=20 | 0.777 | 1.56 | 2.71 | 596 | 10.0 |
| HNSW m=32, ef_construction=128 | ef_search=40 | 0.850 | 1.78 | 3.97 | 461 | 10.0 |
| HNSW m=32, ef_construction=128 | ef_search=80 | 0.917 | 2.03 | 5.86 | 351 | 10.0 |
| HNSW m=32, ef_construction=128 | ef_search=160 | 0.975 | 2.40 | 8.00 | 270 | 10.0 |
| HNSW m=32, ef_construction=128 | ef_search=320 | 0.997 | 3.19 | 10.79 | 200 | 10.0 |
| IVFFlat lists=316 (sqrt N) | probes=1 | 0.717 | 1.49 | 2.96 | 579 | 10.0 |
| IVFFlat lists=316 (sqrt N) | probes=2 | 0.812 | 2.10 | 4.88 | 415 | 10.0 |
| IVFFlat lists=316 (sqrt N) | probes=5 | 0.924 | 3.52 | 7.48 | 244 | 10.0 |
| IVFFlat lists=316 (sqrt N) | probes=10 | 0.980 | 5.52 | 9.42 | 162 | 10.0 |
| IVFFlat lists=316 (sqrt N) | probes=20 | 1.000 | 9.32 | 13.46 | 102 | 10.0 |
| IVFFlat lists=316 (sqrt N) | probes=50 | 1.000 | 21.91 | 30.20 | 45 | 10.0 |
| IVFFlat lists=316 (sqrt N) | probes=100 | 1.000 | 39.06 | 52.40 | 26 | 10.0 |
| IVFFlat lists=100 (N/1000) | probes=1 | 0.832 | 2.46 | 5.78 | 358 | 10.0 |
| IVFFlat lists=100 (N/1000) | probes=2 | 0.917 | 4.21 | 8.13 | 214 | 10.0 |
| IVFFlat lists=100 (N/1000) | probes=5 | 0.989 | 8.36 | 16.21 | 110 | 10.0 |
| IVFFlat lists=100 (N/1000) | probes=10 | 1.000 | 14.75 | 22.95 | 66 | 10.0 |
| IVFFlat lists=100 (N/1000) | probes=20 | 1.000 | 24.95 | 36.10 | 39 | 10.0 |
| IVFFlat lists=100 (N/1000) | probes=50 | 1.000 | 57.00 | 79.85 | 17 | 10.0 |
| IVFFlat lists=100 (N/1000) | probes=100 | 1.000 | 113.09 | 145.30 | 8 | 10.0 |
| DiskANN (pgvectorscale), defaults | search_list=20, rescore=50 | 0.392 | 2.58 | 4.65 | 343 | 10.0 |
| DiskANN (pgvectorscale), defaults | search_list=50, rescore=50 | 0.392 | 3.31 | 6.99 | 266 | 10.0 |
| DiskANN (pgvectorscale), defaults | search_list=100, rescore=50 | 0.394 | 3.05 | 6.18 | 274 | 10.0 |
| DiskANN (pgvectorscale), defaults | search_list=200, rescore=50 | 0.394 | 3.60 | 7.40 | 230 | 10.0 |
| DiskANN (pgvectorscale), defaults | search_list=400, rescore=50 | 0.395 | 5.23 | 11.56 | 163 | 10.0 |
| DiskANN (pgvectorscale), defaults | search_list=100, rescore=200 | 0.621 | 6.11 | 11.33 | 146 | 10.0 |
| DiskANN (pgvectorscale), defaults | search_list=200, rescore=200 | 0.621 | 5.72 | 11.52 | 146 | 10.0 |
| DiskANN (pgvectorscale), defaults | search_list=400, rescore=400 | 0.741 | 12.21 | 22.13 | 74 | 10.0 |
