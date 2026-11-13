"use client";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { api, type DbGraph, type DbRows, type DbStructure, type DbTable } from "@/lib/api";
import { bytes, compact } from "@/lib/format";

const KIND: Record<string, { label: string; color: string }> = {
  hypertable: { label: "hypertable", color: "var(--data)" },
  table: { label: "table", color: "var(--ink-2)" },
  view: { label: "view", color: "var(--good)" },
  "materialized view": { label: "materialized view", color: "var(--s4)" },
};
const key = (t: { schema: string; name: string }) => `${t.schema}.${t.name}`;

function Badge({ kind }: { kind: string }) {
  const k = KIND[kind] ?? KIND.table;
  return <span className="inline-flex items-center gap-1.5 rounded border border-rule px-1.5 py-0.5 text-xs text-ink-2"><span className="h-2 w-2 rounded-full" style={{ background: k.color }} />{k.label}</span>;
}

/* ---------------------------------------------------------------------------------------------- relations diagram */
const POS: Record<string, [number, number]> = {
  vendor_field: [0, 0], field_mapping: [1, 0], concept: [2, 0], concept_relation: [3, 0],
  telemetry: [0, 1], flight: [1, 1], event: [2, 1], flight_signature: [3, 1],
  signal_window: [0, 2], note: [1, 2], investigation: [2, 2], flight_task: [3, 2],
  ingest_job: [0, 3], llm_call: [1, 3], saved_query: [2, 3], window_model: [3, 3], signature_scaler: [0, 4],
};
const NW = 236, GAP_X = 70, GAP_Y = 54, ROW_H = 21, HEAD = 36, MAXC = 7;

