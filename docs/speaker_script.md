# Speaker script

About 27 minutes for 24 slides, plus questions. Read the **Say** paragraphs in your own rhythm; they are written to be spoken, not read off the slide.
Numbers in **bold** are the ones worth memorising. Anything in *italics after "If asked"* is a prepared answer. Backup slides are for questions.

Keep one rule in mind throughout: **say what was measured, say how sure we are, and say what went wrong.** The honest corrections are the strongest part of this project.

---

## 1. Title (0:00, 30 seconds)

**Say:** Good morning. My project is called Semantic Log Analytics for UAV Flight Logs. The short version: I treated drone flight logs as a database problem, built the whole thing on one PostgreSQL instance, and measured every design choice, including the ones that turned out wrong. The code and every result are public on GitHub.

---

## 2. Flight logs are a database problem (0:30, 1 minute)

**Say:** A drone's flight controller records dozens to hundreds of message types, some of them hundreds of times a second. I used 300 real PX4 flights. That is **70.7 million telemetry samples** and 3,401 events extracted from them.
What makes this a database problem is that the data is three things at once. It is time series. It is text: warnings, mode changes, notes from pilots. And it is in vendor dialects: PX4 and ArduPilot name the same quantity differently and in different units.
People want to ask in words: which flights lost a motor? Existing tools like Flight Review or UAV Log Viewer plot one log at a time. As far as I could find, no published system combines an ontology, hybrid retrieval and guarded natural-language SQL over PX4 logs. I say "as far as I could find" on purpose.

**Transition:** So what exactly did I try to answer?

---

## 3. Four questions (1:30, 1 minute)

**Say:** Four questions, and each is answered by an experiment, not an opinion. One, storage: how should high-rate telemetry be stored and what does it cost? Two, retrieval: which vector index, how should filtered search work, and does full-text fusion help? Three, natural-language access: can a model write safe and correct SQL, and what does a semantic layer actually add? And four, operations: does the pipeline survive bad input and scale from 300 logs to hundreds of thousands?
Everything lives in one PostgreSQL instance: TimescaleDB for time series and pgvector for similarity.

---

## 4. Data and method (2:30, 1 minute)

**Say:** The data is the public PX4 Flight Review collection: 478,918 logs. I chose 300 with a seeded, stratified sample, 8.75 gigabytes, licensed under Creative Commons Attribution. Everything ran on a four-core, 15 gigabyte workstation with no GPU, so the numbers are modest but honest.
The rules I held myself to are on the right. Measure, don't assume. Keep a development set and a held-out set. Report intervals and paired tests, not single numbers. And report every mistake with its fix. You will see that last rule used a lot in this talk.

---

## 5. Architecture (3:30, 1 minute 15 seconds)

**Say:** Logs are downloaded, then parsed into two places: a Parquet lake that keeps every topic at full rate, and a hypertable that holds only the 34 signals the ontology knows about. Events come from the logs and from rules over the telemetry; they are embedded and indexed with HNSW. A semantic layer of documented views sits behind a read-only role for natural-language SQL. A FastAPI service exposes it and a Next.js app shows it.
Two design points. It is one database, so one transaction boundary and real joins across time series, text and vectors. And every batch stage is a Postgres job queue: idempotent, concurrent, retried and recoverable after a crash. I will come back to what that cost me in bugs.

---

## 6. Storage: 32 times smaller (4:45, 1 minute 15 seconds)

**Say:** First result. The same 70.7 million samples take **12.46 gigabytes** as ordinary rows with their index, and **0.38 gigabytes** in the columnstore: **thirty-two times smaller**. That is 176 bytes per row against 5. I checked that query results are identical against the Parquet source, because a number like that deserves suspicion.
A detail that surprised me: as plain rows, the index was bigger than the table: 7.6 gigabytes against 4.9. The columnstore is segmented by flight and signal and ordered by time, which matches how people actually read this data: one signal of one flight over a window.
And a bug that testing found: inserting into an already compressed chunk works, but leaves it partially compressed. My first compression stage skipped such chunks, which at scale would have silently left data uncompressed. It now recompresses them.

