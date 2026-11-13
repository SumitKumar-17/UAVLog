# Similar moments: precision at 10 by event kind

18,238 ten-second windows of 297 flights, 32-dimension window embeddings. For each kind that occurs in at least 15 flights, up to 60 query windows (one per flight) that overlap an event of that kind; a result counts when it overlaps an event of the same kind. Base rate is what random results would score.

| event kind | flights | queries | base rate | precision (exact) | precision (HNSW) | lift | HNSW recall vs exact | HNSW p50 ms | queries returning fewer than 10 rows without iterative scan |
|---|---|---|---|---|---|---|---|---|---|
| arm | 35 | 35 | 0.005 | 0.123 | 0.123 | 22.5x | 0.97 | 0.3 | 14% |
| attitude limit exceeded | 26 | 26 | 0.009 | 0.069 | 0.069 | 7.5x | 0.97 | 0.4 | 8% |
| battery low | 41 | 41 | 0.051 | 0.078 | 0.071 | 1.5x | 0.95 | 0.3 | 15% |
| disarm | 71 | 60 | 0.007 | 0.233 | 0.233 | 33.1x | 1.00 | 0.2 | 7% |
| ekf innovation reject | 32 | 32 | 0.016 | 0.166 | 0.166 | 10.5x | 1.00 | 0.2 | 3% |
| failsafe activated | 62 | 60 | 0.013 | 0.023 | 0.023 | 1.7x | 1.00 | 0.2 | 5% |
| landing | 133 | 60 | 0.012 | 0.500 | 0.500 | 43.4x | 1.00 | 0.2 | 3% |
| log error | 97 | 60 | 0.089 | 0.147 | 0.150 | 1.6x | 0.98 | 0.2 | 13% |
| log warning | 199 | 60 | 0.347 | 0.377 | 0.377 | 1.1x | 0.99 | 0.2 | 12% |
| mode change | 200 | 60 | 0.064 | 0.170 | 0.172 | 2.7x | 0.99 | 0.2 | 5% |
| takeoff | 256 | 60 | 0.022 | 0.705 | 0.705 | 32.6x | 1.00 | 0.2 | 0% |
| vibration high | 15 | 15 | 0.022 | 0.247 | 0.247 | 11.2x | 1.00 | 0.3 | 0% |

Mean over kinds: base rate 0.055, precision 0.236 (exact) and 0.236 (HNSW), HNSW recall 0.99, p50 0.3 ms (HNSW with iterative scan). Without iterative scan 7% of queries returned fewer than 10 rows, because the nearest windows are the neighbouring windows of the query's own flight and the filter removes them after the index scan: the filtered-search pitfall measured earlier, on real data.
