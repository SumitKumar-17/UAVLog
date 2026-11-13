"use client";
import { useQuery } from "@tanstack/react-query";
import { api, type Performance } from "@/lib/api";
import { bytes, compact } from "@/lib/format";

function Stat({ n, label, note }: { n: string; label: string; note?: string }) {
  return <div className="rounded border border-rule bg-panel px-4 py-3"><div className="font-dense text-3xl font-semibold tabular-nums">{n}</div><div className="text-sm text-ink-2">{label}</div>{note && <div className="mt-0.5 text-xs text-muted">{note}</div>}</div>;
}

/** Live health of the database that serves the app: the buffer cache, scan patterns and the statements that cost the most time. */
export function PerformanceView() {
  const { data: d, error } = useQuery({ queryKey: ["performance"], queryFn: () => api<Performance>("/data/performance"), refetchInterval: 5000 });
  if (error) return <p className="pt-10 text-critical">Could not read the statistics: {(error as Error).message}</p>;
  if (!d) return <p className="pt-10 text-ink-2" aria-busy>Reading the statistics</p>;
  const maxTotal = Math.max(...d.statements.map((s) => s.total_ms), 1);
  return (
    <div className="pt-8">
      <h1 className="font-dense text-3xl font-semibold tracking-tight">Performance</h1>
      <p className="mt-1 max-w-3xl text-ink-2">Read live from the database's own statistics, refreshed every few seconds. Open any page of the app in another tab and watch the numbers move.</p>
      <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat n={d.database.cache_hit_pct != null ? `${d.database.cache_hit_pct}%` : "n/a"} label="buffer cache hit ratio" note="reads served from memory" />
        <Stat n={String(d.database.connections)} label="connections" />
        <Stat n={compact(d.database.commits)} label="transactions committed" note={`${d.database.rollbacks} rolled back`} />
        <Stat n={bytes(d.database.bytes)} label="database size" note={`${d.database.temp_files} temp files, ${bytes(d.database.temp_bytes)}`} />
      </div>

      <section className="mt-10" aria-labelledby="stmts">
        <h2 id="stmts" className="font-dense text-2xl font-semibold">Costliest statements</h2>
        <p className="mb-3 mt-1 text-sm text-ink-2">By total execution time since the statistics were reset (<code>pg_stat_statements</code>). The bar is each statement's share of the time of the top ten.</p>
        {!d.statements_available ? <p className="text-ink-2">The statement statistics extension is not readable on this server.</p> : (
          <ul className="divide-y divide-rule border-y border-rule">
            {d.statements.map((s, i) => (
              <li key={i} className="py-2.5">
                <div className="grid grid-cols-[minmax(0,1fr)_6rem] items-center gap-4">
                  <code className="min-w-0 break-words text-xs leading-relaxed text-ink">{s.query}</code>
                  <span className="text-right text-sm tabular-nums"><b>{s.total_ms.toLocaleString("en-US")}</b> ms</span>
                </div>
                <div className="mt-1.5 flex items-center gap-3 text-xs text-ink-2">
                  <span className="h-1.5 w-40 rounded bg-rule"><span className="block h-1.5 rounded" style={{ width: `${(s.total_ms / maxTotal) * 100}%`, background: "var(--s2)" }} /></span>
                  <span className="tabular-nums">{s.calls.toLocaleString("en-US")} calls</span><span className="tabular-nums">mean {s.mean_ms} ms</span><span className="tabular-nums">max {s.max_ms} ms</span>
                  <span className="tabular-nums">{s.rows.toLocaleString("en-US")} rows</span>{s.hit_pct != null && <span className="tabular-nums">cache {s.hit_pct}%</span>}
                </div>
              </li>))}
          </ul>)}
      </section>

      <div className="mt-10 grid gap-x-12 gap-y-10 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <section aria-labelledby="scans">
          <h2 id="scans" className="font-dense text-2xl font-semibold">How tables are read</h2>
          <p className="mb-3 mt-1 text-sm text-ink-2">Share of scans that used an index. Small lookup tables are read sequentially on purpose; a large table with a low share deserves a look.</p>
          <ul className="space-y-2">
            {d.tables.map((t) => (
              <li key={t.name} className="grid grid-cols-[9rem_minmax(0,1fr)_9rem] items-center gap-3 text-sm">
                <span className="truncate text-ink-2" title={t.name}>{t.name}</span>
                <span className="flex h-4 overflow-hidden rounded-sm bg-rule-soft" title={`${t.idx_scan} index scans, ${t.seq_scan} sequential scans`}>
                  <span style={{ width: `${t.index_pct ?? 0}%`, background: "var(--data)" }} /></span>
                <span className="tabular-nums text-ink-2"><b className="text-ink">{t.index_pct ?? 0}%</b> of {(t.seq_scan + t.idx_scan).toLocaleString("en-US")}</span>
              </li>))}
          </ul>
        </section>
        <section aria-labelledby="cfg">
          <h2 id="cfg" className="font-dense text-2xl font-semibold">Settings that matter</h2>
          <dl className="mt-3 divide-y divide-rule border-y border-rule text-sm">
            {d.settings.map((s) => <div key={s.name} className="flex justify-between py-1.5"><dt className="font-mono text-xs text-ink-2">{s.name}</dt><dd className="tabular-nums">{s.value}</dd></div>)}
          </dl>
        </section>
      </div>
    </div>
  );
}
