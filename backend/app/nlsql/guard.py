"""SQL guard for model-written queries.

Defence in depth, this being the first layer: (1) this parser-based allow-list, (2) a read-only role that can only see the
curated views, (3) a read-only transaction with a statement timeout, (4) a cost-based admission check (see execute.py).
SELECT-only is not a security boundary by itself, so tables AND functions are allow-listed, and what is executed is the
SQL regenerated from the parsed tree, never the text the model produced.
"""
from dataclasses import dataclass, field

import sqlglot
from sqlglot import exp
from sqlglot.errors import ParseError

MAX_ROWS = 200
MAX_CHARS = 4000
MAX_TABLES = 8

SEMANTIC_TABLES = {"flights", "events", "signals", "telemetry", "signal_summary", "ontology"}
RAW_TABLES = {"telemetry", "vendor_field", "field_mapping", "concept", "concept_relation", "event", "flight"}

# Pure functions only: nothing that reads files, sleeps, changes settings, calls out, or builds JSON.
FUNCTIONS = {
    "count", "sum", "avg", "min", "max", "round", "floor", "ceil", "ceiling", "abs", "sqrt", "power", "pow", "ln", "log", "mod",
    "sign", "coalesce", "nullif", "greatest", "least", "date_trunc", "date_part", "extract", "cast", "try_cast", "lower", "upper",
    "length", "substring", "substr", "strpos", "position", "concat", "concat_ws", "trim", "ltrim", "rtrim", "replace", "left",
    "right", "split_part", "to_char", "array_agg", "string_agg", "percentile_cont", "percentile_disc", "stddev", "stddev_pop",
    "stddev_samp", "variance", "var_pop", "var_samp", "corr", "row_number", "rank", "dense_rank", "ntile", "lag", "lead",
    "first_value", "last_value", "nth_value", "bool_and", "bool_or", "every", "array_length", "cardinality", "if", "case",
    "any_value", "make_interval", "to_timestamp", "lpad", "rpad", "initcap", "reverse", "min_by", "max_by", "approx_percentile",
    "median", "mode", "regr_slope", "regr_intercept", "covar_pop", "covar_samp", "width_bucket", "trunc", "exp", "cume_dist",
    "percent_rank",
}

_FORBIDDEN_NAMES = [
    "Insert", "Update", "Delete", "Merge", "Create", "Drop", "Alter", "Command", "Copy", "Set", "Use", "Transaction", "Commit",
    "Rollback", "Into", "Lock", "Pragma", "Describe", "Analyze", "Placeholder", "Parameter", "Unnest", "Values",
]
# Resolved by name and checked: a node type missing from this sqlglot version must fail loudly, never silently weaken the guard.
_missing = [n for n in _FORBIDDEN_NAMES if not hasattr(exp, n)]
if _missing:
    raise ImportError(f"sqlglot has no node types {_missing}; update the guard's forbidden list")
FORBIDDEN_NODES = tuple(getattr(exp, n) for n in _FORBIDDEN_NAMES)


class GuardError(ValueError):
    """The query was refused. The message is written for the model (self-repair) and for the user."""


@dataclass(frozen=True)
class Policy:
    schema: str
    tables: frozenset

    @staticmethod
    def semantic() -> "Policy":
        return Policy("semantic", frozenset(SEMANTIC_TABLES))

    @staticmethod
    def raw() -> "Policy":
        return Policy("public", frozenset(RAW_TABLES))


@dataclass
class Checked:
    sql: str
    tables: list[str] = field(default_factory=list)
    functions: list[str] = field(default_factory=list)
    notes: list[str] = field(default_factory=list)


def _fn_name(node: exp.Expression) -> str:
    if isinstance(node, exp.Anonymous):
        return str(node.name).lower()
    return node.sql_name().lower()


def check(query: str, policy: Policy | None = None) -> Checked:
    policy = policy or Policy.semantic()
    if not query or not query.strip():
        raise GuardError("The query is empty.")
    if len(query) > MAX_CHARS:
        raise GuardError(f"The query is longer than {MAX_CHARS} characters.")
    try:
        statements = [s for s in sqlglot.parse(query, read="postgres") if s is not None]
    except ParseError as e:
        raise GuardError(f"The query is not valid PostgreSQL: {str(e).splitlines()[0]}") from e
    if len(statements) != 1:
        raise GuardError("Send exactly one statement.")
    root = statements[0]
    if not isinstance(root, (exp.Select, exp.SetOperation)):
        raise GuardError(f"Only SELECT queries are allowed, got {type(root).__name__.upper()}.")

    bad = next((n for n in root.walk() if isinstance(n, FORBIDDEN_NODES)), None)
    if bad is not None:
        raise GuardError(f"{type(bad).__name__.upper()} is not allowed in a query.")

    withs = [n for n in root.walk() if isinstance(n, exp.With)]
    if any(w is not root.args.get("with_") and w is not root.args.get("with") for w in withs):
        raise GuardError("WITH is only allowed at the top level of the query.")
    if any(w.args.get("recursive") for w in withs):
        raise GuardError("Recursive WITH is not allowed.")
    cte_names = {c.alias_or_name.lower() for c in root.find_all(exp.CTE)}

    used_tables: list[str] = []
    for t in root.find_all(exp.Table):
        if not isinstance(t.this, exp.Identifier):
            raise GuardError("Table-valued functions are not allowed in FROM.")
        name, schema = t.name.lower(), (t.db or "").lower()
        if t.args.get("catalog"):
            raise GuardError("Catalog-qualified table names are not allowed.")
        if not schema and name in cte_names:
            continue
        if schema and schema != policy.schema:
            raise GuardError(f"Schema '{schema}' is not available. Use only the {policy.schema} views: {', '.join(sorted(policy.tables))}.")
        if name not in policy.tables:
            raise GuardError(f"'{name}' is not available. Use only: {', '.join(sorted(policy.tables))}.")
        t.set("db", exp.to_identifier(policy.schema))  # qualify, so search_path never matters
        used_tables.append(name)
    if len(used_tables) > MAX_TABLES:
        raise GuardError(f"The query references {len(used_tables)} tables; the limit is {MAX_TABLES}.")

    funcs: list[str] = []
    for n in root.walk():
        # boolean connectors (AND/OR) are Func subclasses in sqlglot but are operators, not calls
        if isinstance(n, exp.Func) and not isinstance(n, (exp.Table, exp.Connector)):
            name = _fn_name(n)
            if name and name not in FUNCTIONS:
                raise GuardError(f"Function '{name.replace('j_s_o_n', 'json').replace('current_version', 'version')}' is not allowed.")
            funcs.append(name)
        if isinstance(n, exp.Dot) and isinstance(n.this, exp.Identifier) and n.this.name.lower() in {"pg_catalog", "information_schema", "pg_temp"}:
            raise GuardError(f"'{n.this.name}' is not available.")

    notes: list[str] = []
    limit = root.args.get("limit")
    n_limit = None
    if limit is not None:
        lit = limit.expression if isinstance(limit, exp.Limit) else None
        n_limit = int(lit.name) if isinstance(lit, exp.Literal) and lit.is_int else None
    if limit is None:
        root = root.limit(MAX_ROWS)
        notes.append(f"added LIMIT {MAX_ROWS}")
    elif n_limit is None or n_limit > MAX_ROWS:
        root = sqlglot.select("*").from_(root.subquery("_q")).limit(MAX_ROWS)
        notes.append(f"capped to {MAX_ROWS} rows")
    return Checked(sql=root.sql(dialect="postgres", comments=False), tables=sorted(set(used_tables)), functions=sorted(set(funcs)), notes=notes)
