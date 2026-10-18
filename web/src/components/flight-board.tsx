"use client";
import { useQuery } from "@tanstack/react-query";
import { api, type FlightSummary } from "@/lib/api";
import { FlightStrip } from "./flight-strip";
import { ModeLegend } from "./mode-legend";

export function FlightBoard({ sort = "critical", limit = 12 }: { sort?: "critical" | "recent" | "longest"; limit?: number }) {
  const { data, isPending, error } = useQuery({ queryKey: ["flights", sort, limit], queryFn: () => api<FlightSummary[]>("/flights", { sort, limit }) });
  if (error) return <p className="py-6 text-critical">Could not load flights: {(error as Error).message}</p>;
  return (
    <div>
      <div className={`border-t border-rule ${isPending ? "opacity-50" : ""}`}>
        {isPending && <div className="h-96" aria-busy />}
        {data?.map((f) => <FlightStrip key={f.id} f={f} />)}
      </div>
      <div className="mt-4"><ModeLegend /></div>
    </div>
  );
}
