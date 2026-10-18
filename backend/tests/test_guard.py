"""Adversarial tests for the NL-to-SQL guard. Run: docker compose exec backend python -m unittest discover -s tests -v"""
import unittest

from app.nlsql.guard import MAX_ROWS, GuardError, Policy, check

MUST_REFUSE = {
    "drop": "DROP TABLE flight",
    "delete": "DELETE FROM semantic.flights",
    "update": "UPDATE semantic.flights SET board = 'x'",
    "insert": "INSERT INTO semantic.flights (log_id) VALUES ('x')",
    "stacked statements": "SELECT * FROM semantic.flights; DROP TABLE flight",
    "read file": "SELECT pg_read_file('/etc/passwd')",
    "read file, schema-qualified": "SELECT pg_catalog.pg_read_file('/etc/passwd')",
    "read file, upper case": "SELECT PG_READ_FILE('/etc/passwd')",
    "read file, comment between": "SELECT pg_read_file /* x */ ('/etc/passwd')",
    "copy program": "COPY flight TO PROGRAM 'id'",
    "dblink": "SELECT dblink('host=x', 'select 1')",
    "set_config": "SELECT set_config('role', 'uavlog', false)",
    "current_setting": "SELECT current_setting('is_superuser')",
    "sleep": "SELECT pg_sleep(100)",
    "sleep in where": "SELECT * FROM semantic.flights WHERE pg_sleep(100) IS NOT NULL",
    "base table": "SELECT * FROM flight",
    "base table, public": "SELECT * FROM public.flight",
    "catalog table": "SELECT * FROM pg_shadow",
    "catalog table, qualified": "SELECT * FROM pg_catalog.pg_user",
    "information_schema": "SELECT * FROM information_schema.tables",
    "catalog-qualified": "SELECT * FROM postgres.public.flight",
    "data-modifying cte": "WITH x AS (DELETE FROM flight RETURNING *) SELECT * FROM x",
    "select into": "SELECT * INTO newtable FROM semantic.flights",
    "for update": "SELECT * FROM semantic.flights FOR UPDATE",
    "large object": "SELECT lo_import('/etc/passwd')",
    "table function": "SELECT * FROM generate_series(1, 1000000000)",
    "recursive cte": "WITH RECURSIVE r AS (SELECT 1 AS n UNION ALL SELECT n + 1 FROM r) SELECT * FROM r",
    "nested with": "SELECT * FROM (WITH a AS (SELECT 1 AS x) SELECT * FROM a) q",
    "placeholder": "SELECT * FROM semantic.flights WHERE flight_id = $1",
    "set role": "SET ROLE uavlog",
    "reset role": "RESET ROLE",
    "set timeout": "SET statement_timeout = 0",
    "version": "SELECT version()",
    "current_user": "SELECT current_user",
    "explain analyze delete": "EXPLAIN ANALYZE DELETE FROM flight",
    "json builder": "SELECT json_agg(f) FROM semantic.flights f",
    "query_to_xml": "SELECT query_to_xml('select * from flight', true, true, '')",
    "union with base table": "SELECT log_id FROM semantic.flights UNION SELECT source_ref FROM flight",
    "subquery on base table": "SELECT (SELECT count(*) FROM flight)",
    "do block": "DO $$ BEGIN PERFORM 1; END $$",
    "call": "CALL foo()",
    "empty": "",
    "only semicolon": ";",
    "values": "VALUES (1), (2)",
    "unnest": "SELECT * FROM unnest(ARRAY[1, 2, 3])",
    "too long": "SELECT 1 " + "+ 1 " * 2000,
}

MUST_ACCEPT = {
    "count by kind": "SELECT kind, count(*) FROM semantic.events GROUP BY kind ORDER BY 2 DESC",
    "unqualified view": "SELECT board, count(*) FROM flights GROUP BY board",
    "quoted names": 'SELECT * FROM "semantic"."flights" WHERE 1 = 1',
    "join": "SELECT f.board, count(*) FROM semantic.events e JOIN semantic.flights f USING (flight_id) WHERE e.kind = 'motor_failure_detected' GROUP BY f.board",
    "telemetry filtered": "SELECT avg(value) FROM semantic.telemetry WHERE flight_id = '00000000-0000-0000-0000-000000000000' AND signal = 'battery.voltage'",
    "summary": "SELECT flight_id, min_value FROM semantic.signal_summary WHERE signal = 'battery.voltage' AND min_value < 20",
    "cte": "WITH bad AS (SELECT DISTINCT flight_id FROM semantic.events WHERE severity = 2) SELECT count(*) FROM bad",
    "window": "SELECT flight_id, row_number() OVER (PARTITION BY flight_id ORDER BY start_s) FROM semantic.events",
    "percentile": "SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY duration_s) FROM semantic.flights",
    "extract and cast": "SELECT extract(year FROM started_at), CAST(duration_s AS int) FROM semantic.flights",
    "case": "SELECT CASE WHEN duration_s > 300 THEN 'long' ELSE 'short' END, count(*) FROM semantic.flights GROUP BY 1",
    "set operation": "SELECT flight_id FROM semantic.events WHERE kind = 'takeoff' INTERSECT SELECT flight_id FROM semantic.events WHERE kind = 'landing'",
    "lowercase and spacing": "select   count(*)   from   semantic.flights",
    "constant": "SELECT 1",
}


class GuardTests(unittest.TestCase):
    def test_refuses_hostile_queries(self):
        for name, q in MUST_REFUSE.items():
            with self.subTest(name):
                with self.assertRaises(GuardError, msg=f"should have refused: {q[:80]}"):
                    check(q)

    def test_accepts_legitimate_queries(self):
        for name, q in MUST_ACCEPT.items():
            with self.subTest(name):
                r = check(q)
                self.assertTrue(r.sql.upper().startswith(("SELECT", "WITH")), r.sql)
                self.assertNotIn(";", r.sql)

    def test_qualifies_tables_and_adds_limit(self):
        r = check("SELECT * FROM flights")
        self.assertIn("semantic.flights", r.sql)
        self.assertTrue(r.sql.endswith(f"LIMIT {MAX_ROWS}"))

    def test_caps_large_and_computed_limits(self):
        for q in ("SELECT * FROM flights LIMIT 99999999", "SELECT * FROM flights LIMIT 100 + 100000"):
            with self.subTest(q):
                r = check(q)
                self.assertIn(f"LIMIT {MAX_ROWS}", r.sql)

    def test_keeps_small_limit(self):
        self.assertTrue(check("SELECT * FROM flights LIMIT 5").sql.endswith("LIMIT 5"))

    def test_executes_regenerated_sql_not_original(self):
        r = check("SELECT * FROM flights /* ; DROP TABLE flight */")
        self.assertNotIn("DROP", r.sql.upper())

    def test_raw_policy_allows_base_tables_but_not_semantic(self):
        self.assertIn("public.flight", check("SELECT * FROM flight", Policy.raw()).sql)
        with self.assertRaises(GuardError):
            check("SELECT * FROM semantic.flights", Policy.raw())
        with self.assertRaises(GuardError):
            check("SELECT * FROM pg_shadow", Policy.raw())

    def test_semantic_policy_refuses_raw_tables(self):
        for t in ("flight", "event", "telemetry_raw", "concept"):
            with self.subTest(t), self.assertRaises(GuardError):
                check(f"SELECT * FROM {t}")


if __name__ == "__main__":
    unittest.main()
