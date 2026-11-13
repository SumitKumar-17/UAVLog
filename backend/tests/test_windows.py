"""Window features, the fitted scaler and PCA, and the guard on queries the workbench accepts or saves. No database needed."""
import unittest

import numpy as np

from app import windows
from app.nlsql import guard


def series(n=60):
    t = np.arange(n, dtype=float)
    return {"battery.voltage": (t, 25 - 0.01 * t), "vibration.accel": (t, np.where(t > 30, 12.0, 2.0))}


class WindowFeatures(unittest.TestCase):
    sigs = ["battery.voltage", "vibration.accel", "missing.signal"]

    def test_five_statistics_per_signal_and_nan_for_a_missing_signal(self):
        x = windows.window_features(series(), self.sigs, 0.0)
        self.assertEqual(x.shape, (len(self.sigs) * len(windows.STATS),))
        self.assertTrue(np.isfinite(x[:10]).all())
        self.assertTrue(np.isnan(x[10:]).all())

    def test_slope_and_range_are_measured(self):
        x = windows.window_features(series(), self.sigs, 0.0)
        mean, std, lo, hi, slope = x[:5]
        self.assertAlmostEqual(slope, -0.01, places=4)
        self.assertLess(lo, hi)

    def test_window_starts_cover_the_flight_with_the_hop(self):
        self.assertEqual(windows.window_starts(30.0), [0.0, 5.0, 10.0, 15.0, 20.0])
        self.assertEqual(windows.window_starts(5.0), [])

    def test_fit_and_transform_give_unit_vectors_of_the_right_size(self):
        rng = np.random.default_rng(1)
        X = rng.normal(size=(200, 15))
        X[rng.random(X.shape) < 0.1] = np.nan
        model = windows.fit(X, ["a", "b", "c"])
        E = windows.transform(model, X)
        self.assertEqual(E.shape, (200, windows.DIMS))
        self.assertTrue(np.allclose(np.linalg.norm(E, axis=1), 1.0, atol=1e-4))
        self.assertGreater(model["explained_variance"], 0.5)


class WorkbenchGuard(unittest.TestCase):
    def test_a_plain_select_over_a_view_is_accepted(self):
        self.assertIn("flights", guard.check("SELECT board, count(*) FROM semantic.flights GROUP BY board", guard.Policy.semantic()).tables)

    def test_the_workbench_refuses_what_the_ask_page_refuses(self):
        for bad in ["SELECT pg_read_file('/etc/passwd')", "DROP TABLE flight", "SELECT * FROM public.flight", "SELECT 1; SELECT 2"]:
            with self.assertRaises(guard.GuardError, msg=bad):
                guard.check(bad, guard.Policy.semantic())


if __name__ == "__main__":
    unittest.main()
