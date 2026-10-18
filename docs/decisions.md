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
