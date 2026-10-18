"use client";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { api } from "@/lib/api";
import { LineChart, type ChartSeries } from "./line-chart";

/* eslint-disable @typescript-eslint/no-explicit-any */
const COLORS = ["var(--s1)", "var(--s2)", "var(--s3)", "var(--s4)", "var(--s5)"];
const file = (name: string) => api<any>(`/bench/${name}`);
const pick = (files: string[], prefix: string) => files.filter((f) => f.startsWith(prefix) && !f.includes("calibration"));
const nice = (name: string) => name.replace(/\.json$/, "").replace(/^[a-z]+_/, "").replaceAll("_", " ");
const Missing = ({ what }: { what: string }) => <p className="text-ink-2">No {what} results yet. Run the benchmark script and reload.</p>;

function Section({ id, title, children, intro }: { id: string; title: string; intro: string; children: React.ReactNode }) {
  return (
    <section aria-labelledby={id} className="mt-14 first:mt-8">
      <h2 id={id} className="font-dense text-2xl font-semibold">{title}</h2>
      <p className="mb-5 mt-1 max-w-3xl text-ink-2">{intro}</p>
      {children}
    </section>
  );
}

function Bars({ rows, unit, fmt }: { rows: { label: string; value: number }[]; unit?: string; fmt?: (v: number) => string }) {
  const max = Math.max(...rows.map((r) => r.value), 1e-9);
  return (
    <div className="space-y-2">
      {rows.map((r) => (
        <div key={r.label} className="grid grid-cols-[minmax(0,16rem)_minmax(0,1fr)] items-center gap-x-4 gap-y-1 max-sm:grid-cols-1">
          <div className="text-[15px] text-ink-2">{r.label}</div>
          <div className="flex items-center gap-3"><div className="h-5 rounded-r-[4px]" style={{ width: `${Math.max((r.value / max) * 100, 0.6)}%`, maxWidth: "calc(100% - 6rem)", background: "var(--data)" }} /><span className="whitespace-nowrap font-semibold tabular-nums">{fmt ? fmt(r.value) : r.value.toLocaleString("en-US")}{unit ? ` ${unit}` : ""}</span></div>
        </div>
      ))}
    </div>
  );
}

function Ann({ files }: { files: string[] }) {
  const [name, setName] = useState(files[0]);
  const { data: d } = useQuery({ queryKey: ["bench", name], queryFn: () => file(name), enabled: !!name });
  const series: ChartSeries[] = useMemo(() => {
    if (!d) return [];
    return Object.keys(d.builds).map((lab, i) => ({ name: lab, color: COLORS[i % 5], points: d.points.filter((p: any) => p.index === lab).map((p: any) => ({ x: p.recall, y: p.p50_ms, tip: `${lab}, ${p.params}: recall ${p.recall.toFixed(3)}, p50 ${p.p50_ms.toFixed(2)} ms, p95 ${p.p95_ms.toFixed(2)} ms` })) }));
  }, [d]);
  if (!files.length) return <Missing what="vector index" />;
  if (!d) return <p className="text-ink-2" aria-busy>Loading</p>;
  const exact = d.points.find((p: any) => p.index.startsWith("exact"));
  const reach = (lab: string, t: number) => { const ok = d.points.filter((p: any) => p.index === lab && p.recall >= t); return ok.length ? `${Math.min(...ok.map((p: any) => p.p50_ms)).toFixed(1)} ms` : "not reached"; };
  return (
    <div>
      {files.length > 1 && (
        <label className="mb-3 flex items-center gap-2 text-[15px]">Run
          <select value={name} onChange={(e) => setName(e.target.value)} className="rounded border border-rule bg-panel px-2 py-1.5">{files.map((f) => <option key={f} value={f}>{nice(f)}</option>)}</select>
        </label>
      )}
      <p className="mb-2 text-sm text-ink-2">{d.meta.n_vectors.toLocaleString("en-US")} vectors of {d.meta.dimensions} dimensions, {d.meta.queries} queries, top {d.meta.k}. Exact search takes {exact?.p50_ms.toFixed(0)} ms per query. Data difficulty: relative contrast {d.meta.rc10_synthetic?.toFixed(1)} against {d.meta.rc10_real} for the real corpus (lower is harder).</p>
      <LineChart series={series} xLabel="Recall at 10 (higher is better)" yLabel="Median latency, ms (lower is better)" yLog xDomain={[Math.max(0.3, Math.floor(Math.min(...d.points.map((p: any) => p.recall)) * 10) / 10), 1]}
        xFormat={(v) => v.toFixed(1)} yFormat={(v) => `${v}`} label="Recall against median latency for each vector index and search setting" />
      <div className="mt-6 overflow-x-auto">
        <table className="text-[15px] tabular-nums">
          <thead><tr className="text-left text-muted"><th className="pr-6 pb-1.5 font-normal">Index</th><th className="pr-6 font-normal">Build time</th><th className="pr-6 font-normal">Size</th><th className="pr-6 font-normal">Fastest at recall 0.90</th><th className="pr-6 font-normal">0.95</th><th className="font-normal">0.99</th></tr></thead>
          <tbody>{Object.entries(d.builds).map(([lab, b]: any) => <tr key={lab} className="border-t border-rule"><td className="py-1.5 pr-6">{lab}</td><td className="pr-6">{b.build_s.toFixed(0)} s</td><td className="pr-6">{b.size_mb.toFixed(0)} MB</td><td className="pr-6">{reach(lab, 0.9)}</td><td className="pr-6">{reach(lab, 0.95)}</td><td>{reach(lab, 0.99)}</td></tr>)}</tbody>
        </table>
      </div>
    </div>
  );
}

