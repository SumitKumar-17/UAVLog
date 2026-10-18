"use client";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { api, type SimilarFlight } from "@/lib/api";
import { FlightStrip } from "./flight-strip";

/** Flights that behaved most like this one: nearest neighbours of a 32-dimension behavioural signature (signal statistics, event rates, mode shares). */
export function SimilarFlights({ flightId }: { flightId: string }) {
  const { data, error, isPending } = useQuery({ queryKey: ["similar", flightId], queryFn: () => api<SimilarFlight[]>(`/flights/${flightId}/similar`, { k: 5 }), retry: false });
  if (error) return <p className="text-ink-2">Similarity is not available yet for this flight.</p>;
  if (isPending) return <p className="text-ink-2" aria-busy>Finding similar flights</p>;
  return (
    <div className="border-t border-rule">
      {data.map((f) => (
        <div key={f.id} className="relative">
          <FlightStrip f={f} />
          <Link href={`/compare?a=${flightId}&b=${f.id}`} className="absolute right-1 top-2 rounded border border-rule bg-panel px-2 py-0.5 text-xs text-ink-2 hover:border-route">Compare</Link>
          <p className="-mt-1 mb-1 px-1 text-xs text-muted">Distance {f.distance.toFixed(3)}; lower means more alike.</p>
        </div>
      ))}
    </div>
  );
}
