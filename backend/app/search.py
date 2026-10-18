"""Hybrid event search: vector similarity + full-text, fused with reciprocal rank fusion (RRF), with filters.
`mode` selects hybrid, vector-only or full-text-only; `weights` = (vector, full-text) overrides it (used by the evaluation).

Filters are applied inside each candidate query. pgvector applies filters *after* the ANN scan, so iterative scan
is enabled to keep filtered queries from under-returning (see docs/decisions.md)."""
import re

RRF_K = 60
# (vector weight, full-text weight). Default "hybrid" is vector-dominant: on our benchmark plain RRF ("rrf") hurts
# (nDCG@10 0.62 vs 0.70) while weights up to 0.5 are indistinguishable from vector-only (docs/decisions.md D12).
MODES = {"hybrid": (1.0, 0.25), "rrf": (1.0, 1.0), "vector": (1.0, 0.0), "fts": (0.0, 1.0)}

SQL = """
WITH q AS (SELECT %(vec)s::vector AS v, to_tsquery('english', %(tsq)s) AS tq),
vec AS (
    SELECT e.id, row_number() OVER (ORDER BY e.embedding <=> q.v) AS r
    FROM event e, q WHERE e.embedding IS NOT NULL {filt}
    ORDER BY e.embedding <=> q.v LIMIT %(pool)s),
fts AS (
    SELECT e.id, row_number() OVER (ORDER BY ts_rank_cd(e.tsv, q.tq) DESC) AS r
    FROM event e, q WHERE e.tsv @@ q.tq {filt}
    ORDER BY ts_rank_cd(e.tsv, q.tq) DESC LIMIT %(pool)s)
SELECT e.id, c.key AS kind, e.severity, e.description, f.source_ref AS flight, f.id::text AS flight_uuid, e.ts_start - f.started_at AS t,
       %(wv)s * coalesce(1.0 / (%(rrf)s + vec.r), 0) + %(wf)s * coalesce(1.0 / (%(rrf)s + fts.r), 0) AS score, vec.r AS vec_rank, fts.r AS fts_rank
FROM vec FULL OUTER JOIN fts ON vec.id = fts.id
JOIN event e ON e.id = coalesce(vec.id, fts.id)
JOIN concept c ON c.id = e.kind_id JOIN flight f ON f.id = e.flight_id
ORDER BY score DESC, vec.r NULLS LAST, fts.r NULLS LAST LIMIT %(k)s"""


def search(conn, llm, text: str, k: int = 10, kinds: list[str] | None = None, min_severity: int = 0,
           hw: str | None = None, pool: int = 100, mode: str = "hybrid", vec: list[float] | None = None,
           weights: tuple[float, float] | None = None) -> list[dict]:
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
    params["vec"] = str(vec if vec is not None else llm.embed([text])[0])
    conn.execute("SET hnsw.iterative_scan = relaxed_order")
    conn.execute("SET hnsw.ef_search = 100")
    cur = conn.execute(SQL.format(filt="".join(f" AND {x}" for x in filt)), params)
    cols = [d.name for d in cur.description]
    return [dict(zip(cols, r)) for r in cur.fetchall()]