function Filter({ files }: { files: string[] }) {
  const [metric, setMetric] = useState<"rows_returned" | "recall" | "p50_ms">("rows_returned");
  const { data: d } = useQuery({ queryKey: ["bench", files[0]], queryFn: () => file(files[0]), enabled: files.length > 0 });
  const unc = useMemo(() => {
    if (!d) return [] as ChartSeries[];
    const strategies = [...new Set<string>(d.points.filter((p: any) => p.family === "uncorrelated").map((p: any) => p.strategy))];
    return strategies.map((s, i) => ({ name: s, color: COLORS[i % 5], dashed: i >= 5, points: d.points.filter((p: any) => p.family === "uncorrelated" && p.strategy === s && p[metric] != null).map((p: any) => ({ x: parseFloat(p.filter), y: Math.max(p[metric], 1e-3), tip: `${s}, filter keeps ${p.filter} of rows: ${p.rows_returned.toFixed(1)} rows returned, recall ${p.recall?.toFixed(2)}, p50 ${p.p50_ms.toFixed(1)} ms` })) }));
  }, [d, metric]);
  if (!files.length) return <Missing what="filtered search" />;
  if (!d) return <p className="text-ink-2" aria-busy>Loading</p>;
  const kinds = ["common (>10%)", "medium (1-10%)", "rare (<1%)"];
  const strategies = [...new Set<string>(d.points.filter((p: any) => p.family === "kind").map((p: any) => p.strategy))];
  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2 text-[15px]" role="radiogroup" aria-label="Metric">
        <span className="mr-1 text-ink-2">Show</span>
        {([["rows_returned", "Rows returned (target 10)"], ["recall", "Recall at 10"], ["p50_ms", "Median latency"]] as const).map(([k, l]) => (
          <button key={k} role="radio" aria-checked={metric === k} onClick={() => setMetric(k)} className={`rounded border px-3 py-1.5 ${metric === k ? "border-route bg-rule-soft font-semibold" : "border-rule text-ink-2 hover:border-route"}`}>{l}</button>
        ))}
      </div>
      <p className="mb-2 text-sm text-ink-2">Filter independent of the vector (a random column), {d.meta.n_vectors.toLocaleString("en-US")} vectors. The filter keeps the fraction of rows on the horizontal axis.</p>
      <LineChart series={unc} xLabel="Share of rows the filter keeps (log scale)" yLabel={metric === "rows_returned" ? "Rows returned" : metric === "recall" ? "Recall at 10" : "Median latency, ms"} xLog yLog={metric === "p50_ms"}
        yDomain={metric === "p50_ms" ? undefined : metric === "recall" ? [0, 1.02] : [0, 10.5]} xFormat={(v) => `${+(v * 100).toPrecision(2)}%`} yFormat={(v) => `${v}`} label={`${metric} against filter selectivity for each strategy`} />
      <h3 className="mb-2 mt-8 font-semibold">Filter on the query&apos;s own event kind (correlated with what is being searched)</h3>
      <div className="overflow-x-auto">
        <table className="text-[15px] tabular-nums"><thead><tr className="text-left text-muted"><th className="pr-6 pb-1.5 font-normal">Strategy</th>{kinds.map((k) => <th key={k} className="pr-6 font-normal">Kind is {k}</th>)}</tr></thead>
          <tbody>{strategies.map((s) => <tr key={s} className="border-t border-rule"><td className="py-1.5 pr-6">{s}</td>{kinds.map((k) => { const p = d.points.find((x: any) => x.family === "kind" && x.strategy === s && x.filter === k); return <td key={k} className="pr-6">{p ? `${p.rows_returned.toFixed(1)} rows, recall ${p.recall?.toFixed(2)}, ${p.p50_ms.toFixed(1)} ms` : "–"}</td>; })}</tr>)}</tbody></table>
      </div>
      <h3 className="mb-2 mt-8 font-semibold">What each approach costs to build</h3>
      <Bars rows={Object.entries(d.builds).filter(([, b]: any) => b.build_s != null).map(([k, b]: any) => ({ label: k, value: b.build_s }))} unit="s" fmt={(v) => v.toFixed(0)} />
    </div>
  );
}

