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
