# Semantic Log Analytics [UAV Log]

UAV flight logs treated as a database problem: time-series telemetry (TimescaleDB columnstore), a semantic
layer (ontology mapping vendor fields to canonical concepts), hybrid SQL + vector retrieval (pgvector) and
guarded LLM NL-to-SQL. See `AGENTS.md` for architecture and rules, `research/` for background, `docs/decisions.md`
for design decisions and measurements.

Status, roadmap, report outline and demo script: `docs/status.md`.

## Run it

```bash
cp .env.example .env        # set OPENAI_API_KEY (and OPENAI_API_BASE if not the default)
./bin/uavlog all            # dev tier (300 logs): db, migrate, seed, download, ingest, compress, size report
./bin/uavlog status         # queue state, row counts, sizes, free disk
```

Every stage is idempotent and resumable, so re-running is always safe. Stages can be run one at a time:
`up init index select fetch enqueue ingest events embed compress summary signatures size status failed`.

## Web app

`docker compose up -d web` serves the app on http://localhost:3000 (Next.js 16; the browser only talks to this origin and `/api/*` is proxied to the API). Pages: Overview, Flights, a flight page (synchronized charts, ground track, notes, similar flights), Search, Compare, Ask (natural language to guarded SQL), Ontology, Database, Benchmarks. `./bin/shots-all` retakes every page. `./bin/shot / home` takes a screenshot (light or dark, any width) into `docs/screens/`.

## Tests

`docker compose exec backend python -m unittest discover -s tests` runs 32 tests: the guard (46 hostile and 18 legitimate queries), the NL-to-SQL pipeline (a fake model that obeys prompt injection must still be stopped), rate limiting, the embedding cache and the MAVLink parser. Evaluations: `python scripts/eval_search.py` (retrieval), `python scripts/eval_nlsql.py --questions /bench/eval/nlsql_test_questions.json` (NL-to-SQL); results land in `bench/results/`.

## API

`docker compose up -d api` serves the API on http://localhost:8000 (interactive docs at `/docs`). Try
`curl 'localhost:8000/api/search?q=one+rotor+stopped&k=5'`.

## Snapshots: share or move the finished database

Everything that took hours (download, ingest, events, embeddings, summaries) lives in the database, so it can be packed once and restored anywhere.

```bash
./bin/snapshot create                                  # data/snapshots/uavlog-<time>.tar (+ .sha256), without the benchmark schema
./bin/snapshot create --to ubuntu@my-ec2:/srv/uavlog   # also upload; DEST can be a folder, user@host:/dir, s3://bucket/prefix,
                                                       #   gh-release:OWNER/REPO@TAG (2 GB limit), or put:<presigned URL>
./bin/snapshot restore ubuntu@my-ec2:/srv/uavlog/uavlog-<time>.tar     # or a path, s3://, gh-release:, https://
./bin/snapshot restore FILE --as scratch               # load into a separate database to inspect, no swap
./bin/snapshot push-db postgresql://user:pass@host:5432/uavlog         # direct copy to another Postgres (needs TimescaleDB + pgvector)
```

**Status: `bin/snapshot` is written but has not been run end to end yet.** Try it safely first with `./bin/snapshot restore FILE --as scratch`.

Restore never destroys anything: it verifies the checksum, loads a **new** database with TimescaleDB's pre/post-restore procedure, compares
row counts with the manifest, and only then swaps by renaming; the previous database is kept as `uavlog_old_<time>` (`--drop-old` removes
it). The receiver needs only Docker, this repository and the same database image, and no re-ingest or re-embedding. A snapshot contains
GPS tracks and pilot notes from public CC-BY Flight Review logs: attribute Flight Review when sharing. It contains no API keys.

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

## Report, slides and speaker script

LaTeX sources in the repo root: `UAVLog_Presentation.tex` (Beamer, 76 slides), `UAVLog_Concept_Explainer.tex` (report), `UAVLog_Speaker_Script.txt`. Build a PDF with `./bin/latex UAVLog_Presentation.tex` (Docker image from `tools/latex/Dockerfile`). Figures: `./bin/figures` (diagrams, code images), `./bin/shots-all` (page screenshots), `tools/capture-terminal.sh` (database output), `tools/extract-listings.cjs` and `tools/bench-to-dat.cjs` (code listings and chart data).