function Columnstore({ files }: { files: string[] }) {
  const { data: d } = useQuery({ queryKey: ["bench", files[0]], queryFn: () => file(files[0]), enabled: files.length > 0 });
  if (!files.length) return <Missing what="columnstore design" />;
  if (!d) return <p className="text-ink-2" aria-busy>Loading</p>;
  const qs = Object.keys(d.results[0]).filter((k) => /^Q\d/.test(k));
  return (
    <div>
      <p className="mb-3 text-sm text-ink-2">{d.meta.rows.toLocaleString("en-US")} rows from {d.meta.flights} flights; median of {d.meta.runs} warm runs.</p>
      <h3 className="mb-2 font-semibold">Size</h3>
      <Bars rows={d.results.map((r: any) => ({ label: r.variant, value: r.size_mb }))} unit="MB" fmt={(v) => v.toFixed(0)} />
      <h3 className="mb-2 mt-8 font-semibold">Query latency, median in milliseconds</h3>
      <div className="overflow-x-auto"><table className="text-[15px] tabular-nums"><thead><tr className="text-left text-muted"><th className="pr-6 pb-1.5 font-normal">Variant</th>{qs.map((q) => <th key={q} className="pr-6 font-normal" title={q}>{q.split(" ")[0]}</th>)}</tr></thead>
        <tbody>{d.results.map((r: any) => <tr key={r.variant} className="border-t border-rule"><td className="py-1.5 pr-6">{r.variant}</td>{qs.map((q) => <td key={q} className="pr-6">{r[q].p50_ms.toFixed(1)}</td>)}</tr>)}</tbody></table></div>
      <ul className="mt-3 space-y-0.5 text-sm text-ink-2">{qs.map((q) => <li key={q}>{q}</li>)}</ul>
    </div>
  );
}

function Engines({ files }: { files: string[] }) {
  const { data: d } = useQuery({ queryKey: ["bench", files[0]], queryFn: () => file(files[0]), enabled: files.length > 0 });
  if (!files.length) return <Missing what="engine comparison" />;
  if (!d) return <p className="text-ink-2" aria-busy>Loading</p>;
  const engines = Object.keys(d.queries_p50_ms);
  const queries = Object.keys(d.queries_p50_ms[engines[0]]);
  return (
    <div>
      <p className="mb-3 text-sm text-ink-2">{d.meta.rows.toLocaleString("en-US")} telemetry rows. DuckDB {d.meta.duckdb} runs inside the benchmark process; PostgreSQL is a separate server. Concurrency is not measured.</p>
      <h3 className="mb-2 font-semibold">Storage</h3>
      <Bars rows={Object.entries(d.storage_bytes).map(([k, v]: any) => ({ label: k, value: v / 1e6 }))} unit="MB" fmt={(v) => v.toFixed(0)} />
      <h3 className="mb-2 mt-8 font-semibold">Query latency, median in milliseconds</h3>
      <div className="overflow-x-auto"><table className="text-[15px] tabular-nums"><thead><tr className="text-left text-muted"><th className="pr-6 pb-1.5 font-normal">Query</th>{engines.map((e) => <th key={e} className="pr-6 font-normal">{e}</th>)}</tr></thead>
        <tbody>{queries.map((q) => <tr key={q} className="border-t border-rule"><td className="py-1.5 pr-6">{q}</td>{engines.map((e) => <td key={e} className="pr-6">{d.queries_p50_ms[e][q] != null ? d.queries_p50_ms[e][q].toFixed(1) : "–"}</td>)}</tr>)}</tbody></table></div>
      <h3 className="mb-2 mt-8 font-semibold">Load throughput, thousands of rows per second</h3>
      <Bars rows={Object.entries(d.load_rows_per_s).map(([k, v]: any) => ({ label: k, value: v / 1000 }))} unit="k/s" fmt={(v) => v.toFixed(0)} />
    </div>
  );
}

