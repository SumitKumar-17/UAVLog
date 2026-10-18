"use client";
import { useState } from "react";
import { FlightBoard } from "./flight-board";

const SORTS = [
  { id: "critical", label: "Most critical events" },
  { id: "recent", label: "Most recent" },
  { id: "longest", label: "Longest" },
] as const;

export function FlightsView() {
  const [sort, setSort] = useState<(typeof SORTS)[number]["id"]>("critical");
  return (
    <div className="pt-10">
      <h1 className="font-dense text-3xl font-semibold tracking-tight">Flights</h1>
      <p className="mb-5 mt-1 max-w-2xl text-ink-2">Every flight in the corpus as a strip. Open one to see its telemetry, events and the moments the autopilot flagged.</p>
      <div className="mb-4 flex flex-wrap items-center gap-2 text-[15px]" role="radiogroup" aria-label="Order flights by">
        <span className="mr-1 text-ink-2">Order by</span>
        {SORTS.map((s) => (
          <button key={s.id} role="radio" aria-checked={sort === s.id} onClick={() => setSort(s.id)}
            className={`rounded border px-3 py-1.5 ${sort === s.id ? "border-route bg-rule-soft font-semibold" : "border-rule text-ink-2 hover:border-route"}`}>{s.label}</button>
        ))}
      </div>
      <FlightBoard sort={sort} limit={60} />
    </div>
  );
}
