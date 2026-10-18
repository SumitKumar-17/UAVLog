"use client";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { api, type Explain, type Internals, type PipelineState } from "@/lib/api";
import { bytes, compact } from "@/lib/format";

function Bar({ label, value, max, color, note }: { label: string; value: number; max: number; color: string; note: string }) {
  return (
    <div className="grid grid-cols-[11rem_minmax(0,1fr)] items-center gap-x-4 gap-y-1 max-sm:grid-cols-1">
      <div className="text-[15px] text-ink-2">{label}</div>
      <div className="flex items-center gap-3">
        <div className="h-6 rounded-r-[4px]" style={{ width: `${Math.max((value / max) * 100, 0.8)}%`, background: color, maxWidth: "calc(100% - 7rem)" }} />
        <span className="whitespace-nowrap font-semibold tabular-nums">{note}</span>
      </div>
    </div>
  );
}

function Plan({ name }: { name: string }) {
  const { data, isFetching, error } = useQuery({ queryKey: ["explain", name], queryFn: () => api<Explain>(`/internals/explain/${name}`), staleTime: 0 });
  if (error) return <p className="text-critical">Could not run the query: {(error as Error).message}</p>;
  if (!data) return <p className="text-ink-2" aria-busy>Running the query</p>;
  return (
    <div className={isFetching ? "opacity-60" : ""}>
      <p className="max-w-3xl text-ink-2">{data.about}</p>
      <h4 className="mb-1 mt-4 font-semibold">The query</h4>
      <pre className="overflow-auto rounded border border-rule bg-panel p-3 text-[13px] leading-relaxed">{data.sql}</pre>
      <h4 className="mb-1 mt-4 font-semibold">How the database ran it <span className="font-normal text-ink-2">({data.execution.replace("Execution Time: ", "took ")})</span></h4>
      <pre className="max-h-[28rem] overflow-auto rounded border border-rule bg-panel p-3 text-[13px] leading-relaxed">{data.plan.join("\n")}</pre>
    </div>
  );
}

