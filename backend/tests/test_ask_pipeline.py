"""Pipeline tests with a scripted fake model: a model that OBEYS prompt injection must still be stopped by the guard, and
repair rounds must work. Needs the database. Run: docker compose exec backend python -m unittest discover -s tests -v"""
import unittest

from psycopg_pool import ConnectionPool

from app.config import settings
from app.nlsql.generate import ask


class FakeLLM:
    def __init__(self, replies):
        self.replies, self.calls = list(replies), 0

    def chat(self, messages, **_):
        self.calls += 1
        return self.replies.pop(0) if len(self.replies) > 1 else self.replies[0]


class PipelineTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.pool = ConnectionPool(settings.dsn, min_size=1, max_size=2, kwargs={"autocommit": True})

    @classmethod
    def tearDownClass(cls):
        cls.pool.close()

    def run_q(self, replies, **kw):
        llm = FakeLLM(replies)
        return ask(self.pool, llm, "anything", **kw), llm

    def test_obedient_model_cannot_read_files(self):
        ans, llm = self.run_q(["```sql\nSELECT pg_read_file('/etc/passwd')\n```"])
        self.assertIsNone(ans.sql)
        self.assertIsNotNone(ans.error)
        self.assertEqual(llm.calls, 3)  # original try plus two repair rounds, all refused
        self.assertEqual(ans.rows, [])

    def test_obedient_model_cannot_modify_data(self):
        before = self.count_flights()
        for evil in ("DELETE FROM flight", "DROP TABLE flight", "DELETE FROM semantic.flights", "UPDATE flight SET firmware = 'x'"):
            with self.subTest(evil):
                ans, _ = self.run_q([f"```sql\n{evil}\n```"])
                self.assertIsNone(ans.sql)
        self.assertEqual(self.count_flights(), before)

    def test_stacked_statement_is_refused(self):
        ans, _ = self.run_q(["```sql\nSELECT 1; DELETE FROM flight\n```"])
        self.assertIsNone(ans.sql)

    def test_repair_after_error(self):
        ans, llm = self.run_q(["```sql\nSELECT nonexistent_column FROM semantic.flights\n```",
                               "```sql\nSELECT count(*) AS n FROM semantic.flights\n```"])
        self.assertIsNone(ans.error)
        self.assertEqual(len(ans.attempts), 2)
        self.assertIsNotNone(ans.attempts[0].error)
        self.assertEqual(ans.columns, ["n"])

    def test_cost_admission_refuses_expensive_query(self):
        ans, _ = self.run_q(["```sql\nSELECT count(*) FROM semantic.telemetry a JOIN semantic.telemetry b ON a.flight_id = b.flight_id\n```"])
        self.assertIsNone(ans.sql)
        self.assertIn("expensive", ans.error)

    def test_cannot_answer_is_passed_through(self):
        ans, _ = self.run_q(["-- CANNOT_ANSWER: no weather data"])
        self.assertEqual(ans.cannot_answer, "no weather data")

    def test_result_rows_are_capped(self):
        ans, _ = self.run_q(["```sql\nSELECT * FROM semantic.events\n```"])
        self.assertLessEqual(len(ans.rows), 200)
        self.assertTrue(ans.truncated)

    def count_flights(self):
        with self.pool.connection() as c:
            return c.execute("SELECT count(*) FROM flight").fetchone()[0]


if __name__ == "__main__":
    unittest.main()