function Relations({ onOpen }: { onOpen: (t: string) => void }) {
  const { data, error, isPending } = useQuery({ queryKey: ["db-graph"], queryFn: () => api<DbGraph>("/data/graph") });
  const [hover, setHover] = useState<string | null>(null);
  const layout = useMemo(() => {
    if (!data) return null;
    let auto = 0;
    const cell = (n: string): [number, number] => POS[n] ?? [auto % 4, 5 + Math.floor(auto++ / 4)];
    const heights = (n: DbGraph["nodes"][number]) => HEAD + Math.min(n.columns.length, MAXC) * ROW_H + (n.columns.length > MAXC ? ROW_H : 0) + 8;
    const rows: Record<number, number> = {};
    data.nodes.forEach((n) => { const [, r] = cell(n.name); rows[r] = Math.max(rows[r] ?? 0, heights(n)); });
    auto = 0;
    const yOf: Record<number, number> = {}; let y = 20;
    Object.keys(rows).map(Number).sort((a, b) => a - b).forEach((r) => { yOf[r] = y; y += rows[r] + GAP_Y; });
    const pos: Record<string, { x: number; y: number; w: number; h: number }> = {};
    data.nodes.forEach((n) => { const [c, r] = cell(n.name); pos[n.name] = { x: 20 + c * (NW + GAP_X), y: yOf[r], w: NW, h: heights(n) }; });
    const W = 20 + 4 * (NW + GAP_X) - GAP_X + 20;
    return { pos, W, H: y };
  }, [data]);
  if (error) return <p className="text-critical">Could not load the schema: {(error as Error).message}</p>;
  if (isPending || !layout || !data) return <p className="text-ink-2" aria-busy>Reading the catalog</p>;
  const related = (n: string) => data.edges.some((e) => (e.src === hover && e.dst === n) || (e.dst === hover && e.src === n)) || n === hover;
  return (
    <div>
      <p className="mb-3 max-w-3xl text-sm text-ink-2">Every table with its keys and the foreign keys between them, read live from the catalog. Hover a table to follow its links; click it to browse the rows.</p>
      <div className="overflow-auto rounded border border-rule bg-panel">
        <svg viewBox={`0 0 ${layout.W} ${layout.H}`} className="block w-full" role="img" aria-label="Entity relationship diagram">
          <defs><marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 1 L9 5 L0 9 z" fill="var(--ink-2)" /></marker></defs>
          {data.edges.map((e, i) => {
            const a = layout.pos[e.src], b = layout.pos[e.dst]; if (!a || !b) return null;
            const horiz = Math.abs((a.x + a.w / 2) - (b.x + b.w / 2)) > Math.abs((a.y + a.h / 2) - (b.y + b.h / 2)) * 0.6;
            let x1, y1, x2, y2, c1x, c1y, c2x, c2y;
            if (horiz) { const right = b.x > a.x; x1 = right ? a.x + a.w : a.x; y1 = a.y + 18; x2 = right ? b.x : b.x + b.w; y2 = b.y + 18; const d = Math.max(40, Math.abs(x2 - x1) / 2); c1x = x1 + (right ? d : -d); c1y = y1; c2x = x2 + (right ? -d : d); c2y = y2; }
            else { const down = b.y > a.y; x1 = a.x + a.w / 2 + (i % 5) * 6 - 12; y1 = down ? a.y + a.h : a.y; x2 = b.x + b.w / 2 + (i % 5) * 6 - 12; y2 = down ? b.y : b.y + b.h; const d = Math.max(30, Math.abs(y2 - y1) / 2); c1x = x1; c1y = y1 + (down ? d : -d); c2x = x2; c2y = y2 + (down ? -d : d); }
            const on = hover && (e.src === hover || e.dst === hover);
            return <path key={i} d={`M${x1},${y1} C${c1x},${c1y} ${c2x},${c2y} ${x2},${y2}`} fill="none" stroke={on ? "var(--route)" : "var(--ink-2)"} strokeWidth={on ? 2.4 : 1.4} opacity={hover && !on ? 0.12 : 0.75} markerEnd="url(#arrow)"><title>{e.src}.{e.column} references {e.dst}</title></path>;
          })}
          {data.nodes.map((n) => {
            const p = layout.pos[n.name]; const k = KIND[n.kind] ?? KIND.table; const dim = hover && !related(n.name);
            return (
              <g key={n.name} transform={`translate(${p.x},${p.y})`} opacity={dim ? 0.3 : 1} className="cursor-pointer" onMouseEnter={() => setHover(n.name)} onMouseLeave={() => setHover(null)} onClick={() => onOpen(`public.${n.name}`)}>
                <rect width={p.w} height={p.h} rx={7} fill="var(--panel)" stroke={hover === n.name ? "var(--route)" : "var(--rule)"} strokeWidth={hover === n.name ? 2.5 : 1.5} />
                <path d={`M0 7 a7 7 0 0 1 7 -7 h${p.w - 14} a7 7 0 0 1 7 7 v${HEAD - 7} h-${p.w} z`} fill="var(--rule-soft)" />
                <rect x={0} y={0} width={5} height={HEAD} rx={2} fill={k.color} />
                <text x={16} y={23} fontSize={14.5} fontWeight={600} fill="var(--ink)">{n.name}</text>
                <text x={p.w - 10} y={23} fontSize={11} textAnchor="end" fill="var(--muted)">{n.rows != null ? compact(n.rows) : ""}</text>
                {n.columns.slice(0, MAXC).map((c, i) => (
                  <g key={c.name} transform={`translate(0,${HEAD + 6 + i * ROW_H})`}>
                    <text x={14} y={14} fontSize={12.5} fontWeight={c.pk ? 700 : 400} fill="var(--ink)">{c.pk ? "◆ " : ""}{c.name}</text>
                    <text x={p.w - 10} y={14} fontSize={11} textAnchor="end" fill="var(--muted)">{c.type.replace("timestamp with time zone", "timestamptz").replace("double precision", "float8").replace("character varying", "varchar").slice(0, 16)}</text>
                  </g>))}
                {n.columns.length > MAXC && <text x={14} y={HEAD + 6 + MAXC * ROW_H + 14} fontSize={11.5} fill="var(--muted)">+ {n.columns.length - MAXC} more columns</text>}
              </g>);
          })}
        </svg>
      </div>
      <ul className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-sm text-ink-2"><li className="flex items-center gap-1.5"><span className="h-3 w-3 rounded-sm" style={{ background: "var(--data)" }} />hypertable</li><li className="flex items-center gap-1.5"><span className="h-3 w-3 rounded-sm" style={{ background: "var(--ink-2)" }} />table</li><li>◆ primary key</li><li>arrow points to the referenced table</li></ul>
    </div>
  );
}

