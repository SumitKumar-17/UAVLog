# 02 - Database Tech and Benchmarks (research as of 2026-10-18)

Legend: [V] = verified from a fetched page this session; [M] = from model memory / general knowledge, verify before citing; [?] = conflicting or unconfirmed.

## 1. TimescaleDB (hypertables, columnstore, caggs, licensing)

**Current naming [V]**
- Product/company is now "Tiger Data" (docs at tigerdata.com/docs). Latest versions seen: 2.30.2 in docker-ha versions.yaml (PG16-18); non-HA Docker Hub tags like `2.26.1-pg17`.
- Storage engine is called **hypercore**: new data lands in **rowstore**, older chunks convert to **columnstore** (columnar, compressed). Old "compression" terminology is superseded since 2.18.0 but the old API still works (deprecated entities to be removed in 3.0).
- Name mapping: `timescaledb.compress` -> `timescaledb.enable_columnstore`; `compress_chunk` -> `convert_to_columnstore`; compression policy -> `add_columnstore_policy`; `compression_settings` view -> `hypertable_columnstore_settings` [V via Zabbix tracker + 2.24 notes; policy function names are [M]].
- Newer syntax: `CREATE TABLE ... WITH (tsdb.hypertable, tsdb.partition_column='ts')` (2.23 simplified creation, auto partition column, default columnstore policy) [V via summary]. `segmentby` / `orderby` still the key tuning knobs [M]. For UAV data: segmentby = flight_id (+ signal_id if long/narrow), orderby = ts.
- Hypercore **table access method (TAM)** was an experiment, deprecated in 2.21, removed ~2.22; upgrade blocked if used. Do NOT use it [V via Zabbix tracker quoting release notes].
- Sparse indexes (bloom, minmax) on columnstore, configurable since 2.22; "Direct Compress"/direct-to-columnstore INSERT is a tech preview from 2.23 (good for bulk loading) [V].
- Continuous aggregates (caggs): still supported; 2.24 deprecates the partial-cagg format (migrate with `cagg_migrate`) and experimental policy functions; WAL-based invalidation is being deprecated [V]. Real-time aggregates were made opt-in several versions ago [M].
- PG15 support ends in 2026 [V]; use PG17 or 18.

**Licensing [V mostly]**
- Two editions: Apache-2 ("apache") and Community (Timescale License, TSL, "timescale"). Check with `SHOW timescaledb.license;`.
- Compression/columnstore, continuous aggregates, retention/compression policies live under TSL (secondary sources; Tiger docs only say "many recent features" are Community-only) [?partly].
- TSL is free for self-hosting; prohibition is on offering it as a hosted DBaaS. A course project is fine. Cite this in the report ("source-available, not OSI open source").
- `-oss` image tags/builds drop TSL code, so no columnstore/caggs: avoid them. Some managed providers ship only the Apache edition.
- Sources: https://www.tigerdata.com/docs/about/latest/timescaledb-editions , https://www.tigerdata.com/legal/licenses , https://www.tigerdata.com/blog/timescaledb-2-22-2-23-90x-faster-distinct-queries-postgres-18-support-configurable-columnstore-indexes-uuidv7 , https://www.tigerdata.com/docs/use-timescale/latest/hypercore/ , https://docs.timescale.com/release-notes

**Docker images**
- `timescale/timescaledb:latest-pg17` / `2.x.y-pg17` (non-HA, Alpine) [V]. Does NOT include pgvector.
- `timescale/timescaledb-ha:pg17` (or `pg18`) is Debian-based, bundles timescaledb + toolkit + pgvectorscale per repo versions.yaml (pgvectorscale 0.9.1, PG14-18) [V]. pgvector is not in versions.yaml, but an Unraid listing says pgvector is included [?]. pgvectorscale's `CREATE EXTENSION vectorscale CASCADE` pulls in pgvector, so it must be present. **Verify locally:** `docker run --rm -e POSTGRES_PASSWORD=x timescale/timescaledb-ha:pg17` then `SELECT name, default_version FROM pg_available_extensions WHERE name IN ('timescaledb','vector','vectorscale','timescaledb_toolkit');`
- Yes, one Postgres image can hold timescaledb + pgvector (+ pgvectorscale). Fallback: custom Dockerfile `FROM timescale/timescaledb:latest-pg17` + install pgvector from source, or `FROM pgvector/pgvector:pg17` + add timescaledb apt package. Tiger's CloudNativePG tutorial builds PG17 + pgvector 0.8.1 + pgvectorscale 0.9.0 + timescaledb [V]: https://tigerdata.com/blog/deploying-timescaledb-vector-search-cloudnativepg-kubernetes-operator
- Set `shared_preload_libraries='timescaledb'` (HA image does it) and `--shm-size` >= maintenance_work_mem for parallel HNSW builds.

## 2. pgvector, pgvectorscale

