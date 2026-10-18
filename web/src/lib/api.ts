export type Segment = { t0: number; t1: number; mode: string };
export type Mark = { t: number; severity: number; kind: string; description: string };

export type FlightSummary = {
  id: string;
  source_ref: string;
  started_at: string;
  duration_s: number;
  firmware: string | null;
  hw: string | null;
  rating: string | null;
  error_labels: number[] | null;
  feedback: string | null;
  events: number;
  critical_events: number;
  modes: Segment[];
  marks: Mark[];
};

export type EventRow = {
  id: number;
  kind: string;
  severity: number;
  source: string;
  description: string;
  attrs: Record<string, unknown>;
  t_start: number;
  t_end: number;
};

export type SignalInfo = { signal: string; unit: string | null; label: string; samples: number };

export type FlightDetail = {
  id: string;
  source_ref: string;
  autopilot: string;
  firmware: string | null;
  vehicle_type: string | null;
  started_at: string;
  duration_s: number;
  metadata: Record<string, unknown>;
  events: EventRow[];
  signals: SignalInfo[];
  modes: Segment[];
};

export type EnvelopePoint = { t: number; lo: number; hi: number; mean: number; n: number };
export type Envelope = { signal: string; from_s: number; to_s: number; bucket_s: number; points: EnvelopePoint[] };

export type SearchResult = {
  id: number;
  kind: string;
  severity: number;
  description: string;
  flight_id: string; // Flight Review log id (source_ref)
  t: number;
  score: number;
  vec_rank: number | null;
  fts_rank: number | null;
};

export type Stats = { flights: number; events: number; telemetry_rows: number; concepts: number; db_bytes: number };

export async function api<T>(path: string, params: Record<string, string | number | string[] | undefined> = {}): Promise<T> {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === "") continue;
    for (const x of Array.isArray(v) ? v : [v]) qs.append(k, String(x));
  }
  const res = await fetch(`/api${path}${qs.size ? `?${qs}` : ""}`);
  if (!res.ok) {
    const detail = await res.json().then((j) => j.detail).catch(() => res.statusText);
    throw new Error(typeof detail === "string" ? detail : res.statusText);
  }
  return res.json();
}