/* ---------------------------------------------------------------------------------------------- one table */
function Rows({ t }: { t: DbTable }) {
  const [offset, setOffset] = useState(0);
  const size = 25;
  const { data, error, isFetching } = useQuery({ queryKey: ["db-rows", key(t), offset], queryFn: () => api<DbRows>(`/data/tables/${t.schema}/${t.name}/rows`, { limit: size, offset }), placeholderData: (p) => p });
  if (error) return <p className="text-critical">{(error as Error).message}</p>;
  if (!data) return <p className="text-ink-2" aria-busy>Reading rows</p>;
  const end = offset + data.rows.length;
  return (
    <div>
      <div className="mb-2 flex items-center gap-3 text-sm text-ink-2">
        <span>Rows <b className="text-ink tabular-nums">{data.rows.length ? offset + 1 : 0} to {end}</b>{data.total_estimate != null && <> of about <b className="text-ink tabular-nums">{data.total_estimate.toLocaleString("en-US")}</b></>}</span>
        <span className="ml-auto flex gap-2">
          <button onClick={() => setOffset(Math.max(0, offset - size))} disabled={offset === 0 || isFetching} className="rounded border border-rule px-3 py-1 hover:border-route disabled:opacity-40">Previous</button>
          <button onClick={() => setOffset(offset + size)} disabled={data.rows.length < size || isFetching} className="rounded border border-rule px-3 py-1 hover:border-route disabled:opacity-40">Next</button>
        </span>
      </div>
      <div className="max-h-[62vh] overflow-auto rounded border border-rule">
        <table className="w-full min-w-max text-[13.5px]">
          <thead className="sticky top-0 bg-panel"><tr>{data.columns.map((c) => <th key={c} className="border-b border-rule px-3 py-2 text-left font-semibold">{c}</th>)}</tr></thead>
          <tbody>{data.rows.map((r, i) => <tr key={i} className="border-b border-rule-soft last:border-0 hover:bg-rule-soft">{r.map((v, j) =>
            <td key={j} className={`max-w-[26rem] truncate px-3 py-1.5 ${typeof v === "number" ? "text-right tabular-nums" : ""} ${v === null ? "text-muted" : ""}`} title={v === null ? "" : String(v)}>{v === null ? "null" : String(v)}</td>)}</tr>)}</tbody>
        </table>
      </div>
    </div>
  );
}

