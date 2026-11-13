"use client";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useState } from "react";
import { api, type Moments } from "@/lib/api";
import { clock } from "@/lib/format";
import { useView } from "@/lib/store";

const label = (k: string) => k.replaceAll("_", " ");

/** Pick a moment of this flight and find the moments in other flights where the signals behaved the same way (nearest 10 second windows). */
export function SimilarMoments({ flightId, duration }: { flightId: string; duration: number }) {
  const range = useView((s) => s.range);
  const focus = useView((s) => s.focus);
  const start = focus ? (focus.t0 + focus.t1) / 2 : range ? (range[0] + range[1]) / 2 : duration / 2;
  const [t, setT] = useState<number | null>(null);
  const at = Math.round(t ?? start);
  const [asked, setAsked] = useState<number | null>(null);
  const { data, error, isFetching } = useQuery({
    queryKey: ["moments", flightId, asked], enabled: asked != null, retry: false,
    queryFn: () => api<Moments>(`/flights/${flightId}/moments`, { t: asked!, k: 8 }),
  });
  return (
    <div>
      <div className="flex flex-wrap items-center gap-4 rounded border border-rule bg-panel px-4 py-3">
        <label className="flex min-w-[16rem] flex-1 items-center gap-3 text-[15px]">
          <span className="whitespace-nowrap text-ink-2">Moment</span>
          <input type="range" min={0} max={Math.max(1, Math.floor(duration))} value={at} onChange={(e) => setT(Number(e.target.value))} className="w-full accent-[var(--route)]" aria-label="Moment in this flight" />
          <span className="w-14 font-semibold tabular-nums">{clock(at)}</span>
        </label>
        <button onClick={() => setAsked(at)} className="h-10 rounded bg-route px-5 font-semibold text-on-route hover:opacity-90">Find similar moments</button>
        <button onClick={() => { setT(Math.round(start)); }} className="h-10 rounded border border-rule px-3 text-sm text-ink-2 hover:border-route">Use the selected event or zoom</button>
      </div>
      {error && <p className="mt-3 text-ink-2">Moment search is not available yet for this flight.</p>}
      {isFetching && <p className="mt-3 text-ink-2" aria-busy>Searching 10 second windows of every flight</p>}
      {data && !isFetching && (
        <div className="mt-3">
          <p className="text-sm text-ink-2">
            Windows most like {clock(data.query.t0)} to {clock(data.query.t1)} of this flight
            {data.query.events.length > 0 && <> (events there: {data.query.events.map(label).join(", ")})</>}. Lower distance means more alike; one best window per flight.
          </p>
          <ul className="mt-2 divide-y divide-rule border-y border-rule">
            {data.results.map((r) => (
              <li key={r.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 py-2.5">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-baseline gap-x-3">
                    <Link href={`/flights/${r.id}?t=${Math.round(r.t0 + 5)}`} className="font-semibold underline decoration-rule underline-offset-2 hover:decoration-route">Flight {r.source_ref.slice(0, 8)}</Link>
                    <span className="text-sm text-ink-2">{r.hw ?? "unknown board"} · {r.firmware ?? "unknown firmware"}</span>
                    <span className="text-sm tabular-nums text-ink-2">{clock(r.t0)} to {clock(r.t1)}</span>
                  </div>
                  <div className="mt-1 flex flex-wrap gap-1.5">
                    {r.events.length === 0 && <span className="text-xs text-muted">no events in this window</span>}
                    {r.events.map((e) => <span key={e} className="rounded border border-rule px-1.5 py-0.5 text-xs text-ink-2">{label(e)}</span>)}
                  </div>
                </div>
                <div className="w-28 text-right">
                  <div className="h-1.5 rounded bg-rule"><div className="h-1.5 rounded bg-route" style={{ width: `${Math.max(4, 100 - r.distance * 250)}%` }} /></div>
                  <div className="mt-1 text-xs tabular-nums text-muted">distance {r.distance.toFixed(3)}</div>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
