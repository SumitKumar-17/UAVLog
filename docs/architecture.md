# Architecture

Status: describes what is implemented. Planned parts are marked *(planned)*.

## 1. Data flow

```mermaid
flowchart LR
    FR[(Flight Review<br/>public index + logs)] -->|select, fetch| ULG[raw .ulg files]
    ULG -->|ingest workers| PQ[(Parquet lake<br/>every topic, partitioned<br/>by topic and log id)]
    ULG -->|ingest workers| TS[(telemetry hypertable<br/>ontology-mapped signals<br/>columnstore)]
    ULG -->|events workers| EV[(event table<br/>semantic events)]
    TS -->|gaps-and-islands rules| EV
    EV -->|embed workers| VEC[event.embedding<br/>pgvector + HNSW]
    ONT[(ontology + field_mapping<br/>semantic catalog)] --> TS
    ONT --> EV
    VEC --> HS[hybrid search<br/>vector + full-text + filters, RRF]
    EV --> HS
    HS --> API[FastAPI *planned*]
    TS --> API
    API --> WEB[Next.js app *planned*]
```

All boxes inside Postgres are one database; the Parquet lake is the full-fidelity raw layer and the benchmark
comparator source (DuckDB). Only ~34 ontology-mapped signals go into the hypertable (decision D2).

## 2. Schema

```mermaid
erDiagram
    flight ||--o{ telemetry : has
    flight ||--o{ event : has
    flight ||--o{ flight_task : "stage state"
    vendor_field ||--o{ telemetry : "measured as"
    vendor_field ||--o{ field_mapping : "mapped by"
    concept ||--o{ field_mapping : "canonical signal"
    concept ||--o{ concept_relation : "src / dst"
    concept ||--o{ event : "kind"
    flight { uuid id PK
             text source_ref UK "Flight Review log id"
             timestamptz started_at
             text log_sha256 UK
             jsonb metadata "labels, hw, firmware" }
    telemetry { uuid flight_id FK
                timestamptz ts "hypertable dimension"
                smallint vendor_field_id FK
                float8 value }
    vendor_field { smallint id PK
                   text autopilot
                   text topic
                   text field }
    concept { int id PK
              text key UK
              text kind "signal subsystem failure_mode event" }
    field_mapping { smallint vendor_field_id FK
                    int concept_id FK
                    float8 scale
                    float8 offset }
    event { bigint id PK
            uuid flight_id FK
            int kind_id FK
            timestamptz ts_start
            timestamptz ts_end
            smallint severity
            text description
            tsvector tsv "generated"
            vector embedding "1536" }
    flight_task { uuid flight_id FK
                  text stage
                  text status }
```

Semantic layer: `canonical_telemetry` is a view that joins `telemetry` to `field_mapping` and `concept`, applying each
mapping's scale and offset, so queries are written against canonical signal names (`battery.remaining`)
instead of vendor fields (`battery_status.remaining`). Ontology: signal `part_of` subsystem, signal `indicates`
failure mode, event `indicates` failure mode (queried with recursive CTEs *(planned)*).

## 3. Pipeline and job queues

Every stage is idempotent, retried, crash-recoverable, and safe to run concurrently.

```mermaid
stateDiagram-v2
    [*] --> pending: enqueue
    pending --> running: claim (FOR UPDATE SKIP LOCKED)
    running --> done: work and status commit in ONE transaction
    running --> pending: error, attempts left
    running --> failed: error, attempts exhausted
    running --> pending: lease expired (crashed worker)
    failed --> pending: --retry-failed
    pending --> missing: input file absent (ingest only)
    missing --> pending: file arrives, enqueue re-run
```

| Stage | Queue table | Script | Output |
|---|---|---|---|
| ingest | `ingest_job` (per log) | `scripts/ingest.py` | Parquet + `flight` + `telemetry` |
| events | `flight_task` stage `events` | `scripts/events.py` | `event` rows |
| embed_events | `flight_task` stage `embed_events` | `scripts/embed_events.py` | `event.embedding` |
| compress | none (chunk state) | `scripts/compress.py` | columnstore chunks |

Orchestration: `bin/uavlog` (single entry point; `stream` overlaps download, ingest, events and compression so a
large run never needs the uncompressed footprint).

