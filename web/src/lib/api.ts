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

// At most four API calls in flight, and a retry after a server error. A managed database with little memory can fail when a page
// asks for a dozen compressed-column queries at the same instant; queueing them keeps every chart working and costs about a second.
const LIMIT = 4;
let active = 0;
const waiting: (() => void)[] = [];
async function slot<T>(run: () => Promise<T>): Promise<T> {
  if (active >= LIMIT) await new Promise<void>((go) => waiting.push(go));
  active++;
  try { return await run(); } finally { active--; waiting.shift()?.(); }
}
export function qfetch(url: string, init?: RequestInit): Promise<Response> {
  const retryable = !init?.method || init.method === "GET";
  return slot(async () => {
    let r = await fetch(url, init);
    for (let n = 0; retryable && r.status >= 500 && n < 2; n++) { await new Promise((t) => setTimeout(t, 700 * (n + 1))); r = await fetch(url, init); }
    return r;
  });
}

export async function api<T>(path: string, params: Record<string, string | number | string[] | undefined> = {}): Promise<T> {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === "") continue;
    for (const x of Array.isArray(v) ? v : [v]) qs.append(k, String(x));
  }
  const res = await qfetch(`/api${path}${qs.size ? `?${qs}` : ""}`);
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
  const res = await qfetch("/api/ask", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ question, explain: true }) });
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

export type MomentHit = { id: string; source_ref: string; firmware: string | null; hw: string | null; started_at: string; t0: number; t1: number; distance: number; events: string[] };
export type Moments = { query: { t0: number; t1: number; events: string[] }; results: MomentHit[] };

export type MapFlight = { id: string; source_ref: string; firmware: string | null; hw: string | null; started_at: string; duration_s: number; lat: number; lon: number; events: number; critical_events: number };
export type FleetStats = {
  boards: { hw: string; flights: number; minutes: number; events_per_flight: number; critical_per_flight: number }[];
  firmware: { family: string; flights: number; critical_per_flight: number; warnings_per_flight: number }[];
  kinds: { kind: string; label: string; events: number; flights: number; critical: number }[];
  years: { year: number; flights: number }[];
  durations: { bucket: string; flights: number }[];
  days: { day: string; flights: number; critical: number }[];
  totals: { flights: number; events: number; critical: number; boards: number; hours: number };
};
export type GalaxyPoint = { id: string; x: number; y: number; unusual: number; source_ref: string; firmware: string | null; hw: string | null; duration_s: number; critical_events: number };
export type Galaxy = { points: GalaxyPoint[]; explained: number };
export type Evidence = { id: string; kind: string; text: string; t: number | null };
export type Investigation = {
  model: string; created_at: string; evidence: Evidence[];
  report: { headline: string; findings: { text: string; cites: string[] }[]; probable_cause: { text: string; cites: string[]; confidence: string }; next_checks: string[]; dropped_citations?: number };
};
export type SchemaView = { view: string; doc: string | null; columns: { name: string; type: string; doc: string | null }[] };
export type WorkbenchResult = { sql: string; columns: string[]; rows: (string | number | boolean | null)[][]; truncated: boolean; cost: number; run_ms: number; notes: string[]; tables: string[]; functions: string[] };
export type SavedQuery = { id: number; title: string; sql: string; created_at: string };

export async function post<T>(path: string, body: unknown): Promise<T> {
  const r = await qfetch(`/api${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(typeof data.detail === "string" ? data.detail : `HTTP ${r.status}`);
  return data as T;
}

export type DbTable = { schema: string; name: string; kind: "table" | "hypertable" | "view" | "materialized view"; rows: number | null; bytes: number | null; doc: string | null };
export type DbColumn = { name: string; type: string; nullable: boolean; default: string | null; doc: string | null; pk: boolean };
export type DbStructure = DbTable & {
  columns: DbColumn[];
  foreign_keys: { name: string; columns: string[]; ref_schema: string; ref_table: string; ref_columns: string[] }[];
  indexes: { name: string; method: string; definition: string; bytes: number; unique: boolean; pk: boolean }[];
  hypertable: { chunks: number; compressed_chunks: number; chunk_interval: string | null; segmentby: string | null; orderby: string | null } | null;
  definition: string | null;
};
export type DbRows = { columns: string[]; rows: (string | number | boolean | null)[][]; offset: number; limit: number; total_estimate: number | null };
export type DbGraph = { nodes: (DbTable & { columns: { name: string; type: string; pk: boolean }[] })[]; edges: { src: string; dst: string; column: string }[] };

export type Incident = { id: number; flight_id: string; source_ref: string; hw: string | null; firmware: string | null; started_at: string; kind: string; label: string; severity: number; description: string; t: number };
export type Incidents = { total: number; items: Incident[]; kinds: { kind: string; label: string; n: number }[]; boards: { hw: string | null; n: number }[] };

export type PatternRow = { kind: string; label: string; flights: number; pairs: number; kind_flights: number; share: number; base: number; lift: number };
export type Patterns = { kind: string; seconds: number; flights: number; target_flights: number; target_events: number; before: PatternRow[]; after: PatternRow[] };

export type PlanNode = { "Node Type": string; "Relation Name"?: string; "Index Name"?: string; Alias?: string; "Startup Cost": number; "Total Cost": number; "Plan Rows": number; "Plan Width": number; "Join Type"?: string; "Parent Relationship"?: string; "Filter"?: string; "Index Cond"?: string; "Hash Cond"?: string; "Group Key"?: string[]; "Sort Key"?: string[]; Plans?: PlanNode[] };
export type Explained = { sql: string; plan: PlanNode; limit: number };

export type Performance = {
  database: { bytes: number; connections: number; commits: number; rollbacks: number; temp_files: number; temp_bytes: number; cache_hit_pct: number | null; deadlocks: number; stats_reset: string | null };
  settings: { name: string; value: string }[];
  tables: { name: string; live_rows: number; seq_scan: number; idx_scan: number; inserts: number; updates: number; index_pct: number | null }[];
  statements: { query: string; calls: number; total_ms: number; mean_ms: number; max_ms: number; rows: number; hit_pct: number | null }[];
  statements_available: boolean;
};

export type LabRule = { id: string; label: string; signal: string; op: string; threshold: number; min_s: number; lo: number; hi: number; step: number; unit: string; ref: string[]; about: string };
export type LabScore = { threshold: number; events: number; flights: number; matched_events: number; ref_messages: number; matched_ref: number; precision: number | null; recall: number | null; f1: number };
export type LabResult = { rule: LabRule; current: LabScore; default: LabScore; sweep: LabScore[] };

export type UploadJob = { id: string; log_id: string; name: string; bytes: number; status: "running" | "done" | "failed"; flight_id: string | null; error: string | null; stages: { name: string; status: "pending" | "running" | "done" | "failed"; seconds: number | null }[] };

export type SignalDist = { signal: string; label: string; unit: string | null; description: string | null; n: number; lo: number; med: number; hi: number; vmin: number; vmax: number; bins: number[] };
export type SignalTop = { id: string; source_ref: string; hw: string | null; firmware: string | null; duration_s: number; value: number };
export type Correlations = { signals: { key: string; label: string }[]; matrix: (number | null)[][] };