**Numbers:** 12.46 GB to 0.38 GB; 176 to 5 bytes per row; index 7.6 GB against table 4.9 GB.

---

## 7. Columnstore design experiment (6:00, 1 minute 30 seconds)

**Say:** I asked whether those design choices matter, so I loaded 100 flights, 26.9 million rows, into seven variants. The baseline is rows with a B-tree: 3.6 gigabytes. The columnstore variants are all around 150 megabytes: **twenty-five times smaller on this subset**.
Speed is the bigger story. A query for one signal across all flights goes from **1,519 milliseconds to 16**, about ninety-five times faster. A 90-day window goes from 246 milliseconds to under 3. The one place the old design keeps up is one signal of one flight, ten milliseconds against twelve, because a B-tree is already ideal for a point lookup.
Between the columnstore variants, differences are small. Size varies by under ten percent. What does matter, by about a factor of two, is removing the segment-by column, which slows cross-flight queries, and the chunk interval: thirty-day chunks mean fewer chunks and faster cross-flight reads. I kept seven days for now because bigger chunks mean more uncompressed data waiting during a large ingest, and I will re-run this at scale.

**If asked why not 30-day chunks now:** *A 30-day chunk at ten thousand flights holds hundreds of flights before it is compressed, so the transient disk need is much larger and re-compressing after late inserts is slower. It is a trade-off I will measure on the large run, not guess.*

---

## 8. TimescaleDB against DuckDB (7:30, 1 minute 15 seconds)

<<ENGINES-SPEECH>>

---

## 9. The semantic layer (8:45, 1 minute 15 seconds)

**Say:** The semantic layer is an ontology stored in tables: 63 concepts and 55 relations. There are 34 canonical signals, 7 subsystems, 7 failure modes and 15 event kinds. Every vendor field maps to a canonical signal with a scale, an offset and a note, so people write battery.voltage instead of battery_status.voltage_v.
To test whether this is more than renaming, I mapped a second autopilot, ArduPilot, from a real MAVLink log. Attitude, GPS, position, velocity and battery map cleanly after unit conversions. But I deliberately did **not** map five things: vibration, motor outputs, the estimator ratios, barometric altitude and flight mode. They mean different things in the two systems. For example, PX4's vibration number is a filtered acceleration metric, while ArduPilot reports a per-axis standard deviation; on a VTOL, servos one and two are control surfaces, not motors. A wrong mapping is worse than a gap, and the notes in the mapping table record why.

**Numbers:** 63 concepts, 55 relations, 34 signals; 18 ArduPilot mappings, 5 deliberately unmapped.

---

## 10. Events and how well the detectors work (10:00, 1 minute 15 seconds)

**Say:** The 3,401 events come from three sources: state changes in the log such as flight mode and arming, the autopilot's own failure detector, and threshold rules that I find with a gaps-and-islands window query over the telemetry. Two quality rules came from testing. A rule only fires against a baseline in the same flight, so a battery gauge stuck at zero for a whole flight is not a low-battery event. And repeated log messages that differ only in numbers collapse into one event with a count: that took 3,846 events down to 3,401.
<<INJECTION-SPEECH>>
I will be honest that the thresholds themselves are heuristics; I did not calibrate them against real fault data.

---

## 11. Search: the hybrid did not win (11:15, 1 minute 30 seconds)

**Say:** Now retrieval. I embedded the events and expected that fusing vector search with full-text search would beat vectors alone. I tested that with 65 natural-language queries, 39 of them pure paraphrases that share no words with the event text.
Vector only scored **0.710** on nDCG at ten. A light full-text tie-break, weight 0.1, chosen by leave-one-concept-out so I did not tune on the test queries, scored **0.709**: the same. Plain reciprocal rank fusion, the textbook way, scored **0.600**, which is significantly worse: minus 0.109 with a confidence interval from minus 0.172 to minus 0.051. Full-text alone scored 0.48.
I even built a separate set of ten exact-term lookups, like the module tag ekf2, to give full-text its best chance. Vector search scored a perfect 1.0 on all of them too, so that test could not show any benefit either. My conclusion is narrow: for this corpus and this embedding model, full-text fusion adds nothing measurable.
One more finding that shaped the interface: cosine distances sit in a narrow band, 0.40 to 0.60, and do not separate relevant from irrelevant results. So the app shows no relevance percentage; that would be false precision. It collapses identical events instead.

