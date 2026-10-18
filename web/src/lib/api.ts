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

export type SearchResponse = { query: string; mode: string; strategy?: string; filter_estimated_rows?: number | null; results: SearchResult[] };

export type SearchResult = {
  id: number;
  kind: string;
  severity: number;
  description: string;
  flight_id: string; // database id, used in routes
  source_ref: string; // Flight Review log id
  t: number;
  score: number;
  distance: number | null;
  vec_rank: number | null;
  fts_rank: number | null;
};

export type OntologyConcept = { key: string; kind: string; label: string; unit: string | null; description: string | null };
export type Ontology = { concepts: OntologyConcept[]; relations: { src: string; dst: string; rel: string }[] };

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

export type Internals = {
  versions: { postgres: string; timescaledb: string; pgvector: string };
  columnstore: { chunks: number; compressed_chunks: number; before_bytes: number; after_bytes: number; before_index_bytes: number };
  telemetry_rows: number;
  indexes: { name: string; on_table: string; method: string; bytes: number }[];
  tables: { name: string; bytes: number; approx_rows: number }[];
  queues: { stage: string; status: string; n: number }[];
  llm: { kind: string; calls: number; prompt_tokens: number; completion_tokens: number; avg_latency_ms: number }[];
  demos: { id: string; title: string; about: string }[];
};
export type Explain = { name: string; title: string; about: string; sql: string; plan: string[]; execution: string };

export type AskAnswer = {
  question: string;
  sql: string | null;
  columns: string[];
  rows: (string | number | boolean | null | unknown[])[][];
  truncated: boolean;
  notes: string[];
  attempts: { sql: string; error: string | null }[];
  cannot_answer: string | null;
  error: string | null;
  cost: number | null;
  generate_ms: number;
  run_ms: number;
  explanation: string | null;
};

export async function ask(question: string): Promise<AskAnswer> {
  const res = await fetch("/api/ask", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ question, explain: true }) });
  if (!res.ok) {
    const detail = await res.json().then((j) => j.detail).catch(() => res.statusText);
    throw new Error(typeof detail === "string" ? detail : res.status === 422 ? "Ask a question of at least three characters." : res.statusText);
  }
  return res.json();
}

export type Track = { points: { t: number; x: number; y: number; z: number | null }[]; modes: { t0: number; mode: string }[] };
export type Note = { id: number; t_s: number; body: string; created_at: string };
export type SimilarFlight = FlightSummary & { distance: number };
export type PipelineState = {
  stages: { stage: string; status: string; n: number; last_finished: string | null }[];
  failures: { stage: string; item: string; status: string; attempts: number; error: string | null; finished_at: string | null }[];
  ingest_seconds: { avg_s: number | null; max_s: number | null; rows: number | null };
  derived: { signal_summary_rows: number; signatures: number; flights: number; events_without_embedding: number; notes: number };
};
