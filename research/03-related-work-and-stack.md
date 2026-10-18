# 03 - Related Work and Stack Recommendations (Semantic Log Analytics [UAV Log])

Research date: 2026-10-18. Evidence tags: **[verified]** = page fetched/seen in search this session; **[from knowledge]** = not re-fetched, check before citing.

---

## 1. Related work and the gap

### 1.1 Existing tools

| Tool | What it does | Notes / limits | URL |
|---|---|---|---|
| PX4 Flight Review | Web app: upload ULog, interactive Bokeh plots on a Tornado server, 3D flight view, Jupyter notebook, CLI upload; public at review.px4.io; BSD-3 [verified] | Fixed plot set and some hard-coded analysis checks; no free-text/semantic query, no cross-flight search by meaning; ULog only | https://github.com/PX4/flight_review |
| UAV Log Viewer (ArduPilot) | JS viewer for MAVLink telemetry and dataflash logs, Cesium 3D, Docker image, GPL-3.0, demo at plot.ardupilot.org [verified] | Visualisation only, no AI/chat feature on the README; single-log | https://github.com/ArduPilot/UAVLogViewer |
| MAVExplorer | MAVProxy log tool: predefined + custom expression graphs, flight-mode filtering, map, param/GCS-message dumps, shareable XML graph files [verified] | Expert CLI/desktop tool; user must know message/field names | https://ardupilot.org/dev/docs/using-mavexplorer-for-log-analysis.html |
| PlotJuggler | Desktop time-series viz; opens CSV, MCAP, Parquet, PX4 ULog; live ROS2/MQTT/UDP/WebSocket; MPL-2.0 [verified] | Generic plotting, no semantics, no DB | https://github.com/facontidavide/PlotJuggler |
| Foxglove | Platform to record/upload/organise/visualise multimodal logs; MCAP; hosted data platform with indexing, events, search by device/time/topic; API/CLI [verified] | Closest "platform" analogue, but commercial, robotics-centric, metadata search not semantic-over-signal-content; PX4/MAVLink support not confirmed on intro page | https://docs.foxglove.dev/docs/introduction |
| ArduPilot community AI log diagnosis (GSoC 2026 threads, "Ardupilot-mcp", flightdx) | Rule + ML (XGBoost/Isolation Forest) diagnosis engines; design principle "LLM explains, check engine decides"; MCP server, offline [verified via search snippets, forum posts, not peer reviewed] | Informal, small label sets (~140 logs), single-log; confirms demand and gives the right design principle | https://discuss.ardupilot.org/t/ardupilot-mcp-open-source-offline-log-diagnosis-tool-for-ardupilot-mcp-server-looking-for-feedback/144475 ; https://discuss.ardupilot.org/t/gsoc-2026-an-automated-log-diagnosis-engine/142949 ; https://pypi.org/project/flightdx/ |

### 1.2 Papers (all seen in search/fetch this session)

