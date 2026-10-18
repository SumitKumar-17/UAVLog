"""Tests for the rate limiter, the trusted client address, the embedding cache and the MAVLink parser. None needs the database.
Run: docker compose exec backend python -m unittest tests.test_new_features -v"""
import os
import unittest
from unittest import mock

from fastapi import FastAPI
from fastapi.testclient import TestClient
from starlette.requests import Request

from app.api import limits
from app.api.common import client_ip


def request(peer: str, forwarded: str | None = None) -> Request:
    headers = [(b"x-forwarded-for", forwarded.encode())] if forwarded else []
    return Request({"type": "http", "method": "GET", "path": "/", "headers": headers, "client": (peer, 1234), "query_string": b""})


class ClientIp(unittest.TestCase):
    def test_forwarded_header_is_trusted_only_from_a_private_peer(self):
        self.assertEqual(client_ip(request("172.18.0.5", "203.0.113.9, 172.18.0.5")), "203.0.113.9")
        self.assertEqual(client_ip(request("127.0.0.1", "203.0.113.9")), "203.0.113.9")

    def test_forwarded_header_from_a_public_peer_is_ignored(self):
        self.assertEqual(client_ip(request("8.8.8.8", "203.0.113.9")), "8.8.8.8")  # spoofing attempt (a documentation range such as 198.51.100.0/24 counts as private to Python 3.12)

    def test_without_the_header_the_peer_is_used(self):
        self.assertEqual(client_ip(request("172.18.0.5")), "172.18.0.5")


class RateLimit(unittest.TestCase):
    def setUp(self):
        app = FastAPI()
        app.add_middleware(limits.RateLimit)
        app.get("/ping")(lambda: {"ok": 1})
        app.post("/write")(lambda: {"ok": 1})
        app.get("/health")(lambda: {"ok": 1})
        self.client = TestClient(app, client=("172.18.0.9", 1))

    def test_writes_are_limited_much_more_strictly_than_reads(self):
        with mock.patch.dict(limits.LIMITS, {"read": (5, 60), "write": (2, 60)}):
            self.assertEqual([self.client.post("/write").status_code for _ in range(3)], [200, 200, 429])
            self.assertEqual([self.client.get("/ping").status_code for _ in range(6)], [200] * 5 + [429])

    def test_each_client_has_its_own_budget(self):
        with mock.patch.dict(limits.LIMITS, {"read": (2, 60), "write": (2, 60)}):
            hdr = lambda ip: {"x-forwarded-for": ip}  # noqa: E731
            self.assertEqual([self.client.get("/ping", headers=hdr("1.1.1.1")).status_code for _ in range(3)], [200, 200, 429])
            self.assertEqual(self.client.get("/ping", headers=hdr("2.2.2.2")).status_code, 200)

    def test_health_is_never_limited(self):
        with mock.patch.dict(limits.LIMITS, {"read": (1, 60), "write": (1, 60)}):
            self.assertTrue(all(self.client.get("/health").status_code == 200 for _ in range(5)))


class EmbeddingCache(unittest.TestCase):
    def make(self):
        from app.llm import LLMClient
        c = LLMClient.__new__(LLMClient)  # no network and no key needed
        import threading
        from collections import OrderedDict
        c._cache, c._lock, c.calls = OrderedDict(), threading.Lock(), 0
        def fake(texts, batch=256):
            c.calls += 1
            return [[float(len(t))] for t in texts]
        c.embed = fake
        return c

    def test_repeated_query_costs_one_call_and_ignores_case_and_spacing(self):
        c = self.make()
        a, b = c.embed_cached("GPS  lost"), c.embed_cached("gps lost")
        self.assertEqual((a, c.calls), (b, 1))

    def test_cache_is_bounded(self):
        c = self.make()
        for i in range(10):
            c.embed_cached(f"query {i}", size=4)
        self.assertEqual(len(c._cache), 4)


SAMPLE = "/data/raw/mavlink/vtol.tlog"


@unittest.skipUnless(os.path.exists(SAMPLE), "sample MAVLink log not downloaded")
class MavlinkParser(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        from app.ingest.mavlink import parse
        cls.r = parse(SAMPLE)
        cls.series = {(t, f): (ts, v) for t, f, ts, v in cls.r["hot"]}

    def test_flight_facts(self):
        self.assertEqual(self.r["autopilot"], "ardupilot")
        self.assertAlmostEqual(self.r["duration_s"], 207.6, delta=1.0)
        self.assertTrue(self.r["metadata"]["simulated"])

    def test_sentinel_values_for_unknown_battery_are_dropped(self):
        for f in ("voltage_battery", "current_battery", "battery_remaining"):
            self.assertNotIn(("SYS_STATUS", f), self.series)  # this simulated flight reports 0 and -1 throughout

    def test_attitude_is_present_and_in_radians_before_mapping(self):
        ts, v = self.series[("ATTITUDE", "roll")]
        self.assertGreater(len(v), 500)
        self.assertLess(abs(v).max(), 3.2)  # radians, never degrees

    def test_timestamps_start_at_zero_and_increase(self):
        ts, _ = self.series[("ATTITUDE", "roll")]
        self.assertGreaterEqual(ts.min(), 0)
        self.assertTrue((ts[1:] >= ts[:-1]).all())

    def test_no_zero_coordinates_survive(self):
        for f in ("lat", "lon"):
            self.assertTrue((self.series[("GPS_RAW_INT", f)][1] != 0).all())


if __name__ == "__main__":
    unittest.main()