function Structure({ t, open }: { t: DbTable; open: (k: string) => void }) {
  const { data, error } = useQuery({ queryKey: ["db-struct", key(t)], queryFn: () => api<DbStructure>(`/data/tables/${t.schema}/${t.name}`) });
  if (error) return <p className="text-critical">{(error as Error).message}</p>;
  if (!data) return <p className="text-ink-2" aria-busy>Reading the structure</p>;
  const fk = new Map(data.foreign_keys.flatMap((f) => f.columns.map((c, i) => [c, `${f.ref_schema}.${f.ref_table}`] as const)));
  const h = data.hypertable;
  return (
    <div className="space-y-6">
      {h && (
        <div className="grid gap-3 sm:grid-cols-4">
          {[["chunks", `${h.compressed_chunks} of ${h.chunks} compressed`], ["chunk interval", h.chunk_interval ?? "?"], ["segment by", h.segmentby ?? "?"], ["order by", h.orderby ?? "?"]].map(([k, v]) => (
            <div key={k} className="rounded border border-rule bg-panel px-3 py-2.5"><div className="text-xs text-muted">{k}</div><div className="font-semibold">{v}</div></div>))}
        </div>)}
      <div className="overflow-x-auto rounded border border-rule">
        <table className="w-full min-w-max text-[14px]">
          <thead className="bg-panel"><tr>{["Column", "Type", "Null", "Default", "Keys", "Description"].map((c) => <th key={c} className="border-b border-rule px-3 py-2 text-left font-semibold">{c}</th>)}</tr></thead>
          <tbody>{data.columns.map((c) => (
            <tr key={c.name} className="border-b border-rule-soft last:border-0">
              <td className="px-3 py-1.5 font-mono font-semibold">{c.name}</td><td className="px-3 font-mono text-ink-2">{c.type}</td>
              <td className="px-3 text-ink-2">{c.nullable ? "yes" : "no"}</td><td className="max-w-[14rem] truncate px-3 font-mono text-xs text-ink-2" title={c.default ?? ""}>{c.default ?? ""}</td>
              <td className="px-3">{c.pk && <span className="mr-1.5 rounded bg-route px-1.5 py-0.5 text-xs font-semibold text-on-route">PK</span>}{fk.has(c.name) && <button onClick={() => open(fk.get(c.name)!)} className="rounded border border-rule px-1.5 py-0.5 text-xs hover:border-route">FK {fk.get(c.name)!.split(".")[1]}</button>}</td>
              <td className="max-w-[24rem] px-3 text-xs text-ink-2">{c.doc}</td>
            </tr>))}</tbody>
        </table>
      </div>
      {data.indexes.length > 0 && (
        <div><h3 className="mb-2 font-dense text-lg font-semibold">Indexes</h3>
          <ul className="divide-y divide-rule border-y border-rule">{data.indexes.map((i) => (
            <li key={i.name} className="grid gap-x-4 gap-y-1 py-2 sm:grid-cols-[14rem_5rem_5rem_minmax(0,1fr)]">
              <span className="font-mono text-sm font-semibold">{i.name}</span><span className="text-sm"><span className="rounded border border-rule px-1.5 py-0.5 text-xs">{i.method}</span></span>
              <span className="text-sm tabular-nums text-ink-2">{bytes(i.bytes)}</span><code className="min-w-0 break-words text-xs text-ink-2">{i.definition.replace(/^CREATE (UNIQUE )?INDEX \S+ ON /, "")}</code>
            </li>))}</ul></div>)}
      {data.definition && <div><h3 className="mb-2 font-dense text-lg font-semibold">Definition</h3><pre className="max-h-[40vh] overflow-auto rounded border border-rule bg-panel p-3 font-mono text-xs leading-relaxed">{data.definition}</pre></div>}
    </div>
  );
}