**pgvector (README, latest seen 0.8.7, PG13+) [V]** https://github.com/pgvector/pgvector
- HNSW: build `m` (default 16), `ef_construction` (64); query `hnsw.ef_search` (40). Start m=16, efc=64-200; raise ef_search (e.g. 40/100/200/400) for recall. Set `maintenance_work_mem` high and `max_parallel_maintenance_workers` for builds.
- IVFFlat: `lists` = rows/1000 (<=1M rows) or sqrt(rows) (>1M); `ivfflat.probes` default 1, start ~sqrt(lists). Build after data is loaded (needs training data). Faster build, smaller index, lower recall/speed tradeoff than HNSW.
- Types: `vector` (index <=2000 dims), `halfvec` (<=4000), `bit` + `binary_quantize()` with re-rank, `sparsevec`. Use halfvec expression indexes to halve size.
- **Iterative scans (0.8.0+)**: `hnsw.iterative_scan = strict_order | relaxed_order`; `hnsw.max_scan_tuples` default 20000; `hnsw.scan_mem_multiplier` default 1; IVFFlat: `ivfflat.iterative_scan = relaxed_order`, `ivfflat.max_probes`.
- **Filtering behaviour**: filter is applied AFTER the ANN scan. ef_search=40 with a 10%-selective filter returns ~4 rows. Remedies: iterative scans; B-tree index on the filter column when selective (planner may choose exact scan, better cost estimation since 0.8); partial indexes for a few distinct values; partitioning for many. Relaxed order + materialized CTE re-sort restores strict order.
- Directly relevant: hybrid queries like `WHERE vehicle_type='quad' AND ts BETWEEN ... ORDER BY emb <=> q LIMIT 10`. This is a core experiment: compare (a) post-filter default, (b) iterative scan, (c) pre-filter exact (btree/time chunk exclusion), (d) partition per vehicle type, (e) pgvectorscale label filter. Measure recall vs the exact filtered answer.
- Third-party summary: https://www.thenile.dev/blog/2024-11-05-pgvector-080 ; AWS: https://aws.amazon.com/blogs/database/supercharging-vector-search-performance-and-relevance-with-pgvector-0-8-0-on-amazon-aurora-postgresql

**pgvectorscale (PostgreSQL License, v0.9.1, PG14-18) [V]** https://github.com/timescale/pgvectorscale
- `USING diskann (embedding vector_cosine_ops)`; build params `num_neighbors` (50), `search_list_size` (100); query `diskann.query_search_list_size` (100), `diskann.query_rescore` (50). SBQ (statistical binary quantization) is the default memory-optimized layout.
- Label-filtered search: `USING diskann (embedding vector_cosine_ops, labels)` with `smallint[] labels` and `&&` overlap; no parallel builds with labels. Good for "vehicle_type / mission_type" filters but labels must be small ints (needs a mapping table).
- Only cosine distance reported in README as of fetch [?]. Rust/pgrx build if not using the image.
- Claim-check: Timescale's "28x lower latency vs Pinecone" benchmarks are vendor marketing; do not cite as fact.
- At student scale (<1M windows) HNSW is enough; include DiskANN as an optional comparator.

## 3. Embeddings for flight-data windows

Target: windows (e.g. 5-30 s at 10 Hz after resampling, multichannel: roll/pitch/yaw, rates, acc, baro alt, GPS speed, battery V/I, motor outputs) -> fixed vector (64-256 d).

Ranked by practicality for a solo student without GPU:
1. **Handcrafted statistical + spectral features** (recommended baseline, fully interpretable, defensible in an ADBMS report): per channel mean/std/min/max/skew/kurtosis, slope, zero-crossing rate, autocorrelation lag-1, FFT band energies (e.g. 4-8 bands), dominant frequency, spectral entropy. Libraries: `catch22` (22 features per series), `tsfel`, `tsfresh` (heavy), numpy/scipy. Z-normalise per feature using training-set stats, optional PCA to 64-128 d. I did not fetch these libraries' docs this session [M].
2. **Matrix of downsampled raw + normalisation** (PAA/SAX-like) with DTW is impractical in SQL; use only as sanity baseline [M].
3. **TS2Vec** (AAAI 2022, hierarchical contrastive learning; per-timestamp reps, max-pool for instance vector; repo yuezhihan/ts2vec) [V]: https://arxiv.org/abs/2106.10466 . Small CNN, trainable on CPU for modest data (hours), unsupervised, handles multivariate. Repo pins old Python 3.8/torch 1.8; expect porting friction. Good "learned" comparator.
4. **Foundation models**: **MOMENT** (AutonLab/MOMENT-1-small, 37.9M params, MIT license, `task_name='embedding'`; expects 512-step windows; per-channel embeddings) [V partial; 512 length from memory]. https://huggingface.co/AutonLab/MOMENT-1-small . Small is CPU-feasible for batch embedding offline (tens of thousands of windows) but slow; MOMENT processes channels independently, so a 15-channel window = 15 forward passes, then concat/mean. **Chronos-Bolt** (tiny 9M, mini 21M, CPU-capable, T5-based, built for forecasting; encoder embeddings are usable but not designed for similarity) [V]. Original Chronos large models need GPU [V]. Treat FMs as an optional experiment with a few thousand windows; do not make them the core.
5. Evaluation of embeddings (important, otherwise "similarity" is unjustified): create labelled segments from logs (takeoff, hover, cruise, turn, land, high-vibration, failsafe/mode-change events from log messages). Report precision@k / mAP of same-label retrieval for each embedding, and ground truth neighbours via exact scan for ANN recall. Inspect with UMAP/t-SNE plot.
- Dimensionality tip: store as `halfvec`/`vector(64..128)`; keep feature version and window params in a metadata table for reproducibility.