**If asked about the weak human-label result:** *Flights that humans labelled vibration had a median rank of 82 out of 300, where chance is about 150. People label causes and outcomes that our event vocabulary does not capture. That is the gap fault injection and a larger labelled set are meant to close.*

---

## 12. Vector indexes at 100,000 vectors (12:45, 1 minute 45 seconds)

**Say:** Which index? At 3,401 real vectors an index would not matter, so I scaled the real embeddings up to **100,000** by perturbing them, keeping the real attributes. I will talk about how realistic that is on the next slide. Exact search takes 362 milliseconds per query.
HNSW with m of 32 reaches 0.95 recall in **2.4 milliseconds** and 0.99 in 3.2. That is more than a hundred times faster than exact search. With m of 16 it reaches 0.95 but never 0.99. IVFFlat needs 5 to 8 milliseconds for 0.95, and 9 to 15 for 0.99, but it builds three to seventeen times faster: 17 seconds against 149 for the best HNSW.
DiskANN is interesting: the index is only **68 megabytes** against about 820, twelve times smaller, because it stores compressed codes. But at default settings it never gets above 0.74 recall and it took 268 seconds to build. So the trade is clear: HNSW for query speed, IVFFlat for build speed, DiskANN for size if you can tolerate the recall.

**Numbers:** exact 362 ms; HNSW m=32: 2.4 ms at 0.95, 3.2 ms at 0.99, build 149 s; IVFFlat 316 lists: 5.5 ms and 9.3 ms, build 17 s; DiskANN 68 MB, max recall 0.74, build 268 s; index sizes about 820 MB.

---

## 13. Does data difficulty change the winner? (14:30, 1 minute 15 seconds)

<<SIGMA-SPEECH>>

---

## 14. Filtered search: post-filtering fails (15:45, 1 minute 45 seconds)

**Say:** Real queries have filters: only critical events, only this board. pgvector finds neighbours first and applies the SQL filter afterwards, so a selective filter can leave fewer rows than you asked for. I measured how bad that is with a filter that keeps an exactly controlled fraction of rows.
Plain HNSW post-filtering returns **zero rows** when the filter keeps a tenth of a percent, 0.4 rows at one percent, and only 4 of 10 at ten percent. Raising the search effort helps only from ten percent up. Iterative scans fix the row count down to a tenth of a percent, but they cost 50 milliseconds there. And the winner for selective filters is the plain approach: filter first with a B-tree, then sort the survivors exactly: **1 millisecond at 0.1 percent, 7 at one percent, and always exact**. It loses badly when the filter is not selective, 329 milliseconds at fifty percent.
So there is a crossover, near a thousand matching rows. Neither approach wins everywhere.

---

## 15. The planner picks wrong, so the search routes itself (17:30, 1 minute 15 seconds)

**Say:** This is my favourite result. When both indexes exist and the filter keeps ten percent, PostgreSQL chose HNSW post-filtering: it returned **4 of 10 requested rows**, a recall of 0.37, in 1.6 milliseconds. It is fast and wrong, and the cost model cannot know that it under-returns.
So the search does not trust the planner here. It asks the planner one cheap question, how many rows survive the filter alone, and if that is about 1,500 or fewer it takes the exact path; otherwise HNSW with iterative scan. The threshold comes straight from the crossover I measured, and I will re-tune it on the big machine.
A relief for the common case: when the filter is correlated with the query, like a query about motor failures filtered to the motor-failure event kind, every variant returned all ten rows, and partial indexes and partitions added nothing at this size.

---

## 16. Natural-language SQL: four defences (18:45, 1 minute 15 seconds)

