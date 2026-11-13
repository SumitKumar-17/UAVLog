# Data and software attribution

## Flight data

All flight data comes from the public **PX4 Flight Review** log collection (https://review.px4.io). Flight Review states that public
logs are shared under a Creative Commons Attribution licence; check the current terms on that site before redistributing. Please credit
Flight Review and its uploaders when you share this project's database snapshots, charts or results. The logs include GPS positions and
free-text notes written by their uploaders; they were uploaded publicly by those users.

The repository itself contains no flight logs. `./bin/uavlog` downloads them from Flight Review at a polite rate, and `./bin/snapshot`
packs the processed database for sharing.

## Software this project builds on

| Component | Licence |
|---|---|
| PostgreSQL | PostgreSQL licence |
| TimescaleDB (columnstore and continuous aggregates are under the Timescale License, free to self-host) | Apache-2.0 and Timescale License |
| pgvector, pgvectorscale | PostgreSQL licence |
| DuckDB | MIT |
| pyulog, FastAPI, SQLAlchemy, sqlglot, httpx | BSD or MIT |
| Next.js, React, TanStack Query, uPlot, Zustand | MIT |
| Barlow typeface | SIL Open Font Licence |

Embeddings and language-model calls use an OpenAI-compatible API chosen by the person running the project.
