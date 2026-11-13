"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { api, post, type Explained, type PlanNode, type SavedQuery, type SchemaView, type WorkbenchResult } from "@/lib/api";

const EXAMPLES: { title: string; sql: string }[] = [
  { title: "Flights per board", sql: "SELECT board, count(*) AS flights\nFROM semantic.flights\nGROUP BY board\nORDER BY flights DESC\nLIMIT 10" },
  { title: "Most common events", sql: "SELECT kind, count(*) AS events, count(DISTINCT flight_id) AS flights\nFROM semantic.events\nGROUP BY kind\nORDER BY events DESC" },
  { title: "Highest vibration per flight", sql: "SELECT flight_id, max_value AS peak_vibration\nFROM semantic.signal_summary\nWHERE signal = 'vibration.accel'\nORDER BY max_value DESC\nLIMIT 10" },
  { title: "Signals and their units", sql: "SELECT key, label, unit\nFROM semantic.signals\nORDER BY key" },
];
/** One node of the planner's plan, with a bar showing its share of the total cost, and its children below. */
function PlanTree({ n, total, depth = 0 }: { n: PlanNode; total: number; depth?: number }) {
  const what = n["Relation Name"] ?? n["Index Name"];
  const detail = n["Index Cond"] ?? n["Hash Cond"] ?? n["Filter"] ?? (n["Group Key"] ? `group by ${n["Group Key"].join(", ")}` : n["Sort Key"] ? `sort by ${n["Sort Key"].join(", ")}` : "");
  return (
    <div>
      <div className="flex items-center gap-3 border-b border-rule-soft py-1.5 text-sm" style={{ paddingLeft: depth * 22 }}>
        <span className="text-muted">{depth > 0 ? "\u2514" : ""}</span>
        <span className="min-w-0 flex-1"><b>{n["Node Type"]}</b>{n["Join Type"] ? ` (${n["Join Type"]})` : ""}{what ? <> on <span className="font-mono">{what}</span></> : null}{detail ? <span className="ml-2 truncate font-mono text-xs text-ink-2">{detail}</span> : null}</span>
        <span className="hidden w-28 sm:block"><span className="block h-2 rounded bg-rule-soft"><span className="block h-2 rounded" style={{ width: `${Math.max(2, (n["Total Cost"] / total) * 100)}%`, background: "var(--s2)" }} /></span></span>
        <span className="w-24 text-right tabular-nums text-ink-2">cost {Math.round(n["Total Cost"]).toLocaleString("en-US")}</span>
        <span className="w-24 text-right tabular-nums text-ink-2">{n["Plan Rows"].toLocaleString("en-US")} rows</span>
      </div>
      {n.Plans?.map((c, i) => <PlanTree key={i} n={c} total={total} depth={depth + 1} />)}
    </div>
  );
}

const cell = (v: unknown) => (v === null ? "" : typeof v === "number" ? (Number.isInteger(v) ? v.toLocaleString("en-US") : Number(v.toPrecision(6)).toString()) : String(v));

