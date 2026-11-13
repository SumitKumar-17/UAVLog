"""Read-only data explorer: tables and views of the app's two schemas, their structure, a page of rows, and the foreign-key graph.

Only the schemas `public` and `semantic` are exposed; a name is used only after it is found in the catalog, and it is always quoted as an identifier,
so nothing from the request ever reaches the SQL as text. Long values (embeddings, free text) are shortened for display.
"""
from fastapi import APIRouter, Depends, HTTPException, Query
from psycopg import sql
from psycopg.rows import dict_row

from app.api.common import rows
from app.api.deps import pool

router = APIRouter(prefix="/api/data")
SCHEMAS = ("public", "semantic")
HIDDEN = ("alembic_version", "pg_stat_statements", "pg_stat_statements_info")

LIST_SQL = """
SELECT n.nspname AS schema, c.relname AS name,
       CASE WHEN h.hypertable_name IS NOT NULL THEN 'hypertable' WHEN c.relkind = 'v' THEN 'view' WHEN c.relkind = 'm' THEN 'materialized view' ELSE 'table' END AS kind,
       CASE WHEN c.relkind = 'v' THEN NULL WHEN h.hypertable_name IS NOT NULL THEN (SELECT approximate_row_count(c.oid::regclass)) ELSE greatest(c.reltuples, 0)::bigint END AS rows,
       CASE WHEN h.hypertable_name IS NOT NULL THEN hypertable_size(c.oid::regclass) WHEN c.relkind IN ('r', 'm') THEN pg_total_relation_size(c.oid) ELSE NULL END AS bytes,
       obj_description(c.oid, 'pg_class') AS doc
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
LEFT JOIN timescaledb_information.hypertables h ON h.hypertable_schema = n.nspname AND h.hypertable_name = c.relname
WHERE n.nspname = ANY(%(schemas)s) AND c.relkind IN ('r', 'v', 'm', 'p') AND c.relname <> ALL(%(hidden)s)
  AND c.relname NOT LIKE '\\_%%' AND c.relname NOT LIKE 'pg\\_%%' AND NOT (n.nspname = 'public' AND c.relname LIKE '%%\\_chunk')
ORDER BY n.nspname DESC, c.relname"""


def _entry(p, schema: str, name: str) -> dict:
    found = [t for t in rows(p, LIST_SQL, {"schemas": list(SCHEMAS), "hidden": list(HIDDEN)}) if t["schema"] == schema and t["name"] == name]
    if not found:
        raise HTTPException(404, "unknown table")
    return _exact_small(p, found)[0]


def _exact_small(p, items: list[dict]) -> list[dict]:
    """The planner's row estimate is 0 until a table is analysed; small tables are cheap to count exactly."""
    for t in items:
        if t["kind"] in ("table", "materialized view") and (t["rows"] or 0) < 5000:
            with p.connection() as c:
                t["rows"] = c.execute(sql.SQL("SELECT count(*) FROM {}.{}").format(sql.Identifier(t["schema"]), sql.Identifier(t["name"]))).fetchone()[0]
    return items


@router.get("/tables")
def tables(p=Depends(pool)):
    return _exact_small(p, rows(p, LIST_SQL, {"schemas": list(SCHEMAS), "hidden": list(HIDDEN)}))


