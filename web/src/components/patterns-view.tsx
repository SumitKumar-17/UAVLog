"use client";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { api, type FleetStats, type PatternRow, type Patterns } from "@/lib/api";

const label = (k: string) => k.replaceAll("_", " ");

function Side({ title, rows, target, seconds, dir }: { title: string; rows: PatternRow[]; target: string; seconds: number; dir: "before" | "after" }) {
  return (
    <section aria-label={title}>
      <h2 className="font-dense text-2xl font-semibold">{title}</h2>
      <p className="mb-3 mt-1 text-sm text-ink-2">Share of flights with a {label(target)} event in which this kind occurred within {seconds} seconds {dir} it. The tick marks how common the kind is across all flights.</p>
      {rows.length === 0 ? <p className="text-ink-2">Nothing in this window.</p> : (
        <ul className="space-y-2.5">
          {rows.map((r) => (
            <li key={r.kind} className="grid grid-cols-[10.5rem_minmax(0,1fr)_5.5rem] items-center gap-3 text-sm">
              <span className="truncate text-ink-2" title={r.label}>{label(r.kind)}</span>
              <span className="relative h-4 rounded-sm bg-rule-soft">
                <span className="absolute inset-y-0 left-0 rounded-sm" style={{ width: `${Math.max(1.5, r.share * 100)}%`, background: dir === "before" ? "var(--s2)" : "var(--data)" }} />
                <span className="absolute -inset-y-0.5 w-0.5" style={{ left: `${r.base * 100}%`, background: "var(--ink)" }} title={`across all flights: ${(r.base * 100).toFixed(0)}%`} />
              </span>
              <span className="tabular-nums"><b>{(r.share * 100).toFixed(0)}%</b> <span className={`text-xs ${r.lift >= 1.5 ? "font-semibold text-ink" : "text-muted"}`}>{r.lift.toFixed(1)}x</span></span>
            </li>))}
        </ul>)}
    </section>
  );
}

/** What tends to happen before and after an event: a windowed self-join over the event table, with each kind's overall frequency as the baseline. */
export function PatternsView() {
  const [kind, setKind] = useState("failsafe_activated");
  const [seconds, setSeconds] = useState(60);
  const fleet = useQuery({ queryKey: ["fleet"], queryFn: () => api<FleetStats>("/fleet") });
  const { data, error, isFetching } = useQuery({ queryKey: ["patterns", kind, seconds], queryFn: () => api<Patterns>("/patterns", { kind, seconds }), placeholderData: (p) => p });
  const top = data?.before[0];
  return (
    <div className="pt-8">
      <h1 className="font-dense text-3xl font-semibold tracking-tight">Patterns</h1>
      <p className="mt-1 max-w-3xl text-ink-2">Pick an event and see what tends to happen shortly before it and shortly after it, across every flight. A lift above 1 means the kind is more common around this event than in flights generally.</p>
      <div className="mt-5 flex flex-wrap items-end gap-4">
        <label className="text-sm"><span className="mb-1 block text-ink-2">Event</span>
          <select value={kind} onChange={(e) => setKind(e.target.value)} className="h-10 min-w-[16rem] rounded border border-rule bg-panel px-2 text-[15px]">
            {fleet.data?.kinds.map((k) => <option key={k.kind} value={k.kind}>{k.label} ({k.events})</option>)}</select></label>
        <div className="text-sm"><span className="mb-1 block text-ink-2">Within</span>
          <div className="flex overflow-hidden rounded border border-rule" role="group" aria-label="Time window">
            {[15, 30, 60, 120, 300].map((s) => <button key={s} onClick={() => setSeconds(s)} aria-pressed={seconds === s} className={`px-3.5 py-2 ${seconds === s ? "bg-route font-semibold text-on-route" : "bg-panel text-ink-2 hover:bg-rule-soft"}`}>{s < 60 ? `${s} s` : `${s / 60} min`}</button>)}
          </div></div>
        {isFetching && <span className="pb-2 text-sm text-muted">updating</span>}
      </div>
      {error && <p className="mt-6 text-critical">{(error as Error).message}</p>}
      {data && (
        <>
          <p className="mt-6 max-w-3xl rounded border border-rule bg-panel px-4 py-3 text-[15px]">
            <b>{label(data.kind)}</b> occurs {data.target_events.toLocaleString("en-US")} times in <b>{data.target_flights}</b> of {data.flights} flights.
            {top && <> In {(top.share * 100).toFixed(0)}% of those flights a <b>{label(top.kind)}</b> event came in the {data.seconds} seconds before it; that kind occurs in only {(top.base * 100).toFixed(0)}% of flights overall, a lift of {top.lift.toFixed(1)}.</>}
          </p>
          <div className="mt-8 grid gap-x-14 gap-y-10 lg:grid-cols-2">
            <Side title="Shortly before" rows={data.before} target={data.kind} seconds={data.seconds} dir="before" />
            <Side title="Shortly after" rows={data.after} target={data.kind} seconds={data.seconds} dir="after" />
          </div>
          <p className="mt-8 max-w-3xl text-xs text-muted">Computed live with a self-join of the event table on the flight and a time window (a range join). Counts are flights, not events, so a flight with many repeated events counts once.</p>
        </>)}
    </div>
  );
}