1. **DronLomaly** (APSEC 2022) - LSTM trained on normal logs, runtime anomaly detection over DJI/ArduPilot/PX4 logs; ~0.96 precision/recall. Abstract-level. https://ink.library.smu.edu.sg/sis_research/7519
2. **An Exploratory Investigation of Log Anomalies in UAVs** (ICSE 2024) - empirical study of 178 abnormal PX4/ArduPilot logs (software-bug-induced). Gives an anomaly taxonomy usable for your labels. https://opus.cloud1.lib.uts.edu.au/handle/10453/185548
3. **RADD: Runtime Anomaly Detection for Drones** (Tan, Minn, Poskitt, Shar, Jiang; ICECCS 2025) - 44 hand-derived invariants + ensemble of 5 unsupervised models, ArduPilot/Gazebo, ~94% detection, 2.33% FPR. Argues for interpretability and domain knowledge: supports your semantic-layer motivation. https://arxiv.org/abs/2505.01947
4. **RESAM** (arXiv 2207.08857) - LSTM autoencoder vs rule-based thresholds from ArduPilot docs on dataflash logs (attitude, vibration, compass). https://arxiv.org/pdf/2207.08857
5. **ALFA dataset** (arXiv 1907.06268) - fault/anomaly dataset with ground truth; usable as evaluation data. https://arxiv.org/pdf/1907.06268
6. **UAV-SEAD** (Kabaoglu, Sariel; arXiv 2602.13900) - 1,396 real PX4 logs, >52 h, 4 anomaly classes (mechanical/electrical, external position, global position, altitude), no synthetic faults. Best public PX4 corpus for benchmark ingestion. https://arxiv.org/abs/2602.13900
7. **MAYDAY** (USENIX Security 2020) - traces drone accidents to control-program bugs using control- and program-level logs (root cause, ArduPilot). https://friends.cs.purdue.edu/pubs/USENIXSec20.pdf
8. **Building causal models for finding actual causes of UAV failures** (Frontiers in Robotics and AI, 2024) - NLP-built causal models tested on ArduPilot logs; the closest published "root cause + semantics" work. https://www.frontiersin.org/journals/robotics-and-ai/articles/10.3389/frobt.2024.1123762/epub
9. **LogPrompt** (Liu et al., ICPC 2024; arXiv 2308.07610) - LLM prompt strategies for interpretable log parsing/anomaly detection without training (text system logs, not telemetry). Note: the repo README cites a different arXiv id (2311.13246); cite the 2308.07610 page. https://arxiv.org/abs/2308.07610 ; code https://github.com/lunyiliu/logprompt
10. **AgentFuel** (Maddi et al.; arXiv 2603.12483, CAIS 2026) - framework for custom evals of "talk to your time-series data" agents; finds failures on stateful/incident-specific queries. Model for your benchmark design. https://arxiv.org/abs/2603.12483
11. **Drone Ontology (LANDRS)** - OWL ontology importing W3C SSN for sensors/observations of scientific drones, with SHACL shapes. https://github.com/landrs-toolkit/drone ; SOSA/SSN standard: https://www.w3.org/TR/vocab-ssn/ [W3C URL from knowledge]
12. (Optional) **LogGPT** (arXiv 2309.01189) and **LLMParser** (arXiv 2404.18001) for LLM-on-logs background. https://arxiv.org/abs/2309.01189 ; https://arxiv.org/pdf/2404.18001

### 1.3 Search findings on the gap
- Searches for a peer-reviewed paper combining LLMs with PX4/ArduPilot flight-log root-cause analysis returned **nothing**; only forum projects (2026) and non-LLM academic work. Frame as "to our knowledge, no published..." and not "first".
- No SOSA/SSN-style ontology for flight *telemetry* (attitude, battery, EKF) was found; Drone Ontology targets scientific-data collection.
- Existing anomaly work is per-log model detection (LSTM, rules). None treats a fleet of logs as a queryable database with semantic retrieval.

### 1.4 Gap you can claim (defensible)
1. **Semantic layer**: a small UAV ontology/taxonomy (signal -> subsystem -> failure mode -> evidence rule) in relational tables, with units/frames normalised across ULog and dataflash. Anomaly *events* (EKF failsafe, vibration clip, battery sag, GPS glitch) become first-class rows with text descriptions.
2. **DB-centric hybrid retrieval**: one Postgres holds time-series, events, tsvector, and pgvector embeddings; fused by SQL (RRF), plus structured filters (vehicle, firmware, flight mode, time window). Cross-flight "find flights like this one" queries.
3. **Grounded LLM**: LLM explains and routes; deterministic SQL/rules produce numbers and evidence citations (matches the community design principle).
4. **Benchmarks**: retrieval quality (recall@k/MRR/nDCG) on labelled events, RCA accuracy, text-to-SQL/tool-call accuracy including stateful queries (AgentFuel style), ingestion throughput, query latency vs data size, index ablations (GIN vs HNSW, with/without time partitioning).