/** Run SQL by hand under the same four defences as the Ask page: guard, restricted role, read-only transaction, cost admission. */
export function WorkbenchView() {
  const qc = useQueryClient();
  const editor = useRef<HTMLTextAreaElement>(null);
  const [sql, setSql] = useState(EXAMPLES[0].sql);
  const [title, setTitle] = useState("");
  const schema = useQuery({ queryKey: ["wb-schema"], queryFn: () => api<SchemaView[]>("/workbench/schema") });
  const saved = useQuery({ queryKey: ["wb-saved"], queryFn: () => api<SavedQuery[]>("/workbench/saved") });
  const plan = useMutation({ mutationFn: (s: string) => post<Explained>("/workbench/explain", { sql: s }) });
  const run = useMutation({ mutationFn: (s: string) => post<WorkbenchResult>("/workbench/run", { sql: s }) });
  const save = useMutation({ mutationFn: () => post("/workbench/saved", { title, sql }), onSuccess: () => { setTitle(""); qc.invalidateQueries({ queryKey: ["wb-saved"] }); } });
  const del = useMutation({ mutationFn: (id: number) => fetch(`/api/workbench/saved/${id}`, { method: "DELETE" }), onSuccess: () => qc.invalidateQueries({ queryKey: ["wb-saved"] }) });
  const insert = (text: string) => {
    const el = editor.current; if (!el) return setSql((s) => s + text);
    const a = el.selectionStart, b = el.selectionEnd;
    setSql(sql.slice(0, a) + text + sql.slice(b));
    requestAnimationFrame(() => { el.focus(); el.selectionStart = el.selectionEnd = a + text.length; });
  };
  const r = run.data;
  return (
    <div className="pt-8">
      <h1 className="font-dense text-3xl font-semibold tracking-tight">SQL workbench</h1>
      <p className="mt-1 max-w-3xl text-ink-2">Write your own query over the documented views. It passes the same four checks as the Ask page: one SELECT on allow-listed views, a restricted read-only role, a timeout, and a cost limit from the planner.</p>
      <div className="mt-5 grid gap-6 lg:grid-cols-[17rem_minmax(0,1fr)]">
        <aside aria-label="Views and columns" className="lg:max-h-[72vh] lg:overflow-auto">
          <h2 className="mb-2 font-dense text-lg font-semibold">Views</h2>
          {schema.data?.map((v) => (
            <details key={v.view} className="border-t border-rule py-1.5" open={v.view === "flights"}>
              <summary className="cursor-pointer font-semibold">{v.view}</summary>
              {v.doc && <p className="mt-1 text-xs text-muted">{v.doc}</p>}
              <ul className="mt-1.5 space-y-0.5">
                {v.columns.map((c) => (
                  <li key={c.name}><button onClick={() => insert(c.name)} title={c.doc ?? c.type} className="w-full text-left text-sm hover:text-route">
                    <span className="font-mono">{c.name}</span> <span className="text-xs text-muted">{c.type}</span></button></li>))}
              </ul>
              <button onClick={() => setSql(`SELECT *\nFROM semantic.${v.view}\nLIMIT 20`)} className="mt-1.5 text-xs underline hover:text-ink">Select from {v.view}</button>
            </details>))}
        </aside>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="text-ink-2">Examples</span>
            {EXAMPLES.map((e) => <button key={e.title} onClick={() => setSql(e.sql)} className="rounded border border-rule px-2.5 py-1 text-ink-2 hover:border-route">{e.title}</button>)}
          </div>
          <textarea ref={editor} value={sql} onChange={(e) => setSql(e.target.value)} spellCheck={false} aria-label="SQL query" rows={8}
            onKeyDown={(e) => { if ((e.ctrlKey || e.metaKey) && e.key === "Enter") run.mutate(sql); }}
            className="mt-2 w-full rounded border border-rule bg-panel p-3 font-mono text-[14px] leading-relaxed text-ink focus:border-route" />
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <button onClick={() => run.mutate(sql)} disabled={run.isPending} className="h-10 rounded bg-route px-6 font-semibold text-on-route hover:opacity-90 disabled:opacity-60">{run.isPending ? "Running" : "Run"}</button>
            <button onClick={() => plan.mutate(sql)} disabled={plan.isPending} className="h-10 rounded border border-rule px-4 text-[15px] text-ink-2 hover:border-route disabled:opacity-60">{plan.isPending ? "Planning" : "Explain"}</button>
            <span className="text-xs text-muted">Ctrl+Enter runs</span>
            <span className="ml-auto flex items-center gap-2">
              <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Name this query" aria-label="Name for the saved query" className="h-9 w-44 rounded border border-rule bg-panel px-2 text-sm" />
              <button onClick={() => save.mutate()} disabled={!title.trim() || save.isPending} className="h-9 rounded border border-rule px-3 text-sm text-ink-2 hover:border-route disabled:opacity-50">Save</button>
            </span>
          </div>
          {save.error && <p className="mt-2 text-sm text-critical">{(save.error as Error).message}</p>}
          {plan.error && <p className="mt-3 text-sm text-critical" role="alert">{(plan.error as Error).message}</p>}
          {plan.data && (
            <div className="mt-4 rounded border border-rule bg-panel p-3">
              <div className="mb-1 flex flex-wrap items-baseline justify-between gap-2"><span className="font-semibold">Query plan</span>
                <span className="text-sm text-ink-2">total cost <b className="text-ink">{Math.round(plan.data.plan["Total Cost"]).toLocaleString("en-US")}</b> of {plan.data.limit.toLocaleString("en-US")} allowed (the planner's estimate; nothing was run)</span></div>
              <PlanTree n={plan.data.plan} total={plan.data.plan["Total Cost"] || 1} />
            </div>)}
          {run.error && <div className="mt-4 rounded border border-critical bg-panel px-4 py-3" role="alert"><div className="font-semibold text-critical">The query was refused or failed</div><p className="mt-1 text-sm">{(run.error as Error).message}</p></div>}
          {r && (
            <div className="mt-4">
              <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm text-ink-2">
                <span><b className="text-ink">{r.rows.length}</b> row{r.rows.length === 1 ? "" : "s"}{r.truncated ? " (limit reached)" : ""}</span>
                <span><b className="text-ink">{r.run_ms.toFixed(1)}</b> ms</span>
                <span>planner cost <b className="text-ink">{Math.round(r.cost).toLocaleString("en-US")}</b> of 100,000 allowed</span>
                <span>reads {r.tables.join(", ")}</span>
              </div>
              {r.notes.length > 0 && <ul className="mt-1 text-xs text-muted">{r.notes.map((n) => <li key={n}>Guard: {n}</li>)}</ul>}
              <div className="mt-2 max-h-[46vh] overflow-auto rounded border border-rule">
                <table className="w-full min-w-max text-sm">
                  <thead className="sticky top-0 bg-panel"><tr>{r.columns.map((c) => <th key={c} className="border-b border-rule px-3 py-2 text-left font-semibold">{c}</th>)}</tr></thead>
                  <tbody>{r.rows.map((row, i) => <tr key={i} className="border-b border-rule-soft last:border-0">{row.map((v, j) => <td key={j} className={`px-3 py-1.5 ${typeof v === "number" ? "text-right tabular-nums" : ""}`}>{cell(v)}</td>)}</tr>)}</tbody>
                </table>
              </div>
              <details className="mt-2 text-sm"><summary className="cursor-pointer text-ink-2">The SQL that ran (rebuilt from the parse tree)</summary><pre className="mt-1 overflow-auto rounded border border-rule bg-panel p-3 font-mono text-xs">{r.sql}</pre></details>
            </div>)}
          {saved.data && saved.data.length > 0 && (
            <section className="mt-8" aria-labelledby="saved"><h2 id="saved" className="font-dense text-xl font-semibold">Saved queries</h2>
              <ul className="mt-2 divide-y divide-rule border-y border-rule">
                {saved.data.map((q) => (
                  <li key={q.id} className="flex items-center gap-3 py-2"><button onClick={() => setSql(q.sql)} className="min-w-0 flex-1 text-left"><div className="font-semibold">{q.title}</div><div className="truncate font-mono text-xs text-ink-2">{q.sql.replace(/\s+/g, " ")}</div></button>
                    <button onClick={() => del.mutate(q.id)} className="text-sm text-ink-2 underline hover:text-critical">Delete</button></li>))}
              </ul></section>)}
        </div>
      </div>
    </div>
  );
}