**Say:** Letting a model write SQL needs defence in depth, because select-only is not a security boundary. First, a guard built on sqlglot: exactly one SELECT, allow-lists of tables and functions, no nested or recursive WITH, and, importantly, **the query that runs is rebuilt from the parse tree**, never the model's text. Second, a database role that can read only a set of documented views. Third, a read-only transaction with an eight-second limit. Fourth, cost admission: before running, I ask the planner for its estimate and refuse anything above 100,000. Realistic questions plan under 5,000; a telemetry self-join plans at **515 million**.
It is tested: 46 hostile queries, each refused for the intended reason, and I checked each reason because a refusal for the wrong reason proves nothing. A fake model that obeys prompt injection is still stopped. 19 tests.

---

## 17. Does the semantic layer help? (20:00, 2 minutes)

**Say:** Does the semantic layer help the model? I wrote thirty held-out questions before any model saw them, with gold SQL written twice, against the views and against the raw tables, and cross-checked so the two golds agree.
Three conditions: the semantic views; the raw tables with the same documentation; and raw tables alone. Strict accuracy was **0.89, 0.70 and 0.26**. The headline is that **documentation is the big effect**: from 0.26 to 0.70, twelve questions to zero. The views add another 0.19, but with 27 questions that is **not statistically significant**: six to one, p of 0.125. I will not claim more than that.
What worries me more is how the model fails. Without documentation it rarely fails loudly: 17 of 27 answers were confident and wrong, for example treating severity equal to one as "critical". The semantic condition never invented an answer to an unanswerable question.
And now the honest part. My first run said 0.65 against 0.24. Part of that gap was mine: I compared numbers as strings, one question was ambiguous, and one of my prompt rules made the model count flights when asked about events. I fixed those on the development set, froze everything, and ran the held-out set. That exposed three more bugs in my own infrastructure, including a guard that rejected a perfectly safe operator and so penalised the baseline unfairly. I fixed them and ran again with byte-identical prompts. Both runs are in the repository; the second is the headline because the first overstated the advantage.

**If asked why not just trust the first result:** *Because it would have been wrong in the direction that flatters my design. Fixing the baseline's handicaps changed one comparison from significant to not significant.*

---

## 18. Pipeline engineering (22:00, 1 minute)

**Say:** The pipeline stages are job tables claimed with SKIP LOCKED, so any number of workers can run side by side and a crash returns only its own rows. Testing found real pitfalls. SKIP LOCKED with a LIMIT claimed 52 rows when I asked for 25, because the planner re-ran the subquery in the join. A transaction block opened after a read quietly became a savepoint, so nothing committed even though the run said it succeeded; I only saw it from a fresh connection that found an empty table. A parallel index build crashed because I asked for more working memory than the container's shared memory. Two services built from the same code had drifted into different images. And one garbage timestamp made a flight ten to the thirteen seconds long, which only surfaced because an evaluation computed an average duration of two billion minutes.

---

## 19. The interface (23:00, 45 seconds)

**Say:** The interface is built around one idea: a flight is a strip, a ribbon of flight modes with event marks, and the same ribbon shades every chart behind the data. Charts show minimum and maximum envelopes computed in the database, so spikes in safety signals are never averaged away. Colours were validated for colour-vision separation on light and dark. Let me show it live if there is time.

---

## 20. More than a viewer (23:45, 1 minute)

**Say:** Beyond viewing: the Ask page shows the answer and the exact query, cost and guard actions behind it. Compare overlays two flights on one axis, even across autopilots, because the signal names are canonical. There is an ontology explorer, a ground track coloured by flight mode, notes pinned to a moment, CSV export, and similar flights found by behaviour rather than text: <<SIGNATURE-SPEECH>> The Database page reads live: compression, query plans from EXPLAIN ANALYZE, and the health of every pipeline stage.

---

## 21. Share it, scale it (24:45, 1 minute)

