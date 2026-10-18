"use client";
import { useQuery } from "@tanstack/react-query";
import { api, type Stats } from "@/lib/api";
import { bytes, compact } from "@/lib/format";

export function Corpus() {
  const { data } = useQuery({ queryKey: ["stats"], queryFn: () => api<Stats>("/stats") });
  const rows: [string, string][] = data
    ? [
        ["Flights", data.flights.toLocaleString("en-US")],
        ["Events", data.events.toLocaleString("en-US")],
        ["Telemetry samples", compact(data.telemetry_rows)],
        ["Database size", bytes(data.db_bytes)],
      ]
    : [];
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-[15px]">
      {rows.map(([k, v]) => (<div key={k} className="contents"><dt className="text-ink-2">{k}</dt><dd className="text-right font-semibold tabular-nums">{v}</dd></div>))}
    </dl>
  );
}