function Search({ files }: { files: string[] }) {
  const { data: d } = useQuery({ queryKey: ["bench", files[0]], queryFn: () => file(files[0]), enabled: files.length > 0 });
  if (!files.length) return <Missing what="search quality" />;
  if (!d) return <p className="text-ink-2" aria-busy>Loading</p>;
  const names: Record<string, string> = { vector: "Vector only", hybrid: "Vector + light full-text (0.1)", rrf: "Plain rank fusion", fts: "Full-text only" };
  return (
    <div>
      <p className="mb-3 text-sm text-ink-2">{d.events.toLocaleString("en-US")} events, {d.queries} concept queries ({d.hard_queries} are pure paraphrases). Mean nDCG@10 with 95% bootstrap interval.</p>
      <div className="overflow-x-auto"><table className="text-[15px] tabular-nums"><thead><tr className="text-left text-muted"><th className="pr-6 pb-1.5 font-normal">Method</th><th className="pr-6 font-normal">All queries</th><th className="pr-6 font-normal">Easy</th><th className="font-normal">Hard paraphrases</th></tr></thead>
        <tbody>{Object.keys(names).map((m) => d.modes[m] && (
          <tr key={m} className="border-t border-rule"><td className="py-1.5 pr-6">{names[m]}</td>{["all", "easy", "hard"].map((sl) => { const x = d.modes[m][sl].ndcg10; return <td key={sl} className="pr-6">{x.mean.toFixed(3)} <span className="text-muted">[{x.lo.toFixed(2)}, {x.hi.toFixed(2)}]</span></td>; })}</tr>))}</tbody></table></div>
      <p className="mt-3 text-sm text-ink-2">Plain rank fusion minus vector only: {d.paired_ndcg10_rrf_minus_vector?.mean.toFixed(3)} [{d.paired_ndcg10_rrf_minus_vector?.lo.toFixed(3)}, {d.paired_ndcg10_rrf_minus_vector?.hi.toFixed(3)}], a significant loss.</p>
    </div>
  );
}

function Nlsql({ files }: { files: string[] }) {
  const f = files.find((x) => x.includes("run2")) ?? files[0];
  const { data: d } = useQuery({ queryKey: ["bench", f], queryFn: () => file(f), enabled: !!f });
  if (!f) return <Missing what="natural-language SQL" />;
  if (!d) return <p className="text-ink-2" aria-busy>Loading</p>;
  const label: Record<string, string> = { semantic: "Semantic views", raw_docs: "Raw tables + same documentation", raw: "Raw tables alone" };
  const rows = ["semantic", "raw_docs", "raw"].map((m) => ({ label: label[m], value: d.summary[m].strict.mean * 100, ci: d.summary[m].strict }));
  return (
    <div>
      <p className="mb-3 text-sm text-ink-2">Held-out set, model {d.model}, strict execution accuracy (result set equals the gold query&apos;s). {f.replace(".json", "")}</p>
      <Bars rows={rows} unit="%" fmt={(v) => v.toFixed(0)} />
      <p className="mt-3 text-sm text-ink-2">{Object.entries(d.sign_tests as Record<string, any>).map(([k, v]) => `${k.replaceAll("_", " ")}: ${v.b} to ${v.c}, p = ${v.p.toFixed(4)}`).join("; ")}.</p>
    </div>
  );
}

