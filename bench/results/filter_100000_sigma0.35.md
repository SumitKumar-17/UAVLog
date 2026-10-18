# Filtered vector search, 100,000 vectors

200 queries, top-10, ground truth by exact filtered search. 'rows' is the mean number of rows returned (target 10); 'short' counts queries that returned fewer rows than exist.

## Independent filter (`bucket < t`, exact selectivities)

| strategy | 0.01% | 0.1% | 1% | 10% | 50% |
|---|---|---|---|---|---|
| hnsw post-filter, ef_search=40 | R 0.00 · 0.0 rows · 1.3 ms | R 0.00 · 0.0 rows · 1.4 ms | R 0.04 · 0.4 rows · 1.6 ms | R 0.38 · 4.1 rows · 1.5 ms | R 0.79 · 10.0 rows · 1.4 ms |
| hnsw post-filter, ef_search=400 | R 0.00 · 0.0 rows · 3.6 ms | R 0.03 · 0.3 rows · 3.4 ms | R 0.42 · 4.2 rows · 3.7 ms | R 0.96 · 10.0 rows · 3.5 ms | R 0.97 · 10.0 rows · 3.0 ms |
| hnsw iterative relaxed, ef=40 | R 0.19 · 1.3 rows · 98.8 ms | R 0.96 · 10.0 rows · 50.1 ms | R 0.97 · 10.0 rows · 6.8 ms | R 0.87 · 10.0 rows · 2.3 ms | R 0.79 · 10.0 rows · 1.8 ms |
| hnsw iterative strict, ef=40 | R 0.16 · 1.1 rows · 98.0 ms | R 0.84 · 9.9 rows · 59.0 ms | R 0.88 · 10.0 rows · 6.8 ms | R 0.79 · 10.0 rows · 2.6 ms | R 0.79 · 10.0 rows · 1.5 ms |
| hnsw iterative relaxed, scan limit N | R 1.00 · 7.0 rows · 586.6 ms | R 0.97 · 10.0 rows · 47.2 ms | R 0.97 · 10.0 rows · 6.2 ms | R 0.87 · 10.0 rows · 1.9 ms | R 0.79 · 10.0 rows · 1.4 ms |
| b-tree filter + exact sort | R 1.00 · 7.0 rows · 0.5 ms | R 1.00 · 10.0 rows · 1.0 ms | R 1.00 · 10.0 rows · 7.0 ms | R 1.00 · 10.0 rows · 55.1 ms | R 1.00 · 10.0 rows · 329.0 ms |
| planner's choice (hnsw + b-trees) | R 1.00 · 7.0 rows · 0.4 ms | R 1.00 · 10.0 rows · 1.1 ms | R 1.00 · 10.0 rows · 7.2 ms | R 0.37 · 4.0 rows · 1.6 ms | R 0.78 · 10.0 rows · 1.5 ms |

## Filter correlated with the query (`kind_id` = the query's own kind)

| strategy | common (>10%) | medium (1-10%) | rare (<1%) |
|---|---|---|---|
| hnsw post-filter, ef_search=40 | R 0.92 · 10.0 rows · 1.2 ms | R 0.66 · 10.0 rows · 1.9 ms | R 1.00 · 10.0 rows · 1.2 ms |
| hnsw post-filter, ef_search=400 | R 0.99 · 10.0 rows · 2.7 ms | R 0.95 · 10.0 rows · 7.8 ms | R 1.00 · 10.0 rows · 2.8 ms |
| hnsw iterative relaxed, ef=40 | R 0.92 · 10.0 rows · 1.4 ms | R 0.66 · 10.0 rows · 2.2 ms | R 1.00 · 10.0 rows · 1.3 ms |
| hnsw iterative strict, ef=40 | R 0.92 · 10.0 rows · 1.3 ms | R 0.66 · 10.0 rows · 2.0 ms | R 1.00 · 10.0 rows · 1.2 ms |
| hnsw iterative relaxed, scan limit N | R 0.92 · 10.0 rows · 1.2 ms | R 0.66 · 10.0 rows · 1.9 ms | R 1.00 · 10.0 rows · 1.2 ms |
| b-tree filter + exact sort | R 1.00 · 10.0 rows · 145.3 ms | R 1.00 · 10.0 rows · 44.2 ms | R 1.00 · 10.0 rows · 8.5 ms |
| planner's choice (hnsw + b-trees) | R 0.91 · 10.0 rows · 1.2 ms | R 0.66 · 10.0 rows · 1.9 ms | R 0.90 · 10.0 rows · 0.6 ms |
| partial hnsw per kind, ef=40 | R 0.91 · 10.0 rows · 1.5 ms | R 0.66 · 10.0 rows · 2.1 ms | R 1.00 · 10.0 rows · 1.3 ms |
| list partitions + hnsw, ef=40 | R 0.93 · 10.0 rows · 1.5 ms | R 0.66 · 10.0 rows · 2.1 ms | R 1.00 · 10.0 rows · 0.8 ms |
| diskann labels, list=100, rescore=200 | R 0.77 · 10.0 rows · 5.0 ms | R 0.46 · 10.0 rows · 8.5 ms | R 1.00 · 10.0 rows · 4.1 ms |

## Build cost

| strategy | build time | size |
|---|---|---|
| hnsw | 62.1 s | 819 MB |
| hnsw+btrees | 57.2 s | n/a |
| partial hnsw per kind | 61.8 s | 819 MB |
| list partitions + hnsw | 101.1 s | n/a |
| diskann with labels | 620.8 s | n/a |
