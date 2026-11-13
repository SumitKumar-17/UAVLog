# Deploy on Vercel (two projects from this repository)

The web app proxies `/api/*` to the API, so deploy the API first and give its address to the web project.

## 1. API project (FastAPI, read-only)
- Import the GitHub repository. **Root Directory:** the repository root (leave empty). **Framework Preset:** Other.
- Build settings: leave the defaults (`api/index.py` and the root `pyproject.toml` (slim dependencies and the entry point) are already in the repository).
- **Settings, Deployment Protection:** turn Vercel Authentication off for this project (the web project calls it server to server).
- Environment variables (Production):

| Name | Value |
|---|---|
| `DATABASE_URL` | `postgresql+psycopg://tsdbadmin:<password>@<host>:<port>/tsdb?sslmode=require` (the Tiger Cloud URL with the scheme changed to `postgresql+psycopg://`) |
| `ALLOW_WRITES` | `0` (read-only: disables uploads, notes and saved queries) |
| `OPENAI_API_KEY` | your key |
| `OPENAI_API_BASE` | `https://api.openai.com/v1` |
| `LLM_MODEL` | `gpt-4o-mini` |
| `EMBED_MODEL` | `text-embedding-3-small` |
| `EMBED_DIMS` | `1536` |
| `CORS_ORIGINS` | optional: your web site address(es), comma separated, only if something other than the web project calls the API directly |

- Check after deploy: `https://<api-project>.vercel.app/api/stats` returns the flight, event and sample counts.

## 2. Web project (Next.js)
- Import the same repository again. **Root Directory:** `web`. Framework: Next.js (detected).
- Environment variable (Production): `API_URL` = `https://<api-project>.vercel.app` (no trailing slash).
- Deploy, then open the site. The Upload page needs a writable host and is not available on this deployment.

Notes: the API image on Vercel contains only what serving needs (no log parser, DuckDB or simulators); the benchmark result files are bundled from `bench/results/`. Changing `API_URL` needs a redeploy of the web project.
