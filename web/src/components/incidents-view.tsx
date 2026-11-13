"use client";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useState } from "react";
import { api, type Incidents } from "@/lib/api";
import { clock } from "@/lib/format";

const SIZE = 30;

/** Warnings and failures from every flight in one feed: filter by kind, board and wording, then jump straight to the moment in the flight. */
export function IncidentsView() {
  const [sev, setSev] = useState(2);
  const [kind, setKind] = useState("");
  const [hw, setHw] = useState("");
  const [q, setQ] = useState("");
  const [typed, setTyped] = useState("");
  const [page, setPage] = useState(0);
  const { data, isFetching, error } = useQuery({
    queryKey: ["incidents", sev, kind, hw, q, page], placeholderData: (p) => p,
    queryFn: () => api<Incidents>("/incidents", { min_severity: sev, kind, hw, q, limit: SIZE, offset: page * SIZE }),
  });
  const reset = (f: () => void) => { f(); setPage(0); };
  const pages = data ? Math.ceil(data.total / SIZE) : 0;
  return (
    <div className="pt-8">
      <h1 className="font-dense text-3xl font-semibold tracking-tight">Incidents</h1>
      <p className="mt-1 max-w-3xl text-ink-2">Every warning and failure the autopilot logged or our rules detected, across all flights. Open one to land on that moment with every chart aligned to it.</p>
      <div className="mt-5 flex flex-wrap items-end gap-3">
        <div className="flex overflow-hidden rounded border border-rule text-sm" role="group" aria-label="Severity">
          {([[2, "Critical"], [1, "Warnings and critical"]] as const).map(([v, l]) => <button key={v} onClick={() => reset(() => setSev(v))} aria-pressed={sev === v} className={`px-3.5 py-2 ${sev === v ? "bg-route font-semibold text-on-route" : "bg-panel text-ink-2 hover:bg-rule-soft"}`}>{l}</button>)}
        </div>
        <label className="text-sm"><span className="mb-1 block text-ink-2">Kind</span>
          <select value={kind} onChange={(e) => reset(() => setKind(e.target.value))} className="h-10 min-w-[12rem] rounded border border-rule bg-panel px-2 text-[15px]">
            <option value="">All kinds</option>{data?.kinds.map((k) => <option key={k.kind} value={k.kind}>{k.label} ({k.n})</option>)}</select></label>
        <label className="text-sm"><span className="mb-1 block text-ink-2">Board</span>
          <select value={hw} onChange={(e) => reset(() => setHw(e.target.value))} className="h-10 min-w-[12rem] rounded border border-rule bg-panel px-2 text-[15px]">
            <option value="">All boards</option>{data?.boards.filter((b) => b.hw).map((b) => <option key={b.hw} value={b.hw!}>{b.hw} ({b.n})</option>)}</select></label>
        <form onSubmit={(e) => { e.preventDefault(); reset(() => setQ(typed.trim())); }} className="flex items-end gap-2" role="search">
          <label className="text-sm"><span className="mb-1 block text-ink-2">Contains</span><input value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="battery, parachute, GPS" className="h-10 w-52 rounded border border-rule bg-panel px-3 text-[15px]" /></label>
          <button className="h-10 rounded border border-rule px-3 text-sm text-ink-2 hover:border-route">Filter</button>
        </form>
        {data && <span className="ml-auto pb-2 text-sm text-ink-2" aria-live="polite"><b className="text-ink tabular-nums">{data.total.toLocaleString("en-US")}</b> incidents{isFetching ? ", updating" : ""}</span>}
      </div>
      {error && <p className="mt-6 text-critical">{(error as Error).message}</p>}
      <ul className="mt-4 divide-y divide-rule border-y border-rule">
        {data?.items.map((i) => (
          <li key={i.id} className="grid grid-cols-[1.25rem_minmax(0,1fr)_auto] items-start gap-x-4 py-3">
            <span className={`mt-1.5 h-3 w-3 rounded-full ${i.severity >= 2 ? "bg-critical" : "bg-warning"}`} title={i.severity >= 2 ? "critical" : "warning"} />
            <div className="min-w-0">
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
                <span className="rounded border border-rule px-1.5 py-0.5 text-xs font-semibold text-ink-2">{i.label}</span>
                <Link href={`/flights/${i.flight_id}?t=${Math.round(i.t)}`} className="font-semibold underline decoration-rule underline-offset-2 hover:decoration-route">Flight {i.source_ref.slice(0, 8)}</Link>
                <span className="text-sm text-ink-2">{i.hw ?? "unknown board"} · {new Date(i.started_at).toISOString().slice(0, 10)} · at {clock(i.t)}</span>
              </div>
              <p className="mt-1 text-[15px] text-ink">{i.description}</p>
            </div>
            <Link href={`/flights/${i.flight_id}?t=${Math.round(i.t)}`} className="whitespace-nowrap rounded border border-rule px-3 py-1.5 text-sm text-ink-2 hover:border-route">Open at {clock(i.t)}</Link>
          </li>))}
        {data && data.items.length === 0 && <li className="py-8 text-center text-ink-2">No incidents match these filters.</li>}
      </ul>
      {pages > 1 && (
        <div className="mt-4 flex items-center justify-center gap-3 text-sm">
          <button onClick={() => setPage(Math.max(0, page - 1))} disabled={page === 0} className="rounded border border-rule px-3 py-1.5 hover:border-route disabled:opacity-40">Previous</button>
          <span className="text-ink-2">Page {page + 1} of {pages}</span>
          <button onClick={() => setPage(page + 1)} disabled={page + 1 >= pages} className="rounded border border-rule px-3 py-1.5 hover:border-route disabled:opacity-40">Next</button>
        </div>)}
    </div>
  );
}
