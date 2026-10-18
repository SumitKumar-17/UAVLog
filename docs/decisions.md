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

## D12. Retrieval evaluation: vector wins; plain RRF hurts; full-text adds nothing measurable (measured)
Benchmark (`bench/eval/concepts.json`, `./backend/scripts/eval_search.py`, results in `bench/results/eval_search_concept.md`):
65 natural-language queries (39 hard, i.e. paraphrases sharing no words with the event text) over 14 concepts, 3,846 events,
text-embedding-3-small. Relevance = right event kind, or a log message matching a concept regex; defined independently of the
methods under test. Mean nDCG@10 with 95% bootstrap CI:

| method | all | hard |
|---|---|---|
| vector only | 0.700 | 0.58 |
| default hybrid (vector 1, full-text 0.25) | 0.700 | 0.58 |
| plain RRF (1, 1) | 0.623 | 0.46 |
| full-text only | 0.48 | 0.32 |

Paired differences: plain RRF minus vector -0.077 [-0.142, -0.022] (significant); default hybrid minus vector -0.000
[-0.013, +0.012] (equal). Leave-one-concept-out selection of the full-text weight gives 0.695 vs 0.700 for vector-only,
so the weight was not tuned on the test queries. I had assumed hybrid would beat vector; the data rejected that.
Decision: default to a vector-dominant fusion (weight 0.25), a judgment call: it is indistinguishable from vector-only here
and keeps exact-term lookups working (easy-query miss rate 0% vs 4%, within noise). Plain RRF stays available for reproducibility.