## 4. Hybrid search

```mermaid
flowchart LR
    Q[query text] --> E[embed via OpenAI-compatible API]
    Q --> T[OR-ed tsquery]
    E --> V[vector candidates<br/>HNSW cosine, top pool]
    T --> F[full-text candidates<br/>GIN tsvector, top pool]
    FILT[filters: kind, severity, hardware] --> V
    FILT --> F
    V --> R[RRF: sum of 1 / 60 + rank]
    F --> R
    R --> OUT[ranked events with flight + time]
```

Filters run inside each candidate query. pgvector applies filters after the ANN scan, so
`hnsw.iterative_scan = relaxed_order` is enabled; comparing this against partial indexes and partitioning is
experiment 3.

## 5. API

FastAPI (`app/api`), connection pool, autocommit, one shared LLM client. OpenAPI docs at `/docs`.

| Endpoint | Purpose |
|---|---|
| `GET /api/flights` | flight list with event counts, labels, filters (`hw`, `label`, paging) |
| `GET /api/flights/{id}` | metadata, all events (offsets in seconds from takeoff of the log), available signals |
| `GET /api/flights/{id}/signals/{signal}` | min/max/mean envelope per time bucket, computed in the database (`time_bucket` over `canonical_telemetry`); envelopes, not decimation, so safety spikes survive |
| `GET /api/search` | hybrid event search (`q`, `k`, `kind`, `min_severity`, `hw`, `mode`) |
| `GET /api/ontology` | concepts and relations |
| `GET /api/stats`, `GET /health` | counts and liveness |

Measured on the dev corpus: envelope queries 0.19 to 0.26 s on compressed chunks (up to 106k samples per signal);
search about 1.4 s, dominated by the embedding API round trip. *Planned:* query-embedding cache, read-only DB role for
the API, NL-to-SQL endpoint with guardrails, DB-internals endpoint (`EXPLAIN`, index and chunk stats).

## 6. NL-to-SQL

```mermaid
flowchart LR
    Q[question] --> P[prompt built from view and column comments in the catalog]
    P --> M[LLM, temperature 0]
    M --> G[guard: sqlglot allow-lists, one SELECT, row cap, SQL regenerated from the parse tree]
    G --> C[cost check: EXPLAIN under the read-only role, admit if planner cost under 100000]
    C --> X[run: read-only transaction, role uav_reader, statement timeout 8 s]
    X --> R[rows plus plain-language summary]
    G -. refused or failed .-> M
    C -. refused .-> M
    X -. error .-> M
```

`semantic.*` views are the only objects the role can read: flights, events, signals, telemetry, ontology, and `signal_summary` (a materialized
per-flight min/max/mean refreshed after ingest). Refusals and errors are fed back to the model for up to two repair rounds. Evidence: 19 security and
pipeline tests, and the three-condition accuracy experiment in `docs/decisions.md` D16 (`bench/results/nlsql_eval_*.md`).

## 7. Web app

Next.js 16 (App Router, Cache Components), TypeScript, Tailwind 4, TanStack Query for server state, Zustand for the shared
zoom window and selected event, uPlot for charts. The browser calls only the web origin; `/api/*` is rewritten to FastAPI, so the
same setup works on a remote server with no CORS. Design rationale and tokens: `docs/design.md`.

| Page | What it shows |
|---|---|
| Overview | search hero, flight board (modes + event marks per flight), corpus facts |
| Flights | all flights as strips, ordered by critical events, recency or length |
| Flight | overview ribbon, synchronized charts with mode shading and envelopes, event list that jumps the charts, pilot notes |
| Search | hybrid event search with filters, best-match-per-flight, collapsed duplicates, ranking details |
| Database | live compression ratio, index and table sizes, queue state, `EXPLAIN ANALYZE` of named queries |

## 8. Deployment

`docker compose`: `db` (timescale/timescaledb-ha:pg17: TimescaleDB, pgvector, pgvectorscale), `backend` (Python 3.12
work container for pipeline stages) and `api` (uvicorn on port 8000); both run as the host uid so data files stay manageable. Data lives under `HOST_DATA_DIR`
(raw logs, Parquet, index). The same compose file and `bin/uavlog stream` run on the large machine.
