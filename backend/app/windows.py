"""Windows of signal behaviour: the features of a 10 second slice of a flight, and the scaler and PCA that turn them into a 32 dimension vector.

Used by scripts/build_windows.py (fit and fill) and by the API. A window is described by mean, standard deviation, minimum, maximum and slope of
every canonical signal that most flights have. Missing signals count as 'typical' (0 after robust scaling) so that flights from other autopilots
can still be searched.
"""
import numpy as np

WINDOW_S = 10.0
HOP_S = 5.0
DIMS = 32
STATS = ("mean", "std", "min", "max", "slope")
MIN_SIGNAL_SHARE = 0.5  # a window needs at least this share of the model's signals to be kept

SERIES_SQL = """
SELECT c.key, extract(epoch FROM time_bucket('1 second', t.ts) - f.started_at) AS t, avg(t.value * m.scale + m."offset") AS v
FROM telemetry t JOIN field_mapping m ON m.vendor_field_id = t.vendor_field_id
JOIN concept c ON c.id = m.concept_id AND c.kind = 'signal' AND c.key = ANY(%(signals)s)
JOIN flight f ON f.id = t.flight_id
WHERE t.flight_id = %(fid)s GROUP BY 1, 2 ORDER BY 1, 2"""


def load_series(conn, fid, signals: list[str]) -> dict[str, tuple[np.ndarray, np.ndarray]]:
    """One value per second for each signal of a flight: {signal: (seconds from start, values)}."""
    out: dict[str, list] = {}
    for key, t, v in conn.execute(SERIES_SQL, {"fid": fid, "signals": signals}).fetchall():
        out.setdefault(key, [[], []])
        out[key][0].append(float(t))
        out[key][1].append(float(v))
    return {k: (np.array(a), np.array(b)) for k, (a, b) in out.items()}


def window_starts(duration: float) -> list[float]:
    n = int((duration - WINDOW_S) // HOP_S) + 1
    return [i * HOP_S for i in range(max(n, 0))]


def window_features(series: dict, signals: list[str], t0: float) -> np.ndarray:
    """Raw feature vector (NaN where a signal has fewer than 3 samples in the window)."""
    x = np.full(len(signals) * len(STATS), np.nan)
    for i, s in enumerate(signals):
        if s not in series:
            continue
        t, v = series[s]
        a, b = np.searchsorted(t, t0), np.searchsorted(t, t0 + WINDOW_S)
        if b - a < 3:
            continue
        seg, ts = v[a:b], t[a:b]
        slope = float(np.polyfit(ts - ts[0], seg, 1)[0]) if np.ptp(ts) > 0 else 0.0
        x[i * len(STATS):(i + 1) * len(STATS)] = [seg.mean(), seg.std(), seg.min(), seg.max(), slope]
    return x


def fit(X: np.ndarray, signals: list[str]) -> dict:
    """Robust scaling (median, IQR, clipped at 5) then PCA to DIMS dimensions."""
    med = np.nanmedian(X, axis=0)
    q75, q25 = np.nanpercentile(X, 75, axis=0), np.nanpercentile(X, 25, axis=0)
    sd = np.nanstd(X, axis=0)
    scale = np.where((q75 - q25) > 1e-9, q75 - q25, np.where(sd > 1e-9, sd, 1.0))
    Z = np.where(np.isnan(X), 0.0, np.clip((X - med) / scale, -5, 5))
    mean = Z.mean(axis=0)
    _, svals, vt = np.linalg.svd(Z - mean, full_matrices=False)
    k = min(DIMS, vt.shape[0])
    comp = np.zeros((DIMS, X.shape[1]))
    comp[:k] = vt[:k]
    explained = float((svals[:k] ** 2).sum() / (svals ** 2).sum())
    return {"signals": signals, "stats": list(STATS), "median": med.tolist(), "scale": scale.tolist(), "pca_mean": mean.tolist(),
            "components": comp.tolist(), "window_s": WINDOW_S, "hop_s": HOP_S, "explained_variance": explained}


def transform(model: dict, X: np.ndarray) -> np.ndarray:
    Z = np.where(np.isnan(X), 0.0, np.clip((X - np.array(model["median"])) / np.array(model["scale"]), -5, 5))
    S = (Z - np.array(model["pca_mean"])) @ np.array(model["components"]).T
    return (S / np.maximum(np.linalg.norm(S, axis=1, keepdims=True), 1e-9)).astype(np.float32)