**Say:** Everything that took hours lives in the database, so I wrote a snapshot tool. It packs the database with a checksum and manifest and can push to a folder, an SSH host, S3 or a GitHub release. Restore never destroys: it verifies the checksum, loads into a new database, compares row counts with the manifest, and only then swaps by renaming, keeping the old one. I should say plainly that I have not yet run that tool end to end; it has a safe first-use mode that restores into a scratch database.
The scaling plan is one command. For ten thousand logs I expect a 13 gigabyte database, 134 gigabytes of Parquet, and at least 17 hours of polite downloading. Then I re-run every benchmark at that scale.

---

## 22. What went wrong, and was fixed (25:45, 1 minute)

**Say:** A summary of the corrections, because they are the part I am proudest of. My comparison treated numbers as strings. My guard rejected a safe operator and unfairly penalised the baseline. A prompt rule of mine made the model count the wrong thing. I suspected my synthetic data was too easy, so I measured it, and it was harder than the real corpus. And I believed hybrid search would win; the data said no. Each one is in the decision log with its numbers.

---

## 23. Limits and future work (26:45, 45 seconds)

**Say:** The limits: 300 flights on one four-core machine; one language model and one run; heuristic event thresholds; questions written by the same person who built the system; and benchmark vectors that are scaled copies, not new text. Next: the large run and every benchmark again, ArduPilot at scale to test the ontology properly, real fault ground truth from a simulator, a stronger and a weaker model for the SQL experiment, and a concurrency benchmark.

---

## 24. Key numbers (27:30, 30 seconds)

**Say:** If you remember six things: thirty-two times smaller telemetry; up to ninety-five times faster cross-flight queries; more than a hundred times faster than exact vector search at 0.95 recall; plain rank fusion hurts, 0.600 against 0.710; the planner returned 4 of 10 rows at a ten percent filter; and 0.89 accuracy for natural-language SQL on held-out questions, with documentation doing most of the work. Thank you. Questions?

---

# Prepared answers

**Why one database instead of a time-series database plus a vector database?**
One transaction boundary and real joins across time series, text and vectors; hybrid queries in a single plan. Polyglot would add operational weight and hide the planner trade-offs I wanted to study. I kept DuckDB only as a benchmark comparator.

**Is the 32 times figure fair?**
It compares the same data as rows plus its index against the columnstore, on the full 300-flight corpus. On a 100-flight subset it was 25 times. The rowstore index being larger than the table inflates the baseline, which is exactly the realistic comparison, because you need that index to query rows quickly.

**Why is the synthetic vector data legitimate?**
It is not new text. It is real embeddings sampled with replacement and perturbed, which keeps the cluster structure and the attribute skew. I measured difficulty by relative contrast: 6.2 at the default noise and 2.0 at the harder one, against 20.5 for the real corpus, so it is harder than the real data by that measure. I report that it is a stress test, not a replica.

**Why does DiskANN look bad?**
At defaults its compression caps recall in 1,536 dimensions on this clustered data; more rescoring raises it but costs latency. It is 12 times smaller, which matters at very large scale. I would re-test it at millions of vectors, where memory pressure changes the picture.

**Could the semantic layer's advantage be real but undetected?**
Yes. Six to one at p of 0.125 with 27 questions is suggestive, but a sample this small cannot confirm or rule out an effect of that size; it would take more questions, and I have not calculated how many. I report it as not significant, not as absent.

**How do you know the guard is safe?**
Three independent layers: the parser allow-list, a role with only SELECT on documented views, and a read-only transaction with a timeout, plus a cost check. 46 hostile queries are tested and each refusal is for the intended reason. I do not claim it is unbreakable; for hosting I recommend the dedicated login role option and authentication in front.

**Why not use a bigger or different language model?**
Time. One model and one run is a stated limit. The prompt component hashes are recorded so the experiment can be repeated with other models and compared fairly.

**What would you change first with more time?**
Real fault ground truth from simulation, to calibrate the event thresholds, and a larger labelled question set for the SQL experiment.

**What is the hardest bug you found?**
The savepoint one. The run reported success and committed nothing, because a transaction block opened after a read was only a savepoint. Only a fresh connection showed an empty table, which is why I now verify from a second connection.