---

## 2. Frontend stack

**Versions** [verified]: Next.js 16.4 published 6 Oct 2026 (blog); 16.3 on 3 Aug 2026; security releases in July/Aug (use latest patch, Active LTS 16.2.x acceptable). deck.gl 9.4 (5 Sep 2026; "expected final v9 release"; WebGPU experimental, not for production; `@deck.gl/maplibre` supports MapLibre v4-v6). uPlot: MIT, ~50 KB, 166,650 points in ~25 ms (author's own benchmark, 2023, Ryzen 7/Chrome 113); it does not downsample.

### Recommendation
- **Framework**: Next.js 16.x App Router + TypeScript (strict) + Tailwind CSS + shadcn/ui [shadcn/Tailwind versions from knowledge]. Use TanStack Query for server state, Zustand for chart-sync state (cursor time, selected window), TanStack Table (virtualised) for event lists. Mostly client components for the analysis workspace; server components only for shell/list pages.
- **Telemetry charts**: **uPlot** as the main line-chart engine (stacked synchronised panels, cursor sync via `uPlot.sync`), fed by **server-side downsampling** (min/max bucket envelope or LTTB in SQL/Python) at the current zoom window, not by pulling millions of points. ECharts is the alternative if you want richer built-ins (tooltips, brush, dataZoom, heatmaps) and accept ~2x slower rendering; use it for non-time-series panels (histograms, correlation matrices, event timeline). Avoid echarts-gl/WebGL line charts: Chrome caps ~16 active GL contexts, which hurts multi-panel dashboards (uPlot maintainer comment in HN thread; not benchmarked here).
- **Wire format**: columnar binary. Easiest: FastAPI returns Arrow IPC (`application/vnd.apache.arrow.stream`) or plain `Float64Array` buffers; parse with `apache-arrow` JS and hand typed arrays straight to uPlot (columnar `[xs, ys1, ys2...]`). Avoid JSON arrays of pairs.
- **Map / replay**: **MapLibre GL + deck.gl** (`@deck.gl/maplibre`, TripsLayer or PathLayer + ScatterplotLayer for the vehicle, colour path by flight mode/metric). Free tiles/styles (e.g. OpenFreeMap/Protomaps) avoid tokens. CesiumJS only if you need true 3D terrain/altitude replay; it is heavy and needs an ion token (UAV Log Viewer uses it). Suggest: MapLibre+deck.gl 2.5D default; optional 3D toggle later.
- **Replay UX**: a single time cursor in Zustand drives chart crosshair, map marker, event list highlight, and LLM-cited evidence ("jump to 12:41.3").
- **AI UI**: streaming chat (SSE) with citation chips linking to log time windows/events; show generated SQL and evidence tables ("show your work") - strong for demo and for grounding.

### Pitfalls
- Passing >~100k points per series per frame; always downsample server-side per viewport and request detail on zoom (debounced, abortable fetch).
- LTTB/min-max can hide spikes if wrong: use min/max envelope for safety signals (uPlot maintainer warns LTTB can drop peaks, PR #1025).
- SSR with uPlot/deck.gl/MapLibre: load with `dynamic(..., {ssr:false})`; guard `window`.
- React re-renders: keep chart data in refs/typed arrays, not React state; avoid rebuilding uPlot instances (use `setData`/`setScale`).
- Timestamps: ULog is microseconds since boot, dataflash `TimeUS`; map to GPS/UTC epoch once at ingest; JS numbers lose precision beyond 2^53 for ns epochs, so keep µs as number (safe) but not ns.
- Don't ship deck.gl WebGPU path (explicitly experimental).
- Next.js version churn and security patches: pin and upgrade to latest patch before the demo.
- Dark-mode, keyboard shortcuts, empty/loading/error states, and a consistent colour palette per signal group are what make it look "non-toy".

---

## 3. Backend glue

- **API**: FastAPI (async) + Pydantic v2; psycopg 3 / asyncpg; SQLAlchemy 2.0 for models + **Alembic** for migrations [from knowledge]. Keep pgvector/tsvector DDL (extensions, GIN/HNSW indexes) as raw SQL in Alembic migrations (`op.execute`) - autogenerate does not manage them well.
- **LiteLLM**: [verified] `litellm.aembedding(model="text-embedding-3-small", input=[...], dimensions=N)`; `dimensions` supported for OpenAI/Azure text-embedding-3+. Use `litellm.acompletion` for chat with streaming. Benefits: one place for model swap, retries, cost logging, and per-call token/latency telemetry that you can store in a table for the report's cost analysis. Batch embeddings (e.g. 100-500 inputs/request) and cache by content hash.
- **pgvector** [verified]: v0.8.7; HNSW and IVFFlat; indexed `vector` up to 2,000 dims (halfvec 4,000) - so 1536 (3-small) fits, 3072 (3-large) needs `halfvec` or reduced `dimensions`. **Filtered ANN pitfall**: filters apply after the index scan (ef_search 40 with a 10% filter ~ 4 rows); use iterative scan (`hnsw.iterative_scan = relaxed_order`, since 0.8.0), partial indexes, or partitioning. Great material for the evaluation section.
- **Hybrid retrieval**: tsvector (GIN) + pgvector fused by Reciprocal Rank Fusion, score = sum 1/(k+rank), k=60. Guides: https://docs.railway.com/guides/hybrid-search-postgres-pgvector ; https://www.tigerdata.com/docs/learn/tutorials/hybrid-search [seen in search; full SQL not fetched].
- **Time-series storage**: plain Postgres with declarative partitioning (by flight or time) + BRIN/btree on (flight_id, ts), or TimescaleDB hypertables + continuous aggregates + toolkit `lttb()` [toolkit LTTB verified; must be installed separately on self-hosted; LTTB is a read-time viz function]. Parquet files for raw bulk + Postgres for events/metadata is a sensible hybrid; compare both in your benchmarks.
- **Job queue for ingestion** (solo project, parse .bin/.ulg -> normalise -> COPY -> detect events -> embed):
  - **procrastinate** [verified]: Postgres-backed, MIT, Python 3.10+, async-recommended (`defer_async`, `run_worker_async`), retries, periodic tasks, locks, CLI.
  - **PgQueuer** [verified]: Postgres-only, `FOR UPDATE SKIP LOCKED` claiming + LISTEN/NOTIFY instant dispatch, **transactional enqueue** (job commits with your data), async handlers, cron, Prometheus metrics, dashboard, in-memory test mode.
  - **Celery + Redis**: mature, heavier (extra service, sync-first, result backend), unnecessary here.
  - **Pick PgQueuer** (or procrastinate if you want more mature retries/docs): fewer moving parts (single docker-compose Postgres), and "the queue is in the DB" is on-theme for an ADBMS project (discuss SKIP LOCKED, MVCC, NOTIFY). Report job state via a `ingest_jobs` table + SSE progress to the UI.
- **Parsing**: `pymavlink` (DFReader) for ArduPilot .bin, `pyulog` for PX4 .ulg [from knowledge]; ingest via `COPY` / binary copy, not row inserts.
- **Dev ergonomics**: docker-compose (postgres+pgvector, api, worker, web), `uv` for Python, Ruff, pytest, Playwright smoke test, seed script that downloads a few public logs (UAV-SEAD, ALFA).

---

## 4. What a standout ADBMS term project contains

Sources are course guidelines seen in search (limited; no rubric found; confirm with your syllabus): Purdue CS542 (problem statement, design/methods 2-4 pp, experiments and analysis) https://cs.purdue.edu/homes/bb/cs542-20Spr/project/format.html ; FSU COP4710 (application/motivation, E-R and relational design, normal form, basic and advanced functions, implementation platform; 4-8 pp) https://www.cs.fsu.edu/~zhao/cop4710/project.html . The rest of this section is synthesis/judgement, not sourced.

### Report structure (aim ~8-12 pages, two-column or tight single)
1. Abstract + one-paragraph problem statement with scope and explicit research questions (RQ1 retrieval, RQ2 grounded RCA, RQ3 scale).
2. Motivation and related work (Section 1 table, condensed) ending with the gap statement.
3. Data model: ER diagram, relational schema, normalisation argument, deliberate denormalisation (wide telemetry tables), ontology tables, keys/constraints, partitioning strategy.
4. System architecture diagram: ingest pipeline (queue -> parser -> COPY -> event detector -> embedder), storage (time-series, events, tsvector, pgvector), query layer (SQL tools, hybrid retrieval, LLM orchestrator), UI. Plus a sequence diagram of one chat query. Use Mermaid/draw.io.
5. Database techniques (the ADBMS core): indexing (btree/BRIN/GIN/HNSW), partitioning, query plans (`EXPLAIN (ANALYZE, BUFFERS)` excerpts), bulk loading, transactions/queue semantics (SKIP LOCKED), RRF in SQL, filtered ANN problem, downsampling.
6. Evaluation (most important):
   - Datasets: UAV-SEAD, ALFA, your own logs; sizes (flights, rows, GB).
   - Ingestion: rows/s, time per log, COPY vs INSERT, parallel workers.
   - Query latency: p50/p95 for window fetch at 1e5/1e6/1e7/1e8 rows, with/without partitioning/index; downsample cost.
   - Retrieval: recall@k, MRR, nDCG on a hand-labelled event set; ablation BM25-only vs vector-only vs hybrid; embedding model/dimension; HNSW ef_search vs recall/latency; filtered-ANN with/without iterative scan.
   - LLM layer: text-to-SQL/tool-call execution accuracy, answer groundedness (citations resolvable to real rows), RCA top-1/top-3 vs labelled cause, stateful-query subset (AgentFuel style), hallucination rate, cost and latency per query; baseline = LLM with raw log dump or no retrieval.
   - Report variance (repeat runs, fixed seeds, hardware spec) and threats to validity (small labels, single annotator, LLM nondeterminism).
7. Discussion, limitations, future work; reproducibility (repo, compose file, seed script).
8. Appendix: schema DDL, prompts, sample queries.

### Presentation / demo flow (10-15 min)
1. 30 s hook: a real crash log and the question "why did it fail?" in Flight Review vs your tool.
2. 2 min: problem + gap + architecture diagram.
3. 2 min: schema and the two or three DB tricks that matter.
4. 4 min live demo (rehearsed, with recorded fallback video): upload log -> progress via job queue -> replay with synced charts/map -> ask a natural-language question -> answer with citations that jump the cursor -> cross-flight "find similar failures".
5. 3 min: evaluation charts (latency vs size, hybrid vs baselines, RCA accuracy).
6. 1 min: limitations and takeaways. Keep a backup slide for each likely question (why Postgres, why not Timescale/Influx, how do you avoid hallucination).

### Extra polish
- Frame it as hypotheses + experiments, not a feature list; every claim backed by a number or plan.
- Include one failure analysis (cases where the system is wrong and why).
- Public repo with README, `docker compose up`, seed data, and a benchmark script that regenerates all figures.

---

## Caveats
- Several search-result summaries (DronLomaly, ICSE 2024, MAYDAY, Frontiers causal models, LogPrompt metrics) were read as snippets, not full papers; re-open before quoting numbers.
- Cesium, MapLibre, Apache Arrow JS, shadcn/ui, Alembic, Celery, pymavlink/pyulog details come from prior knowledge and were not re-fetched.
- uPlot performance numbers are the author's own 2023 benchmark.