What this does NOT show: it measures mapping of everyday phrasing to the right event categories, not fault detection (events
come from the autopilot's own detectors and heuristic thresholds). Regex-defined relevance mildly favours lexical methods.
Human-label case study (small n, 300 flights): flights labelled "Vibration" (5): 1 in the top 10, median rank 52 of 300 (chance
about 150); crash-related feedback (7): 2 in the top 10 (chance 0.2), median rank 172. Humans label causes and outcomes our
event vocabulary does not capture. Next: scale labelled flights (all ~1.5k labelled logs in tier k10), and SITL fault injection
for true detection ground truth.

## D13. No absolute relevance cutoff: cosine distances do not separate relevant from irrelevant (measured)
For text-embedding-3-small, event distances to a query sit in a narrow 0.40-0.60 band for every query we tried, and
relevant and irrelevant results overlap (genuine vibration events at 0.56-0.58; unrelated "Motors disarmed" at 0.58 for a
motor query). A threshold would be false precision, so the UI does not draw one. Instead it (1) collapses identical events
(same kind and text) into one row with "same event in N more flights", which removes the visible noise tail without claiming
a relevance score, (2) offers best-match-per-flight, and (3) shows rank, fused score and cosine distance under "Show how
results were ranked". The API returns `distance` so this stays inspectable.

## D12 addendum. Re-measured after event clean-up; the default full-text weight changed from 0.25 to 0.1
After merging near-identical log messages (D14) the event set shrank from 3,846 to 3,401 and the benchmark was re-run.
Conclusion unchanged, one justification withdrawn. Mean nDCG@10 over 65 concept queries: vector-only 0.710, default hybrid
0.700 at weight 0.25 (paired -0.010 [-0.023, +0.002]), plain RRF 0.600 (paired -0.109 [-0.172, -0.051], significant), full-text
only 0.48. I had defended weight 0.25 as a hedge for exact-term lookups (a 4% vs 0% miss rate on easy queries); on the new data
vector-only also has a 0% miss rate, so that argument no longer held. I then tested the hedge directly with 10 exact-term
lookups (module tags such as `[ekf2]`, `[health_and_arming_checks]`), added as a separate slice so the headline benchmark was not
altered after seeing results: vector-only scores nDCG@10 1.000 on all of them, as does every fusion weight. That slice saturates,
so it cannot show benefit or harm; it simply gives no evidence that full-text helps, even where it should. The default is now 0.1,
the weight selected by leave-one-concept-out (0.708 vs 0.710 for vector-only; hybrid minus vector -0.001 [-0.006, +0.003]),
i.e. vector retrieval with a light lexical tie-break. Reportable result: in this corpus, with this embedding model, full-text
fusion does not improve retrieval; plain rank fusion measurably hurts. Hybrid value remains in vector + relational *filters*
(experiment 3), which this benchmark does not test.
Human-label case study after the clean-up (300 flights, small n): "Vibration" label (5 flights) median rank 82 of 300, 0 in the
top 10; crash-related feedback (7 flights) median rank 121, 0 in the top 10. The system does not recover human-labelled causes
from the current event vocabulary; this is the gap SITL fault injection and a larger labelled tier (k10) are meant to close.

## D14. Collapse log messages that differ only in numbers
The first flight page opened with eight "timestamp error" lines differing only in counters. Log events are now de-duplicated on
the message with digits masked: the first occurrence is kept with a repeat count and the last timestamp. 3,846 events became 3,401
(log warnings 1,085 to 762, log errors 313 to 191). Side effect: fewer, more meaningful rows in search and the event list.

## D15. Flight duration: one corrupt timestamp ruined `last_timestamp` (found by the NL-to-SQL gold cross-check)
Three of 300 flights had `duration_s` of about 10^13 seconds because some message carried a garbage timestamp and the parser took
`ULog.last_timestamp`, the maximum over every message. Two more flights were wrong by a factor of 2 to 3. The telemetry itself was
unaffected (it is read per topic). Caught only because the evaluation's gold queries computed an average duration of two billion
minutes. Fix: use Flight Review's own index duration when present (it agrees with the corrected telemetry-derived length on every
checked flight, and in the one case where telemetry ends early it is the log length that is right), else a robust estimate (75th
percentile of each topic's last timestamp, immune to a few outliers). The source and the parsed value are stored in `metadata` for audit.
Five stored rows were corrected with a targeted update after listing them. The same affected the app's "Longest" ordering and chart
ranges. Lesson recorded: sanity-check derived scalars at ingest (a duration far above the index value should fail loudly).
Also found: one flight reports a battery voltage of 2,063 V (a sensor glitch). Raw telemetry has outliers; summaries surface them.

## D16. NL-to-SQL: guarded, read-only, and measured with and without the semantic layer (experiment 5)

**Design.** A `semantic` schema of documented views (flights, events, signals, telemetry, ontology, and a precomputed per-flight
`signal_summary`); the prompt is built from the view and column comments in the catalog, so documentation lives next to the data. Four
defences: (1) a `sqlglot` guard (one SELECT, allow-listed views and functions, no nested or recursive WITH, row cap with a sentinel row so
truncation is reported, and the *regenerated* SQL is what runs, never the model's text); (2) a role that sees only the views; (3) a read-only
transaction with a statement timeout; (4) cost-based admission control (`EXPLAIN` before running; realistic questions plan at under 5,000,
one signal across all flights at 59,000, counting every sample at 683,000, a telemetry self-join at 515 million; limit 100,000). Tests: 46
hostile queries refused (each checked for the *intended* reason), 18 legitimate ones accepted, and a pipeline test with a fake model that
obeys prompt injection and must still be stopped (19 tests).

**Method.** 37 dev questions (34 answerable) and 30 held-out test questions (27 answerable) over 8 categories; gold SQL written twice (semantic
views and raw tables) and cross-checked to return identical results (this caught a corrupt-duration data bug, D15, and a tied "lowest voltage"
question). Metric: execution accuracy, i.e. the result set equals the gold's (order-insensitive, numbers within rounding); "strict" requires the
same columns, "lenient" allows extra columns. Three conditions: semantic views; raw tables plus the *same documentation* written against the raw
schema (added after the first dev run exposed that plain raw was a weak baseline); raw tables alone. Model gpt-4o-mini, temperature 0, up to two
self-repair rounds. Paired exact sign tests; bootstrap CIs.

**Process, including mistakes.** The first dev run scored semantic 0.65 vs raw 0.24 but part of that was my harness (Decimal results compared
as strings), one ambiguous question, and a prompt rule I wrote ("prefer counting DISTINCT flight_id") that made the model count flights when asked
for events. Those were fixed on the dev set, then the system was frozen, and a held-out test set written before any model run on it was evaluated.
That first held-out run exposed three further bugs in my infrastructure, all of which unfairly penalised the raw conditions: the guard rejected
the safe `->>` JSON operator, a trailing `; -- comment` counted as a second statement, and a refusal containing the word "pilot-selected" was
mistaken for SQL. These were fixed and the held-out set was run a second time. Prompts are byte-identical across both runs (component hashes in
the result files); both runs are kept. The headline uses run 2 because run 1 overstated the semantic layer's advantage.

**Results** (strict EX, 95% bootstrap CI).

| condition | dev (34) | held-out run 1 (27) | held-out run 2 (27) |
|---|---|---|---|
| semantic views | 0.74 [0.59, 0.88] | 0.89 [0.78, 1.00] | **0.89** [0.78, 1.00] (lenient 0.96) |
| raw tables + same docs | 0.53 [0.35, 0.71] | 0.59 [0.41, 0.78] | **0.70** [0.52, 0.89] |
| raw tables alone | 0.21 [0.09, 0.35] | 0.22 [0.07, 0.37] | **0.26** [0.11, 0.44] |

Paired, run 2: documentation alone lifts raw from 0.26 to 0.70 (12 questions to 0, p = 0.0005); the semantic views add a further 0.19 over
documented raw tables, which is suggestive but **not significant at this sample size** (6 to 1, p = 0.125; dev: 10 to 3, p = 0.092; run 1 had
shown 8 to 0, p = 0.008, which the guard bug had inflated). Failure shape: without documentation the model does not fail loudly, it answers
with confident wrong results (17 of 27 answered-but-wrong for plain raw): filtering `severity = 1` for "critical", matching event kinds with
`description ILIKE`, using the `autopilot` column for the board, mapping label codes wrongly. The semantic condition never fabricated an answer
to an unanswerable question (raw alone fabricated 1 of 3), and its two other misses are an unnecessary refusal (t18) and extra columns under
strict scoring.

**Limits.** One model, one run at temperature 0, small n; the questions, gold queries and the views were written by the same person, so phrasing
may lean toward the view vocabulary; the semantic condition also benefits structurally from the precomputed `signal_summary`, which raw tables
cannot match cheaply (cost admission would refuse the telemetry scans). To strengthen: repeat with a stronger and a weaker model, add
questions, and test paraphrases. Security evidence (hostile queries, fake obedient model) is separate from accuracy evidence.

## D17. Portable database snapshots instead of re-ingesting (`bin/snapshot`)
Everything that took hours (download, ingest, events, embeddings, summaries) lives in the database, so the right sharing unit is a database snapshot,
not the raw logs. Design: `pg_dump` custom format with zstd, plus a manifest (versions, row counts, embedding model, migration head, git commit) and a
SHA-256 checksum, in one tar file; the benchmark schema is excluded because it is regenerable and large. Transports are generic (folder, SSH/rsync such
as an EC2 host, S3, GitHub release up to 2 GB, presigned URL) and `push-db`/`pull-db` copy directly between two Postgres servers. Restore is
non-destructive by construction: verify the checksum, check that the TimescaleDB version is at least the dump's, load into a NEW database using the
required `timescaledb_pre_restore()`/`timescaledb_post_restore()` procedure, compare row counts with the manifest, and only then swap by renaming, keeping
the previous database as `<name>_old_<time>`. A failed restore leaves the live database untouched.
Why not Neon (considered because it was the first example given): Neon's documentation lists TimescaleDB with "only Apache-2 licensed features supported.
Compression is not supported", and the free plan allows 1 GB of Postgres storage per project. Our telemetry depends on the columnstore, whose 32x compression
is what keeps it small, so a Neon copy would be either unusable or 30 times larger. (Checked against Neon's extension and plans pages on 2026-10-18.)
Privacy and licence: the snapshot holds GPS tracks and pilot free text from public CC-BY Flight Review logs and no secrets; `DATA_ATTRIBUTION.md` says to
credit Flight Review. Status: the script has not been exercised end to end yet. First use: `./bin/snapshot create`, then
`./bin/snapshot restore <file> --as scratch` loads it into a separate database without touching the live one.

## D18. Filtered vector search: route by the planner's row estimate (experiment 3)
Evidence: `bench/results/filter_100000_sigma0.35.*`, 100,000 vectors, 200 queries. pgvector applies a filter after the ANN scan, so selective filters
under-return: HNSW post-filter (ef_search 40) returned 0.0 of 10 rows at 0.1% selectivity and 4.1 at 10%; ef_search 400 helps (0.3 and 10) but not at
the selective end. Iterative scan restores the row count (10 at every level) but costs 50 ms at 0.1%, and does not raise base recall. A B-tree filter
plus exact sort returns the right 10 rows in 1.0 ms at 0.1% and 7.0 ms at 1% but 55 ms at 10% and 329 ms at 50%. Crossover is near 1,000 rows.
With both indexes present the planner chose HNSW post-filtering at a 10% filter (4.0 rows, recall 0.37, 1.6 ms): cheap by its cost model, wrong by
completeness. Decision: `app/search.py` asks the planner for the filtered row estimate (`EXPLAIN (FORMAT JSON)` on the filter alone); at or below
1,500 rows it filters first and sorts exactly, otherwise HNSW with `hnsw.iterative_scan = relaxed_order`. The path and estimate are returned and shown.
A filter correlated with the query (its own event kind) is harmless: every variant returned 10 rows; partial indexes (62 s build), list partitions
(101 s) and DiskANN labels (621 s) added nothing at this size. Limit: one table size, one embedding model.

## D19. Vector indexes: HNSW m=32 for events; IVFFlat and DiskANN stay comparators (experiment 2)
Evidence: `ann_100000_sigma0.35.*`. Exact search 362 ms. HNSW m=32 reaches recall 0.95 in 2.4 ms and 0.99 in 3.2 ms (build 149 s, 819 MB); m=16
reaches 0.95 in 2.7 ms and not 0.99. IVFFlat builds 3 to 17 times faster (8.5 to 17 s) but needs 5.5 to 14.8 ms for the same recall. DiskANN is 68 MB
(12x smaller) but did not pass recall 0.74. Decision: HNSW for event embeddings. Controlled difficulty check (`ann_50000_sigma0.35.*` against
`ann_50000_sigma0.8.*`, same N, relative contrast 6.0 and 2.0 against 20.5 for the real corpus): the ranking is stable, HNSW m=32 fastest at 0.99 in
both, DiskANN peaks at 0.845 and 0.889. An earlier 50k-against-100k comparison confounded N and noise and was replaced by this run.

## D20. Columnstore physical design and the engine comparison (experiments 1 and 4)
Evidence: `columnstore_26940434.*` (100 flights, 26.9 M rows, median of 7) and `engines_70731891.*` (70.7 M rows, median of 5). Segmenting by
(flight, signal) ordered by time: 147 MB against 3,631 MB rowstore (25x) and the cross-flight query 1,519 ms to 16 ms. Variants change size by under
10%; chunk count and segmentby change cross-flight speed about 2x. Against DuckDB: DuckDB native wins single-signal slices and the full-scan
aggregate (Q1 4.9 ms, Q5 478 ms); the columnstore wins pruned access (Q3 18.7 ms, Q4 3.8 ms) and the per-flight summary (Q6 1.0 s against 2.0 and 2.6 s).
Load: Timescale COPY 287 k rows/s; DuckDB bulk from Parquet 6.2 M rows/s but 603 rows/s row by row. DuckDB stays a comparator because Postgres adds
concurrent writers, transactions, roles and vectors in the same engine. Not measured: concurrency. A first engines run failed on DuckDB Q1 (a timezone
package); fixed by casting buckets to text and the run was repeated.

## D21. Fault injection on the event detectors (experiment on detection)
Evidence: `injection_eval.*`, 30 real flights, 1,043 variants including controls. A constant fault value is held for 1 to 20 s at a random time and the
unchanged rule engine looks for the right event kind. Below each rule's minimum duration (2 to 3 s) detection is 0 to 7%, by design (the 1 to 3 s
detections of the battery rule are matches elsewhere in the flight, onset error 100 to 200 s). From 5 s, 90 to 100% are found, typically within 1 s of
onset. False alarms on unmodified controls: 23% for battery critically low, 3 to 7% for the others. Weakest result: the battery-low rule.

## D22. Flight signatures and a second autopilot
Signatures (`flight_signature`, vector(32)): 145 statistical and spectral features over 30 signals, scaled, PCA to 32 dimensions (86% of variance).
Sanity check: share of a flight's 5 nearest neighbours on the same board, 0.069 by chance, 0.253 with scaled features, 0.250 with the signature
(`signature_eval.*`); compression to 32 dimensions loses nothing measurable. It is a sanity check, not ground truth. ArduPilot: one MAVLink log
(`vtol.tlog`) is loaded through the same loader and the same ontology; attitude, GPS speed and local position resolve to the canonical signals
(888 attitude samples per axis, 807 position samples). Vibration, motor outputs, EKF ratios, barometric altitude and flight mode are deliberately not
mapped because their meaning differs (`app/ontology/seed_data.py`). The 1-second continuous aggregate (`telemetry_1s`) was created `WITH NO DATA`; a full
refresh over 70 M compressed rows is slow (14 of 300 flights in 45 minutes), so the refresh was cancelled and the charts fall back to the raw path,
which `api/main.py` does automatically.
