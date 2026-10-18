# Semantic Log Analytics [UAV Log]

UAV flight logs treated as a database problem: time-series telemetry (TimescaleDB columnstore), a semantic
layer (ontology mapping vendor fields to canonical concepts), hybrid SQL + vector retrieval (pgvector) and
guarded LLM NL-to-SQL. See `AGENTS.md` for architecture and rules, `research/` for background, `docs/decisions.md`
for design decisions and measurements.

## Run it

```bash
cp .env.example .env        # set OPENAI_API_KEY (and OPENAI_API_BASE if not the default)
./bin/uavlog all            # dev tier (300 logs): db, migrate, seed, download, ingest, compress, size report
./bin/uavlog status         # queue state, row counts, sizes, free disk
```

Every stage is idempotent and resumable, so re-running is always safe. Stages can be run one at a time:
`up init index select fetch enqueue ingest events compress size status failed`.

## Scaling to a large machine

```bash
git clone <repo> && cd <repo> && cp .env.example .env     # add keys
HOST_DATA_DIR=/big/disk/data TIER=k10 nohup ./bin/uavlog stream > run.log 2>&1 &
```

`stream` downloads in the background while ingesting what has arrived, compressing as it goes.
Growing a tier later (`TIER=dev` then `k10` then `eligible`) keeps everything already done and only adds new logs.

| Setting | Meaning |
|---|---|
| `TIER` | `dev` 300 logs, `k10` ~10k, `eligible` ~76k (all quadrotor logs 2-15 min since 2024) |
| `WORKERS` | parse workers; default `min(cores/2, RAM_GB/6)` |
| `FETCH_DELAY` | seconds between downloads (default 6, be polite; 10k logs ~ 17 h) |
| `HOST_DATA_DIR` | where raw logs, Parquet and the index live (needs the disk, see sizes in `docs/decisions.md`) |

If something fails: `./bin/uavlog failed` lists failed/missing logs with errors; `./bin/uavlog ingest --retry-failed`.