function Browse({ selected, setSelected }: { selected: string | null; setSelected: (k: string | null) => void }) {
  const { data } = useQuery({ queryKey: ["db-tables"], queryFn: () => api<DbTable[]>("/data/tables") });
  const [q, setQ] = useState("");
  const [tab, setTab] = useState<"rows" | "structure">("rows");
  const tables = (data ?? []).filter((t) => !q || t.name.includes(q.toLowerCase()));
  const sel = data?.find((t) => key(t) === selected) ?? null;
  const groups: [string, DbTable[]][] = [["Tables", tables.filter((t) => t.kind === "table" || t.kind === "hypertable")], ["Semantic views", tables.filter((t) => t.schema === "semantic")], ["Other views", tables.filter((t) => t.schema === "public" && t.kind.includes("view"))]];
  const maxBytes = Math.max(...(data ?? []).map((t) => t.bytes ?? 0), 1);
  return (
    <div className="grid gap-6 lg:grid-cols-[19rem_minmax(0,1fr)]">
      <aside className="lg:max-h-[78vh] lg:overflow-auto lg:pr-1">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter tables" aria-label="Filter tables" className="mb-3 h-10 w-full rounded border border-rule bg-panel px-3 text-[15px]" />
        {groups.map(([label, list]) => list.length > 0 && (
          <div key={label} className="mb-4"><div className="mb-1 px-1 text-xs font-semibold uppercase tracking-wide text-muted">{label}</div>
            <ul>{list.map((t) => (
              <li key={key(t)}><button onClick={() => setSelected(key(t))} aria-current={selected === key(t)} className={`block w-full rounded px-2.5 py-2 text-left ${selected === key(t) ? "bg-rule-soft" : "hover:bg-rule-soft"}`}>
                <div className="flex items-center justify-between gap-2"><span className={`truncate text-[15px] ${selected === key(t) ? "font-semibold" : ""}`}>{t.name}</span><span className="shrink-0 text-xs tabular-nums text-muted">{t.rows != null ? compact(t.rows) : "view"}</span></div>
                {t.bytes != null && <div className="mt-1 flex items-center gap-2"><span className="h-1 flex-1 rounded bg-rule"><span className="block h-1 rounded" style={{ width: `${Math.max(2, (t.bytes / maxBytes) * 100)}%`, background: KIND[t.kind]?.color }} /></span><span className="w-14 text-right text-xs text-muted">{bytes(t.bytes)}</span></div>}
              </button></li>))}</ul></div>))}
      </aside>
      <div className="min-w-0">
        {!sel ? <p className="rounded border border-dashed border-rule p-8 text-center text-ink-2">Choose a table on the left, or click one in the schema map.</p> : (
          <>
            <div className="mb-1 flex flex-wrap items-center gap-3"><h2 className="font-dense text-2xl font-semibold">{sel.schema !== "public" && <span className="text-muted">{sel.schema}.</span>}{sel.name}</h2><Badge kind={sel.kind} />
              {sel.rows != null && <span className="text-sm text-ink-2"><b className="tabular-nums text-ink">{sel.rows.toLocaleString("en-US")}</b> rows</span>}{sel.bytes != null && <span className="text-sm text-ink-2">{bytes(sel.bytes)} on disk</span>}</div>
            {sel.doc && <p className="mb-3 max-w-3xl text-sm text-ink-2">{sel.doc}</p>}
            <div className="mb-4 mt-3 flex gap-1 border-b border-rule" role="tablist">
              {(["rows", "structure"] as const).map((k) => <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)} className={`-mb-px border-b-2 px-4 py-2 text-[15px] ${tab === k ? "border-route font-semibold text-ink" : "border-transparent text-ink-2 hover:text-ink"}`}>{k === "rows" ? "Rows" : "Structure"}</button>)}
            </div>
            {tab === "rows" ? <Rows key={key(sel)} t={sel} /> : <Structure key={key(sel)} t={sel} open={(k) => { setSelected(k); setTab("structure"); }} />}
          </>)}
      </div>
    </div>
  );
}

export function DataExplorer() {
  const [view, setView] = useState<"map" | "browse">("map");
  const [selected, setSelected] = useState<string | null>("public.flight");
  return (
    <div className="pt-8">
      <h1 className="font-dense text-3xl font-semibold tracking-tight">Data explorer</h1>
      <p className="mt-1 max-w-3xl text-ink-2">Look inside the database that holds everything: how the tables relate, what each column is, how big each one is, and the rows themselves. Read-only.</p>
      <div className="mb-5 mt-5 flex gap-1 border-b border-rule" role="tablist">
        {([["map", "Schema map"], ["browse", "Browse tables"]] as const).map(([k, l]) => (
          <button key={k} role="tab" aria-selected={view === k} onClick={() => setView(k)} className={`-mb-px border-b-2 px-5 py-2.5 text-base ${view === k ? "border-route font-semibold text-ink" : "border-transparent text-ink-2 hover:text-ink"}`}>{l}</button>))}
      </div>
      {view === "map" ? <Relations onOpen={(k) => { setSelected(k); setView("browse"); }} /> : <Browse selected={selected} setSelected={setSelected} />}
    </div>
  );
}
