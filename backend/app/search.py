"""Hybrid event search: vector similarity + full-text, fused with reciprocal rank fusion (RRF), with filters.
`mode` selects hybrid, vector-only or full-text-only; `weights` = (vector, full-text) overrides it (used by the evaluation).

Filters are applied inside each candidate query. pgvector applies filters *after* the ANN scan, so a selective filter can leave fewer than k
rows. Experiment 3 (docs/decisions.md D18) measured the alternatives, and the planner itself picks the wrong path at 10% selectivity, so the
strategy is chosen here from the planner's row estimate for the filter alone: a very selective filter takes the exact path (filter first,
then sort by distance: exact and fast because few rows survive); anything else takes the HNSW path with iterative scan."""
import re

RRF_K = 60
# (vector weight, full-text weight). Default "hybrid" is vector with a light lexical tie-break (0.1, the weight chosen by
# leave-one-concept-out selection). Plain RRF ("rrf") hurts (nDCG@10 0.60 vs 0.71); weights up to 0.25 are indistinguishable
# from vector-only; full-text adds no measurable benefit, even on exact-term lookups (docs/decisions.md D12).
MODES = {"hybrid": (1.0, 0.1), "rrf": (1.0, 1.0), "vector": (1.0, 0.0), "fts": (0.0, 1.0)}

# Crossover from the filtered-search benchmark (100k vectors): filter + exact sort took 7 ms at 1,000 matching rows and grows linearly with the
# rows that survive; HNSW iterative scan stays near 2 to 7 ms at 1% and 10% selectivity but returns too few rows when the filter is more selective.
# A row count (not a percentage) because exact cost scales with surviving rows. Re-tune with bench_filter.py on the big machine.
EXACT_ROWS = 1500

VEC_ANN = """vec AS (
    SELECT e.id, row_number() OVER (ORDER BY e.embedding <=> q.v) AS r
    FROM event e, q WHERE e.embedding IS NOT NULL {filt}
    ORDER BY e.embedding <=> q.v LIMIT %(pool)s),"""
VEC_EXACT = """vec AS (
    WITH cand AS MATERIALIZED (SELECT e.id, e.embedding FROM event e WHERE e.embedding IS NOT NULL {filt})
    SELECT cand.id, row_number() OVER (ORDER BY cand.embedding <=> q.v) AS r
    FROM cand, q ORDER BY cand.embedding <=> q.v LIMIT %(pool)s),"""

SQL = """
WITH q AS (SELECT %(vec)s::vector AS v, to_tsquery('english', %(tsq)s) AS tq),
{vec_cte}
fts AS (
    SELECT e.id, row_number() OVER (ORDER BY ts_rank_cd(e.tsv, q.tq) DESC) AS r
    FROM event e, q WHERE e.tsv @@ q.tq {filt}
    ORDER BY ts_rank_cd(e.tsv, q.tq) DESC LIMIT %(pool)s)
SELECT e.id, c.key AS kind, e.severity, e.description, f.source_ref AS flight, f.id::text AS flight_uuid, e.ts_start - f.started_at AS t,
       e.embedding <=> (SELECT v FROM q) AS distance,
       %(wv)s * coalesce(1.0 / (%(rrf)s + vec.r), 0) + %(wf)s * coalesce(1.0 / (%(rrf)s + fts.r), 0) AS score, vec.r AS vec_rank, fts.r AS fts_rank
FROM vec FULL OUTER JOIN fts ON vec.id = fts.id
JOIN event e ON e.id = coalesce(vec.id, fts.id)
JOIN concept c ON c.id = e.kind_id JOIN flight f ON f.id = e.flight_id
ORDER BY score DESC, vec.r NULLS LAST, fts.r NULLS LAST LIMIT %(k)s"""


def estimated_rows(conn, filt: list[str], params: dict) -> int | None:
    """The planner's own estimate of how many events survive the filter (None when there is no filter)."""
    if not filt:
        return None
    sql = "EXPLAIN (FORMAT JSON) SELECT 1 FROM event e WHERE e.embedding IS NOT NULL" + "".join(f" AND {x}" for x in filt)
    plan = conn.execute(sql, {k: v for k, v in params.items() if k in ("kinds", "sev", "hw")}).fetchone()[0][0]["Plan"]
    return int(plan["Plan Rows"])


def search(conn, llm, text: str, k: int = 10, kinds: list[str] | None = None, min_severity: int = 0,
           hw: str | None = None, pool: int = 100, mode: str = "hybrid", vec: list[float] | None = None,
           weights: tuple[float, float] | None = None, info: dict | None = None) -> list[dict]:
    filt, params = [], {"k": k, "pool": pool, "rrf": RRF_K}
    params["wv"], params["wf"] = weights or MODES[mode]
    if kinds:
        filt.append("e.kind_id IN (SELECT id FROM concept WHERE kind = 'event' AND key = ANY(%(kinds)s))")
        params["kinds"] = kinds
    if min_severity:
        filt.append("e.severity >= %(sev)s")
        params["sev"] = min_severity
    if hw:
        filt.append("e.flight_id IN (SELECT id FROM flight WHERE metadata->>'sys_hw' = %(hw)s)")
        params["hw"] = hw
    # natural-language queries rarely contain every word of an event: match ANY term (stop words are dropped by the parser)
    params["tsq"] = " | ".join(dict.fromkeys(re.findall(r"[a-z0-9]+", text.lower()))) or "none"
    params["vec"] = str(vec if vec is not None else llm.embed_cached(text))
    est = estimated_rows(conn, filt, params)
    exact = est is not None and est <= EXACT_ROWS
    if info is not None:
        info["strategy"] = "exact (filter first, then sort by distance)" if exact else "approximate (HNSW index)"
        info["filter_estimated_rows"] = est
    conn.execute("SET hnsw.iterative_scan = relaxed_order")
    conn.execute("SET hnsw.ef_search = 100")
    filt_sql = "".join(f" AND {x}" for x in filt)
    cur = conn.execute(SQL.format(vec_cte=(VEC_EXACT if exact else VEC_ANN).format(filt=filt_sql), filt=filt_sql), params)
    cols = [d.name for d in cur.description]
    return [dict(zip(cols, r)) for r in cur.fetchall()]
