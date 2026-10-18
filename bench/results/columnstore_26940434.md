# Columnstore physical design, 26,940,434 rows from 100 flights

Median of 7 warm runs per query. TimescaleDB 2.30.2. Queries: Q1 one signal of one flight, 1 s buckets; Q2 one signal across all flights; Q3 every signal of one flight; Q4 one signal in a 90 day window

| variant | chunks | size | bytes/row | compress time | Q1 p50 | Q2 p50 | Q3 p50 | Q4 p50 |
|---|---|---|---|---|---|---|---|---|
| rowstore + b-tree (baseline) | 72 | 3631 MB | 134.8 | n/a | 10.8 ms | 1518.6 ms | 65.1 ms | 246.3 ms |
| columnstore: segment (flight, signal), order ts [current] | 72 | 147 MB | 5.5 | 38 s | 12.3 ms | 16.0 ms | 10.8 ms | 2.7 ms |
| columnstore: segment flight, order (signal, ts) | 72 | 149 MB | 5.5 | 37 s | 12.9 ms | 18.0 ms | 11.6 ms | 3.2 ms |
| columnstore: segment signal, order (flight, ts) | 72 | 154 MB | 5.7 | 35 s | 13.0 ms | 20.3 ms | 14.1 ms | 2.2 ms |
| columnstore: no segmentby, order (flight, signal, ts) | 72 | 157 MB | 5.8 | 39 s | 15.0 ms | 29.7 ms | 13.7 ms | 3.6 ms |
| columnstore: current, 1 day chunks | 109 | 150 MB | 5.6 | 41 s | 16.3 ms | 15.3 ms | 12.3 ms | 3.4 ms |
| columnstore: current, 30 day chunks | 34 | 143 MB | 5.3 | 32 s | 9.2 ms | 8.3 ms | 5.7 ms | 2.4 ms |
