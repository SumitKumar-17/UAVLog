"""Database internals for the Database page: live storage, index and queue facts and EXPLAIN ANALYZE of fixed demo queries.
Only named queries run here (never caller-supplied SQL)."""
from fastapi import APIRouter, Depends, HTTPException
from psycopg import sql
from psycopg.rows import dict_row

from app.api.deps import pool

router = APIRouter(prefix="/api/internals")

DEMOS = {
    "envelope": {
        "title": "One signal of one flight, as min/max buckets",
        "about": "Reads compressed columnar chunks for a single series (segment by flight and signal), decompresses only the matching segments and aggregates per time bucket.",
        "sql": """SELECT time_bucket(make_interval(secs => 1.0), ts) AS bucket, min(value), max(value), avg(value)
FROM canonical_telemetry
WHERE flight_id = {fid} AND signal = 'battery.voltage'
GROUP BY 1 ORDER BY 1""",
    },
    "vector": {
        "title": "Ten nearest events by meaning",
        "about": "Approximate nearest-neighbour search over 1536-dimensional embeddings using the HNSW index.",
        "sql": """SELECT id, description FROM event
WHERE embedding IS NOT NULL
ORDER BY embedding <=> (SELECT embedding FROM event WHERE id = {eid})
LIMIT 10""",
    },
    "fulltext": {
        "title": "Events matching any of several words",
        "about": "Inverted-index lookup on the generated tsvector column (GIN), ranked by ts_rank_cd.",
        "sql": """SELECT id, description FROM event
WHERE tsv @@ to_tsquery('english', 'motor | propeller | rotor')
ORDER BY ts_rank_cd(tsv, to_tsquery('english', 'motor | propeller | rotor')) DESC
LIMIT 10""",
    },
    "modes": {
        "title": "Flight-mode ribbon for a flight (gaps and islands)",
        "about": "Turns the sampled mode signal into runs with two ROW_NUMBER() window functions, the classic gaps-and-islands pattern.",
        "sql": """WITH s AS (SELECT t.ts, t.value::int AS v FROM telemetry t
           JOIN vendor_field vf ON vf.id = t.vendor_field_id AND vf.topic = 'vehicle_status' AND vf.field = 'nav_state'
           WHERE t.flight_id = {fid}),
g AS (SELECT *, row_number() OVER (ORDER BY ts) - row_number() OVER (PARTITION BY v ORDER BY ts) AS grp FROM s)
SELECT v, min(ts) AS started, max(ts) AS ended FROM g GROUP BY v, grp ORDER BY started""",
    },
}


def rows(p, query: str, params=None) -> list[dict]:
    with p.connection() as c, c.cursor(row_factory=dict_row) as cur:
        cur.execute(query, params or {})
        return cur.fetchall()


@router.get("")
def internals(p=Depends(pool)):
    cs = rows(p, "SELECT * FROM hypertable_columnstore_stats('telemetry')")[0]
    return {
        "versions": rows(p, """SELECT (SELECT split_part(version(), ' ', 2)) AS postgres,
            (SELECT extversion FROM pg_extension WHERE extname = 'timescaledb') AS timescaledb,
            (SELECT extversion FROM pg_extension WHERE extname = 'vector') AS pgvector""")[0],
        "columnstore": {
            "chunks": cs["total_chunks"], "compressed_chunks": cs["number_compressed_chunks"],
            "before_bytes": cs["before_compression_total_bytes"], "after_bytes": cs["after_compression_total_bytes"],
            "before_index_bytes": cs["before_compression_index_bytes"],
        },
        "telemetry_rows": rows(p, "SELECT count(*) AS n FROM telemetry")[0]["n"],
        "indexes": rows(p, """SELECT relname AS name, indrelid::regclass::text AS on_table, am.amname AS method,
                                     pg_relation_size(i.indexrelid) AS bytes
                              FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid JOIN pg_am am ON am.oid = c.relam
                              WHERE indrelid::regclass::text IN ('event', 'flight', 'concept', 'field_mapping', 'vendor_field')
                              ORDER BY bytes DESC LIMIT 12"""),
        "tables": rows(p, """SELECT relname AS name, pg_total_relation_size(c.oid) AS bytes, reltuples::bigint AS approx_rows
                             FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
                             WHERE n.nspname = 'public' AND c.relkind = 'r' AND relname IN ('event', 'flight', 'concept', 'concept_relation',
                                   'vendor_field', 'field_mapping', 'ingest_job', 'flight_task', 'llm_call') ORDER BY bytes DESC"""),
        "queues": rows(p, """SELECT 'ingest' AS stage, status, count(*) AS n FROM ingest_job GROUP BY status
                             UNION ALL SELECT stage, status, count(*) FROM flight_task GROUP BY stage, status ORDER BY 1, 2"""),
        "llm": rows(p, """SELECT kind, count(*) AS calls, coalesce(sum(prompt_tokens), 0) AS prompt_tokens,
                                 coalesce(sum(completion_tokens), 0) AS completion_tokens, round(avg(latency_ms)) AS avg_latency_ms
                          FROM llm_call GROUP BY kind ORDER BY kind"""),
        "demos": [{"id": k, "title": v["title"], "about": v["about"]} for k, v in DEMOS.items()],
    }


@router.get("/explain/{name}")
def explain(name: str, p=Depends(pool)):
    demo = DEMOS.get(name)
    if not demo:
        raise HTTPException(404, "unknown demo query")
    with p.connection() as c:
        fid = c.execute("SELECT id FROM flight ORDER BY duration_s DESC LIMIT 1").fetchone()[0]
        eid = c.execute("SELECT id FROM event WHERE embedding IS NOT NULL ORDER BY id LIMIT 1").fetchone()[0]
        query = sql.SQL(demo["sql"]).format(fid=sql.Literal(str(fid)), eid=sql.Literal(eid)).as_string(c)
        plan = [r[0] for r in c.execute("EXPLAIN (ANALYZE, BUFFERS, SETTINGS OFF) " + query).fetchall()]
    timing = next((line for line in reversed(plan) if line.startswith("Execution Time")), "")
    return {"name": name, "title": demo["title"], "about": demo["about"], "sql": query, "plan": plan, "execution": timing}
