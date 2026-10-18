"use client";
import { useState } from "react";
import type { EventRow } from "@/lib/api";
import { clock, kindLabel } from "@/lib/format";
import { useView } from "@/lib/store";
import { Severity } from "./severity";

export function EventList({ events, duration }: { events: EventRow[]; duration: number }) {
  const [minSev, setMinSev] = useState(1);
  const focus = useView((s) => s.focus);
  const { setFocus, setRange } = useView.getState();
  const shown = events.filter((e) => e.severity >= minSev);
  const pick = (e: EventRow) => {
    setFocus({ t0: e.t_start, t1: e.t_end });
    setRange([Math.max(0, e.t_start - 20), Math.min(duration, Math.max(e.t_end, e.t_start) + 20)]);
  };
  return (
    <section aria-labelledby="events">
      <div className="flex items-baseline justify-between gap-3">
        <h2 id="events" className="font-dense text-2xl font-semibold">Events <span className="text-base font-normal text-muted">{shown.length}</span></h2>
        <select aria-label="Show events" value={minSev} onChange={(e) => setMinSev(+e.target.value)} className="rounded border border-rule bg-panel px-2 py-1 text-sm">
          <option value={0}>All events</option><option value={1}>Warnings and worse</option><option value={2}>Critical only</option>
        </select>
      </div>
      {shown.length === 0 && <p className="mt-4 text-ink-2">No events at this level. Show all events to see mode changes, arming and takeoffs.</p>}
      <ul className="mt-2 border-t border-rule">
        {shown.map((e) => {
          const active = focus && Math.abs(focus.t0 - e.t_start) < 0.01;
          return (
            <li key={e.id} className="border-b border-rule">
              <button onClick={() => pick(e)} aria-pressed={!!active}
                className={`grid w-full grid-cols-[3rem_minmax(0,1fr)] gap-x-3 px-1 py-2.5 text-left hover:bg-rule-soft ${active ? "bg-rule-soft shadow-[inset_3px_0_0_var(--route)]" : ""}`}>
                <span className="font-dense text-sm tabular-nums text-ink-2">{clock(e.t_start)}</span>
                <span className="min-w-0">
                  <span className="flex flex-wrap items-center gap-x-3"><span className="text-sm font-semibold">{kindLabel(e.kind)}</span><Severity level={e.severity} /></span>
                  <span className="block text-sm text-ink-2">{e.description}</span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