@router.get("/tables/{schema}/{name}")
def structure(schema: str, name: str, p=Depends(pool)):
    t = _entry(p, schema, name)
    qual = f"{schema}.{name}"
    cols = rows(p, """
        SELECT a.attname AS name, format_type(a.atttypid, a.atttypmod) AS type, NOT a.attnotnull AS nullable, pg_get_expr(d.adbin, d.adrelid) AS default,
               col_description(a.attrelid, a.attnum) AS doc,
               EXISTS (SELECT 1 FROM pg_index i WHERE i.indrelid = a.attrelid AND i.indisprimary AND a.attnum = ANY(i.indkey)) AS pk
        FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
        WHERE a.attrelid = %s::regclass AND a.attnum > 0 AND NOT a.attisdropped ORDER BY a.attnum""", (qual,))
    fks = rows(p, """
        SELECT con.conname AS name, (SELECT array_agg(att.attname ORDER BY k.ord) FROM unnest(con.conkey) WITH ORDINALITY k(attnum, ord) JOIN pg_attribute att ON att.attrelid = con.conrelid AND att.attnum = k.attnum) AS columns,
               n2.nspname AS ref_schema, c2.relname AS ref_table,
               (SELECT array_agg(att.attname ORDER BY k.ord) FROM unnest(con.confkey) WITH ORDINALITY k(attnum, ord) JOIN pg_attribute att ON att.attrelid = con.confrelid AND att.attnum = k.attnum) AS ref_columns
        FROM pg_constraint con JOIN pg_class c2 ON c2.oid = con.confrelid JOIN pg_namespace n2 ON n2.oid = c2.relnamespace
        WHERE con.conrelid = %s::regclass AND con.contype = 'f' AND c2.relname NOT LIKE '\\_%%'""", (qual,))
    idx = rows(p, """
        SELECT i.relname AS name, am.amname AS method, pg_get_indexdef(ix.indexrelid) AS definition, pg_relation_size(ix.indexrelid) AS bytes, ix.indisunique AS "unique", ix.indisprimary AS pk
        FROM pg_index ix JOIN pg_class i ON i.oid = ix.indexrelid JOIN pg_am am ON am.oid = i.relam WHERE ix.indrelid = %s::regclass ORDER BY ix.indisprimary DESC, i.relname""", (qual,))
    extra: dict = {}
    if t["kind"] == "hypertable":
        extra = rows(p, """SELECT (SELECT count(*) FROM timescaledb_information.chunks WHERE hypertable_schema = %(s)s AND hypertable_name = %(n)s) AS chunks,
                                  (SELECT count(*) FROM timescaledb_information.chunks WHERE hypertable_schema = %(s)s AND hypertable_name = %(n)s AND is_compressed) AS compressed_chunks,
                                  (SELECT time_interval FROM timescaledb_information.dimensions WHERE hypertable_schema = %(s)s AND hypertable_name = %(n)s LIMIT 1) AS chunk_interval,
                                  (SELECT segmentby FROM timescaledb_information.hypertable_columnstore_settings WHERE hypertable::text LIKE '%%' || %(n)s LIMIT 1) AS segmentby,
                                  (SELECT orderby FROM timescaledb_information.hypertable_columnstore_settings WHERE hypertable::text LIKE '%%' || %(n)s LIMIT 1) AS orderby""",
                    {"s": schema, "n": name})[0]
    definition = None
    if t["kind"] in ("view", "materialized view"):
        definition = rows(p, "SELECT pg_get_viewdef(%s::regclass, true) AS d", (qual,))[0]["d"]
    return {**t, "columns": cols, "foreign_keys": fks, "indexes": idx, "hypertable": extra or None, "definition": definition}


def _short(v):
    if v is None or isinstance(v, (bool, int, float)):
        return v
    s = str(v)
    if s.startswith("[") and s.endswith("]") and s.count(",") > 20:  # an embedding
        head = ", ".join(s[1:-1].split(",")[:5])
        return f"[{head}, ... {s.count(',') + 1} numbers]"
    return s if len(s) <= 140 else s[:137] + "..."


@router.get("/tables/{schema}/{name}/rows")
def table_rows(schema: str, name: str, p=Depends(pool), limit: int = Query(25, ge=1, le=100), offset: int = Query(0, ge=0, le=100000)):
    t = _entry(p, schema, name)
    q = sql.SQL("SELECT * FROM {}.{} LIMIT {} OFFSET {}").format(sql.Identifier(schema), sql.Identifier(name), sql.Literal(limit), sql.Literal(offset))
    with p.connection() as c, c.cursor(row_factory=dict_row) as cur:
        cur.execute("SET LOCAL statement_timeout = '4s'")
        cur.execute(q)
        data = cur.fetchall()
        cols = [d.name for d in cur.description]
    return {"columns": cols, "rows": [[_short(r[k]) for k in cols] for r in data], "offset": offset, "limit": limit, "total_estimate": t["rows"]}


@router.get("/graph")
def graph(p=Depends(pool)):
    """Tables with their columns and the foreign keys between them, for the relations diagram."""
    ts = [t for t in rows(p, LIST_SQL, {"schemas": ["public"], "hidden": list(HIDDEN)}) if t["kind"] in ("table", "hypertable")]
    names = {t["name"] for t in ts}
    cols = rows(p, """
        SELECT c.relname AS table, a.attname AS name, format_type(a.atttypid, a.atttypmod) AS type,
               EXISTS (SELECT 1 FROM pg_index i WHERE i.indrelid = a.attrelid AND i.indisprimary AND a.attnum = ANY(i.indkey)) AS pk
        FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relname = ANY(%s) AND a.attnum > 0 AND NOT a.attisdropped ORDER BY c.relname, a.attnum""", (list(names),))
    edges = rows(p, """
        SELECT c1.relname AS src, c2.relname AS dst, (SELECT att.attname FROM pg_attribute att WHERE att.attrelid = con.conrelid AND att.attnum = con.conkey[1]) AS column
        FROM pg_constraint con JOIN pg_class c1 ON c1.oid = con.conrelid JOIN pg_class c2 ON c2.oid = con.confrelid
        JOIN pg_namespace n1 ON n1.oid = c1.relnamespace JOIN pg_namespace n2 ON n2.oid = c2.relnamespace
        WHERE con.contype = 'f' AND n1.nspname = 'public' AND n2.nspname = 'public'""")
    edges = [e for e in edges if e["src"] in names and e["dst"] in names]
    by: dict = {}
    for c in cols:
        by.setdefault(c["table"], []).append({"name": c["name"], "type": c["type"], "pk": c["pk"]})
    return {"nodes": [{**t, "columns": by.get(t["name"], [])} for t in ts], "edges": edges}
