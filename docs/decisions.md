# Decision log

Format: decision, why, alternatives, evidence. The report is drawn from this file.

## D1. One Postgres (TimescaleDB + pgvector) as the core store
Time-series, relational metadata, ontology and vectors in one engine: one transaction boundary, SQL joins across
all of them, hybrid retrieval in a single query plan. Alternatives: polyglot (ClickHouse + Qdrant + Neo4j), rejected
for operational weight and because it hides the planner trade-offs we want to study; kept only as benchmark comparators.

## D2. Narrow telemetry table: only ontology-mapped ("hot") fields in the DB, everything else in Parquet
Full-rate raw data (all ~60-150 topics per log) stays in Parquet; the DB holds the ~34 mapped signals as
`(flight_id, ts, vendor_field_id, value)`. The semantic view `canonical_telemetry` joins through `field_mapping`.
Trade-off: a narrow table needs a join to name signals and cannot read two signals in one row without pivoting;
a wide per-topic table avoids that but fits a changing schema poorly (firmware drift). To be benchmarked.

## D3. Columnstore with segmentby (flight_id, vendor_field_id), orderby ts
Evidence (`bench/results/size_*.json`, 300 flights, 70.7M rows): rowstore 12.47 GB (176 B/row; the B-tree index
was 7.6 GB, larger than the 4.9 GB table) vs columnstore 0.40 GB (5 B/row), about 31x smaller; query results verified
identical against the Parquet source. Consequence: the DB is the smallest part of the footprint; raw logs and Parquet dominate.

## D4. Compression is an explicit, repeatable stage that also handles partial chunks
Inserting into an already compressed chunk works but leaves it "partial" with new rows uncompressed; the first
version of the compress stage skipped such chunks. Found by test; `compress.py` now re-compresses them. Large runs
compress after every ingest round, because uncompressed rowstore is ~30x larger (a 10k-log run would otherwise need
~400 GB of transient space).

## D5. Postgres job table with SKIP LOCKED for all batch pipelines
Idempotent, retried, crash-recoverable, concurrent, expandable (see AGENTS.md). Chosen over Celery/Redis: fewer
moving parts, transactional (data and job status commit together), and itself a database topic.

## D6. Data quality guards at ingest
Old PX4 firmware reports bogus GPS UTC (1970). Start time now requires a plausible GPS time, else falls back to the
index date. 10 of 300 logs were affected; found by inspecting chunk ranges, not by assumption.

## D7. Events: state transitions and log messages from the ULog, threshold rules from the DB
Events are the semantic unit for search (text descriptions are embedded next). Sources: PX4 state enums (verified
against PX4-msgs `VehicleStatus.msg`; several remembered values were wrong), logged messages (deduplicated, capped
at 50 per flight), and sustained threshold violations found with a gaps-and-islands window query over
`canonical_telemetry`. Thresholds are data (`app/events/rules.py`), flagged as heuristics to calibrate on labelled flights.
300 flights produced ~3.8k events.

## D8. Pitfall: psycopg `conn.transaction()` inside an implicit transaction is only a savepoint
The first events run reported success but persisted nothing: a preceding read had opened an implicit transaction, so
the "transaction" block was a savepoint and nothing committed. Found by verifying from a fresh connection. Worker
connections that use transaction blocks now run in autocommit mode so blocks are real transactions.

## D9. Pitfall: `UPDATE .. FROM (SELECT .. LIMIT n FOR UPDATE SKIP LOCKED)` can claim more than n rows
Asking for 25 flights claimed 52: the planner may re-run the locking subquery inside the join. Both queues now use
`WITH c AS MATERIALIZED (...)`. Verified: requests of 10, 10 and 5 claim exactly 10, 10 and 5. Matters because the claim
size bounds worker memory.

## D10. Event quality: vocabulary coverage and baseline guard (measured)
Search exposed two defects before any metric would have: (1) no propulsion events existed, so "motor problem" matched the
word "Motors armed"; fixed by extracting PX4 `failure_detector_status` (present in 234 of 300 logs; it fires for roll/pitch
limits in 27/12 logs, motor failure in 4, imbalanced propeller in 1, ESC arming in 1). (2) Rules fired on flights where the
signal never left the condition (battery estimate stuck at 0%, no GPS at all). Rules now need a same-flight baseline (an
event is a deviation). Effect on 300 flights: `battery_low` 120 to 97, `gps_poor` 48 to 27 (false events removed);
new: 70 attitude-limit, 5 motor-failure, 1 imbalanced-propeller events. Total 3,846 events, all embedded.
Open: thresholds are heuristics (to calibrate on labelled flights); `attitude_limit_exceeded` includes 0 s blips.

## D11. Hybrid retrieval: vector + OR-ed full-text, fused with reciprocal rank fusion (k = 60)
Vector search alone handles paraphrase ("GPS signal lost" finds "GPS lost 3D fix"); full-text alone fails on natural
phrasing because `websearch_to_tsquery` ANDs every word, so the lexical side returned nothing until terms were OR-ed.
Cost: OR-ed terms add lexical noise ("vehicle lost control" also pulls unrelated "..lost" log lines). Known weaknesses to
address next: results cluster in one flight (needs per-flight diversity), and quality so far is anecdotal; a labelled
evaluation set (index `error_labels`, failure-detector flags, injected SITL faults) with precision@k is required before
claiming anything. Embedding cost is negligible (73k tokens for 3.8k events, run twice).