function Injection({ files }: { files: string[] }) {
  const { data: d } = useQuery({ queryKey: ["bench", files[0]], queryFn: () => file(files[0]), enabled: files.length > 0 });
  const series: ChartSeries[] = useMemo(() => !d ? [] : d.faults.map((f: any, i: number) => ({ name: f.fault, color: COLORS[i % 5], points: d.durations_s.map((s: number) => ({ x: s, y: f.by_duration[String(s)]?.detection_rate ?? 0, tip: `${f.fault}, held ${s} s: detected ${Math.round((f.by_duration[String(s)]?.detection_rate ?? 0) * 100)}% of ${f.by_duration[String(s)]?.n} injections` })) })), [d]);
  if (!files.length) return <Missing what="fault injection" />;
  if (!d) return <p className="text-ink-2" aria-busy>Loading</p>;
  return (
    <div>
      <p className="mb-2 text-sm text-ink-2">{d.flights} real flights, a constant fault value held for the duration on the horizontal axis at a random time; the unchanged rule engine looks for the right event kind.</p>
      <LineChart series={series} xLabel="Seconds the fault is held" yLabel="Share of injected faults detected" yDomain={[0, 1.02]} xFormat={(v) => `${v}`} yFormat={(v) => `${Math.round(v * 100)}%`} xLog label="Detection rate against fault duration for each rule" />
      <p className="mt-2 text-sm text-ink-2">False alarms on unmodified controls: {d.faults.map((f: any) => `${f.fault} ${(f.control_false_alarm_rate * 100).toFixed(0)}%`).join("; ")}.</p>
    </div>
  );
}

function Signature({ files }: { files: string[] }) {
  const { data: d } = useQuery({ queryKey: ["bench", files[0]], queryFn: () => file(files[0]), enabled: files.length > 0 });
  if (!files.length) return <Missing what="signature" />;
  if (!d) return <p className="text-ink-2" aria-busy>Loading</p>;
  return (
    <div>
      <p className="mb-3 text-sm text-ink-2">{d.flights} flights, {d.features} features reduced to {d.dimensions} dimensions ({Math.round(d.variance_kept * 100)}% of the variance). Share of a flight&apos;s 5 nearest neighbours on the same board, leave one out.</p>
      <Bars rows={[{ label: "Chance (random neighbours)", value: d.board_agreement_chance * 100 }, { label: "Scaled features, cosine", value: d.board_agreement_scaled_features * 100 }, { label: "32-dimension signature, cosine", value: d.board_agreement_signature * 100 }]} unit="%" fmt={(v) => v.toFixed(0)} />
    </div>
  );
}

export function BenchmarksView() {
  const { data, error } = useQuery({ queryKey: ["bench-list"], queryFn: () => api<{ files: string[] }>("/bench") });
  if (error) return <p className="pt-10 text-critical">Could not load benchmark results: {(error as Error).message}</p>;
  const files = data?.files ?? [];
  return (
    <div className="pt-10">
      <h1 className="font-dense text-3xl font-semibold tracking-tight">Benchmarks</h1>
      <p className="mt-1 max-w-3xl text-ink-2">Measured on this machine with the scripts in <code>backend/scripts/bench_*.py</code>; the result files are in <code>bench/results</code>. Each section says what was measured and where the data comes from.</p>
      <Section id="ann" title="Vector indexes: HNSW, IVFFlat and DiskANN" intro="How fast each index finds the true nearest neighbours, as the search effort grows. Up and to the left is better.">
        <Ann files={pick(files, "ann_")} />
      </Section>
      <Section id="filter" title="Filtered vector search" intro="A vector index finds neighbours first and applies the SQL filter afterwards, so a selective filter can leave fewer rows than requested. These are the ways around it.">
        <Filter files={pick(files, "filter_")} />
      </Section>
      <Section id="search" title="Search quality" intro="Natural-language queries against the extracted events: which way of ranking finds the right ones.">
        <Search files={pick(files, "eval_search_")} />
      </Section>
      <Section id="nlsql" title="Natural-language SQL" intro="Does a model write correct SQL, and what does the semantic layer add beyond documentation?">
        <Nlsql files={pick(files, "nlsql_eval_test")} />
      </Section>
      <Section id="injection" title="Fault injection on the event detectors" intro="Faults of known size and duration injected into real flights: which does the rule engine find, and which does it miss?">
        <Injection files={pick(files, "injection_")} />
      </Section>
      <Section id="signature" title="Similar flights by behaviour" intro="A sanity check that flights found by signal shape, event rates and mode shares are more alike than chance.">
        <Signature files={pick(files, "signature_")} />
      </Section>
      <Section id="columnstore" title="Columnstore physical design" intro="How chunk size and the segment and sort columns change storage and query speed for the telemetry table.">
        <Columnstore files={pick(files, "columnstore_")} />
      </Section>
      <Section id="engines" title="TimescaleDB against DuckDB" intro="The same telemetry in a client-server time-series database and in an embedded analytical engine.">
        <Engines files={pick(files, "engines_")} />
      </Section>
    </div>
  );
}
