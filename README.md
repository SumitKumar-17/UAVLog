# Semantic Log Analytics [UAV Log]

UAV flight logs treated as a **database problem**: high-rate telemetry in a TimescaleDB columnstore, a semantic layer that maps PX4 and ArduPilot
field names onto shared concepts, hybrid SQL and vector retrieval with pgvector, and natural-language SQL that is guarded by four independent
layers. Every design choice is backed by a measurement in `bench/results/`.

<p align="center">
  <img src="docs/screens/deck-overview-light-1440.png" width="49%" alt="Overview">
  <img src="docs/screens/deck-flight-report-light-1440.png" width="49%" alt="Incident report with citations">
  <img src="docs/screens/deck-map-light-1440.png" width="49%" alt="Map of flights">
  <img src="docs/screens/deck-data-map-light-1440.png" width="49%" alt="Data explorer schema map">
</p>

## What it does

| | |
|---|---|
| **Explore** | Flights as strips of flight modes, synchronized charts with min/max envelopes, ground track, **flight replay**, a **behaviour strip** (how unusual each 10 seconds were, by vector search), **map**, **fleet galaxy** (every flight placed by how it behaved), a year **calendar**, **incidents** feed, **patterns** (what happens before and after an event) |
| **Find** | Semantic search (vector + full text + filters, fused by reciprocal rank fusion) with a planner-aware filtered search; **similar moments** (10-second windows embedded by signal behaviour, with a signal overlay); similar flights |
| **Ask** | Natural language to **guarded read-only SQL** with the SQL, cost and guard actions shown; **SQL workbench** under the same checks, with a **query plan** view; **cited incident reports** (numbers from SQL, prose from a model, every citation verified) |
| **Inspect the database** | **Data explorer** (schema map, tables, rows, structure), Database page (space, `EXPLAIN ANALYZE`, pipeline), Benchmarks page drawn from the saved result files |

## Architecture

```mermaid
flowchart LR
    FR[(Flight Review logs)] --> ING[ingest workers<br/>job tables, SKIP LOCKED]
    ING --> PQ[(Parquet lake)]
    ING --> TS[(telemetry hypertable<br/>columnstore)]
    TS -->|rules| EV[(events)]
    EV --> EMB[event embeddings<br/>HNSW]
    TS --> WIN[signal windows and<br/>flight signatures]
    ONT[(ontology and<br/>field mapping)] --> TS
    EMB --> SRCH[hybrid search<br/>self-routing]
    WIN --> SRCH
    TS --> SEM[semantic views<br/>read-only role]
    SEM --> NL[guarded NL-to-SQL]
    SRCH --> API[FastAPI]
    NL --> API
    API --> WEB[Next.js]
```

One PostgreSQL 17 instance holds all of it: TimescaleDB 2.30 (hypertable, columnstore, continuous aggregate), pgvector 0.8 (HNSW, iterative scan) and
pgvectorscale (DiskANN, a benchmark comparator). Diagrams and the schema: `docs/architecture.md`; every decision with its evidence: `docs/decisions.md`.

## Key measured results

| Question | Result |
|---|---|
| Storage | 70.7 M telemetry rows: 12.46 GB rowstore to **385 MB** columnstore (32x), 5.4 bytes per row |
| Columnstore design | `segmentby (flight, signal)` ordered by time: cross-flight query 1,519 ms to 16 ms |
| Against DuckDB | DuckDB wins full scans; the columnstore wins pruned access and the per-flight summary; Postgres keeps writers, roles and vectors |
| Vector index (100k, 1,536 dims) | HNSW m=32 reaches recall 0.95 in 2.4 ms (exact search: 362 ms) |
| Filtered search | post-filtering returns **0.0 of 10 rows** at 0.1% selectivity; the router picks exact or HNSW by the planner's row estimate |
| Hybrid search | plain rank fusion is *worse* than vector only (0.600 against 0.710 nDCG@10) |
| NL-to-SQL | 0.89 with semantic views, 0.70 with documentation alone, 0.26 without; 46 hostile queries refused |
| Fault injection | 90 to 100% of injected faults found once they last 5 s |
| Similar moments | precision at 10 up to 43x the random base rate |

## Run it

```bash
cp .env.example .env        # set OPENAI_API_KEY (and OPENAI_API_BASE if not the default)
./bin/uavlog all            # dev tier (300 logs): db, migrate, seed, download, ingest, events, embed, compress, signatures
./bin/uavlog status         # queue state, row counts, sizes, free disk
docker compose up -d        # web app on :3000, API on :8000 (docs at /docs)
```

Every stage is idempotent and resumable: `up init index select fetch enqueue ingest events embed compress summary signatures size status failed`.
Signal windows for "similar moments": `docker compose exec backend python scripts/build_windows.py`.

## Layout

| Path | Contents |
|---|---|
| `backend/` | FastAPI (`app/api`), ingest and event rules (`app/ingest`, `app/events`), ontology (`app/ontology`), search router, guarded NL-to-SQL (`app/nlsql`), Alembic migrations, scripts, tests |
| `web/` | Next.js 16 application (pages in `src/app`, components in `src/components`) |
| `bench/` | benchmark results (`results/`) and the evaluation question sets (`eval/`) |
| `docs/` | decision log, architecture, status, diagrams, figures, screenshots |
| `slides/`, `report/`, `script/` | the Beamer project deck, the report, and the speaker and video scripts (build PDFs with `./bin/latex <file.tex>`) |
| `bin/` | `uavlog` (pipeline), `snapshot`, `shot` and `deck-shots` (screenshots), `figures`, `latex` |
| `research/` | background notes on datasets, database technology and related work |

## Tests

`docker compose exec backend python -m unittest discover -s tests` runs 38 tests: the SQL guard (46 hostile and 18 legitimate queries), the NL-to-SQL
pipeline (a fake model that obeys prompt injection must still be stopped), rate limiting, the embedding cache, the MAVLink parser and the window features.
CI (`.github/workflows/ci.yml`) runs the guard tests, applies the migrations to an empty database and builds the web app.

## Snapshots: move the finished database

```bash
./bin/snapshot create                          # data/snapshots/uavlog-<time>.tar (+ .sha256), without the benchmark schema
./bin/snapshot restore FILE --as scratch       # load into a separate database to inspect, no swap
./bin/snapshot restore FILE                    # verify, load a NEW database, compare counts, then swap by rename
```

Restore never destroys anything: the previous database is kept as `uavlog_old_<time>` (`--drop-old` removes it). Use the same TimescaleDB image version that made
the snapshot (`docker-compose.yml` pins it). A snapshot holds GPS tracks and pilot notes from public CC-BY Flight Review logs: attribute Flight Review when sharing.

## Scaling to a large machine

```bash
HOST_DATA_DIR=/big/disk/data TIER=k10 nohup ./bin/uavlog stream > run.log 2>&1 &
```

`TIER`: `dev` 300 logs, `k10` about 10,000, `eligible` about 76,000. Growing a tier keeps everything already done. `WORKERS` defaults to `min(cores/2, RAM_GB/6)`;
`FETCH_DELAY` (default 6 s) keeps downloads polite. `./bin/uavlog failed` lists failed items.

## Data and licence

PX4 logs come from [Flight Review](https://review.px4.io) (CC-BY); see `DATA_ATTRIBUTION.md`. Code: MIT, see `LICENSE`.