function PipelineSection({ llm }: { llm: Internals["llm"] }) {
  const { data: p } = useQuery({ queryKey: ["pipeline"], queryFn: () => api<PipelineState>("/pipeline"), refetchInterval: 10_000 });
  if (!p) return <p className="text-ink-2" aria-busy>Loading</p>;
  const stages = [...new Set(p.stages.map((x) => x.stage))];
  const statuses = ["pending", "running", "done", "failed", "missing"];
  const cell = (st: string, s2: string) => p.stages.find((x) => x.stage === st && x.status === s2)?.n ?? 0;
  const last = (st: string) => { const t = p.stages.filter((x) => x.stage === st && x.last_finished).map((x) => x.last_finished as string).sort().pop(); return t ? new Date(t).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" }) : "–"; };
  const d = p.derived;
  return (
    <div>
      <div className="overflow-x-auto">
        <table className="text-[15px] tabular-nums"><thead><tr><th className={th}>Stage</th>{statuses.map((x) => <th key={x} className={`${th} text-right`}>{x}</th>)}<th className={`${th} pl-6`}>Last finished</th></tr></thead>
          <tbody>{stages.map((st) => <tr key={st} className="border-t border-rule"><td className="py-1.5 pr-6">{st.replaceAll("_", " ")}</td>{statuses.map((x) => <td key={x} className={`pr-6 text-right ${cell(st, x) ? (x === "failed" ? "font-semibold text-critical" : "") : "text-muted"}`}>{cell(st, x) || "–"}</td>)}<td className="pl-6 text-ink-2">{last(st)}</td></tr>)}</tbody></table>
      </div>
      <ul className="mt-4 space-y-1 text-[15px] text-ink-2">
        {p.ingest_seconds.avg_s != null && <li>Ingest averages {p.ingest_seconds.avg_s} s per log (slowest {p.ingest_seconds.max_s} s) and has loaded {Number(p.ingest_seconds.rows).toLocaleString("en-US")} telemetry rows.</li>}
        <li>Derived data: {d.signal_summary_rows.toLocaleString("en-US")} rows in the signal summary, {d.signatures} of {d.flights} flights have a behavioural signature, {d.events_without_embedding} events still lack an embedding, {d.notes} notes saved.</li>
        {llm.length > 0 && <li>{llm.map((l) => `${l.calls} ${l.kind} calls, ${compact(l.prompt_tokens)} tokens, ${l.avg_latency_ms} ms on average`).join("; ")}.</li>}
      </ul>
      <h3 className="mb-1 mt-5 font-semibold">Recent failures</h3>
      {p.failures.length === 0 ? <p className="text-ink-2">None. A failed item is retried up to three times; after that it waits here with its error until someone retries it from the command line.</p> : (
        <div className="overflow-x-auto"><table className="text-[15px]"><thead><tr><th className={th}>Stage</th><th className={th}>Item</th><th className={th}>Status</th><th className={th}>Error</th></tr></thead>
          <tbody>{p.failures.map((f, i) => <tr key={i} className="border-t border-rule"><td className="py-1.5 pr-6">{f.stage.replaceAll("_", " ")}</td><td className="pr-6">{f.item.slice(0, 8)}</td><td className="pr-6">{f.status}</td><td className="max-w-xl text-ink-2">{f.error ?? ""}</td></tr>)}</tbody></table></div>
      )}
    </div>
  );
}

const th = "pb-1.5 pr-6 text-left font-normal text-muted";

export function DatabaseView() {
  const { data: d, error } = useQuery({ queryKey: ["internals"], queryFn: () => api<Internals>("/internals"), staleTime: 10_000, refetchInterval: 10_000 });
  const [demo, setDemo] = useState("envelope");
  if (error) return <p className="pt-10 text-critical">Could not load database facts: {(error as Error).message}</p>;
  if (!d) return <div className="pt-10 text-ink-2" aria-busy>Loading</div>;

  const c = d.columnstore, ratio = c.before_bytes / c.after_bytes;

  return (
    <div className="pt-10">
      <h1 className="font-dense text-3xl font-semibold tracking-tight">Database</h1>
      <p className="mt-1 max-w-2xl text-ink-2">Everything on this page is read live from the database that serves the app. PostgreSQL {d.versions.postgres}, TimescaleDB {d.versions.timescaledb}, pgvector {d.versions.pgvector}.</p>

      <section className="mt-10" aria-labelledby="space">
        <h2 id="space" className="font-dense text-2xl font-semibold">Where the space goes</h2>
        <p className="mb-5 mt-1 max-w-3xl text-ink-2">The same {compact(d.telemetry_rows)} telemetry samples, stored two ways. Columnar chunks keep each signal of each flight together, so values that change slowly compress to a few bytes.</p>
        <div className="space-y-3">
          <Bar label="Row storage (before)" value={c.before_bytes} max={c.before_bytes} color="var(--m-other)" note={bytes(c.before_bytes)} />
          <Bar label="Columnar, compressed (now)" value={c.after_bytes} max={c.before_bytes} color="var(--data)" note={`${bytes(c.after_bytes)}, ${ratio.toFixed(0)} times smaller`} />
        </div>
        <p className="mt-3 text-sm text-muted">{c.compressed_chunks} of {c.chunks} weekly chunks are compressed. Before compression, the index (a {bytes(c.before_index_bytes)}) was larger than the table itself.</p>
      </section>

      <section className="mt-12" aria-labelledby="run">
        <h2 id="run" className="font-dense text-2xl font-semibold">How a query runs</h2>
        <p className="mb-4 mt-1 max-w-3xl text-ink-2">Pick a query to see the plan the database chose and what each step cost, from EXPLAIN ANALYZE with buffer counts.</p>
        <div className="mb-5 flex flex-wrap gap-2" role="radiogroup" aria-label="Query">
          {d.demos.map((x) => (
            <button key={x.id} role="radio" aria-checked={demo === x.id} onClick={() => setDemo(x.id)}
              className={`rounded border px-3 py-1.5 text-[15px] ${demo === x.id ? "border-route bg-rule-soft font-semibold" : "border-rule text-ink-2 hover:border-route"}`}>{x.title}</button>
          ))}
        </div>
        <Plan name={demo} />
      </section>

      <div className="mt-12 grid gap-x-12 gap-y-10 lg:grid-cols-2">
        <section aria-labelledby="idx" className="min-w-0">
          <h2 id="idx" className="mb-2 font-dense text-2xl font-semibold">Indexes</h2>
          <table className="w-full text-[15px] tabular-nums"><thead><tr><th className={th}>Name</th><th className={th}>Method</th><th className={`${th} text-right`}>Size</th></tr></thead>
            <tbody>{d.indexes.map((i) => <tr key={i.name} className="border-t border-rule"><td className="py-1.5 pr-6 [overflow-wrap:anywhere]">{i.name}</td><td className="pr-6 text-ink-2">{i.method}</td><td className="text-right">{bytes(i.bytes)}</td></tr>)}</tbody></table>
        </section>
        <section aria-labelledby="tbl" className="min-w-0">
          <h2 id="tbl" className="mb-2 font-dense text-2xl font-semibold">Tables</h2>
          <table className="w-full text-[15px] tabular-nums"><thead><tr><th className={th}>Name</th><th className={`${th} text-right`}>Rows</th><th className={`${th} text-right`}>Size</th></tr></thead>
            <tbody>{d.tables.map((t) => <tr key={t.name} className="border-t border-rule"><td className="py-1.5 pr-6">{t.name}</td><td className="pr-6 text-right text-ink-2">{t.approx_rows.toLocaleString("en-US")}</td><td className="text-right">{bytes(t.bytes)}</td></tr>)}</tbody></table>
        </section>
      </div>

      <section className="mt-12" aria-labelledby="queues">
        <h2 id="queues" className="font-dense text-2xl font-semibold">Pipeline</h2>
        <p className="mb-3 mt-1 max-w-3xl text-ink-2">Each stage claims work from a table with row locks that skip rows other workers hold, so any number of workers can run side by side and a crash only returns its own rows to the queue.</p>
        <PipelineSection llm={d.llm} />
      </section>
    </div>
  );
}
