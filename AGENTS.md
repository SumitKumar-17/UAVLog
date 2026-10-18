# Semantic Log Analytics [UAV Log]

Term project for **Advanced Database Management Systems** (solo, no fixed deadline). Grading is on **database concepts**: architecture, design trade-offs, measured experiments, report. The app must be polished and non-toy, but every feature should earn its place as a DB topic or a demo of one.

Pitch: UAV flight logs treated as a database problem: high-rate time-series + a semantic layer (ontology mapping PX4/ArduPilot fields to canonical concepts) + hybrid SQL/vector retrieval + guarded LLM NL-to-SQL, with benchmarks proving each design choice. Claim "to our knowledge", never "first".

Background research (read before making design decisions): `research/01-datasets-and-parsing.md`, `research/02-database-tech-and-benchmarks.md`, `research/03-related-work-and-stack.md`. Each claim there is tagged verified / snippet-only / from-memory; re-verify the latter two before relying on them or quoting numbers in the report.

## Project rules from the user

- **Everything runs in Docker** (db, backend, workers, web, benchmarks, simulators). No host installs beyond Docker.
- **Develop on a subset** locally (hundreds of logs). Later the user will provide an **SSH machine** for the full-scale download, ingest and benchmark run. So every data volume, scale factor and path must be configurable, and the full run must be one documented command.
- **Git:** commit continuously in small, single-purpose commits with short imperative messages, so the history stays clean. Never commit `.env`, `data/` or secrets. If a new `.env` key is needed, tell the user (they will provide it) and add it to `.env.example`.
- **Pipelines must be built to scale and to survive failure** (the data will grow from 300 to 478k logs on another machine). Every batch job is: idempotent; tracked in a Postgres job table (status, attempts, last error); claimed with `FOR UPDATE SKIP LOCKED` so it can run concurrently; failure-isolated (one bad item never stops the run); retried automatically and recoverable after crashes (stale-lease reclaim); resumable without redoing finished work; atomic per item (data and job status commit together); and expandable by enqueueing more items, not by changing code. Follow the pattern in `backend/scripts/enqueue.py` and `ingest.py`.
- **Never delete or reset data or database rows without first checking what is in them** (counts, who/what created it). Prefer targeted deletes over wiping tables or directories.
- **Format is ours:** no prescribed report or architecture format. Aim to be the best presentation in the class: original architecture diagrams, a strong live demo, a rigorous report.

## Architecture

```
.ulg/.bin → ingest workers (Postgres job tables) → raw Parquet (per topic, partitioned by log id)
          → canonical store (Postgres + TimescaleDB + pgvector) → semantic indexes → FastAPI → Next.js
```

- **Core DB:** one PostgreSQL 17 with TimescaleDB (hypertables, **columnstore**, continuous aggregates) and pgvector (HNSW). Image: `timescale/timescaledb-ha:pg17`. Verify pgvector is present via `pg_available_extensions`; if not, build a custom Dockerfile. Never use `-oss` images (no columnstore/caggs). Use current names (`enable_columnstore`, `add_columnstore_policy`), not deprecated "compression" names.
- **Semantic layer:** relational ontology tables (concept, vendor_field, field_mapping with unit transform, relation) queried with recursive CTEs. Signal → Subsystem → Failure mode → Event. Apache AGE is out of scope (future work).
- **Embeddings (via the shared OpenAI-compatible client `backend/app/llm.py`, no LiteLLM):** text embeddings of event descriptions (`text-embedding-3-small`, use the `dimensions` param; pgvector indexes max 2000 dims, use `halfvec` if larger), plus numeric signature embeddings of signal windows (statistical + spectral features, PCA 64–128). TS2Vec is an optional learned comparator. No GPU is available or needed.
- **Hybrid retrieval:** vector + full-text + SQL filters fused with reciprocal rank fusion. Known pgvector pitfall: filters apply after the ANN scan, so filtered queries can under-return; use iterative scan, partial indexes or partitioning. This is a headline experiment.
- **LLM layer (shared client `app/llm.py`, OpenAI-compatible):** NL-to-SQL over curated semantic views only. The LLM explains; SQL and rules produce the numbers. Log tokens, cost and latency to a table.
- **NL-to-SQL guardrails (non-negotiable):** dedicated read-only role seeing only curated views; statement and idle timeouts; `sqlglot` allows a single SELECT over allow-listed views/functions and caps LIMIT; block `pg_read_file`, `COPY ... PROGRAM`, `dblink` (SELECT-only is not a security boundary).
- **Comparators for benchmarks only:** DuckDB over Parquet; optionally ClickHouse and pgvectorscale DiskANN.