## 4. Benchmark methodology and what ADBMS graders value

Tools [V unless noted]
- **TSBS** (https://github.com/timescale/tsbs): generate / load / run phases; supports TimescaleDB, ClickHouse, InfluxDB, etc.; IoT use case (truck fleet) and devops; reports load rate (rows/s, metrics/s), per-query min/median/mean/max latency. Does not measure concurrent insert+query. Maintenance status unclear [?]. Using it gives credibility for ingest + classic query shapes (lastpoint, high-load, groupby-orderby-limit, daily-avg). Custom UAV-shaped generator is likely a better fit; reuse TSBS query categories.
- **ann-benchmarks** (https://github.com/erikbern/ann-benchmarks): recall-vs-QPS Pareto curves, top-100 ground truth, single-thread queries. README now says "no longer actively maintained", suggests VIBE (https://github.com/vector-index-bench/vibe). pgvector and pgvectorscale are among its implementations. Use its methodology, not necessarily its harness: compute ground truth by exact `SET enable_indexscan=off` scan, sweep ef_search/probes, plot recall@10 vs p50/p95 latency and QPS. Public datasets (SIFT1M, GloVe) as sanity check, then own embeddings.
- **pgbench** (custom scripts `-f`, `-c`, `-j`, `-T`, `-P`, `--rate`, `-r`; `--log` for latency percentiles) for concurrent mixed SQL+vector query workload [M]. `pg_stat_statements`, `EXPLAIN (ANALYZE, BUFFERS)`, `pg_relation_size`, `hypertable_columnstore_stats` / `hypertable_compression_stats` for size [M].
- DuckDB (Parquet scan, `read_parquet`, optionally `vss` extension) and ClickHouse (MergeTree, ORDER BY (flight_id, ts), `cosineDistance`, vector similarity index experimental/GA status uncertain [?]) as comparators.

Suggested workloads
- W1 Ingest: batch COPY vs insert, with/without hypertable, with/without direct-compress; rows/s, time to ready, disk bytes/row. Scale factors: 1, 10, 100 M rows (e.g. N flights x 50-100 Hz x channels; synthesise by replaying/augmenting real public logs: PX4 Flight Review / ArduPilot logs, UAV datasets).
- W2 Time-range + aggregation: single-flight scan, downsample with `time_bucket` vs cagg vs DuckDB-on-Parquet; fleet-wide stats; last-point.
- W3 Columnstore effect: rowstore vs columnstore (segmentby/orderby variants), compression ratio, query speedup/slowdown.
- W4 ANN: HNSW vs IVFFlat vs DiskANN vs exact; build time, index size, recall@10, p50/p95/p99 latency, QPS at concurrency 1/4/16.
- W5 Hybrid: SQL predicate selectivities 100/10/1/0.1% x strategies (see section 2); recall vs exact filtered result.
- W6 NL-to-SQL: question set (30-50) with gold SQL; execution accuracy, valid-SQL rate, guardrail block rate, latency; ablate with/without semantic layer (raw vendor field names vs canonical concepts). This is the novelty, so make this table prominent.
- Methodology hygiene (graders reward): fixed hardware spec reported (CPU, RAM, disk, PG version, config), warm vs cold cache, >=3-5 runs with median and p95/p99 plus variance, pinned versions/containers, scripts in repo for reproducibility, `EXPLAIN` evidence for why results differ, fairness notes (same data, same indexes class, tuned each system reasonably), threats to validity, cost/size tradeoffs, clear honest limitations. Also: index build time, storage footprint, update/insert cost into ANN index (time-series is append-heavy).
- Academic framing for the report: workload characterisation, design alternatives (normalised wide vs narrow signal tables), indexing/physical design (chunk interval, segmentby), query processing (chunk exclusion, vectorized execution), tradeoff analysis. Graders in ADBMS courses typically value physical design reasoning + measured evidence over feature count [M: my judgement, no source].

## 5. Text-to-SQL guardrails and semantic-layer modelling

Guardrails (defence in depth; enforce outside the prompt)
1. **DB-level**: dedicated role `llm_ro` with `NOLOGIN`-style minimal grants: `GRANT SELECT` only on curated views (semantic views over hypertables), no access to base tables, `pg_catalog` functions limited; `ALTER ROLE llm_ro SET statement_timeout='5s'`, `default_transaction_read_only=on`, `idle_in_transaction_session_timeout`, `work_mem`, `temp_file_limit`; `CONNECTION LIMIT`; run on a replica or separate DB if possible. [V general: https://www.deployhq.com/blog/ai-database-access-read-only-guardrails-claude-code , https://particula.tech/blog/text-to-sql-agent-database-role]
2. **SELECT-only is not a boundary** [V, single-source claim, unverified by me]: functions like `pg_read_file`, `COPY ... TO PROGRAM`, `dblink`, `lo_*`, `pg_sleep` must be blocked. Revoke EXECUTE from PUBLIC on dangerous functions and use the unprivileged role (not superuser); parse and reject function calls not on an allow-list.
3. **SQL parsing with sqlglot** [M; I could not confirm docs this session]: `sqlglot.parse(sql, read='postgres')`; require exactly one statement, root `exp.Select` (allow `With`/`Union`), walk `exp.Table` against an allow-list of semantic views, walk `exp.Func`/`exp.Anonymous` against a function allow-list, reject `exp.Into`, locks (`FOR UPDATE`), set-returning abuse, comments; then inject/cap `LIMIT` (`MIN(existing, 1000)`, wrap as subselect if needed) and optionally require a time-range predicate on raw tables. Transpile/normalise for logging. Also `EXPLAIN (FORMAT JSON)` first and reject if planner cost/rows exceed a threshold.
4. **Schema allow-list in prompt** limited to semantic view names, column descriptions, canonical concept names, units; retrieve only relevant tables/columns (schema linking) to cut hallucination.
5. **Loop**: generate -> validate -> dry-run EXPLAIN -> execute with timeout -> on error, one or two repair attempts with the error text -> return SQL to user alongside results (transparency). Log all queries (audit table).
6. Prompt-injection note: data returned (e.g. log message strings in telemetry) is untrusted; do not feed raw row text back into the prompt without delimiters.
7. Eval: report block rate on an adversarial set (DROP, `pg_read_file`, cross-schema access, huge cross join, missing LIMIT).

Semantic layer / ontology modelling in relational DB [M unless noted]
- Pragmatic relational pattern: `concept(concept_id, name, parent_id, unit, description, quantity_kind)`, `vendor_field(vendor, firmware, msg_type, field, ...)`, `field_mapping(vendor_field_id, concept_id, scale, offset, unit_from, transform_expr, confidence)`, `concept_synonym` (also embedded for NL linking), `concept_relation(subject, predicate, object)` (is_a, part_of, derived_from). Canonical signal table in narrow form `(flight_id, ts, concept_id, value)` or wide per-flight materialised views; semantic views expose canonical names to the LLM.
- **Hierarchies: recursive CTE (or `ltree`) is sufficient** and recommended: `WITH RECURSIVE` for ancestors/descendants, closure table for speed. Zero extra dependency, runs inside the same Postgres image.
- **Apache AGE** (openCypher in Postgres): version reports conflict: Apache download page shows 1.7.0 with PG18 build; EDB docs claim 1.8.0 (Aug 2026); distro packages at 1.8.0~rc0 [?]. https://age.apache.org/release-notes , https://www.enterprisedb.com/docs/pg_extensions/apache_age/rel_notes/apache_age_1.8.0_rel_notes/ . It must be compiled/installed into your image alongside timescaledb (extra build risk) and graph queries cannot be used inside the LLM-generated pure SQL easily. Recommendation: use recursive CTE as main; mention AGE as future work or run a tiny side experiment (hierarchy-depth traversal latency CTE vs Cypher) only if time permits.
- Optionally export to RDF/OWL (rdflib / Protege) for the ontology deliverable and load into the relational tables; keep source of truth in tables.
- Prior art to cite [M, unverified]: dbt/MetricFlow, Cube semantic layers, BIRD / Spider benchmarks for text-to-SQL, vendor-specific log formats: PX4 ULog, ArduPilot DataFlash, MAVLink.

## Open items to verify before finalising
- Exact contents of `timescale/timescaledb-ha:pg17` (pgvector present?) and current pgvector version inside it.
- Whether columnstore/caggs are TSL-only per current LICENSE files (read LICENSE-TIMESCALE in repo).
- ClickHouse vector index status and syntax in the version used.
- sqlglot API specifics (not fetched); catch22/tsfel docs (not fetched).
- AGE latest stable version.