## Stack

| Layer | Choice |
|---|---|
| Frontend | Next.js 16 + TypeScript, Tailwind, shadcn/ui, TanStack Query, Zustand (shared time cursor) |
| Charts / map | uPlot (server-side downsampling per viewport; **min/max envelopes** for safety signals, not LTTB), MapLibre + deck.gl |
| Backend | FastAPI, SQLAlchemy 2, Alembic (pgvector/Timescale DDL as raw SQL in migrations) |
| Queue | Own Postgres job tables (`ingest_job`, `flight_task`) with SKIP LOCKED claims; no Celery/Redis/PgQueuer |
| LLM | Shared `httpx` client for any OpenAI-compatible API (`OPENAI_API_KEY`, `OPENAI_API_BASE` from env); model names in config, never hardcoded; every call logged to `llm_call` |
| Infra | Docker Compose, Grafana + `pg_stat_statements` for DB metrics |

Python: pin **3.12 via uv** (system is 3.14, parser libs may not support it). Node 24, pnpm.

## Data

- Core corpus: 1,000–3,000 PX4 multicopter logs from Flight Review (bulk via PX4 `download_logs.py`; CC-BY; respect rate limit, ~6 s between downloads; min PX4 version to limit schema drift).
- Labeled ground truth: RflyMAD subset, UAV-SEAD, BASiC (ArduPilot SITL, Zenodo). **Licenses for several are unconfirmed; resolve before relying on them.**
- Own SITL runs with injected faults (PX4 `failure` command / MAVSDK; ArduPilot `SIM_*` params) for known injection times. Try SIH before Gazebo.
- Synthetic scale-up by perturbing real logs for 10k+ flight benchmarks. Disk is the limit (86 GB free at start); 100k flights is stretch.
- Raw layer is Parquet per topic; a canonical-mapping table records source field and transform per row. PX4 field names in the research note are from memory, so check against a real log with `ulog_info -v`.

## Report experiments (the graded core)

1. Columnstore physical design (chunk interval, segmentby/orderby, storage and query impact).
2. HNSW vs IVFFlat vs DiskANN: recall@k vs latency, build time, index size.
3. Hybrid filtering strategies (post-filter vs iterative scan vs partial index vs partitioning).
4. Postgres/Timescale vs DuckDB (and ClickHouse): ingest throughput and query shapes.
5. NL-to-SQL accuracy with vs without the semantic layer.

Methodology: report hardware and versions, repeat runs, p50/p95, index size and build time, `EXPLAIN (ANALYZE, BUFFERS)` evidence. Use ann-benchmarks *methodology* (recall vs QPS, top-100 ground truth), TSBS-style ingest/query shapes, `pgbench` for concurrency. Scale factors 1k / 10k (/ 100k) flights. Evaluate embeddings on labeled segments with precision@k.

## Conventions

- Layout (create as built): `backend/` (FastAPI, ingest, semantic layer), `web/` (Next.js), `db/` (migrations, SQL, ontology seed), `bench/` (harness + results), `docs/` (report, diagrams), `research/`.
- All schema changes go through Alembic migrations; never hand-edit the DB.
- Secrets in `.env` (git-ignored); commit `.env.example`. Keys: `OPENAI_API_KEY`, `OPENAI_API_BASE`.
- Everything runs from `docker compose up` plus documented seed/ingest commands; benchmarks must be reproducible by script, and results saved as files under `bench/results/`.
- Keep a decision log in `docs/decisions.md` (what, why, alternatives); the report draws from it.
- Prefer small verified steps: after each phase, run it for real and record the evidence (plans, numbers) instead of asserting it.

## Phases

1. Env + schema + ingest (PX4 first) → 2. Semantic layer/ontology → 3. Segmentation, events, embeddings, search → 4. LLM NL-to-SQL + RCA with citations → 5. Web app (explorer, semantic search, compare, investigation workspace, DB-internals page) → 6. Benchmarks → 7. Report, diagrams, slides, demo script.
